/**
 * 配对批次：有效期内支持多人／多群认领；关闭或替换后失效。
 *
 * 两个使用面：
 *  - Web 侧：issue(code) 生成、list() 展示、revoke() 移除。
 *  - QQ 侧：consume(code) 校验有效期，成功后由调用方写名单及认领结果。
 *
 * 认领成功记录只存「已认领成员」（openid + 昵称 + 场景 + 时间），供 UI 展示。
 * 授权真相仍是 store 里的 owners / access 白名单；本服务只是配对过程与展示缓存。
 */
import { generatePairCode, normalizePairCode, type ClaimedMember, type PairChallenge, type PairClaimResult, type PairPurpose } from '../shared/pairing-protocol.ts';
import { readPairingState, writePairingState, type StoredPairChallenge } from './pairing-state.ts';

/** 配对码有效期（毫秒）。 */
const CODE_TTL_MS = 10 * 60 * 1000;
/** 输码后等待用户点"确认"的有效期。 */
const CONFIRM_TTL_MS = 5 * 60 * 1000;
/** 同时进行中的码上限。 */
const MAX_PENDING = 20;

/** 待确认认领的发起者信息（QQ 侧发送者）。 */
export interface PendingActor { openid: string; nickname: string; scope: 'group' | 'c2c'; sceneName: string }

export type ConsumeResult =
  | { ok: true; purpose: PairPurpose }
  | { ok: false; reason: 'unknown' | 'expired' | 'used' };

export class PairingService {
  private readonly pending = new Map<string, StoredPairChallenge>();
  private readonly claimed: ClaimedMember[] = [];
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly stateFile: string | undefined;

