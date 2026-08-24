import { describe, it, expect, vi } from 'vitest';
import type { InteractionEvent } from '@tencent-connect/qqbot-nodejs';
import {
  QuestionChannel,
  type UserQuestion,
  type UserQuestionRequest,
  type UserQuestionResult,
  type QuestionSessionRecordLike,
} from './question-channel.js';
import { buildKeyboard, formatQuestion } from './question-renderer.js';
import { parseAnswer } from './answer-parser.js';
import type { ChatScope, Logger, ReplyTarget } from '../types.js';

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

interface SentMessage {
  text: string;
  opts?: { keyboard?: unknown };
}

function createSender(sent: SentMessage[], opts?: { failKeyboard?: boolean }) {
  return {
    sendMarkdown: vi.fn(async (_target: ReplyTarget, content: string, o?: { keyboard?: unknown }) => {
      if (o?.keyboard && opts?.failKeyboard) throw new Error('keyboard not permitted');
      sent.push({ text: content, opts: o });
    }),
  };
}

const sessionKey = (scope: ChatScope, peerId: string): string => `qqbot:app:${scope}:${peerId}`;

function makeRecord(sessionKeyStr: string, scope: ChatScope = 'c2c'): QuestionSessionRecordLike {
  return { sessionKey: sessionKeyStr, scope, replyTarget: { scope, targetId: 'x', msgId: 'm' } };
}

function createManager(opts?: {
  findBySessionId?: (id: string) => QuestionSessionRecordLike | undefined;
  getSessionRecord?: (scope: ChatScope, peerId: string) => QuestionSessionRecordLike | undefined;
}) {
  return {
    findBySessionId: opts?.findBySessionId ?? (() => undefined),
    // 默认按 scope+peerId 派生 sessionKey 反查，与 startAsk 的 key 生成保持一致
    getSessionRecord: opts?.getSessionRecord ?? ((scope: ChatScope, peerId: string) => makeRecord(sessionKey(scope, peerId), scope)),
  };
}

function startAsk(
  ch: QuestionChannel,
  scope: ChatScope,
  peerId: string,
  questions: UserQuestion[],
  signal?: AbortSignal,
): Promise<UserQuestionResult> {
  const key = sessionKey(scope, peerId);
  const request: UserQuestionRequest = { questions, ...(signal ? { signal } : {}) };
  return ch.askViaQQ(makeRecord(key, scope), request);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const q2 = (id = 'q'): UserQuestion => ({ id, question: '选哪个？', options: [{ label: 'A' }, { label: 'B' }] });

describe('formatQuestion', () => {
  it('renders numbered options with description and text hint', () => {
    const q: UserQuestion = {
      id: 'q',
      question: '选哪个？',
      options: [{ label: 'A', description: '描述A' }, { label: 'B' }],
    };
    const text = formatQuestion(q, false, false);
    expect(text).toContain('1. A · 描述A');
    expect(text).toContain('2. B');
    expect(text).toContain('> 💡 回复编号选择');
    expect(text).toContain('直接输入你的想法');
  });

  it('uses button hint with emoji when withButtons', () => {
    expect(formatQuestion(q2(), false, true)).toContain('> 👇 点击下方按钮选择');
  });

  it('prefixes multi-select marker and multi-pick hint', () => {
    const q: UserQuestion = { id: 'q', question: '选哪些？', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true };
    const text = formatQuestion(q, false, false);
    expect(text).toContain('选哪些？（可多选）');
    expect(text).toContain('> 💡 回复多个编号即可多选（如 1,3）');
  });

  it('adds @mention note for groups', () => {
    expect(formatQuestion(q2(), true, false)).toContain('需 @机器人');
  });
});

describe('buildKeyboard', () => {
  it('lays out two options in a single row of two buttons', () => {
    const kb = buildKeyboard(q2());
    expect(kb?.content.rows).toHaveLength(1);
    expect(kb?.content.rows[0]?.buttons).toHaveLength(2);
    const btn = kb?.content.rows[0]?.buttons[0];
    expect(btn?.action.type).toBe(1);
    expect(btn?.action.permission.type).toBe(2);
    // 单选互斥：同一题选项共享 group_id，点一个后其余变灰（action.type=1 才生效）
    expect(btn?.group_id).toBe('q-q');
    // 保留 click_limit=1（每人限点一次，与 openclaw 对齐）
    expect(btn?.action.click_limit).toBe(1);
    expect(btn?.render_data.label).toBe('A');
    expect(btn?.render_data.visited_label).toBe('✓ 已选');
    // button_data 同时编码 question.id 与选项下标，供 handleInteraction 校验归属题
    expect(btn?.id).toBe('q-q-opt-0');
    expect(JSON.parse(btn!.action.data)).toEqual({ q: 'q', i: 0 });
  });

  it('wraps options across multiple rows', () => {
    const opts = [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }, { label: 'E' }];
    const kb = buildKeyboard({ id: 'q', question: 't', options: opts });
    expect(kb?.content.rows).toHaveLength(3); // 2+2+1
    expect(kb?.content.rows[0]?.buttons).toHaveLength(2);
    expect(kb?.content.rows[2]?.buttons).toHaveLength(1);
    expect(JSON.parse(kb!.content.rows[2]!.buttons[0]!.action.data)).toEqual({ q: 'q', i: 4 });
  });

  it('returns undefined for multi-select or no-options', () => {
    expect(buildKeyboard({ ...q2(), multiSelect: true })).toBeUndefined();
    expect(buildKeyboard({ id: 'q', question: 't' })).toBeUndefined();
  });
});

