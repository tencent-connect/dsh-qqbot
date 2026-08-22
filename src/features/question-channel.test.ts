import { describe, it, expect, vi } from 'vitest';
import type { InteractionEvent } from '@tencent-connect/qqbot-nodejs';
import {
  QuestionChannel,
  buildKeyboard,
  formatQuestions,
  parseAnswers,
  type UserQuestion,
  type UserQuestionRequest,
  type UserQuestionResult,
  type QuestionSessionRecordLike,
} from './question-channel.js';
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

function createManager(findBySessionId?: (id: string) => QuestionSessionRecordLike | undefined) {
  return { findBySessionId: findBySessionId ?? (() => undefined), sessionKey };
}

function makeRecord(sessionKeyStr: string, scope: ChatScope = 'c2c'): QuestionSessionRecordLike {
  return { sessionKey: sessionKeyStr, scope, replyTarget: { scope, targetId: 'x', msgId: 'm' } };
}

/** 发起提问，返回答案 Promise（pending 的写入在发送完成后，作答前先等发送落定） */
function startAsk(
  ch: QuestionChannel,
  key: string,
  questions: UserQuestion[],
  scope: ChatScope = 'c2c',
  signal?: AbortSignal,
): Promise<UserQuestionResult> {
  const request: UserQuestionRequest = { questions, ...(signal ? { signal } : {}) };
  return ch.askViaQQ(makeRecord(key, scope), request);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const q2 = (id = 'q'): UserQuestion => ({ id, question: '选哪个？', options: [{ label: 'A' }, { label: 'B' }] });

describe('formatQuestions', () => {
  it('renders numbered options and text hint', () => {
    const text = formatQuestions([q2()], false, false);
    expect(text).toContain('1. A');
    expect(text).toContain('2. B');
    expect(text).toContain('回复编号选择');
  });

  it('uses button hint when withButtons', () => {
    expect(formatQuestions([q2()], false, true)).toContain('点击下方按钮选择');
  });

  it('adds @mention note for groups', () => {
    expect(formatQuestions([q2()], true, false)).toContain('需 @机器人');
  });

  it('notes multi-select usage', () => {
    const q: UserQuestion = { ...q2(), multiSelect: true };
    expect(formatQuestions([q], false, false)).toContain('可多选');
  });
});

describe('buildKeyboard', () => {
  it('builds one row per option for single-select questions', () => {
    const kb = buildKeyboard([q2()]);
    expect(kb?.content.rows).toHaveLength(2);
    const btn = kb?.content.rows[0]?.buttons[0];
    expect(btn?.action.type).toBe(1); // 1=回调：点击即确认（2=填输入框，0=跳转）
    expect(btn?.action.permission.type).toBe(2); // 0 实测会报"无权限操作"
    expect(btn?.render_data.label).toBe('A');
    expect(JSON.parse(btn!.action.data)).toEqual({ i: 0 });
  });

  it('returns undefined for multi-select, no-options, or multi-question', () => {
    expect(buildKeyboard([{ ...q2(), multiSelect: true }])).toBeUndefined();
    expect(buildKeyboard([{ id: 'q', question: 't' }])).toBeUndefined();
    expect(buildKeyboard([q2(), q2('q2')])).toBeUndefined();
  });

  it('truncates long labels', () => {
    const long = '这是一个非常非常长的选项标签超过十八个字符的限制了吧';
    const kb = buildKeyboard([{ id: 'q', question: 't', options: [{ label: long }] }]);
    const label = kb?.content.rows[0]?.buttons[0]?.render_data.label ?? '';
    expect(label.length).toBeLessThanOrEqual(18);
    expect(label.endsWith('…')).toBe(true);
  });
});

describe('parseAnswers', () => {
  it('maps numbers to option labels', () => {
    expect(parseAnswers([q2()], '2')).toEqual([{ id: 'q', selected: ['B'] }]);
  });

  it('supports multi-select numbers', () => {
    const q: UserQuestion = { id: 'q', question: 't', options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }], multiSelect: true };
    expect(parseAnswers([q], '1,3')).toEqual([{ id: 'q', selected: ['A', 'C'] }]);
  });

  it('matches exact labels case-insensitively', () => {
    const q: UserQuestion = { id: 'q', question: 't', options: [{ label: 'Option X' }] };
    expect(parseAnswers([q], 'option x')).toEqual([{ id: 'q', selected: ['Option X'] }]);
  });

  it('falls back to custom for out-of-range numbers and free text', () => {
    expect(parseAnswers([q2()], '9')).toEqual([{ id: 'q', selected: [], custom: '9' }]);
    expect(parseAnswers([q2()], '自定义')).toEqual([{ id: 'q', selected: [], custom: '自定义' }]);
  });

  it('no options → custom', () => {
    expect(parseAnswers([{ id: 'q', question: 't' }], '小明')).toEqual([{ id: 'q', selected: [], custom: '小明' }]);
  });

  it('multiple questions → custom broadcast', () => {
    expect(parseAnswers([{ id: 'a', question: '1' }, { id: 'b', question: '2' }], '统一回复'))
      .toEqual([{ id: 'a', selected: [], custom: '统一回复' }, { id: 'b', selected: [], custom: '统一回复' }]);
  });
});

