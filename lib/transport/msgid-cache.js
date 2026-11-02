const MAX_PER_TARGET = 10;
const TTL_GROUP = 5 * 60 * 1000; // 群消息被动回复窗口 5 分钟
const TTL_C2C = 30 * 60 * 1000; // 私聊 30 分钟
const MAX_TARGETS = 200;
const EVENT_PREFIX = 'INTERACTION_CREATE:';
const cache = new Map();
function cacheKey(scope, targetId) {
    return `${scope}:${targetId}`;
}
function push(scope, targetId, target, at = Date.now()) {
    if (!scope || !targetId || !target.id)
        return;
    const key = cacheKey(scope, targetId);
    const existing = cache.get(key);
    const timestamp = Math.min(Date.now(), Number.isFinite(at) ? at : Date.now());
    if (existing) {
        if (existing.some(entry => entry.target.kind === target.kind && entry.target.id === target.id))
            return;
        cache.delete(key);
        existing.push({ target, timestamp });
        if (existing.length > MAX_PER_TARGET)
            existing.shift();
        cache.set(key, existing);
        return;
    }
    cache.set(key, [{ target, timestamp }]);
    if (cache.size > MAX_TARGETS) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined)
            cache.delete(oldest);
    }
}
/** 记录普通消息 msgId */
export function cacheMsgId(scope, targetId, msgId, at) {
    if (!msgId)
        return;
    push(scope, targetId, { kind: 'msg', id: msgId }, at);
}
/** 记录互动事件 eventId（内部拼 INTERACTION_CREATE 前缀） */
export function cacheEventId(scope, targetId, eventId) {
    if (!eventId)
        return;
    push(scope, targetId, { kind: 'event', id: `${EVENT_PREFIX}${eventId}` });
}
/** 获取所有未过期的被动回复目标（按时间倒序，最新在前） */
export function getCachedReplyIds(scope, targetId) {
    return getCachedReplySources(scope, targetId).filter(source => source.expiresAt > Date.now()).map(({ kind, id }) => ({ kind, id }));
}
/** Retain expiry metadata for UI status without refreshing or consuming a reply source. */
export function getCachedReplySources(scope, targetId) {
    const list = cache.get(cacheKey(scope, targetId));
    if (!list || list.length === 0)
        return [];
    const ttl = scope === 'group' ? TTL_GROUP : TTL_C2C;
    const result = [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
        const entry = list[i];
        if (entry)
            result.push({ ...entry.target, expiresAt: entry.timestamp + ttl });
    }
    return result;
}
//# sourceMappingURL=msgid-cache.js.map