describe('parseAnswer', () => {
  it('maps numbers to option labels', () => {
    expect(parseAnswer(q2(), '2')).toEqual({ id: 'q', selected: ['B'] });
  });

  it('supports multi-select numbers', () => {
    const q: UserQuestion = { id: 'q', question: 't', options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }], multiSelect: true };
    expect(parseAnswer(q, '1,3')).toEqual({ id: 'q', selected: ['A', 'C'] });
  });

  it('falls back to custom for free text and out-of-range', () => {
    expect(parseAnswer(q2(), '9')).toEqual({ id: 'q', selected: [], custom: '9' });
    expect(parseAnswer(q2(), '自定义')).toEqual({ id: 'q', selected: [], custom: '自定义' });
  });

  it('no options → custom', () => {
    expect(parseAnswer({ id: 'q', question: 't' }, '小明')).toEqual({ id: 'q', selected: [], custom: '小明' });
  });
});

describe('QuestionChannel.tryAnswer', () => {
  it('resolves single-question and consumes the message', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const p = startAsk(ch, 'c2c', 'U1', [q2()]);
    await sleep(20);
    expect(ch.tryAnswer('c2c', 'U1', '2')).toBe(true);
    expect(await p).toEqual({ answers: [{ id: 'q', selected: ['B'] }] });
  });

  it('advances multi-question one by one', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const q1: UserQuestion = { id: 'a', question: '问题1', options: [{ label: 'A1' }, { label: 'B1' }] };
    const q2b: UserQuestion = { id: 'b', question: '问题2', options: [{ label: 'A2' }, { label: 'B2' }] };
    const p = startAsk(ch, 'c2c', 'U1', [q1, q2b]);
    await sleep(20);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('问题1');

    expect(ch.tryAnswer('c2c', 'U1', '1')).toBe(true);
    await sleep(20);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.text).toContain('问题2');

    expect(ch.tryAnswer('c2c', 'U1', '2')).toBe(true);
    expect(await p).toEqual({ answers: [{ id: 'a', selected: ['A1'] }, { id: 'b', selected: ['B2'] }] });
  });

  it('ignores empty text and returns false when no pending question', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    expect(ch.tryAnswer('c2c', 'nobody', '1')).toBe(false);

    const p = startAsk(ch, 'c2c', 'U1', [q2()]);
    await sleep(20);
    expect(ch.tryAnswer('c2c', 'U1', '')).toBe(false);
    ch.tryAnswer('c2c', 'U1', '1');
    await p;
  });
});