describe('QuestionChannel.tryAnswer', () => {
  it('resolves pending question and consumes the message', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false }, createLogger());
    const p = startAsk(ch, 'k1', [q2()]);
    await sleep(20);
    expect(ch.tryAnswer('k1', '2')).toBe(true);
    expect(await p).toEqual({ answers: [{ id: 'q', selected: ['B'] }] });
  });

  it('ignores empty text (keeps waiting)', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false }, createLogger());
    const p = startAsk(ch, 'k1', [q2()]);
    await sleep(20);
    expect(ch.tryAnswer('k1', '')).toBe(false);
    expect(ch.tryAnswer('k1', '1')).toBe(true);
    await p;
  });

  it('returns false when no pending question', () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false }, createLogger());
    expect(ch.tryAnswer('nope', '1')).toBe(false);
  });
});

describe('QuestionChannel.askViaQQ', () => {
  it('attaches keyboard for single-select and sends to replyTarget', async () => {
    const sent: SentMessage[] = [];
    const sender = createSender(sent);
    const ch = new QuestionChannel(createManager(), sender, { requireMention: true }, createLogger());
    const p = startAsk(ch, 's1', [q2()]);
    await sleep(20);
    expect(sent[0]?.opts?.keyboard).toBeDefined();
    expect(sent[0]?.text).toContain('点击下方按钮选择');
    expect(sender.sendMarkdown).toHaveBeenCalledWith(makeRecord('s1').replyTarget, expect.any(String), expect.any(Object));
    ch.tryAnswer('s1', '1');
    await p;
  });

  it('falls back to plain text when keyboard send fails', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent, { failKeyboard: true }), { requireMention: false }, createLogger());
    const p = startAsk(ch, 's6', [q2()]);
    await sleep(20);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.opts).toBeUndefined();
    expect(sent[0]?.text).toContain('回复编号选择');
    ch.tryAnswer('s6', '1');
    await p;
  });

  it('rejects when the question cannot be delivered at all', async () => {
    const ch = new QuestionChannel(
      createManager(),
      { sendMarkdown: vi.fn(async () => { throw new Error('network down'); }) },
      { requireMention: false },
      createLogger(),
    );
    await expect(ch.askViaQQ(makeRecord('sx'), { questions: [q2()] }))
      .rejects.toThrow('failed to deliver question to QQ');
  });

  it('rejects on abort signal', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false }, createLogger());
    const ac = new AbortController();
    const p = startAsk(ch, 'sa', [q2()], 'c2c', ac.signal);
    await sleep(20);
    ac.abort();
    await expect(p).rejects.toThrow('aborted');
  });

  it('supersedes a previous pending question for the same session', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false }, createLogger());
    const p1 = startAsk(ch, 'sk', [q2()]);
    p1.catch(() => {}); // 抑制被取代时的未处理 rejection（下方用 rejects 断言）
    await sleep(20);
    const p2 = startAsk(ch, 'sk', [q2()]);
    await sleep(20);
    await expect(p1).rejects.toThrow('superseded');
    ch.tryAnswer('sk', '1');
    await p2;
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
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false }, createLogger());
    const p = startAsk(ch, 'qqbot:app:c2c:U1', [q2()]);
    await sleep(20);
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ i: 1 }), { user: 'U1' }))).toBe(true);
    expect(await p).toEqual({ answers: [{ id: 'q', selected: ['B'] }] });
  });

  it('routes group clicks by group_openid', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false }, createLogger());
    const p = startAsk(ch, 'qqbot:app:group:G1', [q2()], 'group');
    await sleep(20);
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ i: 0 }), { user: 'someone', group: 'G1' }))).toBe(true);
    expect(await p).toEqual({ answers: [{ id: 'q', selected: ['A'] }] });
  });

  it('resolves with the full original label for truncated buttons', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false }, createLogger());
    const long = '这是一个非常非常长的选项标签超过十八个字符的限制了吧';
    const p = startAsk(ch, 'qqbot:app:c2c:U7', [{ id: 'q', question: 't', options: [{ label: long }] }]);
    await sleep(20);
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ i: 0 }), { user: 'U7' }))).toBe(true);
    expect(await p).toEqual({ answers: [{ id: 'q', selected: [long] }] });
  });

  it('rejects malformed or stale clicks without consuming the question', async () => {
    const sent: SentMessage[] = [];
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false }, createLogger());
    const p = startAsk(ch, 'qqbot:app:c2c:U2', [q2()]);
    await sleep(20);
    expect(ch.handleInteraction(makeEvent('not-json', { user: 'U2' }))).toBe(false);
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ i: 9 }), { user: 'U2' }))).toBe(false);
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ i: 0 }), { user: 'nobody' }))).toBe(false);
    expect(ch.handleInteraction(makeEvent(undefined, { user: 'U2' }))).toBe(false);
    ch.tryAnswer('qqbot:app:c2c:U2', '1'); // 文本仍可作答
    await p;
  });
});

