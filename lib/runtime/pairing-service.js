import { generatePairCode, normalizePairCode } from "../shared/pairing-protocol.js";
import { readPairingState, writePairingState } from "./pairing-state.js";
/** 配对码有效期（毫秒）。 */
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 20;
export class PairingService {
    pending = new Map();
    now;
    random;
    stateFile;
    constructor(options = {}) {
        this.now = options.now ?? Date.now;
        this.random = options.random ?? Math.random;
        this.stateFile = options.stateFile;
        this.refresh();
    }
    /** 生成一个新码（清理过期项；超上限淘汰最旧）。 */
    issue(purpose, previousCode) {
        this.refresh();
        this.sweep();
        const at = this.now();
        let code = generatePairCode(this.random);
        let guard = 0;
        while (this.pending.has(code) && guard < 50) {
            code = generatePairCode(this.random);
            guard += 1;
        }
        if (this.pending.has(code))
            throw new Error('配对码生成失败，请重试');
        if (previousCode) {
            const previous = this.pending.get(normalizePairCode(previousCode));
            if (previous && previous.purpose !== purpose)
                throw new Error('配对用途不匹配');
            this.pending.delete(normalizePairCode(previousCode));
        }
        const entry = { code, purpose, expiresAt: at + CODE_TTL_MS, createdAt: at, claims: [], revokedOpenids: [] };
        this.pending.set(code, entry);
        if (this.pending.size > MAX_PENDING) {
            const oldest = [...this.pending.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
            if (oldest)
                this.pending.delete(oldest[0]);
        }
        this.save();
        return this.challenge(entry);
    }
    /** 验证限时批次；成功不会消耗配对码。 */
    validate(rawCode) {
        this.refresh();
        const code = normalizePairCode(rawCode);
        const entry = this.pending.get(code);
        if (entry === undefined)
            return { ok: false, reason: 'unknown' };
        if (this.now() >= entry.expiresAt)
            return { ok: false, reason: 'expired' };
        return { ok: true, purpose: entry.purpose };
    }
    end(rawCode, purpose) {
        this.refresh();
        const code = normalizePairCode(rawCode);
        const challenge = this.pending.get(code);
        if (challenge && challenge.purpose !== purpose)
            throw new Error('配对用途不匹配');
        this.pending.delete(code);
        this.save();
    }
    claimResult(rawCode, openid) {
        this.refresh();
        return this.pending.get(normalizePairCode(rawCode))?.claims.find(member => member.openid === openid);
    }
    /** Existing invitations cannot undo a later removal; fresh invitations start without this fence. */
    revokeIdentity(purpose, openid) {
        if (!openid || openid.length > 1024)
            throw new Error('OpenID 无效');
        this.refresh();
        this.sweep();
        for (const [code, batch] of this.pending) {
            if (batch.purpose === purpose && !batch.revokedOpenids.includes(openid)) {
                this.pending.set(code, { ...batch, revokedOpenids: [...batch.revokedOpenids, openid] });
            }
        }
        this.save();
    }
    isRevoked(rawCode, openid) {
        this.refresh();
        return this.pending.get(normalizePairCode(rawCode))?.revokedOpenids.includes(openid) ?? false;
    }
    recordResult(rawCode, member) {
        this.refresh();
        const entry = this.pending.get(normalizePairCode(rawCode));
        if (!entry || this.now() >= entry.expiresAt)
            throw new Error('配对码已结束');
        if (!entry.claims.some(claim => claim.openid === member.openid)) {
            this.pending.set(entry.code, { ...entry, claims: [...entry.claims, member] });
            this.save();
        }
    }
    hasActiveCode(rawCode) { return this.validate(rawCode).ok; }
    /** 展示进行中的码（未过期的）。 */
    listChallenges() {
        this.refresh();
        const before = this.pending.size;
        this.sweep();
        if (before !== this.pending.size)
            this.save();
        return [...this.pending.values()].sort((a, b) => b.createdAt - a.createdAt).map(batch => this.challenge(batch));
    }
    challenge({ revokedOpenids: _revoked, ...batch }) { return structuredClone(batch); }
    refresh() {
        if (this.stateFile) {
            const rows = readPairingState(this.stateFile);
            this.pending.clear();
            for (const row of rows)
                this.pending.set(row.code, row);
        }
    }
    save() {
        if (this.stateFile)
            writePairingState(this.stateFile, [...this.pending.values()]);
    }
    sweep() {
        const at = this.now();
        for (const [code, e] of this.pending)
            if (at >= e.expiresAt)
                this.pending.delete(code);
    }
}
//# sourceMappingURL=pairing-service.js.map