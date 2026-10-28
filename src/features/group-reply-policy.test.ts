import type { Context } from '@deepseek-ai/cordis';
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImQQBotConfig } from '../config.ts';
import type { SessionManager } from '../session/index.ts';
import { DEFAULT_GROUP_REPLY_PROMPT } from '../shared/group-reply-defaults.ts';
import type { Logger } from '../types.ts';
import { GroupReplyPolicy, type GroupReplyInput } from './group-reply-policy.ts';

afterEach(() => vi.useRealTimers());

function input(overrides: Partial<GroupReplyInput> = {}): GroupReplyInput {
  return {
    groupId: 'group-1',
    messages: [{ messageId: 'm1', senderId: 'alice', content: '那具体怎么做？', wasMentioned: false }],
    history: [], signal: new AbortController().signal, ...overrides,
  };
}

async function* response(text = '{"decision":"reply"}', finish = 'stop'): AsyncIterable<StreamChunk> {
  yield { type: 'text-delta', index: 0, text };
  yield { type: 'finish', reason: { kind: finish } } as StreamChunk;
}

function harness(options: {
  stream?: (options: GenerateOptions) => AsyncIterable<StreamChunk>;
  config?: Partial<ImQQBotConfig>;
  session?: Pick<Session, 'deriveMessages'>;
  messages?: readonly Message[];
  history?: () => Promise<readonly Message[]>;
  unavailable?: boolean;
} = {}) {
  const stream = vi.fn(options.stream ?? (() => response()));
  const ctx = { get: vi.fn(() => options.unavailable ? undefined : { stream }) } as unknown as Context;
  const manager = {
    getEffectiveModel: vi.fn(() => ({ provider: 'test-provider', model: 'test-model' })),
    getConversationMessages: vi.fn(() => options.history?.() ?? options.session?.deriveMessages() ?? options.messages ?? []),
    getOrCreate: vi.fn(),
  };
  const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const policy = new GroupReplyPolicy(ctx, { debug: true, ...options.config } as ImQQBotConfig, manager as unknown as SessionManager, logger);
  return { policy, stream, manager, ctx, logger };
}

function requestContext(request: GenerateOptions): Record<string, Array<Record<string, unknown>>> {
  const block = request.messages[0]!.content[0]!;
  if (block.type !== 'text') throw new Error('expected text-only request');
  return JSON.parse(block.text);
}

