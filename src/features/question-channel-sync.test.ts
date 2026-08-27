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

function makeRecord(sessionKeyStr: string, scope: ChatScope = 'c2c'): QuestionSessionRecordLike {
  return { sessionKey: sessionKeyStr, scope, replyTarget: { scope, targetId: 'x', msgId: 'm' } };
}

/** 双端同步相关测试的 manager 桩：带规范键/桥接/存活 agent 查询 */
function createSyncManager(opts?: {
  findBySessionId?: (id: string) => QuestionSessionRecordLike | undefined;
  resolvePeer?: (sid: string) => { scope: ChatScope; peerId: string; lastMsgId?: string } | undefined;
}) {
  return {
    findBySessionId: opts?.findBySessionId ?? ((): QuestionSessionRecordLike | undefined => undefined),
    getSessionRecord: (scope: ChatScope, peerId: string): QuestionSessionRecordLike => makeRecord(sessionKey(scope, peerId), scope),
    sessionKey,
    ...(opts?.resolvePeer ? { resolvePeer: opts.resolvePeer } : {}),
  };
}

const syncConfig = { requireMention: false, askTimeoutMs: 60_000, questionSync: true };

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const q2 = (id = 'q'): UserQuestion => ({ id, question: '选哪个？', options: [{ label: 'A' }, { label: 'B' }] });

describe('QuestionChannel.askDual（双端同步：先答先得）', () => {
  it('QQ-first answer wins and aborts the web card', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createSyncManager(), createSender(sent), syncConfig, createLogger());
    let webAbortSignal: AbortSignal | undefined;
    const origAsk = vi.fn(async (req: UserQuestionRequest) => {
      webAbortSignal = req.signal;
      return new Promise<UserQuestionResult>((_resolve, reject) => {
        req.signal?.addEventListener('abort', () => reject(new Error('ASK_ABORTED')), { once: true });
      });
    });

    const p = ch.askDual(makeRecord(sessionKey('c2c', 'U1')), { questions: [q2()] }, origAsk);
    await sleep(20);
    expect(ch.tryAnswer('c2c', 'U1', '1')).toBe(true);
    await expect(p).resolves.toEqual({ answers: [{ id: 'q', selected: ['A'] }] });
    expect(webAbortSignal?.aborted).toBe(true);
    expect(origAsk).toHaveBeenCalledTimes(1);
  });

  it('web-first answer releases QQ pending (later QQ text is a normal message)', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createSyncManager(), createSender(sent), syncConfig, createLogger());
    let webResolve!: (r: UserQuestionResult) => void;
    const origAsk = vi.fn(() => new Promise<UserQuestionResult>((res) => { webResolve = res; }));

    const p = ch.askDual(makeRecord(sessionKey('c2c', 'U1')), { questions: [q2()] }, origAsk);
    await sleep(20);
    expect(sent).toHaveLength(1); // QQ 侧已发出问题
    webResolve({ answers: [{ id: 'q', selected: ['B'] }] });
    await expect(p).resolves.toEqual({ answers: [{ id: 'q', selected: ['B'] }] });
    // 待答已释放：QQ 端再输入不再被当作答案
    expect(ch.tryAnswer('c2c', 'U1', '1')).toBe(false);
  });

  it('QQ delivery failure degrades to web-only', async () => {
    const ch = new QuestionChannel(
      createSyncManager(),
      { sendMarkdown: vi.fn(async () => { throw new Error('qq offline'); }) },
      syncConfig,
      createLogger(),
    );
    const origAsk = vi.fn(async () => ({ answers: [{ id: 'q', selected: ['A'] }] }));
    await expect(ch.askDual(makeRecord(sessionKey('c2c', 'U1')), { questions: [q2()] }, origAsk))
      .resolves.toEqual({ answers: [{ id: 'q', selected: ['A'] }] });
  });

  it('rejects only when both sides fail', async () => {
    const ch = new QuestionChannel(
      createSyncManager(),
      { sendMarkdown: vi.fn(async () => { throw new Error('qq offline'); }) },
      syncConfig,
      createLogger(),
    );
    const origAsk = vi.fn(async () => { throw new Error('web down'); });
    await expect(ch.askDual(makeRecord(sessionKey('c2c', 'U1')), { questions: [q2()] }, origAsk))
      .rejects.toThrow('web down');
  });

  it('multi-question race resolves with all answers from the winning side', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createSyncManager(), createSender(sent), syncConfig, createLogger());
    const origAsk = vi.fn(() => new Promise<UserQuestionResult>(() => {})); // Web 永不作答
    const qs: UserQuestion[] = [{ id: 'a', question: 'Q1', options: [{ label: 'A1' }, { label: 'B1' }] }, q2('b')];

    const p = ch.askDual(makeRecord(sessionKey('c2c', 'U1')), { questions: qs }, origAsk);
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

describe('QuestionChannel.install 桥接路由（Web 回合继续的 QQ 会话）', () => {
  it('bridges via peer map: question lands on QQ and web card stays', async () => {
    const sent: SentMessage[] = [];
    const manager = createSyncManager({
      resolvePeer: (sid) => (sid === 'sess-web' ? { scope: 'c2c' as const, peerId: 'P9' } : undefined),
    });
    const ch = new QuestionChannel(manager, createSender(sent), syncConfig, createLogger());
    let webCalled = 0;
    const uq = { ask: vi.fn(async () => { webCalled += 1; return new Promise<UserQuestionResult>(() => {}); }) };
    ch.install({ get: (n: string) => (n === 'userQuestions' ? uq : undefined) });

    const p = uq.ask({ questions: [q2()], agent: { id: 'sess-web' } });
    await sleep(20);
    expect(sent).toHaveLength(1); // 桥接投递到 QQ 成功
    expect(webCalled).toBe(1);   // 双端：Web 卡片也在
    expect(ch.tryAnswer('c2c', 'P9', '2')).toBe(true);
    await expect(p).resolves.toEqual({ answers: [{ id: 'q', selected: ['B'] }] });
  });

  it('without peer mapping, non-QQ sessions keep the original ask', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createSyncManager(), createSender(sent), syncConfig, createLogger());
    let origCalled = 0;
    const uq = { ask: vi.fn(async () => { origCalled += 1; return { answers: [] }; }) };
    ch.install({ get: (n: string) => (n === 'userQuestions' ? uq : undefined) });

    await uq.ask({ questions: [q2()], agent: { id: 'sess-unknown' } });
    expect(origCalled).toBe(1);
    expect(sent).toHaveLength(0); // 未向 QQ 投递
  });
});
