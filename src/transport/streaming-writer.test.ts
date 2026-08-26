import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamingWriter } from './streaming-writer.ts';
import type { QQBotSender, StreamSessionLike } from './outbound-buffer.ts';
import type { Logger, ReplyTarget } from '../types.ts';

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createSession(): StreamSessionLike {
  return { update: vi.fn().mockResolvedValue(undefined), complete: vi.fn().mockResolvedValue(undefined) };
}

function createBot(openStreamImpl?: () => StreamSessionLike): QQBotSender {
  return {
    sendMarkdown: vi.fn().mockResolvedValue(undefined),
    openStream: vi.fn(openStreamImpl ?? (() => createSession())),
  };
}

const target: ReplyTarget = { scope: 'c2c', targetId: 'user1', msgId: 'msg1' };

describe('StreamingWriter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('首次 append 后节流触发 openStream + update', async () => {
    const session = createSession();
    const bot = createBot(() => session);
    const writer = new StreamingWriter({ bot, target, logger: createLogger(), throttleMs: 200 });

    writer.append('hello');
    await vi.advanceTimersByTimeAsync(200);

    expect(bot.openStream).toHaveBeenCalledTimes(1);
    expect(session.update).toHaveBeenCalledWith('hello');
  });

  it('同 tick 内多次 append 只触发一次 update', async () => {
    const session = createSession();
    const bot = createBot(() => session);
    const writer = new StreamingWriter({ bot, target, logger: createLogger(), throttleMs: 200 });

    writer.append('Hello');
    writer.append(' ');
    writer.append('world');
    await vi.advanceTimersByTimeAsync(200);

    // throttle：同一 tick 内多次 append 共用一个 timer，只触发一次 update
    expect(session.update).toHaveBeenCalledTimes(1);
    expect(session.update).toHaveBeenCalledWith('Hello world');
  });

  it('throttle：跨节流间隔的 append 分多次 update', async () => {
    const session = createSession();
    const bot = createBot(() => session);
    const writer = new StreamingWriter({ bot, target, logger: createLogger(), throttleMs: 200 });

    writer.append('a');
    await vi.advanceTimersByTimeAsync(200); // 第一次 flush → update('a')

    writer.append('b');
    await vi.advanceTimersByTimeAsync(200); // 第二次 flush → update('ab')

    expect(session.update).toHaveBeenCalledTimes(2);
    expect(session.update).toHaveBeenNthCalledWith(1, 'a');
    expect(session.update).toHaveBeenNthCalledWith(2, 'ab');
  });

  it('finish 触发最终 update + complete', async () => {
    const session = createSession();
    const bot = createBot(() => session);
    const writer = new StreamingWriter({ bot, target, logger: createLogger(), throttleMs: 200 });

    writer.append('hello');
    await writer.finish();

    expect(session.update).toHaveBeenCalledWith('hello');
    expect(session.complete).toHaveBeenCalledTimes(1);
  });

  it('openStream 失败 → shouldFallback = true（从未发送分片）', async () => {
    const bot = createBot(() => {
      throw new Error('open failed');
    });
    const writer = new StreamingWriter({ bot, target, logger: createLogger(), throttleMs: 200 });

    writer.append('hello');
    await vi.advanceTimersByTimeAsync(200);

    expect(writer.shouldFallback).toBe(true);
    expect(bot.sendMarkdown).not.toHaveBeenCalled();
  });

  it('首次 update 失败 → shouldFallback = true', async () => {
    const session: StreamSessionLike = {
      update: vi.fn().mockRejectedValueOnce(new Error('update failed')),
      complete: vi.fn().mockResolvedValue(undefined),
    };
    const bot = createBot(() => session);
    const writer = new StreamingWriter({ bot, target, logger: createLogger(), throttleMs: 200 });

    writer.append('hello');
    await vi.advanceTimersByTimeAsync(200);

    expect(writer.shouldFallback).toBe(true);
  });

  it('后续 update 失败 → shouldFallback = false（已发送过分片，不降级避免重复）', async () => {
    const session: StreamSessionLike = {
      update: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('later update failed')),
      complete: vi.fn().mockResolvedValue(undefined),
    };
    const bot = createBot(() => session);
    const writer = new StreamingWriter({ bot, target, logger: createLogger(), throttleMs: 200 });

    writer.append('a');
    await vi.advanceTimersByTimeAsync(200);
    expect(writer.shouldFallback).toBe(false); // 已成功发送 1 片

    writer.append('b');
    await vi.advanceTimersByTimeAsync(200);
    // 第二次 update 失败，但 sentChunkCount 已 > 0，不降级
    expect(writer.shouldFallback).toBe(false);
  });

  it('finish 幂等：重复 finish 只 complete 一次', async () => {
    const session = createSession();
    const bot = createBot(() => session);
    const writer = new StreamingWriter({ bot, target, logger: createLogger(), throttleMs: 200 });

    writer.append('hello');
    await writer.finish();
    await writer.finish();

    expect(session.complete).toHaveBeenCalledTimes(1);
  });

  it('finish 后 append 被忽略', async () => {
    const session = createSession();
    const bot = createBot(() => session);
    const writer = new StreamingWriter({ bot, target, logger: createLogger(), throttleMs: 200 });

    writer.append('hello');
    await writer.finish();

    writer.append('world');
    expect(writer.text).toBe('hello'); // 终态后 append 不再累积
  });

  it('abort 关闭已打开的会话', async () => {
    const session = createSession();
    const bot = createBot(() => session);
    const writer = new StreamingWriter({ bot, target, logger: createLogger(), throttleMs: 200 });

    writer.append('hello');
    await vi.advanceTimersByTimeAsync(200);
    expect(bot.openStream).toHaveBeenCalledTimes(1);

    writer.abort();
    await vi.runAllTimersAsync();

    expect(session.complete).toHaveBeenCalledTimes(1);
  });
});
