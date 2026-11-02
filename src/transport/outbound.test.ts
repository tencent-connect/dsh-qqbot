import type {} from '@deepseek-ai/dsh-agent/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { createAssistantMessage, createMessage, createUserMessage, ToolCallId, type UserMessage } from '@deepseek-ai/dsh-llm';
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session';
import { ConfigSchema } from '../config.ts';
import { ConversationService } from '../runtime/conversation-service.ts';
import type { SessionManager } from '../session/session-manager.ts';
import type { DshAgent, SessionRecord } from '../session/types.ts';
import type { ReplyTarget } from '../types.ts';
import { createOutboundHandler } from './outbound.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'qq-outbound-turn-')); roots.push(root);
  const session = Session.create(SessionId('native'));
  const nextTurn: UserMessage[] = [];
  const nextStep: UserMessage[] = [];
  const flush = vi.fn(async (_session: Session) => true);
  const live = new Map<string, DshAgent>();
  const sessions = { get: (id: string) => id === session.id ? session : undefined, flush };
  const agents = { get: (id: string) => live.get(id) };
  const ctx = { on: () => () => {}, effect: () => {}, get: (name: string) => name === 'sessions' ? sessions : name === 'agents' ? agents : undefined } as unknown as Context;
  const agent: DshAgent = {
    id: session.id, ctx, session, status: 'idle', inbox: { nextTurn, nextStep },
    model: { current: () => ({ provider: 'p', model: 'm' }) }, cancel: vi.fn(), whenIdle: async () => {},
    runMaintenance: async task => task(new AbortController().signal),
    followup(message: UserMessage) {
      const start = nextTurn.length; nextTurn.push(message);
      session.append('agent/inbox/spliced', { target: 'next-turn', start, inserted: [message] });
    },
  };
  live.set(session.id, agent);
  const record: SessionRecord = {
    sessionKey: 'qqbot:fixture:group:g', sessionId: session.id, scope: 'group', peerId: 'g', senderId: 'actor', agentPreset: 'standard',
    agent, handle: { agent, dispose: async () => {} }, lastActivity: 0,
    replyTarget: { scope: 'group', targetId: 'g', msgId: 'incoming-1' },
  };
  const manager = {
    getDefaultModel: () => ({ provider: 'p', model: 'm' }), getDefaultPreset: () => 'standard',
    getSessionRecord: (scope: string, peerId: string) => scope === 'group' && peerId === 'g' ? record : undefined,
    findBySessionId: (id: string) => id === session.id ? record : undefined,
  } as unknown as SessionManager;
  const config = ConfigSchema.default({ appId: 'fixture', appSecret: 'dummy', cwd: root, streaming: true, showToolResults: true })();
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const sendMarkdown = vi.fn(async (_target: ReplyTarget, _text: string) => undefined);
  const stream = { update: vi.fn(async () => {}), complete: vi.fn(async () => {}) };
  const openStream = vi.fn(() => stream);
  const sender = { sendMarkdown, openStream };
  const deliver = vi.fn(async () => {});
  const service = new ConversationService(ctx, manager, config, logger, root);
  service.entry(record.scope, record.peerId); service.store.bindSession(record.sessionKey, record.sessionId);
  service.setSender(sender); manager.conversations = service;
  const outbound = createOutboundHandler(manager, sender, config, logger, undefined, { deliver });
  const route = (event: SessionEvent) => outbound.routeSessionEvent(session, { type: event.type, data: { ...event.data }, seq: event.seq });
  const drain = () => new Promise<void>(resolve => setImmediate(resolve));
  async function begin(qq: boolean) {
    const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: qq ? 'QQ input' : 'Web input' }] });
    const admitted = qq ? service.enqueueQQ(record, message, { messageId: 'incoming-1', senderId: 'actor' }, 0, []) : Promise.resolve();
    if (!qq) {
      nextTurn.push(message);
      route(session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message] }));
    }
    route(session.append('turn/start', { turn: 1 })); nextTurn.splice(0);
    route(session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] }));
    route(session.append('step/start', { turn: 1, step: 1 }));
    route(session.append('user/message', message, { surfaceOp: 'append' }));
    await admitted;
  }
  function assistant(text: string, step = 1) {
    const message = createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [{ type: 'reasoning', text: 'Private reasoning' }, { type: 'text', text }] });
    route(session.append('assistant/message', { turn: 1, step, message, stream: [] }, { surfaceOp: 'append' }));
  }
  function finish(step = 1) {
    route(session.append('step/end', { turn: 1, step }));
    route(session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }));
  }
  return { session, service, record, outbound, sendMarkdown, openStream, stream, deliver, flush, logger, route, drain, begin, assistant, finish };
}

