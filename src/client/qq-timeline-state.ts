import type { TimelineEntry } from '../shared/conversation-protocol.ts';
export function timelineIdentity(item: TimelineEntry): string { return item.direction === 'inbound' ? `in:${item.message.id}` : `out:${item.delivery.id}`; }
export function timelineMatches(item: TimelineEntry, query: string): boolean {
  const text = item.direction === 'inbound' ? `${item.message.senderName}\n${item.message.text}` : item.delivery.text;
  return text.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}
/** Incremental delivery updates replace their previous row instead of duplicating it. */
export function mergeTimeline(previous: readonly TimelineEntry[], incoming: readonly TimelineEntry[], query = ''): TimelineEntry[] {
  const items = new Map(previous.map(item => [timelineIdentity(item), item]));
  for (const item of incoming) { const key = timelineIdentity(item); const old = items.get(key); if ((!old && timelineMatches(item, query)) || (old && item.change >= old.change)) items.set(key, item); }
  return [...items.values()].sort((a, b) => a.order - b.order || timelineIdentity(a).localeCompare(timelineIdentity(b)));
}
