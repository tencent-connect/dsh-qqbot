import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOutboundHandler, createTurnTracker } from './outbound.ts';
import { QqInputRegistry } from './qq-input-origin.ts';
import type { QQBotSender, StreamSessionLike } from './outbound-buffer.ts';
import type { SessionManager, SessionRecord } from '../session/index.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger, ReplyTarget } from '../types.ts';

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createSession(): StreamSessionLike {
  return { update: vi.fn().mockResolvedValue(undefined), complete: vi.fn().mockResolvedValue(undefined) };
}

function createBot(session: StreamSessionLike): QQBotSender {
  return {
    sendMarkdown: vi.fn().mockResolvedValue(undefined),
    openStream: vi.fn(() => session),
  };
}

const c2cTarget: ReplyTarget = { scope: 'c2c', targetId: 'user1', msgId: 'msg1' };
const groupTarget: ReplyTarget = { scope: 'group', targetId: 'group1', msgId: 'msg1' };

function createRecord(target: ReplyTarget, sessionId = 'sess-qq'): SessionRecord {
  return {
    sessionKey: 'k',
    sessionId,
    replyTarget: target,
    agent: {},
    handle: {},
    createdAt: 0,
    lastActiveAt: 0,
  } as unknown as SessionRecord;
}

function createConfig(overrides?: Partial<ImQQBotConfig>): ImQQBotConfig {
  return {
    streaming: true,
    textChunkLimit: 4500,
    showToolResults: false,
    ...overrides,
  } as unknown as ImQQBotConfig;
}

/** 组装 handler：manager 按 sessionId 返回 record（默认 c2c 私聊） */
function setup(opts?: {
  record?: SessionRecord | undefined;
  config?: ImQQBotConfig;
  deliverer?: { deliver: ReturnType<typeof vi.fn> };
}) {
  const session = createSession();
  const bot = createBot(session);
  const record = 'record' in (opts ?? {}) ? opts!.record : createRecord(c2cTarget);
  const manager = {
    findBySessionId: vi.fn((id: string) => (id === 'sess-qq' ? record : undefined)),
  } as unknown as SessionManager;
  const outbound = createOutboundHandler(
    manager, bot, opts?.config ?? createConfig(), createLogger(), undefined, opts?.deliverer,
  );
  return { outbound, bot, session };
}

const delta = (attemptId: string, text: string) => ({ kind: 'text-delta' as const, attemptId, text });
const start = (attemptId: string) => ({ kind: 'attempt-start' as const, attemptId });