describe('native outbound delivery', () => {
  it('ignores stream frames, chunks, tool output and presented files until a verified QQ turn completes', async () => {
    const f = fixture(); await f.begin(true);
    f.outbound.routeStreamFrame(f.session.id, { kind: 'attempt-start', attemptId: 'attempt-1' });
    f.outbound.routeStreamFrame(f.session.id, { kind: 'text-delta', attemptId: 'attempt-1', text: 'Live text' });
    f.outbound.routeSessionEvent(f.session, { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'Legacy chunk' } } });
    const callId = ToolCallId('read-1');
    const toolMessage = createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [
      { type: 'text', text: 'Tool narration' }, { type: 'tool-call', id: callId, name: 'read', arguments: '{"path":"report.txt"}' },
    ] });
    f.route(f.session.append('assistant/message', { turn: 1, step: 1, message: toolMessage, stream: [] }, { surfaceOp: 'append' }));
    f.route(f.session.append('tool/call', { turn: 1, step: 1, callId, name: 'read', arguments: '{"path":"report.txt"}' }));
    const result = createMessage({ role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text: 'Private tool result' }] });
    f.route(f.session.append('tool/result', { turn: 1, step: 1, message: result }, { surfaceOp: 'append' }));
    f.outbound.routeSessionEvent(f.session, { type: 'deliverables/presented', data: { turn: 1, callId, files: [{ path: '/tmp/report.txt' }] } });
    await f.drain();
    expect(f.sendMarkdown).not.toHaveBeenCalled(); expect(f.openStream).not.toHaveBeenCalled(); expect(f.deliver).not.toHaveBeenCalled();
    f.route(f.session.append('step/end', { turn: 1, step: 1 }));
    f.route(f.session.append('step/start', { turn: 1, step: 2 }));
    f.assistant('Only the final body', 2); await f.drain();
    expect(f.sendMarkdown).not.toHaveBeenCalled();
    f.finish(2); await f.drain();
    expect(f.sendMarkdown.mock.calls).toEqual([[{ scope: 'group', targetId: 'g', msgId: 'incoming-1' }, 'Only the final body']]);
    expect(f.openStream).not.toHaveBeenCalled(); expect(f.deliver).not.toHaveBeenCalled();
    expect(f.stream.update).not.toHaveBeenCalled(); expect(f.stream.complete).not.toHaveBeenCalled();
    const end = f.session.snapshotEvents().at(-1);
    if (!end) throw new Error('No completed turn');
    f.route(end); await f.drain(); expect(f.sendMarkdown).toHaveBeenCalledTimes(1);
  });

  it('keeps a fully completed native Web turn private', async () => {
    const f = fixture(); await f.begin(false); f.assistant('Web-only answer'); f.finish(); await f.drain();
    expect(f.sendMarkdown).not.toHaveBeenCalled(); expect(f.openStream).not.toHaveBeenCalled();
    expect(f.service.store.deliveries(f.record.sessionKey)).toEqual([]);
    expect(f.logger.warn).not.toHaveBeenCalled();
  });

  it('contains a failed durability checkpoint without delivering final text or files', async () => {
    const f = fixture(); await f.begin(true); f.assistant('Unconfirmed answer');
    f.outbound.routeSessionEvent(f.session, { type: 'deliverables/presented', data: { turn: 1, callId: 'present-1', files: [{ path: '/tmp/report.txt' }] } });
    f.flush.mockResolvedValue(false); f.finish(); await f.drain();
    expect(f.logger.warn).toHaveBeenCalled();
    expect(f.sendMarkdown).not.toHaveBeenCalled(); expect(f.deliver).not.toHaveBeenCalled();
    expect(f.service.store.deliveries(f.record.sessionKey)).toEqual([]);
  });
});
