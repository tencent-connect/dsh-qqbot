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
    streaming: false,
    textChunkLimit: 4500,
    showToolResults: false,
    debug: false,
    ...overrides,
  } as unknown as ImQQBotConfig;
}

const qqTarget: ReplyTarget = { scope: 'c2c', targetId: 'user1', msgId: 'm1' };

function assistantMessageEvent(text: string): RawSessionEvent {
  return { type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } };
}

const session = { header: { id: 's1' } };

describe('OutboundRouter — 快捷按钮（尾部编号选项兜底）', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.restoreAllMocks());

  const flush = async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  };

  const OPTIONS_TEXT = '下一步你要哪个？\n1. 合并文件存档就好，零风险不动活跃文件。\n2. 真正加载进活跃会话，需要你确认时机。\n3. 改成时间交错合并再出一版看看效果。\n回 1 / 2 / 3 即可。';

  /** 带 sessionKey 的 manager（快捷按钮登记用规范键） */
  function createKeyedManager(record?: SessionRecord): SessionManager {
    return {
      findBySessionId: vi.fn().mockReturnValue(record),
      getSessionRecord: vi.fn().mockReturnValue(record ? { sessionKey: record.sessionKey } : undefined),
      resolvePeer: vi.fn().mockReturnValue(undefined),
      liveAgent: vi.fn().mockReturnValue(undefined),
      sessionKey: (scope: ChatScope, peerId: string) => `qqbot:app:${scope}:${peerId}`,
    } as unknown as SessionManager;
  }

  async function createQuickChannel(manager: SessionManager) {
    const { QuestionChannel } = await import('../features/question-channel.js');
    return new QuestionChannel(
      manager as never,
      { sendMarkdown: async () => undefined },
      { requireMention: false, askTimeoutMs: 60_000, quickReplyButtons: true },
      createLogger(),
    );
  }

  it('尾部编号选项：正文发送后追加快捷消息并附带键盘', async () => {
    const record = createRecord(qqTarget, 0);
    const bot = createBot();
    const manager = createKeyedManager(record);
    const ch = await createQuickChannel(manager);
    const outbound = createOutboundHandler(manager, bot, createConfig({ quickReplyButtons: true }), createLogger(), undefined, ch);

    outbound.routeSessionEvent(session, assistantMessageEvent(OPTIONS_TEXT));
    await flush();

    const calls = (bot.sendMarkdown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0]?.[1]).toContain('下一步你要哪个');
    expect(calls[1]?.[1]).toContain('快速选择');
    const kb = (calls[1]?.[2] as { keyboard?: { content?: { rows?: unknown[] } } } | undefined)?.keyboard;
    expect(kb?.content?.rows).toHaveLength(3);
  });

  it('点击快捷按钮：解析为编号注入载荷（t:"quick" 判别编码）', async () => {
    const record = createRecord(qqTarget, 0);
    const bot = createBot();
    const manager = createKeyedManager(record);
    const ch = await createQuickChannel(manager);
    const outbound = createOutboundHandler(manager, bot, createConfig({ quickReplyButtons: true }), createLogger(), undefined, ch);

    outbound.routeSessionEvent(session, assistantMessageEvent(OPTIONS_TEXT));
    await flush();

    const click = ch.consumeQuickReply({
      id: 'i', type: 1, version: 1, user_openid: 'user1',
      data: { type: 1, resolved: { button_data: JSON.stringify({ t: 'quick', i: 1 }) } },
    } as never);
    expect(click).toMatchObject({ scope: 'c2c', peerId: 'user1', text: '2' });
  });

  it('正式提问按钮（t:"question"）不被当作快捷按钮', async () => {
    const record = createRecord(qqTarget, 0);
    const bot = createBot();
    const manager = createKeyedManager(record);
    const ch = await createQuickChannel(manager);
    const outbound = createOutboundHandler(manager, bot, createConfig({ quickReplyButtons: true }), createLogger(), undefined, ch);

    outbound.routeSessionEvent(session, assistantMessageEvent(OPTIONS_TEXT));
    await flush();

    const click = ch.consumeQuickReply({
      id: 'i', type: 1, version: 1, user_openid: 'user1',
      data: { type: 1, resolved: { button_data: JSON.stringify({ t: 'question', q: 'some-question', i: 1 }) } },
    } as never);
    expect(click).toBeUndefined();
  });

  it('普通消息：不追加快捷消息', async () => {
    const record = createRecord(qqTarget, 0);
    const bot = createBot();
    const manager = createKeyedManager(record);
    const ch = await createQuickChannel(manager);
    const outbound = createOutboundHandler(manager, bot, createConfig({ quickReplyButtons: true }), createLogger(), undefined, ch);

    outbound.routeSessionEvent(session, assistantMessageEvent('合并完成，一切正常，无需你做任何选择。'));
    await flush();

    expect((bot.sendMarkdown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('quickReplyButtons 关闭：不追加快捷消息', async () => {
    const record = createRecord(qqTarget, 0);
    const bot = createBot();
    const manager = createKeyedManager(record);
    const { QuestionChannel } = await import('../features/question-channel.js');
    const ch = new QuestionChannel(
      manager as never,
      { sendMarkdown: async () => undefined },
      { requireMention: false, askTimeoutMs: 60_000 }, // 通道侧未开启
      createLogger(),
    );
    const outbound = createOutboundHandler(manager, bot, createConfig({ quickReplyButtons: false }), createLogger(), undefined, ch);

    outbound.routeSessionEvent(session, assistantMessageEvent(OPTIONS_TEXT));
    await flush();

    expect((bot.sendMarkdown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('流式路径：chunk 缓冲经 assistant/message 收尾后同样追加快捷消息', async () => {
    const record = createRecord(qqTarget, 0);
    const bot = createBot();
    const manager = createKeyedManager(record);
    const ch = await createQuickChannel(manager);
    const outbound = createOutboundHandler(manager, bot, createConfig({ quickReplyButtons: true }), createLogger(), undefined, ch);

    outbound.routeSessionEvent(session, { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: OPTIONS_TEXT } } });
    outbound.routeSessionEvent(session, assistantMessageEvent(OPTIONS_TEXT));
    await new Promise((r) => setTimeout(r, 30)); // 流式节流窗口
    await flush();

    const calls = (bot.sendMarkdown as ReturnType<typeof vi.fn>).mock.calls;
    const quick = calls.find((c) => String(c[1]).includes('快速选择'));
    expect(quick).toBeDefined();
    expect((quick?.[2] as { keyboard?: unknown } | undefined)?.keyboard).toBeDefined();
  });
});