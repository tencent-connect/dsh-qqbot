import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { GroupHistoryEntry } from '../features/history-store.ts';
import { getHistoryStore } from '../features/history-store.ts';
import { createGroupWaitController } from './group-wait.ts';

function entry(id: string, content = id): GroupHistoryEntry {
  return {
    senderId: `sender-${id}`,
    senderName: `Sender ${id}`,
    content,
    timestamp: Date.parse('2026-01-01T00:00:00.000Z') + Number(id) * 1000,
    messageId: `message-${id}`,
  };
}

function context(wasMentioned: boolean, error = vi.fn()): MiddlewareContext & { stopped: boolean } {
  let stopped = false;
  return {
    state: { mention: { wasMentioned } },
    log: { info: vi.fn(), error },
    stop: vi.fn(() => { stopped = true; }),
    get stopped() { return stopped; },
  } as unknown as MiddlewareContext & { stopped: boolean };
}

function createController(
  onTimeout: (groupId: string, entries: GroupHistoryEntry[]) => Promise<void>,
  overrides: Partial<Parameters<typeof createGroupWaitController>[0]> = {},
) {
  const store = getHistoryStore();
  store.clear?.('app:g1');
  const controller = createGroupWaitController({
    enabled: true,
    timeoutMs: 100,
    historyLimit: 2,
    store,
    groupKey: () => 'app:g1',
    groupId: () => 'g1',
    onTimeout,
    ...overrides,
  });
  return { store, controller };
}

describe('group wait controller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stops unmentioned messages and flushes one history-limited batch', async () => {
    const batches: HistoryEntry[][] = [];
    const { store, controller } = createController(async (_groupId, entries) => {
      batches.push(entries);
    });

    store.append('app:g1', entry('1'), 2);
    const first = context(false);
    await controller.middleware(first, vi.fn());
    store.append('app:g1', entry('2'), 2);
    const second = context(false);
    await controller.middleware(second, vi.fn());
    store.append('app:g1', entry('3'), 2);

    expect(first.stopped).toBe(true);
    expect(second.stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(batches.map(batch => batch.map(item => item.content))).toEqual([['2', '3']]);
    controller.dispose();
  });

  it('passes image metadata through the timeout snapshot unchanged', async () => {
    const batches: GroupHistoryEntry[][] = [];
    const { store, controller } = createController(async (_groupId, entries) => { batches.push(entries); });
    const item = entry('1');
    item.images = [{ contentType: 'image/png', filename: 'a.png', size: 1, url: 'https://example.test/a.png', localPath: '/tmp/a.png' }];
    store.append('app:g1', item, 2);
    await controller.middleware(context(false), vi.fn());
    await vi.advanceTimersByTimeAsync(100);
    expect(batches[0]?.[0]?.images).toEqual(item.images);
    controller.dispose();
  });

  it('does not reset the first deadline and starts the next round after flush', async () => {
    const batches: string[][] = [];
    const { store, controller } = createController(async (_groupId, entries) => {
      batches.push(entries.map(item => item.content));
    });

    store.append('app:g1', entry('1'), 2);
    await controller.middleware(context(false), vi.fn());
    await vi.advanceTimersByTimeAsync(80);
    store.append('app:g1', entry('2'), 2);
    await controller.middleware(context(false), vi.fn());
    await vi.advanceTimersByTimeAsync(19);
    expect(batches).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(batches).toEqual([['1', '2']]);

    store.append('app:g1', entry('3'), 2);
    await controller.middleware(context(false), vi.fn());
    await vi.advanceTimersByTimeAsync(99);
    expect(batches).toEqual([['1', '2']]);
    await vi.advanceTimersByTimeAsync(1);
    expect(batches).toEqual([['1', '2'], ['3']]);
    controller.dispose();
  });

  it('keeps checking an empty queue and dispose prevents later callbacks', async () => {
    const onTimeout = vi.fn(async () => {});
    const { store, controller } = createController(onTimeout);
    await controller.middleware(context(false), vi.fn());
    await vi.advanceTimersByTimeAsync(100);
    expect(onTimeout).not.toHaveBeenCalled();

    store.append('app:g1', entry('1'), 2);
    await vi.advanceTimersByTimeAsync(100);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    controller.dispose();
    store.append('app:g1', entry('2'), 2);
    await vi.advanceTimersByTimeAsync(500);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('lets mentioned messages through and cancels the current timer', async () => {
    const onTimeout = vi.fn(async () => {});
    const { store, controller } = createController(onTimeout);
    store.append('app:g1', entry('1'), 2);
    await controller.middleware(context(false), vi.fn());

    store.append('app:g1', entry('2'), 2);
    const next = vi.fn(async () => { store.clear('app:g1'); });
    const mentioned = context(true);
    await controller.middleware(mentioned, next);
    expect(mentioned.stopped).toBe(false);
    expect(next).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(onTimeout).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('runs a later round after a rejected callback and logs the failure', async () => {
    const error = vi.fn();
    const batches: string[][] = [];
    let calls = 0;
    const { store, controller } = createController(async (_groupId, entries) => {
      batches.push(entries.map(item => item.content));
      calls += 1;
      if (calls === 1) throw new Error('send failed');
    });
    store.append('app:g1', entry('1'), 2);
    const first = context(false, error);
    await controller.middleware(first, vi.fn());
    await vi.advanceTimersByTimeAsync(100);
    expect(error).toHaveBeenCalledWith('[group-wait] timeout flush failed: send failed');

    store.append('app:g1', entry('2'), 2);
    await controller.middleware(context(false, error), vi.fn());
    await vi.advanceTimersByTimeAsync(100);
    expect(batches).toEqual([['1'], ['2']]);
    controller.dispose();
  });

  it('passes through unchanged when disabled', async () => {
    const store = getHistoryStore();
    const controller = createGroupWaitController({
      enabled: false,
      timeoutMs: 100,
      historyLimit: 2,
      store,
      groupKey: () => 'app:g1',
      groupId: () => 'g1',
      onTimeout: async () => {},
    });
    const ctx = context(false);
    const next = vi.fn(async () => {});
    await controller.middleware(ctx, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    controller.dispose();
  });
});
