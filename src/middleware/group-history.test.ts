import { describe, expect, it } from 'vitest';
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import { getHistoryStore } from '../features/history-store.ts';
import { createGroupHistoryBuffer } from './group-history.ts';

describe('group history buffer', () => {
  it('records group image metadata before downstream stop and exposes prior entries', async () => {
    const store = getHistoryStore();
    store.clear?.('test-group-history');
    const middleware = createGroupHistoryBuffer({ limit: 5, store, groupKey: () => 'test-group-history' });
    const ctx = (messageId: string) => ({
      message: {
        kind: 'group', groupOpenid: 'g1', senderId: 'u1', senderName: 'Alice', content: '看图',
        timestamp: '2026-02-03T04:05:06.000Z', messageId,
        attachments: [{ content_type: 'image/png', filename: 'a.png', size: 12, url: 'https://example.test/a.png', width: 10, height: 20 }],
      },
      state: { preDownloadedFiles: [{ contentType: 'image', filename: 'a.png', localPath: '/tmp/a.png' }] },
      stop() {},
    }) as unknown as MiddlewareContext;
    await middleware(ctx('m1'), async () => {});
    const saved = await store.list('test-group-history', 5);
    expect(saved[0]).toMatchObject({ senderId: 'u1', senderName: 'Alice', content: '看图', messageId: 'm1', timestamp: Date.parse('2026-02-03T04:05:06.000Z'), images: [{ contentType: 'image/png', filename: 'a.png', size: 12, url: 'https://example.test/a.png', width: 10, height: 20, localPath: '/tmp/a.png' }] });
    const second = ctx('m2');
    await middleware(second, async () => {});
    expect(second.state.history).toEqual(saved);
    const nonGroup = ctx('m3');
    (nonGroup.message as unknown as { kind: string }).kind = 'c2c';
    await middleware(nonGroup, async () => {});
    expect((await store.list('test-group-history', 5))).toHaveLength(2);
    store.clear?.('test-group-history');
  });
});
