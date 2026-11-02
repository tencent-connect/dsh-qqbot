import { describe, it, expect, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import UserQuestionService from '@deepseek-ai/dsh-user-questions';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import type { ToolDispatchExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools';
import type { InteractionEvent } from '@tencent-connect/qqbot-nodejs';
import {
  QuestionChannel,
  type UserQuestion,
  type UserQuestionRequest,
  type UserQuestionResult,
  type QuestionChannelContext,
  type QuestionSessionRecordLike,
} from './question-channel.ts';
import { buildKeyboard, formatQuestion } from './question-renderer.ts';
import { parseAnswer } from './answer-parser.ts';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

interface SentMessage {
  text: string;
  opts?: { keyboard?: unknown };
}

function questionId(sent: SentMessage[], index = 0): string {
  const keyboard = sent[index]?.opts?.keyboard as { content: { rows: Array<{ buttons: Array<{ action: { data: string } }> }> } };
  return JSON.parse(keyboard.content.rows[0]!.buttons[0]!.action.data).q;
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
  canAnswer?: (scope: ChatScope, peerId: string, actor?: string) => boolean;
  canRelayInteraction?: (id: string) => boolean;
  findBySessionId?: (id: string) => QuestionSessionRecordLike | undefined;
  getSessionRecord?: (scope: ChatScope, peerId: string) => QuestionSessionRecordLike | undefined;
}) {
  return {
    canAnswer: opts?.canAnswer,
    interactionRecord: (id: string) => (opts?.canRelayInteraction?.(id) ?? true) ? (opts?.findBySessionId ? opts.findBySessionId(id) : makeRecord(id, id.includes(':group:') ? 'group' : 'c2c')) : undefined,
    recordHumanReply: vi.fn(async () => {}),
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
  return ch['askViaQQ'](makeRecord(key, scope), request, { sessionId: key, turn: 1, callId: 'call-q' });
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
    expect(JSON.parse(btn!.action.data)).toEqual({ t: 'question', q: 'q', i: 0 });
  });

  it('wraps options across multiple rows', () => {
    const opts = [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }, { label: 'E' }];
    const kb = buildKeyboard({ id: 'q', question: 't', options: opts });
    expect(kb?.content.rows).toHaveLength(3); // 2+2+1
    expect(kb?.content.rows[0]?.buttons).toHaveLength(2);
    expect(kb?.content.rows[2]?.buttons).toHaveLength(1);
    expect(JSON.parse(kb!.content.rows[2]!.buttons[0]!.action.data)).toEqual({ t: 'question', q: 'q', i: 4 });
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
    expect(ch.tryAnswer('c2c', 'U1', '2', 'actor')).toBe(true);
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

    expect(ch.tryAnswer('c2c', 'U1', '1', 'actor')).toBe(true);
    await sleep(20);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.text).toContain('问题2');

    expect(ch.tryAnswer('c2c', 'U1', '2', 'actor')).toBe(true);
    expect(await p).toEqual({ answers: [{ id: 'a', selected: ['A1'] }, { id: 'b', selected: ['B2'] }] });
  });

  it('ignores empty text and returns false when no pending question', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    expect(ch.tryAnswer('c2c', 'nobody', '1', 'actor')).toBe(false);

    const p = startAsk(ch, 'c2c', 'U1', [q2()]);
    await sleep(20);
    expect(ch.tryAnswer('c2c', 'U1', '', 'actor')).toBe(false);
    ch.tryAnswer('c2c', 'U1', '1', 'actor');
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
    ch.tryAnswer('c2c', 'U1', '1', 'actor');
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
    ch.tryAnswer('c2c', 'U1', '1', 'actor');
    await p;
  });

  it('rejects when the question cannot be delivered at all', async () => {
    const ch = new QuestionChannel(
      createManager(),
      { sendMarkdown: vi.fn(async () => { throw new Error('network down'); }) },
      { requireMention: false, askTimeoutMs: 60_000 },
      createLogger(),
    );
    await expect(ch['askViaQQ'](makeRecord('sx'), { questions: [q2()] }, { sessionId: 'sx', turn: 1, callId: 'call-q' }))
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
    ch.tryAnswer('c2c', 'U1', '1', 'actor');
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
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ t: 'question', q: questionId(sent), i: 1 }), { user: 'U1' }))).toBe(true);
    expect(await p).toEqual({ answers: [{ id: 'q', selected: ['B'] }] });
  });

  it('routes group clicks by group_openid', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const p = startAsk(ch, 'group', 'G1', [q2()]);
    await sleep(20);
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ t: 'question', q: questionId(sent), i: 0 }), { user: 'someone', group: 'G1' }))).toBe(true);
    expect(await p).toEqual({ answers: [{ id: 'q', selected: ['A'] }] });
  });

  it('resolves with the full original label for truncated buttons', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const long = '这是一个非常非常长的选项标签超过十八个字符的限制了吧';
    const p = startAsk(ch, 'c2c', 'U7', [{ id: 'q', question: 't', options: [{ label: long }] }]);
    await sleep(20);
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ t: 'question', q: questionId(sent), i: 0 }), { user: 'U7' }))).toBe(true);
    expect(await p).toEqual({ answers: [{ id: 'q', selected: [long] }] });
  });

  it('rejects malformed or stale clicks without consuming the question', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const p = startAsk(ch, 'c2c', 'U2', [q2()]);
    await sleep(20);
    expect(ch.handleInteraction(makeEvent('not-json', { user: 'U2' }))).toBe(false);
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ t: 'question', q: 'q', i: 9 }), { user: 'U2' }))).toBe(false);
    // 旧题按钮：q 不等于当前题 id，忽略
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ t: 'question', q: 'other', i: 0 }), { user: 'U2' }))).toBe(false);
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ t: 'question', q: 'q', i: 0 }), { user: 'nobody' }))).toBe(false);
    expect(ch.handleInteraction(makeEvent(undefined, { user: 'U2' }))).toBe(false);
    ch.tryAnswer('c2c', 'U2', '1', 'actor');
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
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ t: 'question', q: questionId(sent, 0), i: 0 }), { user: 'U1' }))).toBe(true);
    await sleep(20);
    expect(sent).toHaveLength(2); // 第二题已发出
    // 旧题（q=a）按钮在新题发出后被点击 → 忽略，不消费当前题
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ t: 'question', q: 'a', i: 1 }), { user: 'U1' }))).toBe(false);
    // 当前题（q=b）仍可正常作答
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ t: 'question', q: questionId(sent, 1), i: 1 }), { user: 'U1' }))).toBe(true);
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

