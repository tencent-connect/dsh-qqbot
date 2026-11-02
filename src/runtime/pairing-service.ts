/**
 * 配对码运行期状态 —— 内存态（TTL + 单次），不落盘敏感信息。
 *
 * 两个使用面：
 *  - Web 侧：issue(code) 生成、list() 展示、revoke() 移除。
 *  - QQ 侧：consume(code) 核销（校验 TTL/单次），成功后由调用方写名单。
 *
 * 认领成功记录只存「已认领成员」（openid + 昵称 + 场景 + 时间），供 UI 展示。
 * 授权真相仍是 store 里的 owners / access 白名单；本服务只是配对过程与展示缓存。
 */
import { generatePairCode, normalizePairCode, type ClaimedMember, type PairChallenge, type PairPurpose } from '../shared/pairing-protocol.ts';

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
  private readonly pending = new Map<string, { purpose: PairPurpose; expiresAt: number; createdAt: number }>();
  private readonly claimed: ClaimedMember[] = [];
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(options: { now?: () => number; random?: () => number } = {}) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  /** 生成一个新码（清理过期项；超上限淘汰最旧）。 */
  issue(purpose: PairPurpose): PairChallenge {
    this.sweep();
    const at = this.now();
    let code = generatePairCode(this.random);
    let guard = 0;
    while (this.pending.has(code) && guard < 50) { code = generatePairCode(this.random); guard += 1; }
    const entry = { purpose, expiresAt: at + CODE_TTL_MS, createdAt: at };
    this.pending.set(code, entry);
    if (this.pending.size > MAX_PENDING) {
      const oldest = [...this.pending.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      if (oldest) this.pending.delete(oldest[0]);
    }
    return { code, purpose, expiresAt: entry.expiresAt, createdAt: at };
  }

  /** 核销：成功即删除（单次）；返回用途供调用方写对应名单。失败返回原因，不抛。 */
  consume(rawCode: string): ConsumeResult {
    const code = normalizePairCode(rawCode);
    const entry = this.pending.get(code);
    if (entry === undefined) return { ok: false, reason: 'unknown' };
    this.pending.delete(code);
    if (this.now() > entry.expiresAt) return { ok: false, reason: 'expired' };
    return { ok: true, purpose: entry.purpose };
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
  private readonly pendingConfirms = new Map<string, { purpose: PairPurpose; actor: PendingActor; expiresAt: number }>();

  /** 是否存在一个未过期的进行中配对码（用于裸 token 拦截判断，不核销）。 */
  hasActiveCode(rawCode: string): boolean {
    const code = normalizePairCode(rawCode);
    const entry = this.pending.get(code);
    return entry !== undefined && this.now() <= entry.expiresAt;
  }

  /** 查看某码的用途（不核销）；不存在/过期返回 undefined。 */
  peekPurpose(rawCode: string): PairPurpose | undefined {
    const code = normalizePairCode(rawCode);
    const entry = this.pending.get(code);
    return entry !== undefined && this.now() <= entry.expiresAt ? entry.purpose : undefined;
  }

  /** 记录一个待确认认领，返回 nonce（按钮回调携带）。 */
  beginConfirm(purpose: PairPurpose, actor: PendingActor): string {
    const nonce = generatePairCode(this.random) + generatePairCode(this.random);
    this.pendingConfirms.set(nonce, { purpose, actor, expiresAt: this.now() + CONFIRM_TTL_MS });
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
  takeConfirm(nonce: string): { purpose: PairPurpose; actor: PendingActor } | undefined {
    const entry = this.pendingConfirms.get(nonce);
    if (entry === undefined) return undefined;
    this.pendingConfirms.delete(nonce);
    if (this.now() > entry.expiresAt) return undefined;
    return { purpose: entry.purpose, actor: entry.actor };
  }

  /** 展示进行中的码（未过期的）。 */
  listChallenges(): PairChallenge[] {
    this.sweep();
    const at = this.now();
    return [...this.pending.entries()].map(([code, e]) => ({ code, purpose: e.purpose, expiresAt: e.expiresAt, createdAt: e.createdAt }))
      .filter((c) => c.expiresAt > at)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  private sweep(): void {
    const at = this.now();
    for (const [code, e] of this.pending) if (at > e.expiresAt) this.pending.delete(code);
  }
}
