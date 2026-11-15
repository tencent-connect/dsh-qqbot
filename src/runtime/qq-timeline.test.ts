import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReplyTarget } from '../types.ts';
import { QqTimeline, receivedEntryId } from './qq-timeline.ts';
import { deliveryKey } from '../transport/delivery-ledger.ts';

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

it('preserves complete records and resumes appending after a torn UTF-8 tail', () => {
  const record = (log: QqTimeline, id: string, text: string) =>
    log.record('A', target, { id, at: 1, direction: 'inbound', text, status: 'received' });
  record(new QqTimeline(dir, logger), 'before', '原有记录');
  const file = join(dir, deliveryKey('A'), deliveryKey(target.scope, target.targetId), 'rows.jsonl');
  appendFileSync(file, Buffer.from('{"text":"未写完').subarray(0, -1));

  const restarted = new QqTimeline(dir, logger);
  expect(restarted.page('A', target)).toMatchObject({ incomplete: true, entries: [{ text: '原有记录' }] });
  record(restarted, 'after', '新消息');
  const page = new QqTimeline(dir, logger).page('A', target);
  expect(page?.incomplete).toBe(true);
  expect(page?.entries.map(row => row.text)).toEqual(['原有记录', '新消息']);
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

it.each(['account', 'peer'] as const)('ignores an old receipt after clearing the %s', async clear => {
  const log = new QqTimeline(dir, logger);
  const receipt = Promise.withResolvers<string>();
  const id = 'shared-stream';
  const pending = log.observe('A', target, { id, at: 1, direction: 'outbound', text: 'old', status: 'sending' },
    () => receipt.promise, result => ({ status: 'accepted', platformId: result }));
  const other = { id: 'other', at: 1, direction: 'inbound', text: 'other', status: 'received' } as const;
  const privateTarget = { ...target, scope: 'c2c' } as const;
  log.record('A', privateTarget, other);
  log.record('B', target, other);
  if (clear === 'account') log.clearAccount('A');
  else log.clearPeer('A', target);
  expect(log.page('A', target)?.entries).toEqual([]);
  expect(log.page('A', privateTarget)?.entries).toEqual(clear === 'account' ? [] : [other]);
  expect(log.page('B', target)?.entries).toEqual([other]);
  const fresh = { id, at: 2, direction: 'outbound', text: 'new', status: 'rejected' } as const;
  log.record('A', target, fresh);
  receipt.resolve('obsolete-receipt');
  await pending;
  expect(new QqTimeline(dir, logger).page('A', target)?.entries).toEqual([fresh]);
});

it('expires complete journal rows and obsolete versions using record time', () => {
  let cutoff: number | undefined;
  const log = new QqTimeline(dir, logger, appId => appId === 'A' ? cutoff : undefined);
  const old = { id: 'old', at: 5, direction: 'outbound', text: 'old body', status: 'sending' } as const;
  log.record('A', target, old);
  log.record('A', target, { ...old, status: 'accepted', text: 'old edited body' });
  log.record('A', target, { ...old, id: 'boundary', at: 10, status: 'accepted', text: 'keep' });
  log.record('B', target, old);
  const original = log.page('A', target);
  cutoff = 10;
  log.expire('A', target);
  expect(log.page('A', target)?.generation).not.toBe(original?.generation);
  expect(log.entry('A', target, 'old')).toBeUndefined();
  expect(log.page('A', target, 'old')).toBeUndefined();
  expect(log.entry('B', target, 'old')).toBeDefined();
  log.record('A', target, old);
  const file = join(dir, deliveryKey('A'), deliveryKey(target.scope, target.targetId), 'rows.jsonl');
  expect(readFileSync(file, 'utf8')).not.toContain('old');
  expect(new QqTimeline(dir, logger).page('A', target)?.entries.map(row => row.id)).toEqual(['boundary']);
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