describe('QuestionChannel.install routing', () => {
  it('routes QQ sessions to QQ channel and delegates others', async () => {
    const sent: SentMessage[] = [];
    const record = makeRecord('qqbot:app:c2c:u9');
    (record as { sessionId?: string }).sessionId = 'sess-qq';
    const manager = createManager((id) => (id === 'sess-qq' ? record : undefined));
    const ch = new QuestionChannel(manager, createSender(sent), { requireMention: false }, createLogger());
    let origCalled = 0;
    const uq = { ask: vi.fn(async () => { origCalled += 1; return { answers: [] }; }) };
    ch.install({ get: (n: string) => (n === 'userQuestions' ? uq : undefined) });

    await uq.ask({ questions: [q2('x')], agent: { id: 'sess-web' } });
    expect(origCalled).toBe(1);

    const p = uq.ask({ questions: [q2()], agent: { id: 'sess-qq' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(ch.tryAnswer('qqbot:app:c2c:u9', '1')).toBe(true);
    expect(await p).toEqual({ answers: [{ id: 'q', selected: ['A'] }] });
    expect(origCalled).toBe(1); // QQ 路径未触碰原实现
  });

  it('uninstall restores the original ask', async () => {
    const sent: SentMessage[] = [];
    const record = makeRecord('qqbot:app:c2c:u9');
    const manager = createManager((id) => (id === 'sess-qq' ? record : undefined));
    const ch = new QuestionChannel(manager, createSender(sent), { requireMention: false }, createLogger());
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
    const ch = new QuestionChannel(createManager(), createSender(sent), { requireMention: false }, logger);
    ch.install({ get: () => undefined });
    expect(logger.warn).toHaveBeenCalled();
  });
});