describe('OutboundRouter.routeStreamFrame', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('流式帧路由到会话 buffer：openStream + update', async () => {
    const { outbound, bot, session } = setup();

    outbound.routeStreamFrame('sess-qq', start('a1'));
    outbound.routeStreamFrame('sess-qq', delta('a1', 'hello'));
    await vi.advanceTimersByTimeAsync(200);

    expect(bot.openStream).toHaveBeenCalledTimes(1);
    expect(session.update).toHaveBeenCalledWith('hello');
  });

  it('attempt 切换 reset：同一条流式消息被新内容全量重写', async () => {
    const { outbound, bot, session } = setup();

    outbound.routeStreamFrame('sess-qq', start('a1'));
    outbound.routeStreamFrame('sess-qq', delta('a1', 'partial'));
    await vi.advanceTimersByTimeAsync(200);
    expect(session.update).toHaveBeenCalledWith('partial');

    outbound.routeStreamFrame('sess-qq', start('a2'));
    outbound.routeStreamFrame('sess-qq', delta('a2', 'full'));
    await vi.advanceTimersByTimeAsync(200);

    expect(bot.openStream).toHaveBeenCalledTimes(1); // 流式会话复用
    expect(session.update).toHaveBeenNthCalledWith(2, 'full'); // 全量替换
  });

  it('agent replacement（attemptId 重叠）：start 帧无条件重置', async () => {
    const { outbound, bot, session } = setup();

    outbound.routeStreamFrame('sess-qq', start('sess-qq:1'));
    outbound.routeStreamFrame('sess-qq', delta('sess-qq:1', 'stale'));
    await vi.advanceTimersByTimeAsync(200);
    expect(session.update).toHaveBeenCalledWith('stale');

    // agent replacement 后 attempt 计数重启，attemptId 与旧 agent 相同
    outbound.routeStreamFrame('sess-qq', start('sess-qq:1'));
    outbound.routeStreamFrame('sess-qq', delta('sess-qq:1', 'fresh'));
    await vi.advanceTimersByTimeAsync(200);

    expect(bot.openStream).toHaveBeenCalledTimes(1);
    expect(session.update).toHaveBeenNthCalledWith(2, 'fresh'); // 全量替换，无残留
  });

  it('迟到帧（旧 attemptId）被丢弃', async () => {
    const { outbound, session } = setup();

    outbound.routeStreamFrame('sess-qq', start('a1'));
    outbound.routeStreamFrame('sess-qq', delta('a1', 'x'));
    outbound.routeStreamFrame('sess-qq', start('a2'));
    outbound.routeStreamFrame('sess-qq', delta('a1', 'late')); // a1 的迟到帧
    await vi.advanceTimersByTimeAsync(200);

    expect(session.update).not.toHaveBeenCalledWith(expect.stringContaining('late'));
  });

  it('非 QQ 会话（无 record）忽略流式帧', async () => {
    const { outbound, bot } = setup({ record: undefined });

    outbound.routeStreamFrame('sess-web', start('a1'));
    outbound.routeStreamFrame('sess-web', delta('a1', 'hello'));
    await vi.advanceTimersByTimeAsync(200);

    expect(bot.openStream).not.toHaveBeenCalled();
    expect(bot.sendMarkdown).not.toHaveBeenCalled();
  });

  it('群聊不流式：帧累积后由 assistant/message 静态发送', async () => {
    const { outbound, bot } = setup({ record: createRecord(groupTarget) });

    outbound.routeStreamFrame('sess-qq', start('a1'));
    outbound.routeStreamFrame('sess-qq', delta('a1', 'group reply'));
    await vi.advanceTimersByTimeAsync(200);

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'group reply' }] } },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.openStream).not.toHaveBeenCalled();
    expect(bot.sendMarkdown).toHaveBeenCalledWith(groupTarget, 'group reply');
  });

  it('assistant/message 到达时收尾流式：complete 且不重复静态发送', async () => {
    const { outbound, bot, session } = setup();

    outbound.routeStreamFrame('sess-qq', start('a1'));
    outbound.routeStreamFrame('sess-qq', delta('a1', 'hello'));
    await vi.advanceTimersByTimeAsync(200);

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'hello' }] } },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(session.complete).toHaveBeenCalledTimes(1);
    expect(bot.sendMarkdown).not.toHaveBeenCalled();
  });

  it('旧通道回归：durable assistant/chunk 事件仍进 buffer', async () => {
    const { outbound, bot, session } = setup();

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'assistant/chunk',
      data: { chunk: { type: 'text-delta', text: 'legacy' } },
    });
    await vi.advanceTimersByTimeAsync(200);

    expect(bot.openStream).toHaveBeenCalledTimes(1);
    expect(session.update).toHaveBeenCalledWith('legacy');
  });
});

