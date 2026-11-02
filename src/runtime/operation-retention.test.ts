import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { OperationRetention } from './operation-retention.ts';
import { QQOperations } from './qq-operations.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'qq-retention-')); roots.push(root);
  const operations = new QQOperations(root);
  const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'expired private body' }] });
  operations.prepare({ operationId: 'legacy', preparedAt: 1, conversationKey: 'key', sessionId: SessionId('native'), generation: 0, policyVersion: '1', message, target: { scope: 'group', targetId: 'g' }, cutoff: 0, backgroundRefs: [], originalReceived: { text: 'expired private body' } });
  const events: Array<{ seq: number; type: string; data: Record<string, unknown> }> = [];
  const append = (type: string, data: Record<string, unknown>) => events.push({ seq: events.length, type, data });
  const close = vi.fn(async () => {});
  const read = vi.fn(async (offset: number, length: number) => ({ events: events.slice(offset, offset + length) }));
  let revision = 'stable';
  const persistence = { stat: vi.fn(async () => ({ revision })), open: vi.fn(async () => ({ read, close })) };
  const retention = new OperationRetention();
  const queued = () => append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message] });
  const finish = () => { append('turn/start', { turn: 1 }); append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] }); append('user/message', { id: message.id }); append('turn/end', { turn: 1 }); };
  return { root, operations, message, events, append, persistence, retention, queued, finish, close, read, mutate: () => { revision = 'changed'; } };
}
describe('old QQ operation retention evidence', () => {
  it('retires count-evicted request bodies only after the native input is proven terminal', async () => {
    const f = fixture(); f.queued();
    await f.retention.sweep(f.persistence, f.operations, () => -Infinity, () => false, () => true);
    expect(f.operations.lookup('legacy')).toBeDefined();
    f.finish(); f.mutate();
    await f.retention.sweep(f.persistence, f.operations, () => -Infinity, () => false, () => true);
    expect(f.operations.lookup('legacy')).toBeUndefined();
    expect(new QQOperations(f.root).has('legacy')).toBe(true);
    expect(readFileSync(join(f.root, 'qq-operations.json'), 'utf8')).not.toContain('expired private body');
  });
  it('cleans an already terminal count-evicted body without reopening native persistence', async () => {
    const f = fixture(); f.operations.markTerminal('legacy');
    await f.retention.sweep(undefined, f.operations, () => -Infinity, () => true, () => true);
    expect(f.operations.lookup('legacy')).toBeDefined();
    await f.retention.sweep(undefined, f.operations, () => -Infinity, () => false, () => true);
    expect(f.operations.lookup('legacy')).toBeUndefined();
    expect(f.persistence.open).not.toHaveBeenCalled();
  });
  it('resumes a large read-only native log without restoring an Agent and deletes only proven terminal bodies', async () => {
    const f = fixture(); f.queued();
    for (let index = 0; index < 4100; index += 1) f.append('fixture/metadata', {});
    f.finish();
    await f.retention.sweep(f.persistence, f.operations, () => 2, () => false);
    expect(f.operations.lookup('legacy')).toBeDefined();
    await f.retention.sweep(f.persistence, f.operations, () => 2, () => false);
    expect(f.read.mock.calls.map(call => call[0])).toEqual([0, 4096]);
    expect(f.close).toHaveBeenCalledTimes(2);
    expect(f.operations.lookup('legacy')).toBeUndefined(); expect(f.operations.has('legacy')).toBe(true);
    expect(readFileSync(join(f.root, 'qq-operations.json'), 'utf8')).not.toContain('expired private body');
  });
  it('preserves a queued snapshot and visibly reports absent legacy evidence', async () => {
    const f = fixture(); f.queued();
    await f.retention.sweep(f.persistence, f.operations, () => 2, () => false);
    expect(f.operations.lookup('legacy')).toBeDefined();
    await f.retention.sweep(undefined, f.operations, () => 2, () => false);
    expect(f.retention.errors()[0]).toContain('缺少终态证据');
    expect(f.operations.lookup('legacy')).toBeDefined();
  });
  it('discards a partial fold when the persisted native revision changes', async () => {
    const f = fixture(); f.queued(); for (let index = 0; index < 4100; index += 1) f.append('fixture/metadata', {}); f.finish();
    await f.retention.sweep(f.persistence, f.operations, () => 2, () => false);
    f.mutate();
    await f.retention.sweep(f.persistence, f.operations, () => 2, () => false);
    expect(f.read.mock.calls.map(call => call[0])).toEqual([0, 0]);
    expect(f.operations.lookup('legacy')).toBeDefined();
  });
});
