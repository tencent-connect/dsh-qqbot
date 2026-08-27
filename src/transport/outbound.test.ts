import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOutboundHandler } from './outbound.ts';
import type { QQBotSender, StreamSessionLike } from './outbound-buffer.ts';
import type { SessionManager, SessionRecord, DshAgent } from '../session/index.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger, ReplyTarget, ChatScope } from '../types.ts';
import type { RawSessionEvent } from './events.ts';

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createStream(): StreamSessionLike {
  return { update: vi.fn().mockResolvedValue(undefined), complete: vi.fn().mockResolvedValue(undefined) };
}

function createBot(sendImpl?: () => Promise<unknown>): QQBotSender & {
  sendMarkdown: ReturnType<typeof vi.fn>;
  sendWakeup: ReturnType<typeof vi.fn>;
} {
  return {
    sendMarkdown: vi.fn(sendImpl ?? (() => Promise.resolve(undefined))),
    openStream: vi.fn(() => createStream()),
    sendWakeup: vi.fn(() => Promise.resolve(undefined)),
  };
}

/** 最小可用的 SessionRecord（route 只用到 replyTarget/qqPendingTurns/agent） */
function createRecord(target: ReplyTarget, qqPendingTurns = 0): SessionRecord {
  return {
    sessionKey: 'qqbot:app:c2c:user1',
    sessionId: 's1',
    agent: {} as DshAgent,
    handle: { agent: {} as DshAgent, dispose: async () => {} },
    replyTarget: target,
    scope: target.scope,
    peerId: target.targetId,
    senderId: target.targetId,
    lastActivity: Date.now(),
    qqPendingTurns,
  };
}

function createConfig(overrides: Partial<ImQQBotConfig> = {}): ImQQBotConfig {
  return {
    mirrorWeb: true,
    streaming: false,
    textChunkLimit: 4500,
    showToolResults: false,
    debug: false,
    ...overrides,
  } as unknown as ImQQBotConfig;
}

interface ManagerOverrides {
  record?: SessionRecord;
  peer?: { scope: ChatScope; peerId: string };
}

function createManager(overrides: ManagerOverrides = {}): SessionManager {
  return {
    findBySessionId: vi.fn().mockReturnValue(overrides.record),
    resolvePeer: vi.fn().mockReturnValue(overrides.peer),
    liveAgent: vi.fn().mockReturnValue(undefined),
  } as unknown as SessionManager;
}

const qqTarget: ReplyTarget = { scope: 'c2c', targetId: 'user1', msgId: 'm1' };

function userMessageEvent(text: string): RawSessionEvent {
  return { type: 'user/message', data: { content: [{ type: 'text', text }] } };
}

function assistantMessageEvent(text: string): RawSessionEvent {
  return { type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } };
}

const session = { header: { id: 's1' } };

describe('OutboundRouter — Web 镜像与桥接', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.restoreAllMocks());

  const flush = async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };

  it('QQ 发起回合：user/message 消费标记并跳过镜像', async () => {
    const record = createRecord(qqTarget, 1);
    const bot = createBot();
    const handler = createOutboundHandler(createManager({ record }), bot, createConfig(), createLogger());

    handler(session, userMessageEvent('hi from qq'));
    await flush();

    expect(bot.sendMarkdown).not.toHaveBeenCalled();
    expect(record.qqPendingTurns).toBe(0);
  });

  it('Web 发起（有活记录）：镜像用户消息并推送回复', async () => {
    const record = createRecord(qqTarget, 0);
    const bot = createBot();
    const handler = createOutboundHandler(createManager({ record }), bot, createConfig(), createLogger());

    handler(session, userMessageEvent('hi from web'));
    handler(session, assistantMessageEvent('bot reply'));
    await flush();

    const calls = (bot.sendMarkdown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0]?.[0]).toEqual(qqTarget);
    expect(calls[0]?.[1]).toContain('来自 Web');
    expect(calls[0]?.[1]).toContain('hi from web');
    expect(calls[1]?.[1]).toContain('bot reply');
  });

  it('Web 发起（无活记录，桥接）：按持久化映射解析目标，主动消息无 msgId', async () => {
    const bot = createBot();
    const manager = createManager({ peer: { scope: 'c2c', peerId: 'user1' } });
    const handler = createOutboundHandler(manager, bot, createConfig(), createLogger());

    handler(session, userMessageEvent('hi from web'));
    handler(session, assistantMessageEvent('bot reply'));
    await flush();

    const calls = (bot.sendMarkdown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(2);
    // 桥接目标：无 msgId（主动投递）
    expect(calls[0]?.[0]).toEqual({ scope: 'c2c', targetId: 'user1' });
    expect(calls[0]?.[1]).toContain('来自 Web');
    expect(calls[1]?.[1]).toContain('bot reply');
  });

  it('未知会话（既无活记录也无映射）：不发送', async () => {
    const bot = createBot();
    const handler = createOutboundHandler(createManager(), bot, createConfig(), createLogger());

    handler(session, userMessageEvent('x'));
    handler(session, assistantMessageEvent('y'));
    await flush();

    expect(bot.sendMarkdown).not.toHaveBeenCalled();
  });

  it('mirrorWeb 关闭：不桥接、不镜像用户消息，但 QQ 活记录回复照常', async () => {
    const record = createRecord(qqTarget, 0);
    const bot = createBot();
    const handler = createOutboundHandler(
      createManager({ record, peer: { scope: 'c2c', peerId: 'user1' } }),
      bot,
      createConfig({ mirrorWeb: false }),
      createLogger(),
    );

    handler(session, userMessageEvent('web msg')); // 不镜像
    handler(session, assistantMessageEvent('reply')); // 有活记录 → 仍发送
    await flush();

    const calls = (bot.sendMarkdown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0]?.[1]).toContain('reply');
  });

  it('容错投递：带 msgId 失败 → 主动重试；再失败 → c2c 唤醒', async () => {
    const bot = createBot(() => Promise.reject(new Error('send failed')));
    const record = createRecord(qqTarget, 0);
    const handler = createOutboundHandler(createManager({ record }), bot, createConfig(), createLogger());

    handler(session, assistantMessageEvent('reply'));
    await flush();

    // 1) 原目标(带 msgId) 2) 主动(无 msgId) 均失败 → 3) 唤醒
    expect((bot.sendMarkdown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    expect(bot.sendWakeup).toHaveBeenCalledTimes(1);
    expect((bot.sendWakeup as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toEqual({ scope: 'c2c', targetId: 'user1' });
  });

  it('群聊目标：主动重试失败后不走唤醒（唤醒仅 c2c）', async () => {
    const bot = createBot(() => Promise.reject(new Error('send failed')));
    const groupTarget: ReplyTarget = { scope: 'group', targetId: 'group1', msgId: 'm1' };
    const record = createRecord(groupTarget, 0);
    const handler = createOutboundHandler(createManager({ record }), bot, createConfig(), createLogger());

    handler(session, assistantMessageEvent('reply'));
    await flush();

    expect(bot.sendWakeup).not.toHaveBeenCalled();
  });
});
