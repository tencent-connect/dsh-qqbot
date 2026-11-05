import { describe, it, expect, vi } from 'vitest';
import {
  QuestionChannel,
  renderAnswerText,
  type QuestionSessionRecordLike,
  type UserQuestion,
  type UserQuestionResult,
} from './question-channel.ts';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const sessionKey = (scope: ChatScope, peerId: string): string => `qqbot:app:${scope}:${peerId}`;

/** 活跃记录：带 sessionId 与宿主 agent（回显写日志用） */
function makeLiveRecord(agent: unknown, sessionId = 'sess-1'): QuestionSessionRecordLike {
  return {
    sessionKey: sessionKey('c2c', 'U1'),
    sessionId,
    scope: 'c2c',
    replyTarget: { scope: 'c2c', targetId: 'U1', msgId: 'm' },
    agent,
  };
}

function createManagerFor(record: QuestionSessionRecordLike | undefined) {
  return {
    findBySessionId: (id: string) => (record && id === record.sessionId ? record : undefined),
    getSessionRecord: (scope: ChatScope, peerId: string) =>
      record && sessionKey(scope, peerId) === record.sessionKey ? record : undefined,
  };
}

const sender = () => ({ sendMarkdown: vi.fn(async () => undefined) });
const inputs = () => ({ register: vi.fn() });
const syncConfig = { requireMention: false, askTimeoutMs: 60_000, questionSync: true };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const q1 = (): UserQuestion => ({ id: 'q', question: '选哪个？', options: [{ label: 'A' }, { label: 'B' }] });

/** 注入消息的可读视图（宿主 Message：id/role/content） */
interface InjectMessage {
  id: string;
  role: string;
  content: Array<{ text?: string }>;
}

describe('renderAnswerText', () => {
  it('单题直接给答案值（选项与自定义合并）', () => {
    expect(renderAnswerText([q1()], { answers: [{ id: 'q', selected: ['A'] }] })).toBe('A');
    expect(renderAnswerText([q1()], { answers: [{ id: 'q', selected: [], custom: '打会游戏' }] })).toBe('打会游戏');
    expect(renderAnswerText([q1()], { answers: [{ id: 'q', selected: ['A'], custom: '补充' }] })).toBe('A；补充');
  });

  it('多题逐行「问题头: 答案」', () => {
    const questions: UserQuestion[] = [
      { id: 'a', header: '周末计划', question: 'Q1', options: [{ label: '爬山' }] },
      { id: 'b', question: 'Q2 没有 header', options: [{ label: '看电影' }] },
    ];
    const result: UserQuestionResult = {
      answers: [{ id: 'a', selected: ['爬山'] }, { id: 'b', selected: [], custom: '再说' }],
    };
    expect(renderAnswerText(questions, result)).toBe('周末计划: 爬山\nQ2 没有 header: 再说');
  });

  it('空答案返回 undefined', () => {
    expect(renderAnswerText([q1()], { answers: [{ id: 'q', selected: [] }] })).toBeUndefined();
    expect(renderAnswerText([q1()], { answers: [] })).toBeUndefined();
  });
});