describe('OutboundRouter: deliverables/presented', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const presentedEvent = (callId: string, files: Array<{ path: string; description?: string }>) => ({
    type: 'deliverables/presented',
    data: { turn: 1, callId, files },
  });
  const turnEnd = { type: 'turn/end', data: { reason: { kind: 'stop' } } };
  const record = createRecord(c2cTarget);

  it('轮末投递声明的文件，且在文本之后', async () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const { outbound, bot } = setup({ deliverer: { deliver } });

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, presentedEvent('c1', [{ path: '/tmp/report.xlsx' }]));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'final reply' }] } },
    });
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, turnEnd);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(record.replyTarget, [{ path: '/tmp/report.xlsx' }]);
    // 文本先于文件：markdown 发送的调用序在 deliver 之前
    const textOrder = (bot.sendMarkdown as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(textOrder).toBeLessThan(deliver.mock.invocationCallOrder[0]);
  });

  it('同 callId 去重：事件重放不重复投递', async () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const { outbound } = setup({ deliverer: { deliver } });

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, presentedEvent('c1', [{ path: '/tmp/a.png' }]));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, presentedEvent('c1', [{ path: '/tmp/a.png' }]));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, presentedEvent('c2', [{ path: '/tmp/b.png' }]));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, turnEnd);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(record.replyTarget, [{ path: '/tmp/a.png' }, { path: '/tmp/b.png' }]);
  });

  it('assistant/message 在途文本未送达前不投递文件（等待 pending 发送完成）', async () => {
    let resolveText: (() => void) | undefined;
    const textTask = new Promise<void>((resolve) => { resolveText = resolve; });
    const bot: QQBotSender = {
      sendMarkdown: vi.fn(() => textTask),
      openStream: vi.fn(() => createSession()),
    };
    const record = createRecord(c2cTarget);
    const manager = {
      findBySessionId: vi.fn(() => record),
    } as unknown as SessionManager;
    const deliver = vi.fn().mockResolvedValue(undefined);
    const outbound = createOutboundHandler(manager, bot, createConfig(), createLogger(), undefined, { deliver });

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, presentedEvent('c1', [{ path: '/tmp/a.png' }]));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'reply' }] } },
    });
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, turnEnd);
    await Promise.resolve();
    await Promise.resolve();
    expect(deliver).not.toHaveBeenCalled(); // 文本仍在途

    resolveText?.();
    for (let i = 0; i < 10; i++) await Promise.resolve(); // 冲刷 catch 派生 + Promise.all 的微任务链
    expect(deliver).toHaveBeenCalledTimes(1); // 文本送达后才投递
  });

  it('配置关闭时不投递', async () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const { outbound } = setup({
      config: createConfig({ sendFile: { restrictPaths: true, extraRoots: [], sendPresentedFiles: false, maxFiles: 4 } as ImQQBotConfig['sendFile'] }),
      deliverer: { deliver },
    });

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, presentedEvent('c1', [{ path: '/tmp/a.png' }]));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, turnEnd);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(deliver).not.toHaveBeenCalled();
  });

  it('异常结束的轮次仍投递已声明的文件（宿主契约：失败不撤销声明）', async () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const { outbound, bot } = setup({ deliverer: { deliver } });

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, presentedEvent('c1', [{ path: '/tmp/a.png' }]));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'turn/end',
      data: { reason: { kind: 'error', error: { code: 'E_BROKEN', message: 'boom' } } },
    });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(bot.sendMarkdown).toHaveBeenCalledWith(c2cTarget, expect.stringContaining('E_BROKEN'));
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('未提供投递器时静默跳过（老环境降级）', async () => {
    const { outbound, bot } = setup();

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, presentedEvent('c1', [{ path: '/tmp/a.png' }]));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, turnEnd);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(bot.sendMarkdown).not.toHaveBeenCalled();
  });

  it('QQ 入站回合保持被动回复，同回合里的后续消息不改判', async () => {
    const inputs = new QqInputRegistry();
    inputs.register('msg-qq');
    const session = createSession();
    const bot = createBot(session);
    const record = createRecord(c2cTarget);
    const manager = {
      findBySessionId: vi.fn((id: string) => (id === 'sess-qq' ? record : undefined)),
    } as unknown as SessionManager;
    const config = createConfig();
    const tracker = createTurnTracker(manager, config, createLogger(), inputs);
    const outbound = createOutboundHandler(manager, bot, config, createLogger(), undefined, undefined, tracker);

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, { type: 'turn/start', data: { turn: 1 } });
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'user/message',
      data: { id: 'msg-qq', source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] },
    });
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'user/message',
      data: { source: { kind: 'time-context' }, content: [{ type: 'text', text: '现在是凌晨' }] },
    });
    outbound.routeStreamFrame('sess-qq', start('a1'));
    outbound.routeStreamFrame('sess-qq', delta('a1', 'hello'));
    await vi.advanceTimersByTimeAsync(200);

    expect(bot.openStream).toHaveBeenCalledTimes(1);
    expect(bot.sendMarkdown).not.toHaveBeenCalled();
  });

  it('非被动回复的消息主动推送，不复用上一条 msgId，下一轮恢复被动', async () => {
    const session = createSession();
    const bot = createBot(session);
    const record = createRecord(c2cTarget);
    const manager = {
      findBySessionId: vi.fn((id: string) => (id === 'sess-qq' ? record : undefined)),
    } as unknown as SessionManager;
    const outbound = createOutboundHandler(manager, bot, createConfig(), createLogger());

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, { type: 'turn/start', data: { turn: 2 } });
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'user/message',
      data: { source: { kind: 'schedule' }, content: [{ type: 'text', text: '念头' }] },
    });
    outbound.routeStreamFrame('sess-qq', start('a1'));
    outbound.routeStreamFrame('sess-qq', delta('a1', 'hello qq'));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'hello qq' }] } },
    });
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'turn/end',
      data: { turn: 2, reason: { kind: 'completed' } },
    });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(bot.openStream).not.toHaveBeenCalled();
    expect(bot.sendMarkdown).toHaveBeenCalledWith(
      { scope: 'c2c', targetId: 'user1', forceProactive: true },
      'hello qq',
    );

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'later' }] } },
    });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(bot.sendMarkdown).toHaveBeenCalledWith(c2cTarget, 'later');
  });

  it('迟到的上一轮结束不清掉当前回合', async () => {
    const session = createSession();
    const bot = createBot(session);
    const record = createRecord(c2cTarget);
    const manager = {
      findBySessionId: vi.fn((id: string) => (id === 'sess-qq' ? record : undefined)),
    } as unknown as SessionManager;
    const outbound = createOutboundHandler(manager, bot, createConfig(), createLogger());

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, { type: 'turn/start', data: { turn: 2 } });
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'user/message',
      data: { source: { kind: 'schedule' }, content: [{ type: 'text', text: '念头' }] },
    });
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'completed' } },
    });
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'assistant/message',
      data: { turn: 2, message: { content: [{ type: 'text', text: 'still pushing' }] } },
    });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(bot.sendMarkdown).toHaveBeenCalledWith(
      { scope: 'c2c', targetId: 'user1', forceProactive: true },
      'still pushing',
    );
  });

  it('没有有效回合号时不记归属', async () => {
    const session = createSession();
    const bot = createBot(session);
    const record = createRecord(c2cTarget);
    const manager = {
      findBySessionId: vi.fn((id: string) => (id === 'sess-qq' ? record : undefined)),
    } as unknown as SessionManager;
    const outbound = createOutboundHandler(manager, bot, createConfig(), createLogger());

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, { type: 'turn/start', data: {} });
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'user/message',
      data: { source: { kind: 'schedule' }, content: [{ type: 'text', text: '念头' }] },
    });
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'hello' }] } },
    });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(bot.sendMarkdown).toHaveBeenCalledWith(c2cTarget, 'hello');
  });

  it('同一回合里后到的 QQ 入站压过已经记成主动的消息', async () => {
    const inputs = new QqInputRegistry();
    inputs.register('msg-late');
    const session = createSession();
    const bot = createBot(session);
    const record = createRecord(c2cTarget);
    const manager = {
      findBySessionId: vi.fn((id: string) => (id === 'sess-qq' ? record : undefined)),
    } as unknown as SessionManager;
    const config = createConfig();
    const tracker = createTurnTracker(manager, config, createLogger(), inputs);
    const outbound = createOutboundHandler(manager, bot, config, createLogger(), undefined, undefined, tracker);

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, { type: 'turn/start', data: { turn: 3 } });
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'user/message',
      data: { source: { kind: 'schedule' }, content: [{ type: 'text', text: '念头' }] },
    });
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'user/message',
      data: { id: 'msg-late', source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] },
    });
    outbound.routeStreamFrame('sess-qq', start('a1'));
    outbound.routeStreamFrame('sess-qq', delta('a1', 'still passive'));
    await vi.advanceTimersByTimeAsync(200);

    expect(bot.openStream).toHaveBeenCalledTimes(1);
    expect(bot.sendMarkdown).not.toHaveBeenCalled();
  });
});

