import { commandAccessError } from '../commands/auth.ts';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { MemberStore } from './member-store.ts';
import { PairingService } from './pairing-service.ts';
import { openidTail, parseWhitelistEntries, type ClaimedMember, type ManualPairResult, type PairChallenge, type PairPurpose, type PairStatusWire } from '../shared/pairing-protocol.ts';
import type { ChatScope, Logger } from '../types.ts';
import type { AccessControlConfig, ImQQBotConfig } from '../config.ts';
import { getProfileDir } from '../shared/index.ts';
import { PLUGIN_HOME } from '../shared/dirs.ts';
import { updateProfileConfig, readProfileAccess, readProfileAccessSnapshot } from '../setup/persist.ts';

/** 配对码随机源：均匀分布于 [0, 1)。配对码是白名单授权凭据，必须使用密码学随机数。 */
const secureRandom = (): number => randomBytes(4).readUInt32BE(0) / 2 ** 32;

/** 可注入依赖（测试与存储替换）；缺省使用基于文件的实现。 */
export interface AccountAccessDeps {
  /**
   * 配对码随机源，缺省为密码学随机。
   * 只在使用默认 PairingService 时生效；同时注入 `pairing` 时会被忽略。
   */
  random?: () => number;
  store?: MemberStore;
  pairing?: PairingService;
}

export class AccountAccessService {
  readonly store: MemberStore;
  readonly pairing: PairingService;
  constructor(readonly config: ImQQBotConfig, readonly logger: Logger, deps: AccountAccessDeps = {}) {
    this.pairing = deps.pairing ?? new PairingService({
      stateFile: join(PLUGIN_HOME, `pairing-${createHash('sha256').update(config.appId).digest('hex')}.json`),
      random: deps.random ?? secureRandom,
    });
    this.store = deps.store ?? new MemberStore(PLUGIN_HOME, config.appId, () => config.access.c2cMode === 'allowlist' ? config.access.c2cAllow : []);
  }
  // ── 配对码认领（Web 生成码 / QQ 核销） ──────────────────────────────
  /** Web：为一种名单生成限时配对批次，替换时旧码失效。 */
  issuePairCode(purpose: PairPurpose, previousCode?: string): PairChallenge {
    return this.pairing.issue(purpose, previousCode);
  }
  endPairCode(code: string, purpose: PairPurpose): void { this.pairing.end(code, purpose); }

  /** 读取已认领成员：超管来自 store.owners + memberProfiles；白名单来自 store 的 access。 */
  pairStatus(): PairStatusWire {
    const profiles = this.store.memberProfiles();
    const toMember = (openid: string, scene?: 'group' | 'c2c'): ClaimedMember => {
      const profile = profiles[openid];
      return {
        openid,
        nickname: profile?.nickname ?? '',
        scene: scene ?? profile?.scene ?? 'c2c',
        sceneName: profile?.sceneName ?? '',
        claimedAt: profile?.claimedAt ?? 0,
      };
    };
    const owners: ClaimedMember[] = this.store.ownerIds().map((openid) => toMember(openid));
    const access = this.currentAccess();
    const allowC2c: ClaimedMember[] = [...access.c2cAllow].map((openid) => toMember(openid, 'c2c'));
    const allowGroup: ClaimedMember[] = [...access.groupAllow].map((openid) => toMember(openid, 'group'));
    const challenges = this.pairing.listChallenges().map(challenge => {
      const members = challenge.purpose === 'owner' ? owners : challenge.purpose === 'allow-group' ? allowGroup : allowC2c;
      return { ...challenge, claims: challenge.claims.map(claim => {
        const member = members.find(member => member.openid === claim.openid);
        return member ? { ...claim, ...member } : { ...claim, state: 'revoked' as const };
      }) };
    });
    return { challenges, owners, allowC2c, allowGroup };
  }

