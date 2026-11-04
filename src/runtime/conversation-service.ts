import { commandAccessError } from '../commands/auth.ts';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ConversationStore } from '../conversations/index.ts';
import { PairingService, type PendingActor } from './pairing-service.ts';
import { openidTail, type ClaimedMember, type ManualPairResult, type PairChallenge, type PairPurpose, type PairStatusWire } from '../shared/pairing-protocol.ts';
import type { ChatScope, Logger } from '../types.ts';
import type { ImQQBotConfig } from '../config.ts';
import { getProfileDir } from '../shared/index.ts';
import { PLUGIN_HOME } from '../shared/dirs.ts';
import { updateProfileConfig, readProfileAccess } from '../setup/persist.ts';
export class ConversationService {
  readonly store: ConversationStore;
  readonly pairing: PairingService;
  constructor(readonly config: ImQQBotConfig, readonly logger: Logger) {
    this.pairing = new PairingService({ stateFile: join(PLUGIN_HOME, `pairing-${createHash('sha256').update(config.appId).digest('hex')}.json`) });
    this.store = new ConversationStore(PLUGIN_HOME, config.appId, {legacyOwnerIds: () => config.access.c2cMode === 'allowlist' ? config.access.c2cAllow : []});
    this.store.migratePrefs();
  }
  entry(scope: ChatScope, peerId: string) { return this.store.ensure(scope, peerId); }
  // ── 配对码认领（Web 生成码 / QQ 核销） ──────────────────────────────
  /** Web：为一种名单生成限时配对批次，替换时旧码失效。 */
  issuePairCode(purpose: PairPurpose, previousCode?: string): PairChallenge {
    return this.pairing.issue(purpose, previousCode);
  }
  endPairCode(code: string, purpose: PairPurpose): void { this.pairing.end(code, purpose); }

  /** 读取已认领成员：超管来自 store.owners + memberProfiles；白名单来自 store 的 access。 */
  pairStatus(): PairStatusWire {
    const profiles = this.store.memberProfiles();
    const claimed = this.pairing.listClaimed();
    const toMember = (openid: string, scene?: 'group' | 'c2c'): ClaimedMember => {
      const profile = profiles[openid];
      const cached = claimed.find((m) => m.openid === openid);
      return {
        openid,
        nickname: profile?.nickname || cached?.nickname || '',
        scene: scene ?? profile?.scene ?? cached?.scene ?? 'c2c',
        sceneName: profile?.sceneName || cached?.sceneName || '',
        claimedAt: profile?.claimedAt ?? cached?.claimedAt ?? 0,
      };
    };
    const owners: ClaimedMember[] = this.store.ownerIds().map((openid) => toMember(openid));
    const access = readProfileAccess(this.config.access, getProfileDir() ?? undefined);
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
    const access = readProfileAccess(this.config.access, getProfileDir() ?? undefined);
    const nextAccess = purpose === 'allow-group'
      ? { ...access, groupMode: 'allowlist' as const, groupAllow: [...new Set([...access.groupAllow, openid])] }
      : { ...access, c2cMode: 'allowlist' as const, c2cAllow: [...new Set([...access.c2cAllow, openid])] };
    const persisted = updateProfileConfig({ access: nextAccess }, getProfileDir() ?? undefined, this.logger);
    if (persisted) this.config.access = nextAccess;
    const label = purpose === 'allow-group' ? `群「${nickname || '本群'}」` : nickname ? `「${nickname}」` : '你';
    if (!persisted) return { ok: false, message: `⚠️ 已匹配 ${label}，但写入 profile 失败（源码直载？）。请手动加入白名单。` };
    this.store.setMemberProfile(openid, { nickname, scene, sceneName, claimedAt: member.claimedAt });
    this.pairing.recordClaimed(member);
    return { ok: true, message: `✅ 已将${label}加入${purpose === 'allow-group' ? '群' : '私聊'}白名单。`, member };
  }

  /**
   * QQ 第一阶段：核销配对码，记录"待确认"，返回确认文案 + nonce（供发确认按钮）。
   * 不写名单——等用户点「确认」再 applyClaim。
   */
  /** 该文本是否是一个进行中的配对码（供"裸 token"拦截判断，不核销）。 */
  isActivePairCode(text: string): boolean { return this.pairing.hasActiveCode(text); }