describe('OutboundRouter: 主动推送策略与非 QQ 会话', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const sid = { header: { id: 'sess-qq' } };
  const externalInput = { type: 'user/message', data: { id: 'desktop-1', source: { kind: 'user' } } };
  const reply = (text: string) => ({
    type: 'assistant/message',
    data: { turn: 7, message: { content: [{ type: 'text', text }] } },
  });

  async function runExternalTurn(target: ReplyTarget, externalTurns?: 'off' | 'c2c' | 'all') {
    const bot = createBot(createSession());
    const record = createRecord(target);
    const manager = {
      findBySessionId: vi.fn((id: string) => (id === 'sess-qq' ? record : undefined)),
    } as unknown as SessionManager;
    const config = createConfig(externalTurns ? { proactiveDelivery: { externalTurns } } : undefined);
    const outbound = createOutboundHandler(manager, bot, config, createLogger());

    outbound.routeSessionEvent(sid, { type: 'turn/start', data: { turn: 7 } });
    outbound.routeSessionEvent(sid, externalInput);
    outbound.routeSessionEvent(sid, reply('from desktop'));
    await vi.advanceTimersByTimeAsync(0);
    return bot;
  }

  it.each([
    ['c2c 默认策略：私聊外部回合主动推送', c2cTarget, undefined, true],
    ['c2c 默认策略：群聊外部回合不推送', groupTarget, undefined, false],
    ['all：群聊外部回合也推送', groupTarget, 'all' as const, true],
    ['off：私聊外部回合不推送', c2cTarget, 'off' as const, false],
  ])('%s', async (_name, target, policy, delivered) => {
    const bot = await runExternalTurn(target, policy);
    if (delivered) {
      expect(bot.sendMarkdown).toHaveBeenCalledWith(
        { scope: target.scope, targetId: target.targetId, forceProactive: true },
        'from desktop',
      );
    } else {
      expect(bot.sendMarkdown).not.toHaveBeenCalled();
    }
  });

  it('非 QQ 会话的回合不进入状态表', () => {
    const manager = { findBySessionId: vi.fn(() => undefined) } as unknown as SessionManager;
    const config = createConfig();
    const tracker = createTurnTracker(manager, config, createLogger());
    const outbound = createOutboundHandler(
      manager, createBot(createSession()), config, createLogger(), undefined, undefined, tracker,
    );

    outbound.routeSessionEvent({ header: { id: 'sess-web' } }, { type: 'turn/start', data: { turn: 1 } });

    expect(tracker.activeTurns).toBe(0);
  });

  it('会话已回收时按 deliveryAddress 主动推送，交付文件发往同一目标', async () => {
    const bot = createBot(createSession());
    const deliver = vi.fn().mockResolvedValue(undefined);
    const manager = {
      findBySessionId: vi.fn(() => undefined),
      deliveryAddress: vi.fn((id: string) => (id === 'sess-qq' ? { scope: 'c2c', targetId: 'user1' } : undefined)),
    } as unknown as SessionManager;
    const outbound = createOutboundHandler(manager, bot, createConfig(), createLogger(), undefined, { deliver });

    outbound.routeSessionEvent(sid, { type: 'turn/start', data: { turn: 7 } });
    outbound.routeSessionEvent(sid, { type: 'user/message', data: { source: { kind: 'schedule' } } });
    outbound.routeSessionEvent(sid, { type: 'deliverables/presented', data: { turn: 7, callId: 'c1', files: [{ path: '/tmp/a.png' }] } });
    outbound.routeSessionEvent(sid, reply('scheduled'));
    outbound.routeSessionEvent(sid, { type: 'turn/end', data: { turn: 7, reason: { kind: 'completed' } } });
    for (let i = 0; i < 10; i++) await Promise.resolve();

    const pushed = { scope: 'c2c', targetId: 'user1', forceProactive: true };
    expect(bot.sendMarkdown).toHaveBeenCalledWith(pushed, 'scheduled');
    expect(deliver).toHaveBeenCalledWith(pushed, [{ path: '/tmp/a.png' }]);
  });

  it('回合结束释放本回合认领的 QQ 入站登记', () => {
    const inputs = new QqInputRegistry();
    inputs.register('msg-qq');
    const record = createRecord(c2cTarget);
    const manager = { findBySessionId: vi.fn(() => record) } as unknown as SessionManager;
    const config = createConfig();
    const tracker = createTurnTracker(manager, config, createLogger(), inputs);
    const outbound = createOutboundHandler(
      manager, createBot(createSession()), config, createLogger(), undefined, undefined, tracker,
    );

    outbound.routeSessionEvent(sid, { type: 'turn/start', data: { turn: 1 } });
    outbound.routeSessionEvent(sid, { type: 'user/message', data: { id: 'msg-qq', source: { kind: 'user' } } });
    expect(inputs.has('msg-qq')).toBe(true);
    outbound.routeSessionEvent(sid, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });

    expect(inputs.has('msg-qq')).toBe(false);
    expect(tracker.activeTurns).toBe(0);
  });
});

