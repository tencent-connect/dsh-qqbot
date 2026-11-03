import type {} from '@deepseek-ai/dsh-agent/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { createAssistantMessage, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm';
import { Session, SessionId, type TurnEndReason } from '@deepseek-ai/dsh-session';
import { ConfigSchema } from '../config.ts';
import { ConversationService } from './conversation-service.ts';
import type { SessionManager } from '../session/session-manager.ts';
import type { DshAgent, SessionRecord } from '../session/types.ts';
import type { ReplyTarget } from '../types.ts';
import { wasBotMentioned } from '../gateway/conversation-gate.ts';
import { UNEXECUTED_TOOL_REQUEST_NOTICE } from '../transport/model-reply.ts';
import type { SlashCommandHandlerContext } from '@tencent-connect/qqbot-nodejs';
import { buildCommandList } from '../commands/index.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function user(text: string): UserMessage {
  return createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'qq-native-turn-')); roots.push(root);
  const session = Session.create(SessionId('native'));
  const nextTurn: UserMessage[] = [];
  const nextStep: UserMessage[] = [];
  const live = new Map<string, DshAgent>();
  const flush = vi.fn(async (_session: Session) => true);
  const sessions = { get: (id: string) => id === session.id ? session : undefined, flush };
  const agents = { get: (id: string) => live.get(id) };
  const services: Record<string, unknown> = {};
  const ctx = { on: () => () => {}, effect: () => {}, get: (name: string) => name === 'sessions' ? sessions : name === 'agents' ? agents : services[name] } as unknown as Context;
  const agent: DshAgent = {
    id: session.id, session, ctx, status: 'idle', inbox: { nextTurn, nextStep },
    model: { current: () => ({ provider: 'p', model: 'm' }) },
    followup(message: UserMessage) {
      const start = nextTurn.length;
      nextTurn.push(message);
      session.append('agent/inbox/spliced', { target: 'next-turn', start, inserted: [message] });
    },
    cancel: vi.fn(), whenIdle: async () => {}, runMaintenance: async task => task(new AbortController().signal),
  };
  live.set(session.id, agent);
  const record: SessionRecord = {
    sessionKey: 'qqbot:fixture:group:g', sessionId: session.id, scope: 'group', peerId: 'g', senderId: 'actor',
    agent, handle: { agent, dispose: async () => {} }, lastActivity: 0, agentPreset: 'standard',
    replyTarget: { scope: 'group', targetId: 'g', msgId: 'incoming-1' },
  };
  const manager = {
    getDefaultModel: () => ({ provider: 'p', model: 'm' }), getDefaultPreset: () => 'standard',
    getSessionRecord: (scope: string, peerId: string) => scope === 'group' && peerId === 'g' ? record : undefined,
    findBySessionId: (id: string) => id === session.id ? record : undefined,
  } as unknown as SessionManager;
  const config = ConfigSchema.default({ appId: 'fixture', appSecret: 'dummy', cwd: root })();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const sendMarkdown = vi.fn(async (_target: ReplyTarget, _text: string) => undefined);
  const openStream = vi.fn(() => ({ update: async () => {}, complete: async () => {} }));
  const service = new ConversationService(ctx, manager, config, logger, root);
  service.entry(record.scope, record.peerId);
  service.store.bindSession(record.sessionKey, record.sessionId);
  service.setSender({ sendMarkdown, openStream });
  manager.conversations = service;
  const restart = () => {
    const restored = new ConversationService(ctx, manager, config, logger, root);
    restored.setSender({ sendMarkdown, openStream }); manager.conversations = restored;
    return restored;
  };
  return { service, session, record, manager, config, logger, sendMarkdown, openStream, nextTurn, nextStep, flush, services, restart };
}

type Fixture = ReturnType<typeof fixture>;

