import { describe, it, expect, vi } from 'vitest';
import {
  QuestionChannel,
  renderAnswerText,
  type UserQuestion,
  type UserQuestionResult,
  type QuestionSessionRecordLike,
  type QuestionAgentLike,
} from './question-channel.ts';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const sessionKey = (scope: ChatScope, peerId: string): string => `qqbot:app:${scope}:${peerId}`;

/** 带 sessionId/agent 的活跃记录（回显写日志 + 镜像门闩） */
function makeLiveRecord(agent: QuestionAgentLike | undefined, sessionId = 'sess-1'): QuestionSessionRecordLike {
  return {
    sessionKey: sessionKey('c2c', 'U1'),
    sessionId,
    scope: 'c2c',
    replyTarget: { scope: 'c2c', targetId: 'U1', msgId: 'm' },
    agent,
    qqPendingTurns: 0,
  };
}

function createManagerFor(record: QuestionSessionRecordLike | undefined) {
  return {
    findBySessionId: (id: string) => (record && id === record.sessionId ? record : undefined),
    getSessionRecord: (scope: ChatScope, peerId: string) =>
      record && sessionKey(scope, peerId) === record.sessionKey ? record : undefined,
    sessionKey,
  };
}

const sender = () => ({ sendMarkdown: vi.fn(async () => undefined) });
const syncConfig = { requireMention: false, askTimeoutMs: 60_000, questionSync: true };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const q1 = (): UserQuestion => ({ id: 'q', question: '选哪个？', options: [{ label: 'A' }, { label: 'B' }] });

describe('renderAnswerText', () => {
  it('单题直接给答案值（选项与自定义合并）', () => {
    expect(renderAnswerText([q1()], { answers: [{ id: 'q', selected: ['A'] }] })).toBe('A');
    expect(renderAnswerText([q1()], { answers: [{ id: 'q', selected: [], custom: '打会游戏' }] })).toBe('打会游戏');
    expect(renderAnswerText([q1()], { answers: [{ id: 'q', selected: ['A'], custom: '补充' }] })).toBe('A；补充');
  });

  it('多题逐行「问题头: 答案」', () => {
    const qs: UserQuestion[] = [
      { id: 'a', header: '周末计划', question: 'Q1', options: [{ label: '爬山' }] },
      { id: 'b', question: 'Q2 没有 header', options: [{ label: '看电影' }] },
    ];
    const result: UserQuestionResult = {
      answers: [{ id: 'a', selected: ['爬山'] }, { id: 'b', selected: [], custom: '再说' }],
    };
    expect(renderAnswerText(qs, result)).toBe('周末计划: 爬山\nQ2 没有 header: 再说');
  });

  it('空答案返回 undefined', () => {
    expect(renderAnswerText([q1()], { answers: [{ id: 'q', selected: [] }] })).toBeUndefined();
    expect(renderAnswerText([q1()], { answers: [] })).toBeUndefined();
  });
});

describe('答案回显（agent.inject 写回会话日志）', () => {
  it('QQ 作答：回显答案 + 门闩 +1（出站镜像不重复推回 QQ）', async () => {
    const inject = vi.fn();
    const record = makeLiveRecord({ inject });
    const ch = new QuestionChannel(createManagerFor(record), sender(), syncConfig, createLogger());
    const origAsk = vi.fn(() => new Promise<UserQuestionResult>(() => {}));

    const p = ch.askDual(record, { questions: [q1()] }, origAsk);
    await sleep(20);
    expect(ch.tryAnswer('c2c', 'U1', '2')).toBe(true);
    await expect(p).resolves.toEqual({ answers: [{ id: 'q', selected: ['B'] }] });

    expect(inject).toHaveBeenCalledTimes(1);
    const msg = inject.mock.calls[0]?.[0] as { role: string; content: Array<{ text?: string }> };
    expect(msg.role).toBe('user');
    expect(msg.content[0]?.text).toBe('B');
    expect(record.qqPendingTurns).toBe(1); // 门闩：出站镜像跳过这条回显
  });

  it('Web 作答：回显但不门闩（出站层将镜像「🌐 来自 Web：<答案>」）', async () => {
    const inject = vi.fn();
    const record = makeLiveRecord({ inject });
    const ch = new QuestionChannel(createManagerFor(record), sender(), syncConfig, createLogger());
    let webResolve!: (r: UserQuestionResult) => void;
    const origAsk = vi.fn(() => new Promise<UserQuestionResult>((res) => { webResolve = res; }));

    const p = ch.askDual(record, { questions: [q1()] }, origAsk);
    await sleep(20);
    webResolve({ answers: [{ id: 'q', selected: ['A'] }] });
    await expect(p).resolves.toEqual({ answers: [{ id: 'q', selected: ['A'] }] });

    expect(inject).toHaveBeenCalledTimes(1);
    expect(record.qqPendingTurns).toBe(0); // 不门闩 → 出站镜像到 QQ
  });

  it('会话无存活 agent：静默跳过回显，不影响答案定案', async () => {
    const record = makeLiveRecord(undefined);
    const ch = new QuestionChannel(createManagerFor(record), sender(), syncConfig, createLogger());
    let webResolve!: (r: UserQuestionResult) => void;
    const origAsk = vi.fn(() => new Promise<UserQuestionResult>((res) => { webResolve = res; }));

    const p = ch.askDual(record, { questions: [q1()] }, origAsk);
    await sleep(20);
    webResolve({ answers: [{ id: 'q', selected: ['A'] }] });
    await expect(p).resolves.toEqual({ answers: [{ id: 'q', selected: ['A'] }] });
  });

  it('inject 抛错：回显 fail-soft，答案照常返回', async () => {
    const record = makeLiveRecord({ inject: () => { throw new Error('session disposed'); } });
    const ch = new QuestionChannel(createManagerFor(record), sender(), syncConfig, createLogger());
    let webResolve!: (r: UserQuestionResult) => void;
    const origAsk = vi.fn(() => new Promise<UserQuestionResult>((res) => { webResolve = res; }));

    const p = ch.askDual(record, { questions: [q1()] }, origAsk);
    await sleep(20);
    webResolve({ answers: [{ id: 'q', selected: ['A'] }] });
    await expect(p).resolves.toEqual({ answers: [{ id: 'q', selected: ['A'] }] });
  });
});
