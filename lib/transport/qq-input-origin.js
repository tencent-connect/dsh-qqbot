/**
 * QQ 入站登记。
 *
 * followup 进去的 user 消息和桌面输入都是 kind=user，靠 source 区分不开。
 * 宿主契约保证 Message.id 跨所有表示边界保持不变（dsh-llm `Message.id`），
 * 所以入站时登记本插件铸造的消息 id，出站在 user/message 上按 id 认领。
 *
 * - 查询不消费：同一条消息可能被事件重放重复读取；
 * - 正常释放由回合结束驱动（TurnTracker.end → release）；
 * - TTL 与条数上限只是兜底，防止丢失 turn/end 时无界增长。
 */
/** 兜底 TTL 下限：至少覆盖一次默认处理超时 */
const MIN_TTL_MS = 30 * 60 * 1000;
/** TTL 相对处理超时的倍数：排队 + 处理都要覆盖到 */
const TTL_PROCESSING_FACTOR = 2;
const DEFAULT_MAX_ENTRIES = 4096;
/** 按处理超时推导兜底 TTL：排队等待 + 一次完整处理都不应让登记过期 */
export function inputOriginTtlMs(processingTimeoutMs) {
    const derived = Number.isFinite(processingTimeoutMs) ? processingTimeoutMs * TTL_PROCESSING_FACTOR : 0;
    return Math.max(MIN_TTL_MS, derived);
}
export class QqInputRegistry {
    entries = new Map();
    ttlMs;
    maxEntries;
    now;
    constructor(options = {}) {
        this.ttlMs = options.ttlMs ?? MIN_TTL_MS;
        this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
        this.now = options.now ?? Date.now;
    }
    /** 登记一条本插件入站的消息 id */
    register(messageId) {
        this.prune();
        this.entries.delete(messageId);
        this.entries.set(messageId, this.now() + this.ttlMs);
        this.evictOverflow();
    }
    /** 是否为本插件登记过且未过期的消息。不删除登记。 */
    has(messageId) {
        if (!messageId)
            return false;
        const expiresAt = this.entries.get(messageId);
        if (expiresAt === undefined)
            return false;
        if (expiresAt > this.now())
            return true;
        this.entries.delete(messageId);
        return false;
    }
    /** 回合结束后释放登记 */
    release(messageId) {
        this.entries.delete(messageId);
    }
    get size() {
        return this.entries.size;
    }
    prune() {
        const now = this.now();
        for (const [id, expiresAt] of this.entries) {
            if (expiresAt <= now)
                this.entries.delete(id);
        }
    }
    evictOverflow() {
        while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined)
                return;
            this.entries.delete(oldest);
        }
    }
}
//# sourceMappingURL=qq-input-origin.js.map