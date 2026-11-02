/**
 * 被动回复目标缓存 — 记录最近处理的 msgId / eventId，供「无上下文的出站发送」
 * 获取被动回复目标。
 *
 * 按类型区分：普通消息 msgId（填 msg_id）与互动事件 eventId（填 event_id），
 * 避免用字符串前缀做隐式类型判别。
 */
import type { ChatScope } from '../types.ts';

/** 被动回复目标类型 */
export type ReplyIdKind = 'msg' | 'event';

/** 缓存的被动回复目标 */
export interface CachedReplyId {
  kind: ReplyIdKind;
  /** msg: 消息 id；event: 带 INTERACTION_CREATE 前缀的完整事件 id */
  id: string;
}
export interface CachedReplySource extends CachedReplyId { expiresAt: number }

interface CachedEntry {
  target: CachedReplyId;
  timestamp: number;
}

const MAX_PER_TARGET = 10;
const TTL_GROUP = 5 * 60 * 1000; // 群消息被动回复窗口 5 分钟
const TTL_C2C = 30 * 60 * 1000; // 私聊 30 分钟
const MAX_TARGETS = 200;
const EVENT_PREFIX = 'INTERACTION_CREATE:';

const cache = new Map<string, CachedEntry[]>();

function cacheKey(scope: ChatScope, targetId: string): string {
  return `${scope}:${targetId}`;
}

function push(scope: ChatScope, targetId: string | undefined, target: CachedReplyId, at = Date.now()): void {
  if (!scope || !targetId || !target.id) return;
  const key = cacheKey(scope, targetId);
  const existing = cache.get(key);
  const timestamp = Math.min(Date.now(), Number.isFinite(at) ? at : Date.now());
  if (existing) {
    if (existing.some(entry => entry.target.kind === target.kind && entry.target.id === target.id)) return;
    cache.delete(key);
    existing.push({ target, timestamp });
    if (existing.length > MAX_PER_TARGET) existing.shift();
    cache.set(key, existing);
    return;
  }
  cache.set(key, [{ target, timestamp }]);
  if (cache.size > MAX_TARGETS) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/** 记录普通消息 msgId */
export function cacheMsgId(scope: ChatScope, targetId: string | undefined, msgId: string | undefined, at?: number): void {
  if (!msgId) return;
  push(scope, targetId, { kind: 'msg', id: msgId }, at);
}

/** 记录互动事件 eventId（内部拼 INTERACTION_CREATE 前缀） */
export function cacheEventId(scope: ChatScope, targetId: string | undefined, eventId: string | undefined): void {
  if (!eventId) return;
  push(scope, targetId, { kind: 'event', id: `${EVENT_PREFIX}${eventId}` });
}

/** 获取所有未过期的被动回复目标（按时间倒序，最新在前） */
export function getCachedReplyIds(scope: ChatScope, targetId: string): CachedReplyId[] {
  return getCachedReplySources(scope, targetId).filter(source => source.expiresAt > Date.now()).map(({ kind, id }) => ({ kind, id }));
}

/** Retain expiry metadata for UI status without refreshing or consuming a reply source. */
export function getCachedReplySources(scope: ChatScope, targetId: string): CachedReplySource[] {
  const list = cache.get(cacheKey(scope, targetId));
  if (!list || list.length === 0) return [];
  const ttl = scope === 'group' ? TTL_GROUP : TTL_C2C;
  const result: CachedReplySource[] = [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const entry = list[i];
    if (entry) result.push({ ...entry.target, expiresAt: entry.timestamp + ttl });
  }
  return result;
}
