const MAX_PER_TARGET = 10;
const TTL_GROUP = 5 * 60 * 1000; // 群消息被动回复窗口 5 分钟
const TTL_C2C = 30 * 60 * 1000; // 私聊 30 分钟
const MAX_TARGETS = 200;
const EVENT_PREFIX = 'INTERACTION_CREATE:';
function cacheKey(scope, targetId) {
    return `${scope}:${targetId}`;
}
export class ReplyIdCache {
    cache = new Map();
    cacheMsgId(scope, targetId, msgId) {
        if (!msgId)
            return;
        this.push(scope, targetId, { kind: 'msg', id: msgId });
    }
    forgetMsgId(scope, targetId, msgId) {
        const key = cacheKey(scope, targetId);
        const entries = this.cache.get(key)?.filter(entry => entry.target.kind !== 'msg' || entry.target.id !== msgId);
        if (entries?.length)
            this.cache.set(key, entries);
        else
            this.cache.delete(key);
    }
    cacheEventId(scope, targetId, eventId) {
        if (!eventId)
            return;
        this.push(scope, targetId, { kind: 'event', id: `${EVENT_PREFIX}${eventId}` });
    }
    getCachedReplyIds(scope, targetId) {
        const list = this.cache.get(cacheKey(scope, targetId));
        if (!list)
            return [];
        const now = Date.now();
        const ttl = scope === 'group' ? TTL_GROUP : TTL_C2C;
        return list.filter(entry => now - entry.timestamp < ttl).reverse().map(entry => entry.target);
    }
    push(scope, targetId, target) {
        if (!scope || !targetId || !target.id)
            return;
        const key = cacheKey(scope, targetId);
        const existing = this.cache.get(key);
        if (existing) {
            this.cache.delete(key);
            existing.push({ target, timestamp: Date.now() });
            if (existing.length > MAX_PER_TARGET)
                existing.shift();
            this.cache.set(key, existing);
            return;
        }
        this.cache.set(key, [{ target, timestamp: Date.now() }]);
        if (this.cache.size > MAX_TARGETS) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined)
                this.cache.delete(oldest);
        }
    }
}
//# sourceMappingURL=msgid-cache.js.map