describe('答案回显（agent.inject 写回会话日志）', () => {
  it('QQ 作答：答案作为用户消息写回，且登记为本插件入站', async () => {
    const inject = vi.fn();
    const record = makeLiveRecord({ inject });
    const register = inputs();
    const ch = new QuestionChannel(
      createManagerFor(record), sender(), syncConfig, createLogger(), undefined, register,
    );
    const origAsk = vi.fn(() => new Promise<UserQuestionResult>(() => {}));

    const p = ch.askDual(record, record.replyTarget, { questions: [q1()] }, origAsk);
    await sleep(20);
    expect(ch.tryAnswer('c2c', 'U1', '2')).toBe(true);
    await expect(p).resolves.toEqual({ answers: [{ id: 'q', selected: ['B'] }] });

    expect(inject).toHaveBeenCalledTimes(1);
    const message = inject.mock.calls[0]?.[0] as InjectMessage;
    expect(message.role).toBe('user');
    expect(message.content[0]?.text).toBe('B');
    // 登记必须先于注入：出站才认领回合归属，回复不被推成外部回合
    expect(register.register).toHaveBeenCalledWith(String(message.id));
    expect(register.register.mock.invocationCallOrder[0]!)
      .toBeLessThan(inject.mock.invocationCallOrder[0]!);
  });

  it('Web 作答：同样回显（Web 先答也留下用户消息）', async () => {
    const inject = vi.fn();
    const record = makeLiveRecord({ inject });
    const register = inputs();
    const ch = new QuestionChannel(
      createManagerFor(record), sender(), syncConfig, createLogger(), undefined, register,
    );
    let webResolve!: (r: UserQuestionResult) => void;
    const origAsk = vi.fn(() => new Promise<UserQuestionResult>((res) => { webResolve = res; }));

    const p = ch.askDual(record, record.replyTarget, { questions: [q1()] }, origAsk);
    await sleep(20);
    webResolve({ answers: [{ id: 'q', selected: ['A'] }] });
    await expect(p).resolves.toEqual({ answers: [{ id: 'q', selected: ['A'] }] });

    expect(inject).toHaveBeenCalledTimes(1);
    const message = inject.mock.calls[0]?.[0] as InjectMessage;
    expect(message.content[0]?.text).toBe('A');
    expect(register.register).toHaveBeenCalledWith(String(message.id));
  });

  it('agent 不支持 inject：静默跳过回显，答案照常定案', async () => {
    const record = makeLiveRecord({ followup: vi.fn() });
    const register = inputs();
    const ch = new QuestionChannel(
      createManagerFor(record), sender(), syncConfig, createLogger(), undefined, register,
    );
    let webResolve!: (r: UserQuestionResult) => void;
    const origAsk = vi.fn(() => new Promise<UserQuestionResult>((res) => { webResolve = res; }));

    const p = ch.askDual(record, record.replyTarget, { questions: [q1()] }, origAsk);
    await sleep(20);
    webResolve({ answers: [{ id: 'q', selected: ['A'] }] });
    await expect(p).resolves.toEqual({ answers: [{ id: 'q', selected: ['A'] }] });

    expect(register.register).not.toHaveBeenCalled();
  });

  it('inject 抛错：回显 fail-soft，答案照常返回', async () => {
    const record = makeLiveRecord({ inject: () => { throw new Error('session disposed'); } });
    const logger = createLogger();
    const ch = new QuestionChannel(createManagerFor(record), sender(), syncConfig, logger);
    let webResolve!: (r: UserQuestionResult) => void;
    const origAsk = vi.fn(() => new Promise<UserQuestionResult>((res) => { webResolve = res; }));

    const p = ch.askDual(record, record.replyTarget, { questions: [q1()] }, origAsk);
    await sleep(20);
    webResolve({ answers: [{ id: 'q', selected: ['A'] }] });

    await expect(p).resolves.toEqual({ answers: [{ id: 'q', selected: ['A'] }] });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('桥接会话（无活跃 agent）：跳过回显，答案照常定案', async () => {
    const register = inputs();
    const record: QuestionSessionRecordLike = {
      sessionKey: 'bridge:c2c:P9',
      sessionId: 'sess-web',
      scope: 'c2c',
      replyTarget: { scope: 'c2c', targetId: 'P9' },
    };
    const ch = new QuestionChannel(
      createManagerFor(undefined), sender(), syncConfig, createLogger(), undefined, register,
    );
    let webResolve!: (r: UserQuestionResult) => void;
    const origAsk = vi.fn(() => new Promise<UserQuestionResult>((res) => { webResolve = res; }));

    const p = ch.askDual(record, record.replyTarget, { questions: [q1()] }, origAsk);
    await sleep(20);
    webResolve({ answers: [{ id: 'q', selected: ['A'] }] });
    await expect(p).resolves.toEqual({ answers: [{ id: 'q', selected: ['A'] }] });

    expect(register.register).not.toHaveBeenCalled();
  });
});