import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReplyTarget } from '../types.ts';
import { QqTimeline, receivedEntryId } from './qq-timeline.ts';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const target: ReplyTarget = { scope: 'group', targetId: 'shared' };
let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qq-timeline-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

it('paginates stable same-time identities across updates, replay and restart', () => {
  const log = new QqTimeline(dir, logger);
  const record = (i: number, text = String(i), appId = 'A') => log.record(appId, target, {
    id: receivedEntryId(String(i)), at: 1, direction: 'inbound', text, status: 'received',
  }, true);
  for (let i = 0; i < 49; i++) record(i);
  record(16, 'duplicate');
  record(16, 'other bot', 'B');
  const first = log.page('A', target)!;
  expect(first.entries).toHaveLength(40);
  expect(first.entries[0]?.text).toBe('9');
  expect(first.entries.find(row => row.id === receivedEntryId('16'))?.text).toBe('16');
  record(49);
  const incoming = { ...target, msgId: '8' };
  log.reportInbound('A', incoming, 'mention-required');
  log.reportInbound('A', incoming, 'submitted', 'original-session');
  log.reportInbound('A', incoming, 'submit-failed');
  const restored = new QqTimeline(dir, logger);
  const older = restored.page('A', target, first.before)!;
  expect(older.entries.map(row => row.text)).toEqual(Array.from({ length: 9 }, (_, index) => String(index)));
  expect(older.entries.at(-1)).toMatchObject({ sessionId: 'original-session', inboundOutcome: 'submitted' });
  expect(restored.page('B', target)?.entries[0]).toMatchObject({ text: 'other bot', status: 'received' });
  expect(restored.entry('B', target, receivedEntryId('8'))).toBeUndefined();
  expect(restored.entry('A', target, receivedEntryId('8'))?.inboundOutcome).toBe('submitted');
  expect(restored.page('A', { ...target, scope: 'c2c' })?.entries).toEqual([]);
});

it('does not report a pending request as successful after restart', async () => {
  const log = new QqTimeline(dir, logger);
  const id = 'submitted';
  let accept!: (reply: string) => void;
  const pending = log.observe('A', target, {
    id, at: 1, direction: 'outbound', text: 'answer', status: 'sending',
  }, () => new Promise<string>(resolve => { accept = resolve; }), result => ({ status: 'accepted', platformId: result }));
  expect(log.page('A', target)?.entries[0]?.status).toBe('sending');
  expect(new QqTimeline(dir, logger).entry('A', target, id)?.status).toBe('unknown');
  accept('qq-receipt');
  await pending;
  expect(new QqTimeline(dir, logger).page('A', target)?.entries).toMatchObject([{ id, status: 'accepted', platformId: 'qq-receipt' }]);
});

it('preserves the real SDK outcome when the display store is unwritable', async () => {
  const path = join(dir, 'file');
  writeFileSync(path, 'invalid root');
  const log = new QqTimeline(path, logger);
  await expect(log.observe('A', target, {
    id: 'one', at: 1, direction: 'outbound', text: 'real outbound', status: 'sending',
  }, async () => 'accepted', () => ({ status: 'accepted' }))).resolves.toBe('accepted');
  expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('流水'));
});
