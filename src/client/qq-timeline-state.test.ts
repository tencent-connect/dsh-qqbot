import { describe, expect, it } from 'vitest';
import type { TimelineEntry } from '../shared/conversation-protocol.ts';
import { mergeTimeline, timelineMatches } from './qq-timeline-state.ts';
const incoming: TimelineEntry = { direction: 'inbound', order: 2, change: 2, message: { id: 'same', senderId: 'user', senderName: '小明', at: 2, text: '问题', mentioned: true, attachments: [] } };
function delivery(change: number, state: 'pending' | 'accepted', order = 3): TimelineEntry { return { direction: 'outbound', order, change, delivery: { id: 'same', key: 'group', at: 3, updatedAt: change, state, text: '回答', parts: [] } }; }
describe('QQ message timeline merge', () => {
  it('erases expired search matches and does not add unrelated change-stream bodies', () => {
    const first = mergeTimeline([], [incoming], '问题');
    const expired: TimelineEntry = { ...incoming, change: 9, message: { ...incoming.message, senderName: '', text: '', bodyState: 'expired' } };
    const updated = mergeTimeline(first, [expired, delivery(10, 'accepted')], '问题');
    expect(updated).toEqual([expired]);
    expect(updated.filter(item => timelineMatches(item, '问题'))).toEqual([]);
    expect(JSON.stringify(updated)).not.toContain('问题');
    expect(mergeTimeline(updated, [incoming], '问题')).toEqual([expired]);
  });
  it('keeps directional identities, sorts old pages, and replaces delivery state incrementally', () => {
    const first = mergeTimeline([], [delivery(3, 'pending'), incoming]);
    const updated = mergeTimeline(first, [delivery(6, 'accepted'), { ...incoming, order: 1, message: { ...incoming.message, id: 'older' } }]);
    expect(updated.map(item => item.order)).toEqual([1, 2, 3]);
    expect(updated.at(-1)).toMatchObject({ delivery: { state: 'accepted' } });
    expect(mergeTimeline(updated, [delivery(3, 'pending')])).toEqual(updated);
  });
});