describe('OutboundRouter: mirrorWeb（Web 提问镜像到 QQ）', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const sid = { header: { id: 'sess-qq' } };
  const turnStart = { type: 'turn/start', data: { turn: 1 } };
  const userMessage = (
    source: Record<string, unknown>,
    text: string,
    id?: string,
  ) => ({
    type: 'user/message',
    data: { id, source, content: [{ type: 'text', text }] },
  });

  async function settle(): Promise<void> {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }

  function setupMirror(opts: {
    config?: Partial<ImQQBotConfig>;
    inputs?: QqInputRegistry;
    target?: ReplyTarget;
  } = {}) {
    const session = createSession();
    const bot = createBot(session);
    const record = createRecord(opts.target ?? c2cTarget);
    const manager = {
      findBySessionId: vi.fn((id: string) => (id === 'sess-qq' ? record : undefined)),
    } as unknown as SessionManager;
    const config = createConfig(opts.config);
    const inputs = opts.inputs ?? new QqInputRegistry();
    const tracker = createTurnTracker(manager, config, createLogger(), inputs);
    const outbound = createOutboundHandler(manager, bot, config, createLogger(), undefined, undefined, tracker);
    return { outbound, bot };
  }

  it('默认关闭：网页输入一条消息也不发送', async () => {
    const { outbound, bot } = setupMirror();

    outbound.routeSessionEvent(sid, turnStart);
    outbound.routeSessionEvent(sid, userMessage({ kind: 'user' }, '在网页里问的问题', 'web-1'));
    await settle();

    expect(bot.sendMarkdown).not.toHaveBeenCalled();
  });

  it('开启后 external 来源镜像成一条主动消息，正文逐字保留', async () => {
    const { outbound, bot } = setupMirror({ config: { mirrorWeb: true } });

    outbound.routeSessionEvent(sid, turnStart);
    outbound.routeSessionEvent(sid, userMessage({ kind: 'user' }, '在网页里问的问题', 'web-1'));
    await settle();

    expect(bot.sendMarkdown).toHaveBeenCalledTimes(1);
    const [target, text] = (bot.sendMarkdown as ReturnType<typeof vi.fn>).mock.calls[0] as [ReplyTarget, string];
    // external 回合已置 forceProactive：镜像不吃被动回复额度
    expect(target).toEqual({ scope: 'c2c', targetId: 'user1', forceProactive: true });
    expect(text).toBe('🌐 来自 Web：在网页里问的问题');
    expect(text).toContain('在网页里问的问题');
  });

  it('qq 来源不镜像（QQ 端本来就有这条消息）', async () => {
    const inputs = new QqInputRegistry();
    inputs.register('msg-qq');
    const { outbound, bot } = setupMirror({ config: { mirrorWeb: true }, inputs });

    outbound.routeSessionEvent(sid, turnStart);
    outbound.routeSessionEvent(sid, userMessage({ kind: 'user' }, '你好', 'msg-qq'));
    await settle();

    expect(bot.sendMarkdown).not.toHaveBeenCalled();
  });

  it.each([
    ['schedule 注入', { kind: 'schedule' }],
    ['已回答的提问回显', { kind: 'user-question-reply' }],
    ['notice 形态', { kind: 'user', form: 'notice' }],
    ['每轮上下文（非 user kind）', { kind: 'time-context' }],
  ])('internal 来源不镜像：%s', async (_name, source) => {
    const { outbound, bot } = setupMirror({ config: { mirrorWeb: true } });

    outbound.routeSessionEvent(sid, turnStart);
    outbound.routeSessionEvent(sid, userMessage(source as Record<string, unknown>, '插件自己塞的字', 'plugin-1'));
    await settle();

    expect(bot.sendMarkdown).not.toHaveBeenCalled();
  });

  it('仅附件的消息不镜像（没有可镜像的正文）', async () => {
    const { outbound, bot } = setupMirror({ config: { mirrorWeb: true } });

    outbound.routeSessionEvent(sid, turnStart);
    outbound.routeSessionEvent(sid, {
      type: 'user/message',
      data: { id: 'web-img', source: { kind: 'user' }, content: [{ type: 'image', url: 'https://example.com/a.png' }] },
    });
    await settle();

    expect(bot.sendMarkdown).not.toHaveBeenCalled();
  });

  it('externalTurns=off 时不镜像（跟随主动推送策略）', async () => {
    const { outbound, bot } = setupMirror({
      config: { mirrorWeb: true, proactiveDelivery: { externalTurns: 'off' } },
    });

    outbound.routeSessionEvent(sid, turnStart);
    outbound.routeSessionEvent(sid, userMessage({ kind: 'user' }, '桌面输入的提问', 'web-1'));
    await settle();

    expect(bot.sendMarkdown).not.toHaveBeenCalled();
  });
});