describe('QQ failure notifications', () => {
  it('reports a verified QQ failure once without exposing provider details or partial output', async () => {
    const f = fixture(); f.config.access.groupMode = 'open';
    const input = enqueue(f); begin(f);
    await observeLast(f); await input.admitted;
    f.session.append('turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'private provider diagnostic' } } });
    await observeLast(f); await observeLast(f);
    expect(f.sendMarkdown).toHaveBeenCalledExactlyOnceWith(f.record.replyTarget, expect.stringContaining('本轮回复失败'));
    expect(f.sendMarkdown.mock.calls[0]?.[1]).not.toContain('private provider diagnostic');
  });
  it('keeps Web failures private', async () => {
    const f = fixture(); f.config.access.groupMode = 'open';
    queueWeb(f); begin(f);
    f.session.append('turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'web diagnostic' } } });
    await observeLast(f);
    expect(f.sendMarkdown).not.toHaveBeenCalled();
  });
  it('does not report an error to QQ after a Web steer changes the turn', async () => {
    const f = fixture(); f.config.access.groupMode = 'open';
    const input = enqueue(f); begin(f); await observeLast(f); await input.admitted;
    const web = queueWeb(f, user('private Web steer'), 'next-step');
    f.nextStep.shift(); f.session.append('agent/inbox/spliced', { target: 'next-step', start: 0, removedCount: 1, inserted: [] });
    f.session.append('user/message', web, { surfaceOp: 'append' });
    f.session.append('turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'UNKNOWN', message: 'mixed diagnostic' } } });
    await observeLast(f);
    expect(f.sendMarkdown).not.toHaveBeenCalled();
  });
});

function enqueue(f: Fixture, message = user('QQ question'), messageId = 'incoming-1', cutoff = 0, backgroundRefs: string[] = []) {
  const admitted = f.service.enqueueQQ(f.record, message, { messageId, senderId: 'actor' }, cutoff, backgroundRefs);
  void admitted.catch(() => {});
  return { message, admitted };
}

function queueWeb(f: Fixture, message = user('Web question'), target: 'next-turn' | 'next-step' = 'next-turn') {
  const pending = target === 'next-turn' ? f.nextTurn : f.nextStep;
  const start = pending.length; pending.push(message);
  f.session.append('agent/inbox/spliced', { target, start, inserted: [message] });
  return message;
}

function begin(f: Fixture, turn = 1) {
  f.session.append('turn/start', { turn });
  const message = f.nextTurn.shift();
  if (!message) throw new Error('No queued input');
  f.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] });
  f.session.append('step/start', { turn, step: 1 });
  f.session.append('user/message', message, { surfaceOp: 'append' });
  return message;
}

function observeLast(f: Fixture, service = f.service) {
  const event = f.session.snapshotEvents().at(-1);
  if (!event) throw new Error('No Session event');
  return service.observeSessionEvent(f.session.id, event.type, { ...event.data }, event.seq);
}

async function enter(f: Fixture, pending: ReturnType<typeof enqueue>, turn = 1) {
  begin(f, turn); await observeLast(f); await pending.admitted;
}

function answer(f: Fixture, text = 'Final answer', turn = 1) {
  const message = createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [{ type: 'reasoning', text: 'Private reasoning' }, { type: 'text', text }] });
  f.session.append('assistant/message', { turn, step: 1, message, stream: [] }, { surfaceOp: 'append' });
  return message;
}

function finish(f: Fixture, turn = 1, reason: TurnEndReason = { kind: 'completed' }) {
  f.session.append('step/end', { turn, step: 1 });
  f.session.append('turn/end', { turn, reason });
  return observeLast(f);
}

function background(f: Fixture) {
  f.service.store.recordMessage(f.record.sessionKey, { id: 'background-1', senderId: 'member', senderName: '', text: 'Earlier group context', at: Date.now(), mentioned: false, attachments: [] });
  return f.service.store.snapshotBackground(f.record.sessionKey, '');
}

async function admissionState(pending: Promise<void>) {
  return Promise.race([pending.then(() => 'accepted', () => 'rejected'), new Promise<string>(resolve => setImmediate(() => resolve('pending')))]);
}