  /** 把（openid + 展示资料）写入指定名单（超管 / 私聊白名单 / 群白名单）。返回是否成功。 */
  private applyMember(purpose: PairPurpose, openid: string, nickname: string, scene: 'group' | 'c2c', sceneName: string): { ok: true; message: string; member: ClaimedMember } | { ok: false; message: string } {
    nickname = nickname.trim() || this.store.memberProfiles()[openid]?.nickname || '';
    const member: ClaimedMember = { openid, nickname, scene, sceneName, claimedAt: Date.now() };
    if (purpose === 'owner') {
      this.store.claimOwner(openid, { nickname, scene, sceneName, claimedAt: member.claimedAt });
      return { ok: true, message: `✅ 已把「${nickname || openidTail(openid)}」加入斜杠命令白名单。`, member };
    }
    this.store.setMemberProfile(openid, { nickname, scene, sceneName, claimedAt: member.claimedAt });
    const persisted = this.updateMembership(purpose, list => [...new Set([...list, openid])]);
    const label = purpose === 'allow-group' ? `群「${nickname || '本群'}」` : nickname ? `「${nickname}」` : '你';
    if (!persisted) return { ok: false, message: `⚠️ 已匹配 ${label}，但写入 profile 失败（源码直载？）。请手动加入白名单。` };
    return { ok: true, message: `✅ 已将${label}加入${purpose === 'allow-group' ? '群' : '私聊'}白名单。`, member };
  }

  /** 该文本是否是一个进行中的配对码（供"裸 token"拦截判断，不核销）。 */
  isActivePairCode(text: string): boolean { return this.pairing.hasActiveCode(text); }

  /** 由 QQ 侧发起认领（群里/私聊直接发送配对码）：在允许接入的场景认领。 */
  beginClaimFromMessage(scope: ChatScope, peerId: string, code: string, senderId: string, senderName?: string): { ok: boolean; message: string } {
    const validation = this.pairing.validate(code);
    if (!validation.ok) {
      return { ok: false, message: validation.reason === 'expired' ? '❌ 配对码已过期，请在网页重新生成。' : '❌ 配对码无效或已结束，请在网页重新生成。' };
    }
    const { purpose } = validation;
    if ((purpose === 'allow-group' && scope !== 'group') || (purpose === 'allow-c2c' && scope !== 'c2c')) {
      return { ok: false, message: purpose === 'allow-group'
        ? '请在目标群聊中 @机器人发送此配对码；配对码仍然有效。'
        : '请在私聊中发送此配对码；配对码仍然有效。' };
    }
    const access = this.currentAccess();
    if ((scope === 'group' ? access.groupMode : access.c2cMode) === 'disabled') {
      return { ok: false, message: '此类 QQ 对话的接入已关闭，无法认领配对码。' };
    }
    const entry = this.store.peerName(scope, peerId);
    // 群白名单是对「群」加白：身份用群 openID（peerId），昵称用群名；其余用发送者 openID。
    const isGroupAllow = purpose === 'allow-group';
    const savedName = this.store.memberProfiles()[isGroupAllow ? peerId : senderId]?.nickname;
    return this.claimMember(code, purpose, {
      openid: isGroupAllow ? peerId : senderId,
      nickname: isGroupAllow
        ? (entry.alias || savedName || entry.name || '')
        : (senderName?.trim() || savedName || (scope === 'c2c' ? (entry.alias || entry.name) : '') || ''),
      scene: scope,
      sceneName: scope === 'group' ? (entry.name || entry.alias || '本群') : (entry.alias || entry.name || '私聊'),
    });
  }

  private claimMember(code: string, purpose: PairPurpose, actor: Omit<ClaimedMember, 'claimedAt'>): { ok: boolean; message: string } {
    if (this.pairing.isRevoked(code, actor.openid)) return { ok: false, message: '该身份已被移出白名单，请使用新的配对码。' };
    const status = this.pairStatus();
    const members = purpose === 'owner' ? status.owners : purpose === 'allow-group' ? status.allowGroup : status.allowC2c;
    const existing = members.find(member => member.openid === actor.openid);
    if (this.pairing.claimResult(code, actor.openid) && !existing) return { ok: false, message: '该身份已被移出白名单，请使用新的配对码。' };
    if (existing) {
      this.pairing.recordResult(code, { ...existing, state: 'existing' });
      return { ok: true, message: `✅ ${existing.nickname || '该身份'}已在白名单中，无需重复添加。` };
    }
    const applied = this.applyMember(purpose, actor.openid, actor.nickname, actor.scene, actor.sceneName);
    if (applied.ok) this.pairing.recordResult(code, { ...applied.member, state: 'added' });
    return { ok: applied.ok, message: applied.message };
  }

