import { generatePairCode, normalizePairCode, type PairChallenge, type PairClaimResult, type PairPurpose } from '../shared/pairing-protocol.ts';
import { readPairingState, writePairingState, type StoredPairChallenge } from './pairing-state.ts';

/** 配对码有效期（毫秒）。 */
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 20;

type Validation =
  | { ok: true; purpose: PairPurpose }
  | { ok: false; reason: 'unknown' | 'expired' };

export class PairingService {
  private readonly pending = new Map<string, StoredPairChallenge>();
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
  validate(rawCode: string): Validation {
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

  hasActiveCode(rawCode: string): boolean { return this.validate(rawCode).ok; }

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