  /** 由 QQ 侧发起认领（群里/私聊直接发送配对码）：解析 actor + startClaim。 */
  beginClaimFromMessage(scope: ChatScope, peerId: string, code: string, senderId: string, senderName?: string): { ok: boolean; message: string } {
    const purpose = this.pairing.peekPurpose(code);
    if ((purpose === 'allow-group' && scope !== 'group') || (purpose === 'allow-c2c' && scope !== 'c2c')) {
      return { ok: false, message: purpose === 'allow-group'
        ? '请在目标群聊中 @机器人发送此配对码；配对码仍然有效。'
        : '请在私聊中发送此配对码；配对码仍然有效。' };
    }
    const entry = this.entry(scope, peerId);
    // 群白名单是对「群」加白：身份用群 openID（peerId），昵称用群名；其余用发送者 openID。
    const isGroupAllow = purpose === 'allow-group';
    const savedName = this.store.memberProfiles()[isGroupAllow ? peerId : senderId]?.nickname;
    const actor: PendingActor = {
      openid: isGroupAllow ? peerId : senderId,
      nickname: isGroupAllow
        ? (entry.alias || savedName || entry.name || '')
        : (senderName?.trim() || savedName || (scope === 'c2c' ? (entry.alias || entry.name) : '') || ''),
      scope: scope === 'group' ? 'group' : 'c2c',
      sceneName: scope === 'group' ? (entry.name || entry.alias || '本群') : (entry.alias || entry.name || '私聊'),
    };
    return this.claimMember(code, actor);
  }

  private claimMember(code: string, actor: PendingActor): { ok: boolean; message: string } {
    const consumed = this.pairing.consume(code);
    if (!consumed.ok) {
      return { ok: false, message: consumed.reason === 'expired' ? '❌ 配对码已过期，请在网页重新生成。' : '❌ 配对码无效或已被使用，请核对后在网页重新生成。' };
    }
    if (this.pairing.isRevoked(code, actor.openid)) return { ok: false, message: '该身份已被移出白名单，请使用新的配对码。' };
    const status = this.pairStatus();
    const members = consumed.purpose === 'owner' ? status.owners : consumed.purpose === 'allow-group' ? status.allowGroup : status.allowC2c;
    const existing = members.find(member => member.openid === actor.openid);
    if (this.pairing.claimResult(code, actor.openid) && !existing) return { ok: false, message: '该身份已被移出白名单，请使用新的配对码。' };
    if (existing) {
      this.pairing.recordResult(code, { ...existing, state: 'existing' });
      return { ok: true, message: `✅ ${existing.nickname || '该身份'}已在白名单中，无需重复添加。` };
    }
    const applied = this.applyMember(consumed.purpose, actor.openid, actor.nickname, actor.scope, actor.sceneName);
    if (applied.ok) this.pairing.recordResult(code, { ...applied.member, state: 'added' });
    return { ok: applied.ok, message: applied.message };
  }

  startClaim(rawCode: string, actor: PendingActor): { ok: boolean; message: string; nonce?: string; purpose?: PairPurpose } {
    const result = this.pairing.consume(rawCode);
    if (!result.ok) {
      return { ok: false, message: result.reason === 'expired' ? '❌ 配对码已过期，请在网页重新生成。' : '❌ 配对码无效或已被使用，请核对后在网页重新生成。' };
    }
    const nonce = this.pairing.beginConfirm(result.purpose, actor, rawCode);
    const label = result.purpose === 'owner' ? '斜杠命令白名单' : result.purpose === 'allow-group' ? '群白名单' : '私聊白名单';
    // 群白名单是对「群」加白——只显示群名，不显示 openID；其余显示昵称（同样不显示 openID）。
    const who = result.purpose === 'allow-group'
      ? `群「${actor.sceneName || actor.nickname || '本群'}」`
      : `「${actor.nickname || '该用户'}」`;
    return { ok: true, nonce, purpose: result.purpose, message: `要把 ${who} 加入【${label}】吗？请点下方按钮确认。` };
  }

  /** QQ 第二阶段：用户点「确认」→ 真正写名单。 */
  applyClaim(nonce: string): { ok: boolean; message: string } {
    const pending = this.pairing.takeConfirm(nonce);
    if (pending === undefined) return { ok: false, message: '⚠️ 认领已过期或已完成，请重新输入配对码。' };
    if (pending.code) return this.claimMember(pending.code, pending.actor);
    return this.applyMember(pending.purpose, pending.actor.openid, pending.actor.nickname, pending.actor.scope, pending.actor.sceneName);
  }

  /** QQ：用户点「取消」→ 丢弃待确认。 */
  cancelClaim(nonce: string): void { this.pairing.takeConfirm(nonce); }

