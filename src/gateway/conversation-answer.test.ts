import { Context } from '@deepseek-ai/cordis';
import { QQBot, runMiddlewareChain, type Middleware } from '@tencent-connect/qqbot-nodejs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema } from '../config.ts';
import { QuestionChannel, type QuestionSessionRecordLike } from '../features/question-channel.ts';
import type { QQMiddlewareContext } from '../middleware/qq-context.ts';
import { ConversationService } from '../runtime/conversation-service.ts';
import type { SessionManager } from '../session/session-manager.ts';
import type { ChatScope } from '../types.ts';
import { setupMiddlewares } from './middleware-setup.ts';

const roots: string[] = [];
const channels: QuestionChannel[] = [];
afterEach(() => {
  for (const channel of channels.splice(0)) channel.uninstall();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(scope: ChatScope = 'group', replyEnabled = true) {
  const root = mkdtempSync(join(tmpdir(), 'qq-answer-gate-')); roots.push(root);
  const peer = scope === 'group' ? 'group-1' : 'actor';
  const config = ConfigSchema({ appId: 'answer-gate', appSecret: 'dummy', cwd: root,
    access: { c2cMode: 'open', c2cAllow: [], groupMode: 'open', groupAllow: [] } });
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  let record: QuestionSessionRecordLike;
  const dependencies = {
    getDefaultModel: () => ({ provider: 'offline', model: 'dummy' }), getDefaultPreset: () => 'standard',
    getSessionRecord: (candidateScope: ChatScope, candidatePeer: string) => candidateScope === scope && candidatePeer === peer ? record : undefined,
    interactionRecord: () => record,
    canAnswer: (candidateScope: ChatScope, candidatePeer: string, actor?: string) => candidateScope === scope && candidatePeer === peer && actor === 'actor',
    recordHumanReply: vi.fn(async () => {}), getOrCreate: vi.fn(),
  };
  const manager = dependencies as unknown as SessionManager;
  const service = new ConversationService(new Context(), manager, config, logger, root);
  manager.conversations = service;
  const entry = service.entry(scope, peer);
  service.store.updatePolicy(entry.key, entry.policy.version, { ...entry.policy, requireMention: true, replyEnabled });
  record = { sessionKey: entry.key, scope, replyTarget: { scope, targetId: peer } };
  const channel = new QuestionChannel(dependencies, { sendMarkdown: vi.fn(async () => {}) }, config, logger);
  channels.push(channel); manager.questionChannel = channel;
  const bot = new QQBot({ appId: config.appId, appSecret: config.appSecret, logger });
  const sendText = vi.spyOn(bot, 'sendText').mockResolvedValue({ id: 'offline-reply', timestamp: new Date().toISOString() });
  const middlewares: Middleware[] = [];
  vi.spyOn(bot, 'use').mockImplementation(middleware => { middlewares.push(middleware); return bot; });
  setupMiddlewares(bot, config, manager, logger);
  const newTurn = vi.fn();
  middlewares.push(async () => { newTurn(); });
  let sequence = 0;
  function input(content = '2', actor = 'actor', target = peer, mentioned = false): QQMiddlewareContext {
    const signal = new AbortController().signal;
    let stopped = false;
    let stopReason: string | undefined;
    const replyTarget = { scope, targetId: target };
    return {
      bot, log: logger, replyTarget, state: {}, signal, receivedAt: Date.now(),
      message: { kind: scope, senderId: actor, senderName: actor, groupOpenid: scope === 'group' ? target : undefined,
        content, messageId: `message-${++sequence}`, timestamp: new Date().toISOString(),
        rawEventType: scope === 'group' ? mentioned ? 'GROUP_AT_MESSAGE_CREATE' : 'GROUP_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
        replyTarget, mentions: [], attachments: [] },
      stop: reason => { stopped = true; stopReason = reason; },
      get stopped() { return stopped; }, get stopReason() { return stopReason; },
      abort: reason => { stopped = true; stopReason = reason; }, aborted: false,
    };
  }
  function ask() {
    const pending = channel['askViaQQ'](record, { questions: [{ id: 'q', question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] }] },
      { sessionId: 'session-1', turn: 1, callId: 'question-call' });
    void pending.catch(() => {});
    return pending;
  }
  return { service, channel, dependencies, middlewares, newTurn, input, ask, scope, peer, key: entry.key, sendText };
}

describe('pending answers through the configured middleware chain', () => {
  it.each([true, false])('answers an unmentioned pending group question with automatic reply %s', async replyEnabled => {
    const f = fixture('group', replyEnabled); const pending = f.ask(); const input = f.input();
    const reserve = vi.spyOn(f.service, 'reserveTrigger');
    await runMiddlewareChain(f.middlewares, input);
    await expect(pending).resolves.toEqual({ answers: [{ id: 'q', selected: ['B'] }] });
    expect(input.stopReason).toBe('question-answer');
    expect(f.dependencies.recordHumanReply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ actor: 'actor', sessionId: 'session-1', turn: 1, callId: 'question-call' }));
    expect(f.service.store.messages(f.key)).toMatchObject([{ id: input.message.messageId, contextEligible: false, provenance: 'interaction' }]);
    expect(f.service.store.snapshotBackground(f.key, '').text).toBe('');
    expect(reserve).not.toHaveBeenCalled();
    expect(f.newTurn).not.toHaveBeenCalled();
    expect(f.dependencies.getOrCreate).not.toHaveBeenCalled();
  });

  it('answers a private pending question while automatic reply is disabled', async () => {
    const f = fixture('c2c', false); const pending = f.ask(); const input = f.input();
    await runMiddlewareChain(f.middlewares, input);
    await expect(pending).resolves.toEqual({ answers: [{ id: 'q', selected: ['B'] }] });
    expect(input.stopReason).toBe('question-answer');
    expect(f.newTurn).not.toHaveBeenCalled();
  });

  it.each(['different-actor', 'different-group', 'no-pending'])('keeps %s messages behind the ordinary gates', async scenario => {
    const f = fixture('group', false);
    if (scenario !== 'no-pending') f.ask();
    const input = f.input('2', scenario === 'different-actor' ? 'outsider' : 'actor', scenario === 'different-group' ? 'other-group' : f.peer);
    await runMiddlewareChain(f.middlewares, input);
    expect(input.stopReason).toBe(scenario === 'different-group' ? 'mention-gate:no_mention' : 'automatic-reply-disabled');
    expect(f.dependencies.recordHumanReply).not.toHaveBeenCalled();
    expect(f.newTurn).not.toHaveBeenCalled();
    const entry = f.service.entry('group', input.message.groupOpenid!);
    expect(f.service.store.messages(entry.key)).toMatchObject([{ contextEligible: true, provenance: 'qq' }]);
    if (scenario !== 'no-pending') expect(f.channel.canAcceptText('group', f.peer, '2', 'actor')).toBe(true);
  });

  it('keeps a disabled conversation closed even when its question is pending', async () => {
    const f = fixture(); f.ask();
    const entry = f.service.requireEntry(f.key);
    f.service.store.updatePolicy(f.key, entry.policy.version, { ...entry.policy, receiveEnabled: false });
    const input = f.input();
    await runMiddlewareChain(f.middlewares, input);
    expect(input.stopReason).toBe('conversation-disabled');
    expect(f.dependencies.recordHumanReply).not.toHaveBeenCalled();
    expect(f.service.store.messages(f.key)).toEqual([]);
    expect(f.newTurn).not.toHaveBeenCalled();
  });

  it('runs a mentioned slash command before the pending answer handler', async () => {
    const f = fixture('group', false); f.ask(); const input = f.input('/bot-ping', 'actor', f.peer, true);
    await runMiddlewareChain(f.middlewares, input);
    expect(f.sendText).toHaveBeenCalledWith(input.replyTarget, expect.stringContaining('pong'));
    expect(f.dependencies.recordHumanReply).not.toHaveBeenCalled();
    expect(f.channel.canAcceptText('group', f.peer, '2', 'actor')).toBe(true);
    expect(f.service.store.messages(f.key)).toMatchObject([{ contextEligible: false, provenance: 'command' }]);
    expect(f.newTurn).not.toHaveBeenCalled();
  });

  it('keeps an unmentioned slash command behind the mention gate while a question is pending', async () => {
    const f = fixture(); f.ask(); const input = f.input('/bot-ping');
    await runMiddlewareChain(f.middlewares, input);
    expect(input.stopReason).toBe('mention-gate:no_mention');
    expect(f.dependencies.recordHumanReply).not.toHaveBeenCalled();
    expect(f.sendText).not.toHaveBeenCalled();
    expect(f.newTurn).not.toHaveBeenCalled();
  });

  it('does not start a turn when the question expires after classification while ingestion waits', async () => {
    const f = fixture(); const pending = f.ask();
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const blocker = f.service.ingestion.run(f.key, () => barrier);
    const input = f.input(); const run = runMiddlewareChain(f.middlewares, input);
    expect(f.service.ingestion.pending(f.key)).toBe(2);
    f.channel.cancelPending(f.key);
    release(); await Promise.all([blocker, run]);
    await expect(pending).rejects.toMatchObject({ code: 'ASK_ABORTED' });
    expect(input.stopReason).toBe('question-answer');
    expect(f.dependencies.recordHumanReply).not.toHaveBeenCalled();
    expect(f.newTurn).not.toHaveBeenCalled();
    expect(f.service.store.messages(f.key)).toMatchObject([{ contextEligible: false, provenance: 'interaction' }]);
  });
});