function waterfall(ch: QuestionChannel) {
  type QuestionHandler = (request: UserQuestionRequest, next: () => Promise<UserQuestionResult>) => Promise<UserQuestionResult>;
  type ToolHandler = (exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>) => Promise<ToolExecutionResult>;
  let question: QuestionHandler | undefined;
  let tool: ToolHandler | undefined;
  const remove = vi.fn(() => true);
  const on = vi.fn((name: string, handler: unknown) => {
    if (name === 'user-questions/request') question = handler as QuestionHandler;
    else if (name === 'tools/execute') tool = handler as ToolHandler;
    return () => {
      if (name === 'user-questions/request') question = undefined;
      else tool = undefined;
      return remove();
    };
  });
  const ctx = { on, get: () => undefined } as unknown as QuestionChannelContext;
  ch.install(ctx);
  return {
    on, remove,
    ask: (request: UserQuestionRequest, next: () => Promise<UserQuestionResult>) => question ? question(request, next) : next(),
    execute: (exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>) => tool ? tool(exec, next) : next(),
  };
}

function toolExecution(request: UserQuestionRequest, callId: string, signal = new AbortController().signal): ToolDispatchExecution {
  return { agent: request.agent, name: 'ask_user_question', callId: ToolCallId(callId), rootCallId: ToolCallId(callId),
    arguments: {}, signal, token: Symbol(callId) } as ToolDispatchExecution;
}

function toolSuccess(): ToolExecutionResult { return { isError: false, value: null, content: [] }; }

function identifiedRequest(sessionId: string): UserQuestionRequest {
  return {
    questions: [q2()], wait: { callId: 'call-q' },
    agent: { id: sessionId, session: { snapshotEvents: () => [{ type: 'turn/start', data: { turn: 1 } }] } },
  } as unknown as UserQuestionRequest;
}