  /**
   * QQ 按钮回调：处理认领确认/取消。
   * 由 gateway dispatchInteraction 在 t==='claim' 时调用。返回是否已处理。
   */
  handleClaimInteraction(event: { id?: string; data?: { resolved?: { button_data?: string } }; user_openid?: string; group_openid?: string; group_member_openid?: string }): { handled: boolean; reply?: string } {
    const raw = event.data?.resolved?.button_data;
    if (raw === undefined) return { handled: false };
    let parsed: { t?: string; d?: string; n?: string };
    try { parsed = JSON.parse(raw) as { t?: string; d?: string; n?: string }; } catch { return { handled: false }; }
    if (parsed.t !== 'claim' || typeof parsed.n !== 'string') return { handled: false };
    const pending = this.pairing.peekConfirm(parsed.n);
    if (pending === undefined) { this.logger.warn('QQ 认领按钮：待确认已过期或不存在'); return { handled: true, reply: '⚠️ 认领已过期或已完成，请重新发送配对码。' }; }
    // 身份校验：确认/取消必须由「发起认领者本人」点击（群白名单由该群成员点击）。
    const clickerUser = event.user_openid ?? event.group_member_openid;
    if (pending.purpose === 'allow-group') {
      if (event.group_openid !== pending.actor.openid) { this.logger.warn('QQ 认领确认被拒绝：非目标群或非群成员'); return { handled: true, reply: '⚠️ 只能在目标群里确认。' }; }
    } else if (clickerUser !== pending.actor.openid) {
      this.logger.warn('QQ 认领确认被拒绝：点击者与发起者不一致'); return { handled: true, reply: '⚠️ 只有发起认领的人才能确认。' };
    }
    if (parsed.d === 'confirm') { const r = this.applyClaim(parsed.n); this.logger.info(`QQ 认领确认: ${r.message}`); return { handled: true, reply: r.message }; }
    this.cancelClaim(parsed.n); this.logger.info('QQ 认领已取消'); return { handled: true, reply: '已取消认领。' };
  }

  /**
   * Web：手动按 openID 直接添加成员（超管 / 白名单）。允许用户自行输入 openid。
   * 显示昵称留空，待日后其在 QQ 发言或认领时补全。
   */
  addManualMember(purpose: PairPurpose, input: string): ManualPairResult {
    // 支持一次添加多个：按换行/英文逗号/中文逗号分隔；每条支持 "openID" 或 "openID:昵称"。
    const parts = String(input).split(/[\n,，;；]+/).map((v) => v.trim()).filter(Boolean);
    if (parts.length === 0) return { ok: false, message: '请填写 openID', added: 0, results: [], errors: [] };
    const scene: 'group' | 'c2c' = purpose === 'allow-group' ? 'group' : 'c2c';
    const results: ManualPairResult['results'] = []; const errors: ManualPairResult['errors'] = [];
    for (const part of parts) {
      // 冒号分隔 openID 与昵称（中文/英文冒号都认），昵称可含空格/中英文
      const sep = part.indexOf(':') >= 0 ? part.indexOf(':') : part.indexOf('：');
      const id = (sep >= 0 ? part.slice(0, sep) : part).trim();
      const nickname = sep >= 0 ? part.slice(sep + 1).trim() : '';
      if (!id || id.length > 1024) { errors.push({ input: part, message: 'OpenID 无效' }); continue; }
      const status = this.pairStatus();
      const members = purpose === 'owner' ? status.owners : purpose === 'allow-group' ? status.allowGroup : status.allowC2c;
      const existing = members.some(member => member.openid === id);
      const r = this.applyMember(purpose, id, nickname, scene, '');
      if (r.ok) {
        if (!results.some(result => result.openid === id)) results.push({ ...r.member, state: existing ? 'existing' : 'added' });
      } else errors.push({ input: part, message: r.message });
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
    this.pairing.forget(openid);
    if (purpose === 'owner') { this.store.revokeOwner(openid); return { ok: true, message: '已从命令白名单移除' }; }
    const access = readProfileAccess(this.config.access, getProfileDir() ?? undefined);
    const nextAccess = purpose === 'allow-group'
      ? { ...access, groupAllow: access.groupAllow.filter((id) => id !== openid) }
      : { ...access, c2cAllow: access.c2cAllow.filter((id) => id !== openid) };
    const persisted = updateProfileConfig({ access: nextAccess }, getProfileDir() ?? undefined, this.logger);
    if (persisted) {
      this.config.access = nextAccess;
    }
    return { ok: persisted, message: persisted ? '已从白名单移除' : '写入失败，请手动移除' };
  }
  commandAccessError(actor?: string): string | undefined {
    return commandAccessError(this.config.access.commandMode, actor, this.isOwner(actor));
  }
  isOwner(actor?: string): boolean { return !!actor && this.store.ownerIds().includes(actor); }
}