describe('native QQ turn delivery', () => {
  it('waits for persisted QQ admission and sends only the final body once to the frozen target', async () => {
    const f = fixture(); const snapshot = background(f);
    const pending = enqueue(f, user('QQ question'), 'incoming-1', snapshot.cursor, snapshot.messageIds);
    expect(await admissionState(pending.admitted)).toBe('pending');
    expect(f.service.store.snapshotBackground(f.record.sessionKey, '').text).toContain('Earlier group context');
    begin(f);
    expect(f.service.store.snapshotBackground(f.record.sessionKey, '').text).toContain('Earlier group context');
    await observeLast(f); await pending.admitted;
    expect(f.service.store.snapshotBackground(f.record.sessionKey, '').text).toBe('');
    f.record.replyTarget = { scope: 'group', targetId: 'unrelated-group', msgId: 'later-message' };
    answer(f, 'QQ final body'); await observeLast(f);
    expect(f.sendMarkdown).not.toHaveBeenCalled();
    await finish(f);
    expect(f.sendMarkdown.mock.calls).toEqual([[{ scope: 'group', targetId: 'g', msgId: 'incoming-1' }, 'QQ final body']]);
    expect(f.openStream).not.toHaveBeenCalled();
    expect(f.service.store.snapshotBackground(f.record.sessionKey, '').text).toBe('');
    expect(f.service.store.deliveries(f.record.sessionKey)).toMatchObject([{ state: 'accepted', text: 'QQ final body' }]);
    await observeLast(f);
    expect(f.sendMarkdown).toHaveBeenCalledTimes(1);
  });

  it('keeps Web-only queue turns private and allows the next queued QQ turn', async () => {
    const f = fixture(); queueWeb(f);
    const pending = enqueue(f);
    begin(f); await observeLast(f); answer(f, 'Web answer'); await finish(f);
    expect(f.sendMarkdown).not.toHaveBeenCalled();
    expect(await admissionState(pending.admitted)).toBe('pending');
    await enter(f, pending, 2); answer(f, 'QQ answer', 2); await finish(f, 2);
    expect(f.sendMarkdown.mock.calls).toEqual([[{ scope: 'group', targetId: 'g', msgId: 'incoming-1' }, 'QQ answer']]);
  });

  it('does not let a queued future Web request revoke the current pure QQ turn', async () => {
    const f = fixture(); const pending = enqueue(f); await enter(f, pending);
    queueWeb(f, user('Next Web request'));
    answer(f, 'Current QQ answer'); await finish(f);
    expect(f.sendMarkdown).toHaveBeenCalledTimes(1);
    begin(f, 2); await observeLast(f); answer(f, 'Future Web answer', 2); await finish(f, 2);
    expect(f.sendMarkdown).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('queues a second completed QQ delivery behind a slow first send and rechecks revocation=%s', async revoked => {
    const f = fixture();
    let release: () => void = () => {};
    f.sendMarkdown.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const first = enqueue(f); await enter(f, first); answer(f, 'First QQ answer');
    const sending = finish(f);
    await new Promise<void>(resolve => setImmediate(resolve));
    const second = enqueue(f, user('Second QQ question'), 'incoming-2'); await enter(f, second, 2);
    answer(f, 'Second QQ answer', 2); const queued = finish(f, 2);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(f.sendMarkdown).toHaveBeenCalledTimes(1);
    expect(f.service.store.deliveries(f.record.sessionKey)).toContainEqual(expect.objectContaining({ text: 'Second QQ answer', state: 'pending' }));
    if (revoked) f.config.access.groupMode = 'disabled';
    release(); await Promise.all([sending, queued]);
    expect(f.sendMarkdown).toHaveBeenCalledTimes(revoked ? 1 : 2);
    expect(f.service.store.deliveries(f.record.sessionKey)).toContainEqual(expect.objectContaining({ text: 'Second QQ answer', state: revoked ? 'failed' : 'accepted' }));
  });

  it('suppresses a queued QQ input edited with its original message id', async () => {
    const f = fixture(); const pending = enqueue(f);
    const edited: UserMessage = { ...pending.message, content: [{ type: 'text', text: 'Edited on Web' }] };
    f.nextTurn.splice(0, 1, edited);
    f.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [edited], outcome: 'canceled' });
    await observeLast(f);
    expect(await admissionState(pending.admitted)).toBe('rejected');
    begin(f); await observeLast(f);
    await expect(pending.admitted).rejects.toThrow();
    answer(f, 'Answer to edited input'); await finish(f);
    expect(f.sendMarkdown).not.toHaveBeenCalled();
  });

  it('suppresses a QQ turn after Web Steer enters a later step', async () => {
    const f = fixture(); const pending = enqueue(f); await enter(f, pending);
    answer(f, 'Intermediate QQ text');
    f.session.append('step/end', { turn: 1, step: 1 });
    const steer = queueWeb(f, user('Web steer'), 'next-step');
    f.nextStep.splice(0);
    f.session.append('agent/inbox/spliced', { target: 'next-step', start: 0, removedCount: 1, inserted: [] });
    f.session.append('step/start', { turn: 1, step: 2 });
    f.session.append('user/message', steer, { surfaceOp: 'append' }); await observeLast(f);
    const message = createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [{ type: 'text', text: 'Mixed answer' }] });
    f.session.append('assistant/message', { turn: 1, step: 2, message, stream: [] }, { surfaceOp: 'append' });
    f.session.append('step/end', { turn: 1, step: 2 });
    f.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }); await observeLast(f);
    expect(f.sendMarkdown).not.toHaveBeenCalled();
  });

  it('does not send an unknown direct user input or an unfinished turn', async () => {
    const f = fixture(); const pending = enqueue(f); await enter(f, pending);
    f.session.append('user/message', user('Unknown input outside the inbox'), { surfaceOp: 'append' }); await observeLast(f);
    answer(f, 'Unknown provenance answer'); await observeLast(f);
    expect(f.sendMarkdown).not.toHaveBeenCalled();
    await finish(f);
    expect(f.sendMarkdown).not.toHaveBeenCalled();
  });

  it.each([
    { kind: 'aborted', reason: { kind: 'user' } },
    { kind: 'error', error: { code: 'UNKNOWN', message: 'Failure' } },
  ] satisfies TurnEndReason[])('does not send a partial answer for a $kind turn', async reason => {
    const f = fixture(); const pending = enqueue(f); await enter(f, pending);
    answer(f, 'Partial result'); await finish(f, 1, reason);
    if (reason.kind === 'error') {
      expect(f.sendMarkdown).toHaveBeenCalledExactlyOnceWith(f.record.replyTarget, expect.stringContaining('本轮回复失败'));
      expect(f.sendMarkdown.mock.calls[0]?.[1]).not.toContain('Partial result');
    } else expect(f.sendMarkdown).not.toHaveBeenCalled();
  });

  it('rejects unconfirmed input without advancing group context or sending', async () => {
    const f = fixture(); const snapshot = background(f);
    const pending = enqueue(f, user('QQ question'), 'incoming-1', snapshot.cursor, snapshot.messageIds);
    begin(f); f.flush.mockResolvedValue(false);
    await expect(observeLast(f)).rejects.toThrow();
    expect(await admissionState(pending.admitted)).toBe('rejected');
    expect(f.service.store.snapshotBackground(f.record.sessionKey, '').text).toContain('Earlier group context');
    answer(f); await expect(finish(f)).rejects.toThrow();
    expect(f.sendMarkdown).not.toHaveBeenCalled();
  });

  it('does not send before the final turn is confirmed durable', async () => {
    const f = fixture(); const pending = enqueue(f); await enter(f, pending);
    answer(f); f.flush.mockResolvedValue(false);
    await expect(finish(f)).rejects.toThrow();
    expect(f.sendMarkdown).not.toHaveBeenCalled();
    expect(f.service.store.deliveries(f.record.sessionKey)).toEqual([]);
  });

  it.each(['flush', 'checkpoint'])('releases admission and the QQ preparation queue when %s persistence throws', async failure => {
    const f = fixture(); const snapshot = background(f);
    let pending: ReturnType<typeof enqueue> | undefined;
    const queued = f.service.queue.run(f.record.sessionKey, async () => {
      pending = enqueue(f, user('QQ question'), 'incoming-1', snapshot.cursor, snapshot.messageIds);
      return pending.admitted;
    });
    void queued.catch(() => {});
    await new Promise<void>(resolve => setImmediate(resolve));
    if (!pending) throw new Error('QQ input was not prepared');
    begin(f);
    if (failure === 'flush') f.flush.mockRejectedValue(new Error('Disk unavailable'));
    else vi.spyOn(f.service.store, 'commitBackground').mockImplementation(() => { throw new Error('Catalog write failed'); });
    await expect(observeLast(f)).rejects.toThrow('QQ 输入持久化未确认');
    await expect(queued).rejects.toThrow('QQ 输入持久化未确认');
    expect(f.service.queue.pending(f.record.sessionKey)).toBe(0);
    expect(f.record.agent.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true });
    expect(f.service.store.snapshotBackground(f.record.sessionKey, '').text).toContain('Earlier group context');
    expect(f.sendMarkdown).not.toHaveBeenCalled();
  });

  it('rejects a canceled queued input and preserves its background checkpoint', async () => {
    const f = fixture(); const snapshot = background(f);
    const pending = enqueue(f, user('QQ question'), 'incoming-1', snapshot.cursor, snapshot.messageIds);
    f.nextTurn.splice(0);
    f.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' });
    await observeLast(f);
    expect(await admissionState(pending.admitted)).toBe('rejected');
    expect(f.service.store.snapshotBackground(f.record.sessionKey, '').text).toContain('Earlier group context');
    expect(f.sendMarkdown).not.toHaveBeenCalled();
  });

  it.each(['reply-disabled', 'access-revoked', 'session-replaced'])('does not send after %s', async change => {
    const f = fixture(); const pending = enqueue(f); await enter(f, pending);
    if (change === 'reply-disabled') {
      const entry = f.service.requireEntry(f.record.sessionKey);
      f.service.store.updatePolicy(entry.key, entry.policy.version, { ...entry.policy, replyEnabled: false });
    } else if (change === 'access-revoked') {
      f.config.access.groupMode = 'disabled';
    } else {
      f.service.store.bindSession(f.record.sessionKey, 'replacement');
    }
    answer(f); await finish(f);
    expect(f.sendMarkdown).not.toHaveBeenCalled();
  });

  it('does not resend an accepted automatic delivery after service restart', async () => {
    const f = fixture(); const pending = enqueue(f); await enter(f, pending); answer(f); await finish(f);
    const restored = f.restart(); await observeLast(f, restored); await observeLast(f, restored);
    expect(f.sendMarkdown).toHaveBeenCalledTimes(1);
    expect(restored.store.deliveries(f.record.sessionKey)).toMatchObject([{ state: 'accepted' }]);
  });

  it('does not create a delivery from a completed historical turn replayed after restart', async () => {
    const f = fixture(); const pending = enqueue(f); await enter(f, pending); answer(f);
    f.session.append('step/end', { turn: 1, step: 1 });
    f.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
    const restored = f.restart(); await observeLast(f, restored);
    expect(f.sendMarkdown).not.toHaveBeenCalled();
    expect(restored.store.deliveries(f.record.sessionKey)).toEqual([]);
  });

  it('continues a restored native inbox request when it really enters a new model step', async () => {
    const f = fixture(); enqueue(f);
    const restored = f.restart();
    begin(f); await observeLast(f, restored); answer(f, 'Recovered QQ answer');
    f.session.append('step/end', { turn: 1, step: 1 });
    f.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }); await observeLast(f, restored);
    expect(f.sendMarkdown.mock.calls).toEqual([[{ scope: 'group', targetId: 'g', msgId: 'incoming-1' }, 'Recovered QQ answer']]);
  });

  it('does not authorize output from an event without a native sequence identity', async () => {
    const f = fixture(); const pending = enqueue(f); await enter(f, pending); answer(f);
    f.session.append('step/end', { turn: 1, step: 1 });
    f.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
    await f.service.observeSessionEvent(f.session.id, 'turn/end', { turn: 1, reason: { kind: 'completed' } });
    expect(f.sendMarkdown).not.toHaveBeenCalled();
  });

  it('does not retry an explicit send with unknown delivery after restart', async () => {
    const f = fixture(); f.sendMarkdown.mockRejectedValueOnce(new Error('Connection lost after submission'));
    const delivery = await f.service.send(f.record.sessionKey, 'manual-1', 'Explicit conclusion');
    expect(delivery.state).toBe('unknown');
    expect((await f.service.send(f.record.sessionKey, 'manual-1', 'Explicit conclusion')).state).toBe('unknown');
    const restored = f.restart();
    expect((await restored.send(f.record.sessionKey, 'manual-1', 'Explicit conclusion')).state).toBe('unknown');
    expect(f.sendMarkdown.mock.calls).toEqual([[{ scope: 'group', targetId: 'g' }, 'Explicit conclusion']]);
    expect(restored.store.snapshotBackground(f.record.sessionKey, '').text).toBe('');
  });

  it('records an accepted explicit send once without adding it to group background', async () => {
    const f = fixture();
    expect((await f.service.send(f.record.sessionKey, 'manual-1', 'Explicit conclusion')).state).toBe('accepted');
    await f.service.send(f.record.sessionKey, 'manual-1', 'Explicit conclusion');
    expect(f.sendMarkdown).toHaveBeenCalledTimes(1);
    expect(f.service.store.snapshotBackground(f.record.sessionKey, '').text).toBe('');
  });
});

