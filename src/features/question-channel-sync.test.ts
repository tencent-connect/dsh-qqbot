import { describe, it, expect, vi } from 'vitest';
import {
  QuestionChannel,
  type UserQuestion,
  type UserQuestionRequest,
  type UserQuestionResult,
  type QuestionSessionRecordLike,
} from './question-channel.ts';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

interface SentMessage {
  text: string;
  opts?: { keyboard?: unknown };
}

function createSender(sent: SentMessage[]) {
  return {
    sendMarkdown: vi.fn(async (_target: ReplyTarget, content: string, o?: { keyboard?: unknown }) => {
      sent.push({ text: content, opts: o });
    }),
  };
}

const sessionKey = (scope: ChatScope, peerId: string): string => `qqbot:app:${scope}:${peerId}`;

function makeRecord(sessionKeyStr: string, scope: ChatScope = 'c2c', sessionId?: string): QuestionSessionRecordLike {
  const record: QuestionSessionRecordLike = {
    sessionKey: sessionKeyStr,
    scope,
    replyTarget: { scope, targetId: 'x', msgId: 'm' },
  };
  if (sessionId !== undefined) record.sessionId = sessionId;
  return record;
}

/** 双端同步相关测试的 manager 桩：按会话查记录、按会话反查 QQ 地址（桥接） */
function createManager(opts?: {
  findBySessionId?: (id: string) => QuestionSessionRecordLike | undefined;
  getSessionRecord?: (scope: ChatScope, peerId: string) => QuestionSessionRecordLike | undefined;
  deliveryAddress?: (sessionId: string) => ReplyTarget | undefined;
}) {
  return {
    findBySessionId: opts?.findBySessionId ?? ((): QuestionSessionRecordLike | undefined => undefined),
    // 默认按 scope+peerId 派生 sessionKey 反查，与 askViaQQ 的登记键一致
    getSessionRecord: opts?.getSessionRecord
      ?? ((scope: ChatScope, peerId: string) => makeRecord(sessionKey(scope, peerId), scope)),
    ...(opts?.deliveryAddress ? { deliveryAddress: opts.deliveryAddress } : {}),
  };
}

const syncConfig = { requireMention: false, askTimeoutMs: 60_000, questionSync: true };

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const q = (id = 'q'): UserQuestion => ({ id, question: '选哪个？', options: [{ label: 'A' }, { label: 'B' }] });

describe('QuestionChannel.askDual（双端同步：先答先得）', () => {
  it('QQ 先答：定案并中止 Web 卡片', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), syncConfig, createLogger());
    let webSignal: AbortSignal | undefined;
    const origAsk = vi.fn(async (req: UserQuestionRequest) => {
      webSignal = req.signal;
      return new Promise<UserQuestionResult>((_resolve, reject) => {
        req.signal?.addEventListener('abort', () => reject(new Error('ASK_ABORTED')), { once: true });
      });
    });

    const record = makeRecord(sessionKey('c2c', 'U1'));
    const p = ch.askDual(record, record.replyTarget, { questions: [q()] }, origAsk);
    await sleep(20);
    expect(sent).toHaveLength(1); // QQ 侧已发题
    expect(ch.tryAnswer('c2c', 'U1', '1')).toBe(true);

    await expect(p).resolves.toEqual({ answers: [{ id: 'q', selected: ['A'] }] });
    expect(webSignal?.aborted).toBe(true);
    expect(origAsk).toHaveBeenCalledTimes(1);
  });

  it('Web 先答：释放 QQ 待答，之后的 QQ 文本回归常规消息流', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), syncConfig, createLogger());
    let webResolve!: (r: UserQuestionResult) => void;
    const origAsk = vi.fn(() => new Promise<UserQuestionResult>((res) => { webResolve = res; }));

    const record = makeRecord(sessionKey('c2c', 'U1'));
    const p = ch.askDual(record, record.replyTarget, { questions: [q()] }, origAsk);
    await sleep(20);
    expect(sent).toHaveLength(1);
    webResolve({ answers: [{ id: 'q', selected: ['B'] }] });

    await expect(p).resolves.toEqual({ answers: [{ id: 'q', selected: ['B'] }] });
    // 待答已释放：QQ 端再输入不再被当作答案
    expect(ch.tryAnswer('c2c', 'U1', '1')).toBe(false);
  });

  it('QQ 投递失败：降级为仅 Web，不影响作答', async () => {
    const ch = new QuestionChannel(
      createManager(),
      { sendMarkdown: vi.fn(async () => { throw new Error('qq offline'); }) },
      syncConfig,
      createLogger(),
    );
    const origAsk = vi.fn(async () => ({ answers: [{ id: 'q', selected: ['A'] }] }));
    const record = makeRecord(sessionKey('c2c', 'U1'));

    await expect(ch.askDual(record, record.replyTarget, { questions: [q()] }, origAsk))
      .resolves.toEqual({ answers: [{ id: 'q', selected: ['A'] }] });
  });

  it('两端都失败才拒绝', async () => {
    const ch = new QuestionChannel(
      createManager(),
      { sendMarkdown: vi.fn(async () => { throw new Error('qq offline'); }) },
      syncConfig,
      createLogger(),
    );
    const origAsk = vi.fn(async () => { throw new Error('web down'); });
    const record = makeRecord(sessionKey('c2c', 'U1'));

    await expect(ch.askDual(record, record.replyTarget, { questions: [q()] }, origAsk))
      .rejects.toThrow('web down');
  });

  it('多题竞速：赢家一次性给出全部答案', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), syncConfig, createLogger());
    const origAsk = vi.fn(() => new Promise<UserQuestionResult>(() => {})); // Web 永不作答
    const questions: UserQuestion[] = [
      { id: 'a', question: 'Q1', options: [{ label: 'A1' }, { label: 'B1' }] },
      q('b'),
    ];

    const record = makeRecord(sessionKey('c2c', 'U1'));
    const p = ch.askDual(record, record.replyTarget, { questions }, origAsk);
    await sleep(20);
    expect(ch.tryAnswer('c2c', 'U1', '2')).toBe(true); // 第一题
    await sleep(20);
    expect(sent).toHaveLength(2); // 第二题已发出
    expect(ch.tryAnswer('c2c', 'U1', '1')).toBe(true); // 第二题

    await expect(p).resolves.toEqual({
      answers: [{ id: 'a', selected: ['B1'] }, { id: 'b', selected: ['A'] }],
    });
  });
});

