import { describe, it, expect, vi, afterEach } from 'vitest';
import { createOutboundHandler } from './outbound.ts';
import { QqInputRegistry } from './qq-input-origin.ts';
import { injectUserText } from './inbound.ts';
import { QuestionChannel } from '../features/question-channel.ts';
import type { QQBotSender, StreamSessionLike } from './outbound-buffer.ts';
import type { SessionManager, SessionRecord } from '../session/index.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger, ReplyTarget } from '../types.ts';
import type { RawSessionEvent } from './events.ts';

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createStream(): StreamSessionLike {
  return { update: vi.fn().mockResolvedValue(undefined), complete: vi.fn().mockResolvedValue(undefined) };
}

function createBot(): QQBotSender & { sendMarkdown: ReturnType<typeof vi.fn> } {
  return {
    sendMarkdown: vi.fn().mockResolvedValue(undefined),
    openStream: vi.fn(() => createStream()),
  };
}

/** 最小可用的 SessionRecord（出站只用到 sessionKey / replyTarget） */
function createRecord(target: ReplyTarget): SessionRecord {
  return {
    sessionKey: 'qqbot:app:c2c:user1',
    sessionId: 's1',
    replyTarget: target,
    agent: {},
    handle: {},
    createdAt: 0,
    lastActiveAt: 0,
  } as unknown as SessionRecord;
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

/** 等出站 fire-and-forget 链路（正文 → 附加键盘消息）跑完 */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
}

describe('OutboundRouter — 快捷按钮（尾部编号选项兜底）', () => {
  afterEach(() => vi.restoreAllMocks());

  const OPTIONS_TEXT = '下一步你要哪个？\n1. 合并文件存档就好，零风险不动活跃文件。\n2. 真正加载进活跃会话，需要你确认时机。\n3. 改成时间交错合并再出一版看看效果。\n回 1 / 2 / 3 即可。';

  /** manager 桩：会话键取记录上的 sessionKey（与 interaction 侧解析一致） */
  function createManager(record?: SessionRecord): SessionManager {
    return {
      findBySessionId: vi.fn().mockReturnValue(record),
      getSessionRecord: vi.fn().mockReturnValue(record ? { sessionKey: record.sessionKey } : undefined),
    } as unknown as SessionManager;
  }

  function createQuickChannel(manager: SessionManager, enabled = true): QuestionChannel {
    return new QuestionChannel(
      manager as never,
      { sendMarkdown: async () => undefined },
      { requireMention: false, askTimeoutMs: 60_000, quickReplyButtons: enabled },
      createLogger(),
    );
  }

  /** 组装出站 + 回填快捷按钮来源（bootstrap 的接线方式） */
  function setup(opts?: { config?: ImQQBotConfig; enabled?: boolean }) {
    const record = createRecord(qqTarget);
    const bot = createBot();
    const manager = createManager(record);
    const channel = createQuickChannel(manager, opts?.enabled ?? true);
    const outbound = createOutboundHandler(manager, bot, opts?.config ?? createConfig(), createLogger());
    outbound.setQuickReplySource(channel);
    return { outbound, bot, channel, manager };
  }

  it('尾部编号选项：正文发送后追加一条带键盘的快捷消息', async () => {
    const { outbound, bot } = setup();

    outbound.routeSessionEvent(session, assistantMessageEvent(OPTIONS_TEXT));
    await settle();

    const calls = bot.sendMarkdown.mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0]?.[1]).toContain('下一步你要哪个');
    // 键盘必须挂在独立的一条短消息上
    expect(calls[0]?.[2]).toBeUndefined();
    expect(calls[1]?.[1]).toContain('快速选择');
    const kb = (calls[1]?.[2] as { keyboard?: { content?: { rows?: unknown[] } } } | undefined)?.keyboard;
    expect(kb?.content?.rows).toHaveLength(3);
  });

  it('点击快捷按钮：解析为编号注入载荷（t:"quick" 判别编码）', async () => {
    const { outbound, channel } = setup();

    outbound.routeSessionEvent(session, assistantMessageEvent(OPTIONS_TEXT));
    await settle();

    const click = channel.consumeQuickReply({
      id: 'i', type: 1, version: 1, user_openid: 'user1',
      data: { type: 1, resolved: { button_data: JSON.stringify({ t: 'quick', i: 1 }) } },
    } as never);
    expect(click).toMatchObject({ scope: 'c2c', peerId: 'user1', text: '2' });
  });

  it('正式提问按钮（t:"question"）不被当作快捷按钮', async () => {
    const { outbound, channel } = setup();

    outbound.routeSessionEvent(session, assistantMessageEvent(OPTIONS_TEXT));
    await settle();

    const click = channel.consumeQuickReply({
      id: 'i', type: 1, version: 1, user_openid: 'user1',
      data: { type: 1, resolved: { button_data: JSON.stringify({ t: 'question', q: 'some-question', i: 1 }) } },
    } as never);
    expect(click).toBeUndefined();
  });

  it('普通消息：不追加快捷消息', async () => {
    const { outbound, bot } = setup();

    outbound.routeSessionEvent(session, assistantMessageEvent('合并完成，一切正常，无需你做任何选择。'));
    await settle();

    expect(bot.sendMarkdown.mock.calls.length).toBe(1);
  });

  it('quickReplyButtons 关闭：不追加快捷消息', async () => {
    const { outbound, bot } = setup({ enabled: false, config: createConfig({ quickReplyButtons: false }) });

    outbound.routeSessionEvent(session, assistantMessageEvent(OPTIONS_TEXT));
    await settle();

    expect(bot.sendMarkdown.mock.calls.length).toBe(1);
  });

  it('流式路径：chunk 缓冲经 assistant/message 收尾后同样追加快捷消息', async () => {
    const { outbound, bot } = setup({ config: createConfig({ streaming: true }) });

    outbound.routeSessionEvent(session, { type: 'assistant/chunk', data: { chunk: { type: 'text-delta', text: OPTIONS_TEXT } } });
    outbound.routeSessionEvent(session, assistantMessageEvent(OPTIONS_TEXT));
    await settle();

    const quick = bot.sendMarkdown.mock.calls.find((c) => String(c[1]).includes('快速选择'));
    expect(quick).toBeDefined();
    expect((quick?.[2] as { keyboard?: unknown } | undefined)?.keyboard).toBeDefined();
  });
});

describe('injectUserText — 快捷按钮点击注入用户消息', () => {
  afterEach(() => vi.restoreAllMocks());

  it('登记消息 id 后 followup（出站据此认领回合归属，不重复镜像）', async () => {
    const followup = vi.fn();
    const manager = {
      getOrCreate: vi.fn().mockResolvedValue({ agent: { followup } }),
    } as unknown as SessionManager;
    const inputs = new QqInputRegistry();

    await injectUserText(manager as never, 'c2c', 'user1', 'user1', '2', createLogger(), inputs);

    // 点击时机与原消息脱节：注入不带 msgId，后续回复走主动投递
    expect(manager.getOrCreate).toHaveBeenCalledWith('c2c', 'user1', 'user1', { scope: 'c2c', targetId: 'user1' });
    expect(followup).toHaveBeenCalledTimes(1);
    const message = followup.mock.calls[0]?.[0] as { id?: string; content?: Array<{ text?: string }> };
    expect(message.content?.[0]?.text).toBe('2');
    expect(inputs.has(String(message.id))).toBe(true);
  });
});