describe('channel membership and ownership', () => {
  it('keeps an active QQ initiator able to answer and approve while denying every slash command', async () => {
    const f = fixture(); f.config.access.groupMode = 'open';
    const entry = f.service.requireEntry(f.record.sessionKey);
    f.service.store.updatePolicy(entry.key, entry.policy.version, { ...entry.policy, approvers: ['actor'] });
    await enter(f, enqueue(f));
    expect(f.service.isOwner('actor')).toBe(false);
    expect(f.service.canAnswer('group', 'g', 'actor')).toBe(true);
    expect(f.service.canApprove('group', 'g', 'actor')).toBe(true);
    expect(f.service.canStop('group', 'g', 'actor')).toBe(true);
    const commands = buildCommandList({ manager: f.manager, config: f.config, logger: f.logger });
    const input = { message: { kind: 'group', senderId: 'actor', groupOpenid: 'g' }, command: { raw: '' } } as unknown as SlashCommandHandlerContext;
    for (const command of commands) expect(await command.handler(input)).toBe('斜杠命令仅机器人超管可用。');
    expect(f.record.agent.cancel).not.toHaveBeenCalled();
  });

  it('keeps group controllers and approvers separate and does not trust other groups', () => {
    const { service } = fixture(); const group = service.entry('group', 'g');
    service.store.updatePolicy(group.key, group.policy.version, { ...group.policy, controllers: ['controller'], approvers: ['approver'] });
    expect(service.canManage('group', 'g', 'controller')).toBe(true);
    expect(service.canApprove('group', 'g', 'controller')).toBe(false);
    expect(service.canApprove('group', 'g', 'approver')).toBe(true);
    expect(service.canManage('group', 'other', 'controller')).toBe(false);
    expect(service.canManage('c2c', 'person', 'person')).toBe(true);
    expect(service.canManage('c2c', 'person', 'other')).toBe(false);
  });

  it('recognizes full-mode self mentions without trusting another bot', () => {
    const self = new Set(['self-member']);
    expect(wasBotMentioned('GROUP_MESSAGE_CREATE', '<@self-member> /model', [{ member_openid: 'self-member' }], self)).toBe(true);
    expect(wasBotMentioned('GROUP_MESSAGE_CREATE', '<@other-bot> /model', [{ member_openid: 'other-bot' }], self)).toBe(false);
    expect(wasBotMentioned('GROUP_AT_MESSAGE_CREATE', '/model', [], self)).toBe(true);
  });
});

