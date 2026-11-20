import { MemoryHistoryStore } from '@tencent-connect/qqbot-nodejs';
class GroupHistoryStore extends MemoryHistoryStore {
    // An SDK-queued message may already hold a snapshot of these same entries.
    consumed = new WeakSet();
    list(groupKey, limit) {
        return this.unconsumed(super.list(groupKey, limit));
    }
    unconsumed(entries) {
        return entries.filter(entry => !this.consumed.has(entry));
    }
    consume(entries) {
        for (const entry of entries)
            this.consumed.add(entry);
    }
}
const stores = new Map();
export function getHistoryStore(appId) {
    const store = stores.get(appId) ?? new GroupHistoryStore();
    stores.set(appId, store);
    return store;
}
/** 用 appId 前缀隔离群历史（单账号下等价于 groupOpenid，保留多账号扩展） */
export function historyGroupKey(appId, groupId) {
    return `${appId}:${groupId}`;
}
export function clearAccountHistory(appId) {
    stores.delete(appId);
}
//# sourceMappingURL=history-store.js.map