describe('QuestionChannel.askViaQQ', () => {
  it('attaches keyboard for single-select', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: true, askTimeoutMs: 60_000 }, createLogger());
    const p = startAsk(ch, 'c2c', 'U1', [q2()]);
    await sleep(20);
    expect(sent[0]?.opts?.keyboard).toBeDefined();
    expect(sent[0]?.text).toContain('点击下方按钮选择');
    ch.tryAnswer('c2c', 'U1', '1');
    await p;
  });

  it('falls back to plain text when keyboard send fails', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent, { failKeyboard: true }), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const p = startAsk(ch, 'c2c', 'U1', [q2()]);
    await sleep(20);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.opts).toBeUndefined();
    expect(sent[0]?.text).toContain('回复编号选择');
    ch.tryAnswer('c2c', 'U1', '1');
    await p;
  });

  it('rejects when the question cannot be delivered at all', async () => {
    const ch = new QuestionChannel(
      createManager(),
      { sendMarkdown: vi.fn(async () => { throw new Error('network down'); }) },
      { requireMention: false, askTimeoutMs: 60_000 },
      createLogger(),
    );
    await expect(ch.askViaQQ(makeRecord('sx'), { questions: [q2()] }))
      .rejects.toThrow('failed to deliver question to QQ');
  });

  it('rejects on abort signal', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const ac = new AbortController();
    const p = startAsk(ch, 'c2c', 'U1', [q2()], ac.signal);
    await sleep(20);
    ac.abort();
    await expect(p).rejects.toThrow('aborted');
  });

  it('supersedes a previous pending question for the same session', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const p1 = startAsk(ch, 'c2c', 'U1', [q2()]);
    p1.catch(() => {});
    await sleep(20);
    const p2 = startAsk(ch, 'c2c', 'U1', [q2()]);
    await sleep(20);
    await expect(p1).rejects.toThrow('superseded');
    ch.tryAnswer('c2c', 'U1', '1');
    await p2;
  });

  it('times out and rejects when the user never answers', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false, askTimeoutMs: 20 }, createLogger());
    const p = startAsk(ch, 'c2c', 'U1', [q2()]);
    p.catch(() => {}); // 抑制超时 reject 早于断言挂 handler 的 unhandled rejection
    await sleep(80);
    await expect(p).rejects.toThrow('timed out');
    expect(sent.some((s) => s.text.includes('超时'))).toBe(true);
  });
});

