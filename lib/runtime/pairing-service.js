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
import { generatePairCode, normalizePairCode } from "../shared/pairing-protocol.js";
import { readPairingState, writePairingState } from "./pairing-state.js";
/** 配对码有效期（毫秒）。 */
const CODE_TTL_MS = 10 * 60 * 1000;
/** 输码后等待用户点"确认"的有效期。 */
const CONFIRM_TTL_MS = 5 * 60 * 1000;
/** 同时进行中的码上限。 */
const MAX_PENDING = 20;
export class PairingService {
    pending = new Map();
    claimed = [];
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
        const entry = { code, purpose, expiresAt: at + CODE_TTL_MS, createdAt: at, claims: [] };
        this.pending.set(code, entry);
        if (this.pending.size > MAX_PENDING) {
            const oldest = [...this.pending.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
            if (oldest)
                this.pending.delete(oldest[0]);
        }
        this.save();
        return structuredClone(entry);
    }
    /** 验证限时批次；成功不会消耗配对码。 */
    consume(rawCode) {
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
    /** 记录认领成功（同一 openid+场景只保留一条，更新时间/昵称）。 */
    recordClaimed(member) {
        const idx = this.claimed.findIndex((m) => m.openid === member.openid && m.scene === member.scene);
        if (idx >= 0)
            this.claimed[idx] = member;
        else
            this.claimed.push(member);
    }
    /** 已认领成员（按用途筛选由调用方结合 store 的 owners/access 决定；这里给出全量缓存）。 */
    listClaimed() {
        return this.claimed.map((m) => ({ ...m }));
    }
    /** 从缓存移除（撤销时同步）。 */
    forget(openid, scene) {
        for (let i = this.claimed.length - 1; i >= 0; i -= 1) {
            const m = this.claimed[i];
            if (m && m.openid === openid && (scene === undefined || m.scene === scene))
                this.claimed.splice(i, 1);
        }
    }
    // ── 待确认（QQ 输码后、用户点"确认"前）──
    pendingConfirms = new Map();
    /** 是否存在一个未过期的进行中配对码（用于裸 token 拦截判断，不核销）。 */
    hasActiveCode(rawCode) {
        this.refresh();
        const code = normalizePairCode(rawCode);
        const entry = this.pending.get(code);
        return entry !== undefined && this.now() < entry.expiresAt;
    }
    /** 查看某码的用途（不核销）；不存在/过期返回 undefined。 */
    peekPurpose(rawCode) {
        this.refresh();
        const code = normalizePairCode(rawCode);
        const entry = this.pending.get(code);
        return entry !== undefined && this.now() < entry.expiresAt ? entry.purpose : undefined;
    }
    /** 记录一个待确认认领，返回 nonce（按钮回调携带）。 */
    beginConfirm(purpose, actor, code) {
        const nonce = generatePairCode(this.random) + generatePairCode(this.random);
        this.pendingConfirms.set(nonce, { purpose, actor, expiresAt: this.now() + CONFIRM_TTL_MS, code });
        // 清理过期
        for (const [k, v] of this.pendingConfirms)
            if (this.now() > v.expiresAt)
                this.pendingConfirms.delete(k);
        return nonce;
    }
    /** 查看待确认（不删除；过期/未知返回 undefined）。 */
    peekConfirm(nonce) {
        const entry = this.pendingConfirms.get(nonce);
        if (entry === undefined)
            return undefined;
        if (this.now() > entry.expiresAt)
            return undefined;
        return { purpose: entry.purpose, actor: entry.actor };
    }
    /** 取出并删除待确认（点按钮时核销；过期/未知返回 undefined）。 */
    takeConfirm(nonce) {
        const entry = this.pendingConfirms.get(nonce);
        if (entry === undefined)
            return undefined;
        this.pendingConfirms.delete(nonce);
        if (this.now() > entry.expiresAt)
            return undefined;
        return { purpose: entry.purpose, actor: entry.actor, code: entry.code };
    }
    /** 展示进行中的码（未过期的）。 */
    listChallenges() {
        this.refresh();
        const before = this.pending.size;
        this.sweep();
        if (before !== this.pending.size)
            this.save();
        return structuredClone([...this.pending.values()].sort((a, b) => b.createdAt - a.createdAt));
    }
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