describe('OutboundRouter: wakeupFallback（文本三档兜底）', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const sid = { header: { id: 'sess-qq' } };
  const replyEvent = {
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: '回复正文' }] } },
  };

  async function settle(): Promise<void> {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  }

  /** 按顺序决定 sendMarkdown 的结果；缺省一律失败（被动窗口已用尽） */
  function makeBot(sequence: Array<'ok' | 'fail'>, wakeup: 'ok' | 'fail' | 'absent'): QQBotSender {
    const sendMarkdown = vi.fn();
    for (const outcome of sequence) {
      if (outcome === 'ok') sendMarkdown.mockResolvedValueOnce(undefined);
      else sendMarkdown.mockRejectedValueOnce(new Error('passive reply window expired'));
    }
    sendMarkdown.mockRejectedValue(new Error('passive reply window expired'));
    const bot: QQBotSender = { sendMarkdown, openStream: vi.fn(() => createSession()) };
    if (wakeup === 'ok') bot.sendWakeup = vi.fn().mockResolvedValue(undefined);
    else if (wakeup === 'fail') bot.sendWakeup = vi.fn().mockRejectedValue(new Error('wakeup limited'));
    return bot;
  }

  function setupFallback(bot: QQBotSender, opts: {
    target?: ReplyTarget;
    config?: Partial<ImQQBotConfig>;
  } = {}) {
    const record = createRecord(opts.target ?? c2cTarget);
    const manager = {
      findBySessionId: vi.fn((id: string) => (id === 'sess-qq' ? record : undefined)),
    } as unknown as SessionManager;
    const config = createConfig(opts.config);
    return createOutboundHandler(manager, bot, config, createLogger());
  }

  it('默认关闭：被动发送失败只记错误，不重投也不唤醒', async () => {
    const bot = makeBot([], 'ok');
    const outbound = setupFallback(bot);

    outbound.routeSessionEvent(sid, replyEvent);
    await settle();

    expect(bot.sendMarkdown).toHaveBeenCalledTimes(1);
    expect(bot.sendMarkdown).toHaveBeenCalledWith(c2cTarget, '回复正文');
    expect(bot.sendWakeup).not.toHaveBeenCalled();
  });

  it('开启后 c2c 两档都失败才用唤醒消息补一次', async () => {
    const bot = makeBot([], 'ok');
    const outbound = setupFallback(bot, { config: { wakeupFallback: true } });

    outbound.routeSessionEvent(sid, replyEvent);
    await settle();

    const calls = (bot.sendMarkdown as ReturnType<typeof vi.fn>).mock.calls as Array<[ReplyTarget, string]>;
    expect(calls).toHaveLength(2);
    expect(calls[0]![0]).toEqual(c2cTarget); // 第一档：被动回复带 msgId
    expect(calls[1]![0]).toEqual({ scope: 'c2c', targetId: 'user1', forceProactive: true }); // 第二档：去 msgId
    expect(bot.sendWakeup).toHaveBeenCalledTimes(1);
    expect(bot.sendWakeup).toHaveBeenCalledWith({ scope: 'c2c', targetId: 'user1' }, '回复正文');
  });

  it('第二档成功就不再唤醒', async () => {
    const bot = makeBot(['fail', 'ok'], 'ok');
    const outbound = setupFallback(bot, { config: { wakeupFallback: true } });

    outbound.routeSessionEvent(sid, replyEvent);
    await settle();

    expect(bot.sendMarkdown).toHaveBeenCalledTimes(2);
    expect(bot.sendWakeup).not.toHaveBeenCalled();
  });

  it('群聊不唤醒：两档都失败就放弃', async () => {
    const bot = makeBot([], 'ok');
    const outbound = setupFallback(bot, {
      target: groupTarget,
      config: { wakeupFallback: true },
    });

    outbound.routeSessionEvent(sid, replyEvent);
    await settle();

    expect(bot.sendMarkdown).toHaveBeenCalledTimes(2);
    expect(bot.sendWakeup).not.toHaveBeenCalled();
  });

  it('适配器没有唤醒能力时降级为放弃（不抛错）', async () => {
    const bot = makeBot([], 'absent');
    const outbound = setupFallback(bot, { config: { wakeupFallback: true } });

    outbound.routeSessionEvent(sid, replyEvent);
    await settle();

    expect(bot.sendMarkdown).toHaveBeenCalledTimes(2);
    expect(bot.sendWakeup).toBeUndefined();
  });

  it('唤醒也失败时不重复补发（每档只一次）', async () => {
    const bot = makeBot([], 'fail');
    const outbound = setupFallback(bot, { config: { wakeupFallback: true } });

    outbound.routeSessionEvent(sid, replyEvent);
    await settle();

    expect(bot.sendMarkdown).toHaveBeenCalledTimes(2);
    expect(bot.sendWakeup).toHaveBeenCalledTimes(1);
  });
});