describe('revocation classification', () => {
  it('allows removal of resource and member grants during a task, while rejecting expansions', async () => {
    const { defaultPolicy } = await import('../policy/index.ts');
    const { isReduction } = await import('./conversation-service.ts');
    const old = defaultPolicy('project', '/tmp/project');
    old.resources.readRoots = ['/tmp/project']; old.controllers = ['controller'];
    const reduced = structuredClone(old); reduced.resources.readRoots = []; reduced.controllers = [];
    expect(isReduction(old, reduced)).toBe(true);
    expect(isReduction(reduced, old)).toBe(false);
    const broader = structuredClone(old); broader.resources.readRoots.push('/tmp/other');
    expect(isReduction(old, broader)).toBe(false);
  });
});

describe('manual QQ reply sources and visible failures', () => {
  it('guards forwarded model answers while preserving explicitly entered manual text', async () => {
    const f = fixture();
    const text = '<｜｜DSML｜｜ calls><｜｜DSML｜｜ invoke name="web_fetch">https://example.com</｜｜DSML｜｜ invoke></｜｜DSML｜｜ calls>';
    const message = answer(f, text);
    f.services.sessionController = { resolveAgent: async () => f.record.agent };
    await f.service.send(f.record.sessionKey, 'forwarded-protocol', text, { sessionId: f.session.id, messageId: message.id });
    expect(f.sendMarkdown.mock.calls[0]?.[1]).toBe(UNEXECUTED_TOOL_REQUEST_NOTICE);
    await f.service.send(f.record.sessionKey, 'manual-protocol-example', text);
    expect(f.sendMarkdown.mock.calls[1]?.[1]).toBe(text);
  });
  it('redacts bare configured credentials from explicit-send errors and logger output while retaining platform evidence', async () => {
    const { ApiError } = await import('@tencent-connect/qqbot-nodejs');
    const f = fixture(); f.config.appSecret = 'bare-configured-secret';
    f.sendMarkdown.mockRejectedValueOnce(new ApiError('ignored', 400, '/private', 40034105, 'bare-configured-secret denied'));
    const record = await f.service.send(f.record.sessionKey, 'manual-secret-rejection', 'conclusion');
    expect(record.state).toBe('failed'); expect(record.error).toContain('HTTP 400'); expect(record.error).toContain('40034105');
    expect(JSON.stringify(record)).not.toContain('bare-configured-secret');
    expect(JSON.stringify(f.logger.warn.mock.calls)).not.toContain('bare-configured-secret');
  });

  afterEach(() => { vi.useRealTimers(); });
  it('uses the latest live passive source instead of forcing a proactive send', async () => {
    vi.useFakeTimers({ now: 0 });
    const { cacheMsgId } = await import('../transport/msgid-cache.ts');
    cacheMsgId('group', 'g', 'manual-live-id');
    const f = fixture();
    await f.service.send(f.record.sessionKey, 'manual-live', 'conclusion');
    expect(f.sendMarkdown).toHaveBeenCalledWith({ scope: 'group', targetId: 'g', msgId: 'manual-live-id' }, 'conclusion');
  });
  it('preserves an explicit permission rejection through restart and never repeats the same operation', async () => {
    const { ApiError } = await import('@tencent-connect/qqbot-nodejs');
    const f = fixture();
    f.sendMarkdown.mockRejectedValueOnce(new ApiError('API failed', 400, '/messages', 40034105, '主动消息失败, 无权限'));
    const record = await f.service.send(f.record.sessionKey, 'manual-denied', 'conclusion');
    expect(record.state).toBe('failed'); expect(record.error).toContain('40034105'); expect(record.error).toContain('无权限');
    const restored = f.restart();
    expect(await restored.send(f.record.sessionKey, 'manual-denied', 'conclusion')).toEqual(record);
    expect(f.sendMarkdown).toHaveBeenCalledTimes(1);
  });
  it('freezes the selected passive source across parts and stops when that source expires', async () => {
    vi.useFakeTimers({ now: 0 });
    const { cacheMsgId } = await import('../transport/msgid-cache.ts');
    cacheMsgId('group', 'g', 'manual-expiring-id');
    const f = fixture(); f.config.textChunkLimit = 100;
    f.sendMarkdown.mockImplementationOnce(async () => {
      vi.advanceTimersByTime(300001);
      cacheMsgId('group', 'g', 'newer-source-not-authorized-for-this-send');
    });
    const record = await f.service.send(f.record.sessionKey, 'manual-expiring', Array.from({ length: 3 }, () => 'x'.repeat(90)).join('\n'));
    expect(f.sendMarkdown).toHaveBeenCalledTimes(1);
    expect(record.state).toBe('failed'); expect(record.error).toContain('窗口已过期');
    expect(record.parts[0]?.state).toBe('accepted'); expect(record.parts[1]?.state).toBe('failed');
  });
});


