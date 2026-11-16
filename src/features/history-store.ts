import { MemoryHistoryStore, type HistoryEntry } from '@tencent-connect/qqbot-nodejs';

class GroupHistoryStore extends MemoryHistoryStore {
  // An SDK-queued message may already hold a snapshot of these same entries.
  private readonly consumed = new WeakSet<HistoryEntry>();

  override list(groupKey: string, limit: number): HistoryEntry[] {
    return this.unconsumed(super.list(groupKey, limit));
  }

  unconsumed(entries: readonly HistoryEntry[]): HistoryEntry[] {
    return entries.filter(entry => !this.consumed.has(entry));
  }

  consume(entries: readonly HistoryEntry[]): void {
    for (const entry of entries) this.consumed.add(entry);
  }
}

const stores = new Map<string, GroupHistoryStore>();

export function getHistoryStore(appId: string): GroupHistoryStore {
  const store = stores.get(appId) ?? new GroupHistoryStore();
  stores.set(appId, store);
  return store;
}

/** 用 appId 前缀隔离群历史（单账号下等价于 groupOpenid，保留多账号扩展） */
export function historyGroupKey(appId: string, groupId: string): string {
  return `${appId}:${groupId}`;
}

export function clearAccountHistory(appId: string): void {
  stores.delete(appId);
}