describe('QuestionChannel.handleInteraction', () => {
  function makeEvent(data: string | undefined, peer: { user?: string; group?: string }): InteractionEvent {
    return {
      id: 'i1',
      type: 1,
      version: 1,
      ...(peer.group ? { group_openid: peer.group } : {}),
      ...(peer.user ? { user_openid: peer.user } : {}),
      data: { type: 1, resolved: { ...(data !== undefined ? { button_data: data } : {}) } },
    } as InteractionEvent;
  }

  it('answers a c2c question by button click', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const p = startAsk(ch, 'c2c', 'U1', [q2()]);
    await sleep(20);
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ q: 'q', i: 1 }), { user: 'U1' }))).toBe(true);
    expect(await p).toEqual({ answers: [{ id: 'q', selected: ['B'] }] });
  });

  it('routes group clicks by group_openid', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const p = startAsk(ch, 'group', 'G1', [q2()]);
    await sleep(20);
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ q: 'q', i: 0 }), { user: 'someone', group: 'G1' }))).toBe(true);
    expect(await p).toEqual({ answers: [{ id: 'q', selected: ['A'] }] });
  });

  it('resolves with the full original label for truncated buttons', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const long = '这是一个非常非常长的选项标签超过十八个字符的限制了吧';
    const p = startAsk(ch, 'c2c', 'U7', [{ id: 'q', question: 't', options: [{ label: long }] }]);
    await sleep(20);
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ q: 'q', i: 0 }), { user: 'U7' }))).toBe(true);
    expect(await p).toEqual({ answers: [{ id: 'q', selected: [long] }] });
  });

  it('rejects malformed or stale clicks without consuming the question', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const p = startAsk(ch, 'c2c', 'U2', [q2()]);
    await sleep(20);
    expect(ch.handleInteraction(makeEvent('not-json', { user: 'U2' }))).toBe(false);
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ q: 'q', i: 9 }), { user: 'U2' }))).toBe(false);
    // 旧题按钮：q 不等于当前题 id，忽略
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ q: 'other', i: 0 }), { user: 'U2' }))).toBe(false);
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ q: 'q', i: 0 }), { user: 'nobody' }))).toBe(false);
    expect(ch.handleInteraction(makeEvent(undefined, { user: 'U2' }))).toBe(false);
    ch.tryAnswer('c2c', 'U2', '1');
    await p;
  });

  it('ignores a stale click from a previous question after advancing', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const q1: UserQuestion = { id: 'a', question: '问题1', options: [{ label: 'A1' }, { label: 'B1' }] };
    const q2b: UserQuestion = { id: 'b', question: '问题2', options: [{ label: 'A2' }, { label: 'B2' }] };
    const p = startAsk(ch, 'c2c', 'U1', [q1, q2b]);
    await sleep(20);
    // 答第一题（按钮点击），推进到第二题
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ q: 'a', i: 0 }), { user: 'U1' }))).toBe(true);
    await sleep(20);
    expect(sent).toHaveLength(2); // 第二题已发出
    // 旧题（q=a）按钮在新题发出后被点击 → 忽略，不消费当前题
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ q: 'a', i: 1 }), { user: 'U1' }))).toBe(false);
    // 当前题（q=b）仍可正常作答
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ q: 'b', i: 1 }), { user: 'U1' }))).toBe(true);
    expect(await p).toEqual({ answers: [{ id: 'a', selected: ['A1'] }, { id: 'b', selected: ['B2'] }] });
  });
});

describe('QuestionChannel.cancelPending', () => {
  it('rejects pending question when the session is evicted', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const p = startAsk(ch, 'c2c', 'U1', [q2()]);
    await sleep(20);
    ch.cancelPending(sessionKey('c2c', 'U1'));
    await expect(p).rejects.toThrow('cancelled');
  });
});

describe('QuestionChannel.install routing', () => {
  it('routes QQ sessions to QQ channel and delegates others', async () => {
    const sent: SentMessage[] = [];
    const record = makeRecord(sessionKey('c2c', 'u9'));
    (record as { sessionId?: string }).sessionId = 'sess-qq';
    const manager = createManager({ findBySessionId: (id) => (id === 'sess-qq' ? record : undefined) });
    const ch = new QuestionChannel(manager, createSender(sent), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    let origCalled = 0;
    const uq = { ask: vi.fn(async () => { origCalled += 1; return { answers: [] }; }) };
    ch.install({ get: (n: string) => (n === 'userQuestions' ? uq : undefined) });

    await uq.ask({ questions: [q2('x')], agent: { id: 'sess-web' } });
    expect(origCalled).toBe(1);

    const p = uq.ask({ questions: [q2()], agent: { id: 'sess-qq' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(ch.tryAnswer('c2c', 'u9', '1')).toBe(true);
    expect(await p).toEqual({ answers: [{ id: 'q', selected: ['A'] }] });
    expect(origCalled).toBe(1); // QQ 路径未触碰原实现
  });

  it('uninstall restores the original ask', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const uq: { ask: (r: UserQuestionRequest) => Promise<UserQuestionResult>; __qqQuestionPatched?: boolean } = {
      ask: async () => ({ answers: [] }),
    };
    ch.install({ get: (n: string) => (n === 'userQuestions' ? uq : undefined) });
    expect(uq.__qqQuestionPatched).toBe(true);
    ch.uninstall();
    expect(uq.__qqQuestionPatched).toBeUndefined();
  });

  it('disables gracefully when the userQuestions service is missing', () => {
    const sent: SentMessage[] = [];
    const logger = createLogger();
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false, askTimeoutMs: 60_000 }, logger);
    ch.install({ get: () => undefined });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
