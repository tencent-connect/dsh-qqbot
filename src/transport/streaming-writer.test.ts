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
const toolRequestNotice = '模型返回了未执行的工具请求，无法据此提供结果。请检查此会话的工具设置后重试。';
const dsmlToolRequest = '<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="functions.exec_command">\n{"cmd":"private-command"}\n</｜｜DSML｜｜ invoke>\n</｜｜DSML｜｜ calls>';

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

  it('reset 清空累积文本，复用已打开会话，新内容全量重写', async () => {
    const session = createSession();
    const bot = createBot(() => session);
    const writer = new StreamingWriter({ bot, target, logger: createLogger(), throttleMs: 200 });

    writer.append('attempt-a');
    await vi.advanceTimersByTimeAsync(200);
    expect(session.update).toHaveBeenCalledWith('attempt-a');

    writer.reset();
    writer.append('attempt-b');
    await vi.advanceTimersByTimeAsync(200);

    expect(writer.text).toBe('attempt-b');
    expect(bot.openStream).toHaveBeenCalledTimes(1); // 流式会话复用，不新开消息
    expect(session.update).toHaveBeenNthCalledWith(2, 'attempt-b'); // 全量替换
    expect(writer.shouldFallback).toBe(false); // sentChunkCount 保留，不降级
  });

  it('finish 后 reset 不复活 writer', async () => {
    const session = createSession();
    const bot = createBot(() => session);
    const writer = new StreamingWriter({ bot, target, logger: createLogger(), throttleMs: 200 });

    writer.append('hello');
    await writer.finish();
    writer.reset();

    expect(writer.text).toBe('hello'); // 终态后 reset 无效
  });

  it.each([1, 2, 5, 13])('DSML 每 %i 字符分块，节流和最终更新均不暴露调用标记', async (chunkSize) => {
    const session = createSession();
    const bot = createBot(() => session);
    const writer = new StreamingWriter({ bot, target, logger: createLogger(), throttleMs: 200 });
    const preface = '准备查询。\n';
    const response = preface + dsmlToolRequest;

    for (let offset = 0; offset < response.length; offset += chunkSize) {
      writer.append(response.slice(offset, offset + chunkSize));
      await vi.advanceTimersByTimeAsync(200);
    }
    await writer.finish();

    for (const [content] of vi.mocked(session.update).mock.calls) {
      expect(content === toolRequestNotice || preface.startsWith(content)).toBe(true);
    }
    expect(session.update).toHaveBeenLastCalledWith(toolRequestNotice);
    expect(writer.text).toBe(toolRequestNotice);
    expect(session.complete).toHaveBeenCalledTimes(1);
  });

  it.each(['<｜｜DSML｜｜ tool_calls>', '<｜｜DSML｜｜ tool_calls', '<｜｜DSML｜｜ tool_'])('真实 tool_calls 标签按 UTF-8 单字节跨节流也不泄漏，含截断：%s', async (request) => {
    const session = createSession();
    const writer = new StreamingWriter({ bot: createBot(() => session), target, logger: createLogger(), throttleMs: 200 });
    const preface = '准备查询。\n';
    const decoder = new TextDecoder();
    for (const byte of new TextEncoder().encode(preface + request)) {
      writer.append(decoder.decode(Uint8Array.of(byte), { stream: true }));
      await vi.advanceTimersByTimeAsync(200);
    }
    writer.append(decoder.decode());
    await writer.finish();
    for (const [content] of vi.mocked(session.update).mock.calls) expect(content === toolRequestNotice || preface.startsWith(content)).toBe(true);
    expect(session.update).toHaveBeenLastCalledWith(toolRequestNotice);
    expect(writer.text).toBe(toolRequestNotice);
  });

  it.each([
    '普通回复：2 < 3，任务已完成。',
    '格式示例：`<｜｜DSML｜｜ invoke name="example">`，仅用于说明。',
    '协议示例：\n```xml\n<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="example">\n```\n这是示例。',
    '格式示例：`<｜｜DSML｜｜ tool_calls>`，仅用于说明。',
    '协议示例：\n```xml\n<｜｜DSML｜｜ tool_calls>\n```\n这是示例。',
  ])('普通回复与代码中的 DSML 示例逐字符流式保留：%s', async (response) => {
    const session = createSession();
    const bot = createBot(() => session);
    const writer = new StreamingWriter({ bot, target, logger: createLogger(), throttleMs: 200 });

    for (const character of response) {
      writer.append(character);
      await vi.advanceTimersByTimeAsync(200);
    }
    await writer.finish();

    for (const [content] of vi.mocked(session.update).mock.calls) {
      expect(response.startsWith(content)).toBe(true);
    }
    expect(session.update).toHaveBeenLastCalledWith(response);
    expect(writer.text).toBe(response);
  });

  it.each(['<｜｜DSML｜', dsmlToolRequest])('reset 清理 DSML 检测状态并允许下一次正常回复：%s', async (oldAttempt) => {
    const session = createSession();
    const bot = createBot(() => session);
    const writer = new StreamingWriter({ bot, target, logger: createLogger(), throttleMs: 200 });

    writer.append('旧尝试。\n' + oldAttempt);
    await vi.advanceTimersByTimeAsync(200);
    writer.reset();
    expect(writer.text).toBe('');
    writer.append('重试后的正常回答。');
    await writer.finish();

    for (const [content] of vi.mocked(session.update).mock.calls) {
      expect(content).not.toContain('DSML');
      expect(content).not.toContain('private-command');
    }
    expect(session.update).toHaveBeenLastCalledWith('重试后的正常回答。');
    expect(bot.openStream).toHaveBeenCalledTimes(1);
    expect(session.complete).toHaveBeenCalledTimes(1);
  });

  it('abort 清理待发送的 DSML 前缀，关闭后不再追加或发送', async () => {
    const session = createSession();
    const bot = createBot(() => session);
    const writer = new StreamingWriter({ bot, target, logger: createLogger(), throttleMs: 200 });

    writer.append('准备查询。');
    await vi.advanceTimersByTimeAsync(200);
    writer.append('<｜｜DSML｜｜ inv');
    writer.abort();
    writer.append(dsmlToolRequest);
    await vi.runAllTimersAsync();
    await writer.finish();

    expect(session.update).toHaveBeenCalledTimes(1);
    expect(session.update).toHaveBeenCalledWith('准备查询。');
    expect(session.complete).toHaveBeenCalledTimes(1);
    expect(bot.sendMarkdown).not.toHaveBeenCalled();
  });
});