  constructor(options: { now?: () => number; random?: () => number; stateFile?: string } = {}) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.stateFile = options.stateFile;
    this.refresh();
  }

  /** 生成一个新码（清理过期项；超上限淘汰最旧）。 */
  issue(purpose: PairPurpose, previousCode?: string): PairChallenge {
    this.refresh();
    this.sweep();
    const at = this.now();
    let code = generatePairCode(this.random);
    let guard = 0;
    while (this.pending.has(code) && guard < 50) { code = generatePairCode(this.random); guard += 1; }
    if (this.pending.has(code)) throw new Error('配对码生成失败，请重试');
    if (previousCode) {
      const previous = this.pending.get(normalizePairCode(previousCode));
      if (previous && previous.purpose !== purpose) throw new Error('配对用途不匹配');
      this.pending.delete(normalizePairCode(previousCode));
    }
    const entry: StoredPairChallenge = { code, purpose, expiresAt: at + CODE_TTL_MS, createdAt: at, claims: [], revokedOpenids: [] };
    this.pending.set(code, entry);
    if (this.pending.size > MAX_PENDING) {
      const oldest = [...this.pending.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      if (oldest) this.pending.delete(oldest[0]);
    }
    this.save();
    return this.challenge(entry);
  }

  /** 验证限时批次；成功不会消耗配对码。 */
  consume(rawCode: string): ConsumeResult {
    this.refresh();
    const code = normalizePairCode(rawCode);
    const entry = this.pending.get(code);
    if (entry === undefined) return { ok: false, reason: 'unknown' };
    if (this.now() >= entry.expiresAt) return { ok: false, reason: 'expired' };
    return { ok: true, purpose: entry.purpose };
  }

  end(rawCode: string, purpose: PairPurpose): void {
    this.refresh();
    const code = normalizePairCode(rawCode);
    const challenge = this.pending.get(code);
    if (challenge && challenge.purpose !== purpose) throw new Error('配对用途不匹配');
    this.pending.delete(code); this.save();
  }

  claimResult(rawCode: string, openid: string): PairClaimResult | undefined {
    this.refresh();
    return this.pending.get(normalizePairCode(rawCode))?.claims.find(member => member.openid === openid);
  }

  /** Existing invitations cannot undo a later removal; fresh invitations start without this fence. */
  revokeIdentity(purpose: PairPurpose, openid: string): void {
    if (!openid || openid.length > 1024) throw new Error('OpenID 无效');
    this.refresh(); this.sweep();
    for (const [code, batch] of this.pending) {
      if (batch.purpose === purpose && !batch.revokedOpenids.includes(openid)) {
        this.pending.set(code, { ...batch, revokedOpenids: [...batch.revokedOpenids, openid] });
      }
    }
    this.save();
  }

  isRevoked(rawCode: string, openid: string): boolean {
    this.refresh();
    return this.pending.get(normalizePairCode(rawCode))?.revokedOpenids.includes(openid) ?? false;
  }

  recordResult(rawCode: string, member: PairClaimResult): void {
    this.refresh();
    const entry = this.pending.get(normalizePairCode(rawCode));
    if (!entry || this.now() >= entry.expiresAt) throw new Error('配对码已结束');
    if (!entry.claims.some(claim => claim.openid === member.openid)) {
      this.pending.set(entry.code, { ...entry, claims: [...entry.claims, member] });
      this.save();
    }
  }

  /** 记录认领成功（同一 openid+场景只保留一条，更新时间/昵称）。 */
  recordClaimed(member: ClaimedMember): void {
    const idx = this.claimed.findIndex((m) => m.openid === member.openid && m.scene === member.scene);
    if (idx >= 0) this.claimed[idx] = member; else this.claimed.push(member);
  }

  /** 已认领成员（按用途筛选由调用方结合 store 的 owners/access 决定；这里给出全量缓存）。 */
  listClaimed(): ClaimedMember[] {
    return this.claimed.map((m) => ({ ...m }));
  }

  /** 从缓存移除（撤销时同步）。 */
  forget(openid: string, scene?: 'group' | 'c2c'): void {
    for (let i = this.claimed.length - 1; i >= 0; i -= 1) {
      const m = this.claimed[i];
      if (m && m.openid === openid && (scene === undefined || m.scene === scene)) this.claimed.splice(i, 1);
    }
  }

  // ── 待确认（QQ 输码后、用户点"确认"前）──
  private readonly pendingConfirms = new Map<string, { purpose: PairPurpose; actor: PendingActor; expiresAt: number; code?: string }>();

  /** 是否存在一个未过期的进行中配对码（用于裸 token 拦截判断，不核销）。 */
  hasActiveCode(rawCode: string): boolean {
    this.refresh();
    const code = normalizePairCode(rawCode);
    const entry = this.pending.get(code);
    return entry !== undefined && this.now() < entry.expiresAt;
  }

  /** 查看某码的用途（不核销）；不存在/过期返回 undefined。 */
  peekPurpose(rawCode: string): PairPurpose | undefined {
    this.refresh();
    const code = normalizePairCode(rawCode);
    const entry = this.pending.get(code);
    return entry !== undefined && this.now() < entry.expiresAt ? entry.purpose : undefined;
  }

  /** 记录一个待确认认领，返回 nonce（按钮回调携带）。 */
  beginConfirm(purpose: PairPurpose, actor: PendingActor, code?: string): string {
    const nonce = generatePairCode(this.random) + generatePairCode(this.random);
    this.pendingConfirms.set(nonce, { purpose, actor, expiresAt: this.now() + CONFIRM_TTL_MS, code });
    // 清理过期
    for (const [k, v] of this.pendingConfirms) if (this.now() > v.expiresAt) this.pendingConfirms.delete(k);
    return nonce;
  }

  /** 查看待确认（不删除；过期/未知返回 undefined）。 */
  peekConfirm(nonce: string): { purpose: PairPurpose; actor: PendingActor } | undefined {
    const entry = this.pendingConfirms.get(nonce);
    if (entry === undefined) return undefined;
    if (this.now() > entry.expiresAt) return undefined;
    return { purpose: entry.purpose, actor: entry.actor };
  }

  /** 取出并删除待确认（点按钮时核销；过期/未知返回 undefined）。 */
  takeConfirm(nonce: string): { purpose: PairPurpose; actor: PendingActor; code?: string } | undefined {
    const entry = this.pendingConfirms.get(nonce);
    if (entry === undefined) return undefined;
    this.pendingConfirms.delete(nonce);
    if (this.now() > entry.expiresAt) return undefined;
    return { purpose: entry.purpose, actor: entry.actor, code: entry.code };
  }

  /** 展示进行中的码（未过期的）。 */
  listChallenges(): PairChallenge[] {
    this.refresh();
    const before = this.pending.size;
    this.sweep();
    if (before !== this.pending.size) this.save();
    return [...this.pending.values()].sort((a, b) => b.createdAt - a.createdAt).map(batch => this.challenge(batch));
  }

  private challenge({ revokedOpenids: _revoked, ...batch }: StoredPairChallenge): PairChallenge { return structuredClone(batch); }

  private refresh(): void {
    if (this.stateFile) {
      const rows = readPairingState(this.stateFile);
      this.pending.clear();
      for (const row of rows) this.pending.set(row.code, row);
    }
  }
  private save(): void {
    if (this.stateFile) writePairingState(this.stateFile, [...this.pending.values()]);
  }

  private sweep(): void {
    const at = this.now();
    for (const [code, e] of this.pending) if (at >= e.expiresAt) this.pending.delete(code);
  }
}