describe('pairing-code claim (two-phase)', () => {
  it('issues a code, startClaim returns a nonce without writing, applyClaim commits the owner', () => {
    const f = fixture();
    const { code } = f.service.issuePairCode('owner');
    const actor = { openid: 'user-openid-1234', nickname: '小明', scope: 'group' as const, sceneName: '测试群' };
    // 第一阶段：仅返回确认 nonce，不写名单
    const started = f.service.startClaim(code, actor);
    expect(started.ok).toBe(true);
    expect(typeof started.nonce).toBe('string');
    expect(f.service.store.ownerIds()).not.toContain('user-openid-1234');
    // 第二阶段：确认后写入
    const applied = f.service.applyClaim(started.nonce!);
    expect(applied.ok).toBe(true);
    expect(f.service.store.ownerIds()).toContain('user-openid-1234');
    // 幂等/一次性：再次确认同 nonce 失败
    expect(f.service.applyClaim(started.nonce!).ok).toBe(false);
  });

  it('rejects an invalid or reused pairing code at startClaim', () => {
    const f = fixture();
    const actor = { openid: 'o', nickname: 'n', scope: 'c2c' as const, sceneName: '私聊' };
    expect(f.service.startClaim('BADCODE', actor).ok).toBe(false);
    const { code } = f.service.issuePairCode('owner');
    expect(f.service.startClaim(code, actor).ok).toBe(true);
    // 码单次：再核销同一码失败
    expect(f.service.startClaim(code, actor).ok).toBe(false);
  });

  it('manual openID add writes an owner without a pairing code', () => {
    const f = fixture();
    const r = f.service.addManualMember('owner', '  manual-oid  ');
    expect(r.ok).toBe(true);
    expect(f.service.store.ownerIds()).toContain('manual-oid');
    expect(f.service.pairStatus().owners.map((m) => m.openid)).toContain('manual-oid');
  });

  it('handleClaimInteraction confirm commits the pending claim from a button callback', () => {
    const f = fixture();
    const { code } = f.service.issuePairCode('owner');
    const started = f.service.startClaim(code, { openid: 'btn-oid', nickname: '按钮人', scope: 'c2c', sceneName: '私聊' });
    // 点击者必须与发起者一致（user_openid === actor.openid）
    const res = f.service.handleClaimInteraction({ user_openid: 'btn-oid', data: { resolved: { button_data: JSON.stringify({ t: 'claim', d: 'confirm', n: started.nonce }) } } } as never);
    expect(res.handled).toBe(true);
    expect(res.reply).toBeTruthy();
    expect(f.service.store.ownerIds()).toContain('btn-oid');
  });

  it('rejects a confirm click from a different user', () => {
    const f = fixture();
    const { code } = f.service.issuePairCode('owner');
    const started = f.service.startClaim(code, { openid: 'owner-oid', nickname: '本人', scope: 'c2c', sceneName: '私聊' });
    const res = f.service.handleClaimInteraction({ user_openid: 'intruder-oid', data: { resolved: { button_data: JSON.stringify({ t: 'claim', d: 'confirm', n: started.nonce }) } } } as never);
    expect(res.handled).toBe(true); // 事件被消费
    expect(res.reply).toContain('只有发起认领的人'); // 给出拒绝提示
    expect(f.service.store.ownerIds()).not.toContain('owner-oid'); // 但未写入
  });

  it('group allowlist claim targets the group, not the sender (message shows group name, no openID)', () => {
    const f = fixture();
    const { code } = f.service.issuePairCode('allow-group');
    // 群会话：peerId='g'（群 openid），senderId='actor'（成员 openid）
    const started = f.service.beginClaimFromMessage('group', 'g', code, 'actor', '小明');
    // 文案针对「群」，不是「人」，且不显示 openID（无 profile 时写入失败，但文案已正确）
    expect(started.message).toContain('群');
    expect(started.message).not.toMatch(/[0-9A-Fa-f]{16,}/); // 不显示 openID
    expect(started.message).not.toContain('小明'); // 不是对"人"加白
  });

  it('adds multiple openIDs with openid:nickname syntax and renames a member', () => {
    const f = fixture();
    const r = f.service.addManualMember('owner', 'oid-a\noid-b:张三\noid-c：Alice Zhang');
    expect(r.ok).toBe(true);
    expect(r.added).toBe(3);
    const map = Object.fromEntries(f.service.pairStatus().owners.map((m) => [m.openid, m.nickname]));
    expect(map['oid-a']).toBe('');
    expect(map['oid-b']).toBe('张三');
    expect(map['oid-c']).toBe('Alice Zhang');
    expect(f.service.renameMember('oid-b', '张三丰').ok).toBe(true);
    expect(f.service.pairStatus().owners.find((m) => m.openid === 'oid-b')?.nickname).toBe('张三丰');
  });
});

