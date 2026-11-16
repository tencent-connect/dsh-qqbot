import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReplyTarget } from '../types.ts';
import { QqTimeline, receivedEntryId } from './qq-timeline.ts';
import { DatabaseSync } from 'node:sqlite';

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

it('reads consecutive indexed windows from a 100,000-entry conversation after restart', () => {
  const log = new QqTimeline(dir, logger);
  log.record('A', target, { id: 'first', at: 1, direction: 'inbound', text: 'first', status: 'received' });
  log.close();
  const db = new DatabaseSync(join(dir, 'messages.sqlite'));
  try {
    db.exec(`
      WITH RECURSIVE numbers(n) AS (SELECT 2 UNION ALL SELECT n + 1 FROM numbers WHERE n < 100000)
      INSERT INTO messages (app_id, scope, target_id, message_id, at, body)
      SELECT 'A', 'group', 'shared', CAST(n AS TEXT), n,
        json_object('id', CAST(n AS TEXT), 'at', n, 'direction', 'inbound', 'status', 'received', 'text', CAST(n AS TEXT))
      FROM numbers;
    `);
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT body FROM messages INDEXED BY messages_page
      WHERE app_id = 'A' AND scope = 'group' AND target_id = 'shared' AND seq < 99961 ORDER BY seq DESC LIMIT 41`).all();
    expect(plan.map(row => row.detail)).toEqual([expect.stringContaining('SEARCH messages USING INDEX messages_page')]);
  } finally { db.close(); }
  const reopened = new QqTimeline(dir, logger);
  try {
    const first = reopened.page('A', target)!;
    expect(first.entries.map(row => row.text)).toEqual(Array.from({ length: 40 }, (_, index) => String(99961 + index)));
    const next = reopened.page('A', target, first.before)!;
    expect(next.entries.map(row => row.text)).toEqual(Array.from({ length: 40 }, (_, index) => String(99921 + index)));
  } finally { reopened.close(); }
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

it('expires records using message time', () => {
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
  const db = new DatabaseSync(join(dir, 'messages.sqlite'));
  try {
    expect(db.prepare("SELECT count(*) AS count FROM messages WHERE app_id = 'A' AND message_id = 'old'").get()?.count).toBe(0);
  } finally { db.close(); }
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
