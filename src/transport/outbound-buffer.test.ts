import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OutboundBuffer } from './outbound-buffer.ts';
import type { QQBotSender, StreamSessionLike } from './outbound-buffer.ts';
import type { SessionRecord } from '../session/index.ts';
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
const toolRequestNotice = '模型返回了未执行的工具请求，无法据此提供结果。请检查此会话的工具设置后重试。';
const dsmlToolRequest = '<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="functions.exec_command">\n{"cmd":"private-command"}\n</｜｜DSML｜｜ invoke>\n</｜｜DSML｜｜ calls>';

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
    await vi.advanceTimersByTimeAsync(200);
    await buffer.flush();

    // 流式从未成功发送 → 降级静态
    expect(bot.sendMarkdown).toHaveBeenCalledWith(c2cTarget, 'hello');
  });

  it('cancel → abort 关闭会话', async () => {
    const session = createSession();
    const bot = createBot(() => session);
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), true);

    buffer.append('hello');
    await vi.advanceTimersByTimeAsync(200);
    buffer.cancel();
    await vi.runAllTimersAsync();

    expect(session.complete).toHaveBeenCalledTimes(1);
  });

  it('reset 清空累积文本并保留流式会话', async () => {
    const session = createSession();
    const bot = createBot(() => session);
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), true);

    buffer.append('old');
    await vi.advanceTimersByTimeAsync(200);
    expect(session.update).toHaveBeenCalledWith('old');

    buffer.reset();
    expect(buffer.text).toBe('');

    buffer.append('new');
    await buffer.flush();

    expect(bot.openStream).toHaveBeenCalledTimes(1); // 会话复用
    expect(session.update).toHaveBeenNthCalledWith(2, 'new'); // 全量替换
    expect(session.complete).toHaveBeenCalledTimes(1);
    expect(bot.sendMarkdown).not.toHaveBeenCalled(); // 不降级静态
  });

  it('静态模式只发送 DSML 未执行通知并清空缓冲', async () => {
    const bot = createBot();
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), false);

    buffer.append('准备查询。\n' + dsmlToolRequest);
    await buffer.flush();

    expect(bot.sendMarkdown).toHaveBeenCalledExactlyOnceWith(c2cTarget, toolRequestNotice);
    expect(buffer.text).toBe('');
    await buffer.flush();
    expect(bot.sendMarkdown).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('真实 tool_calls 按 UTF-8 单字节追加仅发送未执行通知，streaming=%s', async (streaming) => {
    const session = createSession();
    const bot = createBot(() => session);
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), streaming);
    const decoder = new TextDecoder();
    for (const byte of new TextEncoder().encode('<｜｜DSML｜｜ tool_calls>')) {
      buffer.append(decoder.decode(Uint8Array.of(byte), { stream: true }));
      await vi.advanceTimersByTimeAsync(200);
    }
    buffer.append(decoder.decode());
    await buffer.flush();
    for (const [content] of vi.mocked(session.update).mock.calls) expect(content).toBe(toolRequestNotice);
    if (streaming) {
      expect(session.update).toHaveBeenLastCalledWith(toolRequestNotice);
      expect(bot.sendMarkdown).not.toHaveBeenCalled();
    } else expect(bot.sendMarkdown).toHaveBeenCalledExactlyOnceWith(c2cTarget, toolRequestNotice);
  });

  it('tool_calls 截断在名称中间、流式创建失败后仍只发送未执行通知', async () => {
    const bot = createBot(() => { throw new Error('stream unavailable'); });
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), true);
    for (const character of '<｜｜DSML｜｜ tool_') {
      buffer.append(character);
      await vi.advanceTimersByTimeAsync(200);
    }
    await buffer.flush();
    expect(bot.sendMarkdown).toHaveBeenCalledExactlyOnceWith(c2cTarget, toolRequestNotice);
  });

  it.each(['openStream', 'update'])('DSML 逐字符流式 %s 失败后只降级发送安全通知', async (failure) => {
    const session: StreamSessionLike = {
      update: vi.fn().mockRejectedValue(new Error('update failed')),
      complete: vi.fn().mockResolvedValue(undefined),
    };
    const bot = createBot(() => {
      if (failure === 'openStream') throw new Error('open failed');
      return session;
    });
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), true);

    for (const character of dsmlToolRequest) {
      buffer.append(character);
      await vi.advanceTimersByTimeAsync(200);
    }
    await buffer.flush();

    for (const [content] of vi.mocked(session.update).mock.calls) {
      expect(content).toBe(toolRequestNotice);
    }
    expect(bot.sendMarkdown).toHaveBeenCalledExactlyOnceWith(c2cTarget, toolRequestNotice);
    expect(buffer.text).toBe('');
    if (failure === 'update') expect(session.complete).toHaveBeenCalledTimes(1);
  });

  it('已发送普通前缀后 DSML 更新失败，不静态重复发送调用内容', async () => {
    const session: StreamSessionLike = {
      update: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('later update failed')),
      complete: vi.fn().mockResolvedValue(undefined),
    };
    const bot = createBot(() => session);
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), true);

    buffer.append('准备查询。');
    await vi.advanceTimersByTimeAsync(200);
    buffer.append(dsmlToolRequest);
    await buffer.flush();

    expect(session.update).toHaveBeenNthCalledWith(1, '准备查询。');
    expect(session.update).toHaveBeenLastCalledWith(toolRequestNotice);
    expect(bot.sendMarkdown).not.toHaveBeenCalled();
    expect(session.complete).toHaveBeenCalledTimes(1);
    expect(buffer.text).toBe('');
  });

  it('reset 丢弃未完整的 DSML 前缀，重试流式只保留新回复', async () => {
    const session = createSession();
    const bot = createBot(() => session);
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), true);

    buffer.append('旧尝试。\n<｜｜DSML｜');
    await vi.advanceTimersByTimeAsync(200);
    buffer.reset();
    buffer.append('重试后的正常回答。');
    await buffer.flush();

    expect(session.update).toHaveBeenNthCalledWith(1, '旧尝试。\n');
    expect(session.update).toHaveBeenLastCalledWith('重试后的正常回答。');
    expect(bot.sendMarkdown).not.toHaveBeenCalled();
    expect(buffer.text).toBe('');
  });

  it('cancel 丢弃待发送 DSML 内容并清空缓冲，后续 flush 不发送', async () => {
    const session = createSession();
    const bot = createBot(() => session);
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), true);

    buffer.append('准备查询。');
    await vi.advanceTimersByTimeAsync(200);
    buffer.append(dsmlToolRequest);
    buffer.cancel();
    await vi.runAllTimersAsync();
    await buffer.flush();

    expect(session.update).toHaveBeenCalledExactlyOnceWith('准备查询。');
    expect(session.complete).toHaveBeenCalledTimes(1);
    expect(bot.sendMarkdown).not.toHaveBeenCalled();
    expect(buffer.text).toBe('');
  });

  it.each([false, true])('静态及流式模式保留普通回复与代码示例，streaming=%s', async (streaming) => {
    const session = createSession();
    const bot = createBot(() => session);
    const buffer = new OutboundBuffer(createRecord(c2cTarget), bot, 4500, createLogger(), streaming);
    const response = '正常回答与示例：`<｜｜DSML｜｜ invoke>`、`<｜｜DSML｜｜ tool_calls>`\n```xml\n' + dsmlToolRequest + '\n<｜｜DSML｜｜ tool_calls>\n```';

    buffer.append(response);
    await buffer.flush();

    if (streaming) {
      expect(session.update).toHaveBeenCalledExactlyOnceWith(response);
      expect(bot.sendMarkdown).not.toHaveBeenCalled();
    } else {
      expect(bot.sendMarkdown).toHaveBeenCalledExactlyOnceWith(c2cTarget, response);
    }
  });
});