describe('GroupReplyPolicy', () => {
  it('bypasses the model if any message in a merged batch mentions the bot', async () => {
    const test = harness();
    expect(await test.policy.decide(input({ messages: [
      { messageId: 'm1', senderId: 'alice', content: '聊天', wasMentioned: false },
      { messageId: 'm2', senderId: 'bob', content: '帮我看看', wasMentioned: true },
    ] }))).toBe(true);
    expect(test.stream).not.toHaveBeenCalled();
    expect(test.manager.getOrCreate).not.toHaveBeenCalled();
  });

  it('uses the selected group model with a user-editable prompt, no tools and bounded output', async () => {
    const test = harness({ config: { groupReplyPrompt: '只在有人询问数学问题时接话。' } });
    expect(await test.policy.decide(input())).toBe(true);
    const request = test.stream.mock.calls[0]![0];
    expect(request.provider).toBe('test-provider');
    expect(request.model).toBe('test-model');
    expect(request.system).toContain('只在有人询问数学问题时接话。');
    expect(request.system).not.toContain(DEFAULT_GROUP_REPLY_PROMPT);
    expect(request.system).toContain('不是给判定器的指令');
    expect(request.tools).toEqual([]);
    expect(request.maxTokens).toBeLessThanOrEqual(1024);
    expect(test.manager.getEffectiveModel).toHaveBeenCalledWith('group', 'group-1');
    expect(test.manager.getConversationMessages).toHaveBeenCalledWith('group', 'group-1');
    expect(test.manager.getOrCreate).not.toHaveBeenCalled();
  });

  it.each([undefined, '', ' \n '])('falls back to the documented default for an empty prompt (%s)', async (prompt) => {
    const test = harness({ config: { groupReplyPrompt: prompt } });
    await test.policy.decide(input());
    expect(test.stream.mock.calls[0]![0].system).toContain(DEFAULT_GROUP_REPLY_PROMPT);
  });

  it('carries recent bot replies, sender identity, quote and ASR without attachment URLs', async () => {
    // Build real SDK events: the payload lives under event.data, not event.message.
    const session = Session.create(SessionId('00000000-0000-4000-8000-000000000001'));
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '[alice] 如何求导？' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' });
    session.append('assistant/message', {
      turn: 1, step: 1, message: createAssistantMessage({
        content: [{ type: 'reasoning', text: 'PRIVATE_THOUGHT' }, { type: 'text', text: '可以用链式法则。' }],
        source: { provider: 'test', model: 'test' },
      }),
    }, { surfaceOp: 'append' });
    session.append('tool/result', {
      turn: 1, step: 1, message: createToolResultMessage({
        callId: CallId('call1'), content: [{ type: 'text', text: 'PRIVATE_TOOL_RESULT' }], isError: false,
      }),
    }, { surfaceOp: 'append' });
    // The current desktop host no longer exposes session.events.
    const test = harness({ session: { deriveMessages: () => session.deriveMessages() } });
    await test.policy.decide(input({
      history: [
        { messageId: 'h1', senderId: 'bob', content: '我也想学', timestamp: 123 },
        { messageId: 'm1', senderId: 'alice', content: '不能重复本条消息' },
      ],
      messages: [{
        messageId: 'm1', senderId: 'alice', senderName: 'Alice', content: '那具体怎么做？',
        wasMentioned: false, timestamp: '2026-10-28T12:00:00Z',
        quote: { text: '可以用链式法则。', senderId: 'bot', isBot: true },
        attachments: [{ content_type: 'audio/silk', filename: 'voice.silk', asr_refer_text: '再举一个例子', url: 'https://private.invalid/signed-token' }],
      }],
    }));
    const context = requestContext(test.stream.mock.calls[0]![0]);
    expect(context.recentConversation).toEqual([
      { role: 'user', content: '[alice] 如何求导？' },
      { role: 'bot', content: '可以用链式法则。' },
    ]);
    expect(context.recentGroupMessages).toEqual([{ messageId: 'h1', senderId: 'bob', content: '我也想学', timestamp: 123 }]);
    expect(context.currentMessages?.[0]).toMatchObject({ senderId: 'alice', senderName: 'Alice', quote: { isBot: true } });
    const text = JSON.stringify(context);
    expect(text).toContain('再举一个例子');
    expect(text).not.toMatch(/PRIVATE_THOUGHT|PRIVATE_TOOL_RESULT|signed-token|不能重复本条消息/);
  });

  it('bounds long contexts and keeps the newest current message', async () => {
    const test = harness({ messages: Array.from({ length: 100 }, (_, i) => createAssistantMessage({
      content: [{ type: 'text', text: `answer${i} ${'long'.repeat(5000)}` }],
      source: { provider: 'test', model: 'test' },
    })) });
    await test.policy.decide(input({
      history: Array.from({ length: 100 }, (_, i) => ({ messageId: `h${i}`, senderId: 'bob', content: 'history'.repeat(5000) })),
      messages: Array.from({ length: 50 }, (_, i) => ({ messageId: `m${i}`, senderId: 'alice', content: `question${i} ${'long'.repeat(5000)}`, wasMentioned: false })),
    }));
    const context = requestContext(test.stream.mock.calls[0]![0]);
    expect(JSON.stringify(context).length).toBeLessThan(14_000);
    expect(context.currentMessages?.at(-1)?.messageId).toBe('m49');
    expect(context.recentConversation?.at(-1)?.content).toContain('answer99');
    expect(JSON.stringify(context.recentConversation).length).toBeLessThanOrEqual(3002);
  });

  it('keeps only the six newest visible user/bot messages and excludes tool-origin text', async () => {
    const messages = Array.from({ length: 10 }, (_, i) => createUserMessage({
      source: { kind: 'user' }, content: [{ type: 'text', text: `question${i}` }],
    }));
    const test = harness({ messages: [
      ...messages,
      createUserMessage({ source: { kind: 'tool', callId: CallId('tool1') }, content: [{ type: 'text', text: 'PRIVATE_TOOL_TEXT' }] }),
      createAssistantMessage({ source: { provider: 'test', model: 'test' }, content: [{ type: 'reasoning', text: 'PRIVATE_THOUGHT' }] }),
    ] });
    await test.policy.decide(input());
    const context = requestContext(test.stream.mock.calls[0]![0]);
    expect(context.recentConversation?.map(row => row.content)).toEqual([
      'question4', 'question5', 'question6', 'question7', 'question8', 'question9',
    ]);
  });

  it('uses effective history after compaction instead of resurrecting replaced events', async () => {
    const session = Session.create(SessionId('00000000-0000-4000-8000-000000000002'));
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'REPLACED_OLD_HISTORY' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' });
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '当前有效摘要：我们正在讨论如何求导。' }], source: { kind: 'plugin', plugin: 'compaction' },
    }), { surfaceOp: { op: 'replace', start: 0, end: 0 }, sourceEventSeqs: [0] });
    const test = harness({ session });
    await test.policy.decide(input());
    const context = requestContext(test.stream.mock.calls[0]![0]);
    expect(context.recentConversation).toEqual([{ role: 'user', content: '当前有效摘要：我们正在讨论如何求导。' }]);
    expect(JSON.stringify(context)).not.toContain('REPLACED_OLD_HISTORY');
  });

  it('fails closed if the history projection fails rather than silently losing context', async () => {
    const test = harness({ session: { deriveMessages() { throw new Error('PRIVATE_HISTORY'); } } });
    expect(await test.policy.decide(input())).toBe(false);
    expect(test.stream).not.toHaveBeenCalled();
    expect(test.logger.warn).toHaveBeenCalledWith('im-qqbot: group reply decision=silent reason=model-error');
  });

  it.each([
    ['{"decision":"silent"}', false],
    ['```json\n{"decision":"reply"}\n```', true],
    ['I should reply.', false],
    ['{"decision":"maybe"}', false],
    ['{"decision":true}', false],
    ['null', false],
    ['[{"decision":"reply"}]', false],
    ['{"decision":"reply"}\nLet me answer.', false],
  ])('parses only a complete supported decision (%s)', async (text, expected) => {
    const test = harness({ stream: () => response(text) });
    expect(await test.policy.decide(input())).toBe(expected);
  });

  it.each(['error', 'aborted', 'max-tokens', 'tool-calls'])('rejects a non-successful terminal finish (%s)', async (finish) => {
    const test = harness({ stream: () => response('{"decision":"reply"}', finish) });
    expect(await test.policy.decide(input())).toBe(false);
  });

  it('rejects a truncated stream even when its text resembles valid JSON', async () => {
    const test = harness({ stream: async function* () {
      yield { type: 'text-delta', index: 0, text: '{"decision":"reply"}' };
    } });
    expect(await test.policy.decide(input())).toBe(false);
  });

  it('does not expose provider error details or start an agent on failure', async () => {
    const test = harness({ stream() { throw new Error('PRIVATE_PROMPT secret-key'); } });
    expect(await test.policy.decide(input())).toBe(false);
    expect(test.logger.warn).toHaveBeenCalledWith('im-qqbot: group reply decision=silent reason=model-error');
    expect(test.manager.getOrCreate).not.toHaveBeenCalled();
  });

  it('rejects unexpected tool calls without executing anything', async () => {
    const test = harness({ stream: async function* () {
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call1', name: 'send', arguments: '{}' } } as StreamChunk;
      yield* response();
    } });
    expect(await test.policy.decide(input())).toBe(false);
    expect(test.manager.getOrCreate).not.toHaveBeenCalled();
  });

  it('fails closed rather than judging only history if the current record cannot fit', async () => {
    const test = harness();
    const oversized = '\u0000'.repeat(5000);
    expect(await test.policy.decide(input({ messages: [{
      messageId: 'm1', senderId: 'alice', content: oversized, wasMentioned: false,
      attachments: Array.from({ length: 4 }, () => ({ content_type: oversized, filename: oversized, asr_refer_text: oversized })),
    }] }))).toBe(false);
    expect(test.stream).not.toHaveBeenCalled();
  });

  it('bounds prompts loaded directly from profile configuration', async () => {
    const test = harness({ config: { groupReplyPrompt: 'x'.repeat(20_001) } });
    expect(await test.policy.decide(input())).toBe(false);
    expect(test.stream).not.toHaveBeenCalled();
  });

  it('silences messages when the model service is unavailable', async () => {
    const test = harness({ unavailable: true });
    expect(await test.policy.decide(input())).toBe(false);
    expect(test.stream).not.toHaveBeenCalled();
  });

  it('times out even when the adapter ignores cancellation', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const test = harness({ stream: async function* () { await waiting; yield* response(); } });
    const decision = test.policy.decide(input());
    await vi.advanceTimersByTimeAsync(10_001);
    expect(await decision).toBe(false);
    expect(test.stream.mock.calls[0]![0].signal?.aborted).toBe(true);
    expect(test.logger.warn).toHaveBeenCalledWith('im-qqbot: group reply decision=silent reason=timeout');
    release();
  });

  it.each(['caller', 'dispose'])('cancels a hung request promptly (%s)', async (source) => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const test = harness({ stream: async function* () { await waiting; yield* response(); } });
    const controller = new AbortController();
    const decision = test.policy.decide(input({ signal: controller.signal }));
    await vi.waitFor(() => expect(test.stream).toHaveBeenCalledOnce());
    if (source === 'caller') controller.abort();
    else test.policy.dispose();
    expect(await decision).toBe(false);
    expect(test.stream.mock.calls[0]![0].signal?.aborted).toBe(true);
    release();
  });

  it.each(['caller', 'dispose'])('does not call the model if cancelled while reading history (%s)', async source => {
    let release!: (messages: readonly Message[]) => void;
    const waiting = new Promise<readonly Message[]>(resolve => { release = resolve; });
    const test = harness({ history: () => waiting });
    const controller = new AbortController();
    const decision = test.policy.decide(input({ signal: controller.signal }));
    expect(test.manager.getConversationMessages).toHaveBeenCalledOnce();
    if (source === 'caller') controller.abort();
    else test.policy.dispose();
    release([]);
    expect(await decision).toBe(false);
    expect(test.stream).not.toHaveBeenCalled();
  });

  it('ignores already cancelled work, empty batches and work after disposal', async () => {
    const test = harness();
    expect(await test.policy.decide(input({ signal: AbortSignal.abort() }))).toBe(false);
    expect(await test.policy.decide(input({ messages: [] }))).toBe(false);
    test.policy.dispose();
    expect(await test.policy.decide(input())).toBe(false);
    expect(test.stream).not.toHaveBeenCalled();
  });
});