describe('QuestionChannel public waterfall routing', () => {
  it('delegates a native or mixed turn without modifying userQuestions.ask', async () => {
    const sent: SentMessage[] = [];
    const manager = createManager({ canRelayInteraction: () => false });
    const ch = new QuestionChannel(manager, createSender(sent), { requireMention: false, askTimeoutMs: 60 }, createLogger());
    const hooks = waterfall(ch);
    const answer = { answers: [] };
    const next = vi.fn(async () => answer);
    expect(await hooks.ask(identifiedRequest('sess-web'), next)).toBe(answer);
    expect(next).toHaveBeenCalledOnce();
    expect(sent).toEqual([]);
    expect(hooks.on).toHaveBeenCalledWith('user-questions/request', expect.any(Function), { global: true, prepend: true });
  });

  it('routes a proven QQ turn and persists its actor, call and nonce before returning the answer', async () => {
    const sent: SentMessage[] = [];
    const record = makeRecord(sessionKey('c2c', 'u9'));
    const manager = createManager({ findBySessionId: id => id === 'sess-qq' ? record : undefined });
    let persist!: () => void;
    manager.recordHumanReply.mockImplementationOnce(() => new Promise<void>(resolve => { persist = resolve; }));
    const ch = new QuestionChannel(manager, createSender(sent), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const hooks = waterfall(ch);
    const next = vi.fn(async () => ({ answers: [] }));
    const pending = hooks.ask(identifiedRequest('sess-qq'), next);
    await Promise.resolve();
    expect(ch.tryAnswer('c2c', 'u9', '1', 'actual-user')).toBe(true);
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(manager.recordHumanReply).toHaveBeenCalledWith({ sessionId: 'sess-qq', turn: 1, callId: 'call-q',
      nonce: expect.any(String), actor: 'actual-user', answer: { answers: [{ id: 'q', selected: ['A'] }] } });
    persist();
    expect(await pending).toEqual({ answers: [{ id: 'q', selected: ['A'] }] });
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['call', 'turn'])('delegates when public request lacks a verified %s identity', async missing => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false, askTimeoutMs: 60 }, createLogger());
    const hooks = waterfall(ch);
    const request = identifiedRequest('sess-qq');
    if (missing === 'call') delete request.wait;
    else request.agent = undefined;
    const next = vi.fn(async () => ({ answers: [] }));
    await hooks.ask(request, next);
    expect(next).toHaveBeenCalledOnce(); expect(sent).toEqual([]);
  });

  it('rejects the waterfall if the durable reply cannot be saved', async () => {
    const manager = createManager(); manager.recordHumanReply.mockRejectedValueOnce(new Error('disk full'));
    const ch = new QuestionChannel(manager, createSender([]), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const pending = startAsk(ch, 'c2c', 'u9', [q2()]);
    expect(ch.tryAnswer('c2c', 'u9', '1', 'actual-user')).toBe(true);
    await expect(pending).rejects.toThrow('disk full');
  });

  it('uninstall removes its listeners and cancels its pending question', async () => {
    const ch = new QuestionChannel(createManager(), createSender([]), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const hooks = waterfall(ch);
    const pending = startAsk(ch, 'c2c', 'u9', [q2()]);
    ch.uninstall();
    expect(hooks.remove).toHaveBeenCalledTimes(2);
    await expect(pending).rejects.toMatchObject({ code: 'ASK_ABORTED' });
  });
  it('rejects missing and unauthorized human identities without recording an answer', async () => {
    const manager = createManager({ canAnswer: (_scope, _peer, actor) => actor === 'authorized' });
    const ch = new QuestionChannel(manager, createSender([]), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const pending = startAsk(ch, 'c2c', 'u9', [q2()]);
    expect(ch.tryAnswer('c2c', 'u9', '1')).toBe(false);
    expect(ch.tryAnswer('c2c', 'u9', '1', 'outsider')).toBe(false);
    expect(manager.recordHumanReply).not.toHaveBeenCalled();
    expect(ch.tryAnswer('c2c', 'u9', '1', 'authorized')).toBe(true);
    await expect(pending).resolves.toEqual({ answers: [{ id: 'q', selected: ['A'] }] });
  });

  it('cancels an answer whose durable receipt is still being saved when the channel unloads', async () => {
    const manager = createManager(); let persist!: () => void;
    manager.recordHumanReply.mockImplementationOnce(() => new Promise<void>(resolve => { persist = resolve; }));
    const ch = new QuestionChannel(manager, createSender([]), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const pending = startAsk(ch, 'c2c', 'u9', [q2()]);
    ch.tryAnswer('c2c', 'u9', '1', 'authorized'); ch.uninstall();
    await expect(pending).rejects.toMatchObject({ code: 'ASK_ABORTED' }); persist();
  });

  it('uses the public tool execution callId for default legacy questions without changing ask', async () => {
    const sent: SentMessage[] = []; const record = makeRecord(sessionKey('c2c', 'legacy'));
    const manager = createManager({ findBySessionId: id => id === 'session-legacy' ? record : undefined });
    const ch = new QuestionChannel(manager, createSender(sent), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const hooks = waterfall(ch); const request = identifiedRequest('session-legacy'); delete request.wait;
    const next = vi.fn(async () => ({ answers: [] }));
    const pending = hooks.execute(toolExecution(request, 'legacy-call'), async () => {
      const answer = await hooks.ask(request, next);
      expect(answer).toEqual({ answers: [{ id: 'q', selected: ['B'] }] });
      return toolSuccess();
    });
    expect(ch.tryAnswer('c2c', 'legacy', '2', 'human')).toBe(true);
    await pending; expect(next).not.toHaveBeenCalled();
    expect(manager.recordHumanReply).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-legacy', callId: 'legacy-call', turn: 1, actor: 'human' }));
  });

  it('keeps two concurrent Agents in distinct legacy tool-call contexts', async () => {
    const manager = createManager({ findBySessionId: id => id === 'session-a' ? makeRecord(sessionKey('c2c', 'a')) : id === 'session-b' ? makeRecord(sessionKey('c2c', 'b')) : undefined });
    const ch = new QuestionChannel(manager, createSender([]), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const hooks = waterfall(ch); const requests = ['a', 'b'].map(id => { const request = identifiedRequest(`session-${id}`); delete request.wait; return request; });
    const next = vi.fn(async () => ({ answers: [] }));
    const entered = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    const running = requests.map((request, index) => hooks.execute(toolExecution(request, `call-${index}`), async () => {
      await Promise.resolve(); const answer = hooks.ask(request, next); entered[index]!.resolve(); await answer; return toolSuccess();
    }));
    await Promise.all(entered.map(value => value.promise));
    expect(ch.tryAnswer('c2c', 'b', '2', 'human-b')).toBe(true);
    expect(ch.tryAnswer('c2c', 'a', '1', 'human-a')).toBe(true);
    await Promise.all(running);
    expect(manager.recordHumanReply).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-a', callId: 'call-0', actor: 'human-a' }));
    expect(manager.recordHumanReply).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-b', callId: 'call-1', actor: 'human-b' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('delegates a legacy question with another Agent and after the enclosing execution has ended', async () => {
    const manager = createManager(); const sent: SentMessage[] = [];
    const ch = new QuestionChannel(manager, createSender(sent), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const hooks = waterfall(ch); const own = identifiedRequest('session-a'); delete own.wait;
    const other = identifiedRequest('session-b'); delete other.wait;
    const impostor = identifiedRequest('session-a'); delete impostor.wait;
    const next = vi.fn(async () => ({ answers: [] }));
    const gate = Promise.withResolvers<void>(); let delayed!: Promise<UserQuestionResult>;
    await hooks.execute(toolExecution(own, 'call-a'), async () => {
      await hooks.ask(other, next);
      await hooks.ask(impostor, next);
      delayed = gate.promise.then(() => hooks.ask(own, next));
      return toolSuccess();
    });
    gate.resolve(); await delayed;
    expect(next).toHaveBeenCalledTimes(3); expect(sent).toEqual([]); expect(manager.recordHumanReply).not.toHaveBeenCalled();
  });

  it('propagates the enclosing legacy tool cancellation even when its request omits a signal', async () => {
    const manager = createManager(); const record = makeRecord(sessionKey('c2c', 'cancel'));
    manager.interactionRecord = () => record;
    const ch = new QuestionChannel(manager, createSender([]), { requireMention: false, askTimeoutMs: 60_000 }, createLogger());
    const hooks = waterfall(ch); const request = identifiedRequest('session-cancel'); delete request.wait;
    const lifetime = new AbortController();
    const pending = hooks.execute(toolExecution(request, 'cancel-call', lifetime.signal), async () => {
      await hooks.ask(request, async () => ({ answers: [] })); return toolSuccess();
    });
    lifetime.abort(); await expect(pending).rejects.toMatchObject({ code: 'ASK_ABORTED' });
    expect(ch.tryAnswer('c2c', 'cancel', '1', 'human')).toBe(false);
    expect(manager.recordHumanReply).not.toHaveBeenCalled();
  });

  it('claims a real native timed wait until the QQ answer arrives and releases the claim', async () => {
    vi.useFakeTimers(); const ctx = new Context();
    const session = Session.create(SessionId('session-timed-qq')); session.append('turn/start', { turn: 1 });
    const agent = { id: session.id, session, ctx } as unknown as NonNullable<UserQuestionRequest['agent']>;
    ctx.provide('agents', { get: () => agent, roots: () => [agent] } as unknown as Context['agents']);
    await ctx.plugin(UserQuestionService);
    const manager = createManager({ findBySessionId: id => id === session.id ? makeRecord(sessionKey('c2c', 'timed')) : undefined });
    const ch = new QuestionChannel(manager, createSender([]), { requireMention: false, askTimeoutMs: 10_000 }, createLogger()); ch.install(ctx);
    try {
      const pending = ctx.userQuestions.askTimed({ agent, questions: [q2()] }, ToolCallId('timed-call'), 100);
      let settled = false; void pending.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(500);
      expect(settled).toBe(false);
      expect(ch.tryAnswer('c2c', 'timed', '1', 'human')).toBe(true);
      await expect(pending).resolves.toEqual({ answers: [{ id: 'q', selected: ['A'] }] });
      expect(vi.getTimerCount()).toBe(0);
      expect(manager.recordHumanReply).toHaveBeenCalledWith(expect.objectContaining({ callId: 'timed-call', actor: 'human' }));
    } finally { ch.uninstall(); await ctx.fiber.dispose(); vi.useRealTimers(); }
  });

});