describe('QuestionChannel.install 双端路由', () => {
  it('QQ 会话：问题同时投 QQ 与 Web，先答先得', async () => {
    const sent: SentMessage[] = [];
    const record = makeRecord(sessionKey('c2c', 'u9'), 'c2c', 'sess-qq');
    const manager = createManager({ findBySessionId: (id) => (id === 'sess-qq' ? record : undefined) });
    const ch = new QuestionChannel(manager, createSender(sent), syncConfig, createLogger());
    let webCalled = 0;
    const uq = {
      ask: vi.fn(async () => {
        webCalled += 1;
        return new Promise<UserQuestionResult>(() => {}); // Web 卡片挂着等人答
      }),
    };
    ch.install({ get: (n: string) => (n === 'userQuestions' ? uq : undefined) });

    const p = uq.ask({ questions: [q()], agent: { id: 'sess-qq' } });
    await sleep(20);
    expect(sent).toHaveLength(1); // QQ 侧已投递
    expect(webCalled).toBe(1);   // Web 卡片也在
    expect(ch.tryAnswer('c2c', 'u9', '2')).toBe(true);

    await expect(p).resolves.toEqual({ answers: [{ id: 'q', selected: ['B'] }] });
  });

  it('questionSync 关闭：保持 QQ 单端，不触碰宿主原实现', async () => {
    const sent: SentMessage[] = [];
    const record = makeRecord(sessionKey('c2c', 'u9'), 'c2c', 'sess-qq');
    const manager = createManager({ findBySessionId: (id) => (id === 'sess-qq' ? record : undefined) });
    const ch = new QuestionChannel(
      manager, createSender(sent), { requireMention: false, askTimeoutMs: 60_000, questionSync: false }, createLogger(),
    );
    let origCalled = 0;
    const uq = { ask: vi.fn(async () => { origCalled += 1; return { answers: [] }; }) };
    ch.install({ get: (n: string) => (n === 'userQuestions' ? uq : undefined) });

    const p = uq.ask({ questions: [q()], agent: { id: 'sess-qq' } });
    await sleep(20);
    expect(origCalled).toBe(0);
    expect(ch.tryAnswer('c2c', 'u9', '1')).toBe(true);
    await expect(p).resolves.toEqual({ answers: [{ id: 'q', selected: ['A'] }] });
  });

  it('桥接：无活跃记录但能解析 QQ 地址 → 双端出现，QQ 作答可推进', async () => {
    const sent: SentMessage[] = [];
    const manager = createManager({
      deliveryAddress: (id) => (id === 'sess-web' ? { scope: 'c2c', targetId: 'P9' } : undefined),
    });
    const ch = new QuestionChannel(manager, createSender(sent), syncConfig, createLogger());
    let webCalled = 0;
    const uq = {
      ask: vi.fn(async () => {
        webCalled += 1;
        return new Promise<UserQuestionResult>(() => {});
      }),
    };
    ch.install({ get: (n: string) => (n === 'userQuestions' ? uq : undefined) });

    const p = uq.ask({ questions: [q()], agent: { id: 'sess-web' } });
    await sleep(20);
    expect(sent).toHaveLength(1); // 桥接投递到 QQ 成功
    expect(webCalled).toBe(1);    // 双端：Web 卡片也在
    // 桥接会话没有 SessionRecord，答案按 scope+peerId 派生键命中
    expect(ch.tryAnswer('c2c', 'P9', '2')).toBe(true);

    await expect(p).resolves.toEqual({ answers: [{ id: 'q', selected: ['B'] }] });
  });

  it('桥接：本回合按策略不投递到 QQ → 交回宿主界面', async () => {
    const sent: SentMessage[] = [];
    const manager = createManager({
      deliveryAddress: (id) => (id === 'sess-web' ? { scope: 'group', targetId: 'g1' } : undefined),
    });
    const ch = new QuestionChannel(
      manager, createSender(sent), syncConfig, createLogger(), { targetFor: () => undefined },
    );
    const orig = vi.fn(async () => ({ answers: [] }));
    const uq = { ask: orig };
    ch.install({ get: (n: string) => (n === 'userQuestions' ? uq : undefined) });

    await uq.ask({ questions: [q()], agent: { id: 'sess-web' } });

    expect(orig).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(0); // 未向 QQ 投递
  });

  it('既无活跃记录也无 QQ 地址：保持宿主原实现', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), syncConfig, createLogger());
    let origCalled = 0;
    const uq = { ask: vi.fn(async () => { origCalled += 1; return { answers: [] }; }) };
    ch.install({ get: (n: string) => (n === 'userQuestions' ? uq : undefined) });

    await uq.ask({ questions: [q()], agent: { id: 'sess-unknown' } });

    expect(origCalled).toBe(1);
    expect(sent).toHaveLength(0); // 未向 QQ 投递
  });
});