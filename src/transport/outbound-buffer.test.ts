import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OutboundBuffer } from './outbound-buffer.js';
import type { QQBotSender, StreamSessionLike } from './outbound-buffer.js';
import type { SessionRecord } from '../session/index.js';
import type { Logger, ReplyTarget } from '../types.js';

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

function createRecord(target: ReplyTarget): SessionRecord {
  return {
    sessionId: 's1',
    key: 'k',
    replyTarget: target,
    agent: {},
    createdAt: 0,
    lastActiveAt: 0,
  } as unknown as SessionRecord;
}

const c2cTarget: ReplyTarget = { scope: 'c2c', targetId: 'user1', msgId: 'msg1' };

describe('OutboundBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('流式开启：append + flush → openStream + update + complete', async () => {
    const session = createSession();
    const bot = createBot(() => session);
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), true);

    buffer.append('hello');
    await buffer.flush();

    expect(bot.openStream).toHaveBeenCalledTimes(1);
    expect(session.update).toHaveBeenCalledWith('hello');
    expect(session.complete).toHaveBeenCalledTimes(1);
    expect(bot.sendMarkdown).not.toHaveBeenCalled();
  });

  it('流式关闭：append + flush → 静态 sendMarkdown', async () => {
    const bot = createBot();
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), false);

    buffer.append('hello');
    await buffer.flush();

    expect(bot.openStream).not.toHaveBeenCalled();
    expect(bot.sendMarkdown).toHaveBeenCalledWith(c2cTarget, 'hello');
  });

  it('流式开启但 openStream 失败 → 降级静态 sendMarkdown', async () => {
    const bot = createBot(() => {
      throw new Error('open failed');
    });
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), true);

    buffer.append('hello');
    await vi.advanceTimersByTimeAsync(500);
    await buffer.flush();

    // 流式从未成功发送 → 降级静态
    expect(bot.sendMarkdown).toHaveBeenCalledWith(c2cTarget, 'hello');
  });

  it('cancel → abort 关闭会话', async () => {
    const session = createSession();
    const bot = createBot(() => session);
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), true);

    buffer.append('hello');
    await vi.advanceTimersByTimeAsync(500);
    buffer.cancel();
    await vi.runAllTimersAsync();

    expect(session.complete).toHaveBeenCalledTimes(1);
  });

  it('流式：标记跨 chunk 分片到达不打碎，闭合后触发文件发送', async () => {
    const session = createSession();
    const sendFile = vi.fn().mockResolvedValue({ message: { id: 'm' } });
    const bot = { ...createBot(() => session), sendFile };
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), true);

    buffer.append('文件来了 [[FILE:/etc/host');
    await vi.advanceTimersByTimeAsync(500);
    // 未闭合标记被拦截：此时 update 不应收到标记碎片
    expect(session.update).not.toHaveBeenCalled();

    buffer.append('name]] 请查收');
    await vi.advanceTimersByTimeAsync(500);
    await buffer.flush();

    const streamed = (session.update as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).join('');
    expect(streamed).not.toContain('[[FILE:');
    expect(streamed).toContain('文件来了');
    expect(streamed).toContain('请查收');
    expect(sendFile).toHaveBeenCalledWith(c2cTarget, { localPath: '/etc/hostname' }, { fileName: 'hostname' });
  });

  it('流式：增量推送不重复（pushPos）', async () => {
    const session = createSession();
    const bot = createBot(() => session);
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), true);

    buffer.append('abc');
    await vi.advanceTimersByTimeAsync(500);
    buffer.append('def');
    await vi.advanceTimersByTimeAsync(500);
    await buffer.flush();

    // StreamingWriter update 全量语义：每次推送都是累积文本，最终恰为 abc + def
    const calls = (session.update as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(calls[calls.length - 1]).toBe('abcdef');
    expect(calls[0]).not.toContain('abcabc');
  });
});