  /**
   * Web：手动按 openID 直接添加成员（超管 / 白名单）。允许用户自行输入 openid。
   * 显示昵称留空，待日后其在 QQ 发言或认领时补全。
   */
  addManualMember(purpose: PairPurpose, input: string): ManualPairResult {
    const entries = parseWhitelistEntries(input);
    if (entries.length === 0) return { ok: false, message: '请填写 OpenID', added: 0, results: [], errors: [] };
    const scene = purpose === 'allow-group' ? 'group' : 'c2c';
    const results: ManualPairResult['results'] = [];
    const errors: ManualPairResult['errors'] = [];
    const status = this.pairStatus();
    const members = purpose === 'owner' ? status.owners : purpose === 'allow-group' ? status.allowGroup : status.allowC2c;
    const existing = new Set(members.map(member => member.openid));
    const processed = new Set<string>();
    for (const entry of entries) {
      if ('message' in entry) { errors.push(entry); continue; }
      const { input: part, openid, nickname } = entry;
      if (processed.has(openid)) continue;
      try {
        const result = this.applyMember(purpose, openid, nickname, scene, '');
        if (result.ok) {
          processed.add(openid);
          results.push({ ...result.member, state: existing.has(openid) ? 'existing' : 'added' });
        } else errors.push({ input: part, message: result.message });
      } catch (err) {
        this.logger.warn(`QQ 名单写入失败: ${err instanceof Error ? err.message : String(err)}`);
        errors.push({ input: part, message: '名单写入失败，请重试此项。' });
      }
    }
    const added = results.length;
    if (added === 0) return { ok: false, message: errors[0]?.message ?? '添加失败', added: 0, results, errors };
    return { ok: true, added, results, errors, message: `已处理 ${added} 项${errors.length ? `；${errors.length} 项失败` : ''}` };
  }

  /** Web：修改成员显示昵称（openid 身份不变）。 */
  renameMember(openid: string, nickname: string): { ok: boolean; message: string } {
    const id = openid.trim();
    if (!id) return { ok: false, message: 'openID 无效' };
    this.store.setMemberNickname(id, nickname.trim());
    return { ok: true, message: '昵称已更新' };
  }

  /** Web：撤销一个已认领身份（超管 / 白名单）。 */
  revokePair(openid: string, purpose: PairPurpose): { ok: boolean; message: string } {
    // Persist the fence first: a failed fence must not report a successful removal.
    this.pairing.revokeIdentity(purpose, openid);
    if (purpose === 'owner') { this.store.revokeOwner(openid); return { ok: true, message: '已从命令白名单移除' }; }
    const persisted = this.updateMembership(purpose, list => list.filter(id => id !== openid));
    return { ok: persisted, message: persisted ? '已从白名单移除' : '写入失败，请手动移除' };
  }

  private updateMembership(purpose: Exclude<PairPurpose, 'owner'>, change: (list: readonly string[]) => string[]): boolean {
    const profileDir = getProfileDir() ?? undefined;
    const { appId, access: fallback } = this.config;
    const { access, revision } = readProfileAccessSnapshot(fallback, profileDir, appId);
    const field = purpose === 'allow-group' ? 'groupAllow' : 'c2cAllow';
    const next = { ...access, [field]: change(access[field]) };
    const persisted = updateProfileConfig({ access: next }, profileDir, this.logger, { appId, fallback, revision });
    if (persisted) this.syncConfigAccess(next);
    return persisted;
  }

  /**
   * 把最新 access 写回宿主持有的 config 对象。这是刻意的 HMR 窗口同步：
   * updateProfileConfig 触发宿主重载之前，旧 fiber 仍在服务 QQ 请求，
   * 必须立即看到新名单，否则会按旧名单放行/拒绝。
   */
  private syncConfigAccess(access: AccessControlConfig): void {
    this.config.access = access;
  }

  currentAccess() {
    return readProfileAccess(this.config.access, getProfileDir() ?? undefined, this.config.appId);
  }
  commandAccessError(actor?: string): string | undefined {
    const mode = this.currentAccess().commandMode;
    return commandAccessError(mode, actor, mode === 'allowlist' && this.isOwner(actor));
  }
  isOwner(actor?: string): boolean { return !!actor && this.store.ownerIds().includes(actor); }
}
