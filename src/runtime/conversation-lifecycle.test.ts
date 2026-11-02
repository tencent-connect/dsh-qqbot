import type { Context } from '@deepseek-ai/cordis';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema } from '../config.ts';
import { conversationGate } from '../gateway/conversation-gate.ts';
import type { SessionManager } from '../session/session-manager.ts';
import type { SessionRecord } from '../session/types.ts';
import { handleInbound } from '../transport/inbound.ts';
import { ConversationService } from './conversation-service.ts';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'qq-rotation-')); roots.push(root);
  const ctx = { get: () => undefined, on: () => () => {} } as unknown as Context;
  const config = ConfigSchema({ appId: 'rotation', appSecret: 'dummy', cwd: root });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  let current: SessionRecord | undefined;
  let created = 0;
  const manager = {
    getDefaultModel: () => ({ provider: 'offline', model: 'dummy' }), getDefaultPreset: () => 'standard',
    getSessionRecord: () => current,
    getOrCreate: vi.fn(async () => {
      if (current) return current;
      const session = Session.create(SessionId(`session-${++created}`));
      const agent = { id: session.id, ctx, session, status: 'idle' as const, inbox: { nextTurn: [], nextStep: [] },
        followup: vi.fn(), cancel: vi.fn(), whenIdle: async () => {}, runMaintenance: async <T>(task: (signal: AbortSignal) => Promise<T>) => task(new AbortController().signal) };
      current = { sessionKey: key, sessionId: session.id, scope: 'group', peerId: 'g', senderId: 'actor', agent, handle: { agent, dispose: async () => {} }, lastActivity: Date.now(), replyTarget: { scope: 'group', targetId: 'g' } };
      service.store.bindSession(key, session.id);
      return current;
    }),
    remove: vi.fn(async () => { current = undefined; }),
  };
  const service = new ConversationService(ctx, manager as unknown as SessionManager, config, logger, root);
  Object.assign(manager, { conversations: service });
  const key = service.entry('group', 'g').key;
  const enqueue = vi.spyOn(service, 'enqueueQQ').mockResolvedValue(undefined);
  const gate = conversationGate(manager as unknown as SessionManager);
  const message = (id: string) => ({
    message: { kind: 'group', senderId: 'actor', groupOpenid: 'g', messageId: id, content: 'next question', timestamp: new Date().toISOString(), rawEventType: 'GROUP_AT_MESSAGE_CREATE', attachments: [] },
    state: {}, bot: { sendMarkdown: vi.fn() }, stop: (reason: string) => { throw new Error(reason); },
  }) as unknown as MiddlewareContext;
  const inbound = (input: MiddlewareContext) => handleInbound(input, manager as unknown as SessionManager, config, logger);
  return { root, service, manager, key, enqueue, gate, message, inbound };
}

async function due(f: ReturnType<typeof fixture>) {
  const old = await f.manager.getOrCreate();
  f.service.store.noteReceived(f.key, old.sessionId);
  const entry = f.service.requireEntry(f.key);
  f.service.store.updateLifecycle(f.key, entry.policy.version, { rotateDays: 0, maxMessages: 1, retentionDays: null });
  return old;
}

describe('automatic rotation through the QQ gate and inbound queue', () => {
  it('durably records every command in a burst above 100 behind a busy Session boundary', async () => {
    const f = fixture(); const barrier = deferred();
    const work = Array.from({ length: 20 }, (_unused, index) => f.service.ingestion.run(f.key, async () => { if (index === 0) await barrier.promise; }));
    expect(f.service.ingestion.pending(f.key)).toBe(20);
    const next = vi.fn(async () => {});
    const command = (index: number) => {
      const input = f.message(`burst-command-${index}`); input.message.content = '/bot-help';
      Object.assign(input, { stop: vi.fn() });
      return input;
    };
    try {
      const burst = Array.from({ length: 106 }, (_unused, index) => f.gate(command(index), next));
      expect(f.service.ingestion.pending(f.key)).toBe(126);
      barrier.resolve();
      await Promise.all([...work, ...burst]);
      const messages = f.service.store.messages(f.key, { limit: 1000 });
      expect(messages).toHaveLength(106);
      expect(new Set(messages.map(message => message.id)).size).toBe(106);
      expect(messages.every(message => message.provenance === 'command' && message.contextEligible === false)).toBe(true);
      expect(f.service.store.snapshotBackground(f.key, '').text).toBe('');
      expect(f.service.ingestion.pending(f.key)).toBe(0);
      expect(f.service.queue.pending(f.key)).toBe(0);
      expect(f.manager.getOrCreate).not.toHaveBeenCalled();
      await Promise.all(Array.from({ length: 106 }, (_unused, index) => f.gate(command(index), next)));
      expect(f.service.store.messages(f.key, { limit: 1000 })).toHaveLength(106);
      expect(next).toHaveBeenCalledTimes(106);
    } finally { barrier.resolve(); await Promise.all(work); }
  }, 30_000);
  it('records admitted commands before parsing, redacts secrets, and excludes commands and answers from background', async () => {
    const f = fixture(); f.service.config.appSecret = 'private-configured-secret';
    const command = f.message('command-1'); command.message.content = '/token private-configured-secret';
    const next = vi.fn(async () => { expect(f.service.store.messages(f.key)).toMatchObject([{ id: 'command-1', contextEligible: false, provenance: 'command' }]); });
    await f.gate(command, next);
    expect(f.service.store.messages(f.key)[0]?.text).not.toContain('private-configured-secret');
    const catalog = readdirSync(f.root).find(name => name.startsWith('conversations-') && name.endsWith('.json'));
    if (!catalog) throw new Error('Catalog missing');
    expect(readFileSync(join(f.root, catalog), 'utf8')).not.toContain('private-configured-secret');
    expect(f.service.requireEntry(f.key).lastMessage).toBe('/token [已隐藏凭据]');
    Object.assign(f.manager, { questionChannel: { canAcceptText: () => true } });
    const answer = f.message('answer-1'); answer.message.content = 'a private answer'; await f.gate(answer, async () => {});
    expect(f.service.store.messages(f.key).find(row => row.id === 'answer-1')).toMatchObject({ contextEligible: false, provenance: 'interaction' });
    expect(f.service.store.snapshotBackground(f.key, '').text).toBe('');
    expect(next).toHaveBeenCalledOnce();
  });

  it('rotates at the message boundary despite its own trigger reservation', async () => {
    const f = fixture(); const old = await due(f); const input = f.message('next');
    await f.gate(input, () => f.inbound(input));
    expect(f.manager.remove).toHaveBeenCalledExactlyOnceWith('group', 'g');
    expect(f.enqueue.mock.calls[0]?.[0].sessionId).not.toBe(old.sessionId);
    expect(f.service.requireEntry(f.key).sessions).toHaveLength(2);
  });

  it('rotates at the age boundary through normal middleware', async () => {
    const f = fixture(); const old = await f.manager.getOrCreate();
    const entry = f.service.requireEntry(f.key);
    f.service.store.updateLifecycle(f.key, entry.policy.version, { rotateDays: 7, maxMessages: 0, retentionDays: null });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 8 * 86_400_000);
    const input = f.message('aged'); await f.gate(input, () => f.inbound(input));
    expect(f.manager.remove).toHaveBeenCalledOnce();
    expect(f.enqueue.mock.calls[0]?.[0].sessionId).not.toBe(old.sessionId);
  });

  it('keeps a future trigger reserved after the first trigger releases twice', async () => {
    const f = fixture(); const old = await due(f);
    const firstReady = deferred(); const firstGo = deferred(); const secondReady = deferred(); const secondGo = deferred();
    const first = f.message('first'); const second = f.message('second');
    const firstRun = f.gate(first, async () => { firstReady.resolve(); await firstGo.promise; await f.inbound(first); });
    await firstReady.promise;
    const secondRun = f.gate(second, async () => { secondReady.resolve(); await secondGo.promise; await f.inbound(second); });
    await secondReady.promise;
    firstGo.resolve(); await firstRun;
    expect(f.manager.remove).not.toHaveBeenCalled();
    expect(f.enqueue.mock.calls[0]?.[0].sessionId).toBe(old.sessionId);
    expect(f.service.busy(f.key)).toBe(true);
    secondGo.resolve(); await secondRun;
    expect(f.manager.remove).toHaveBeenCalledOnce();
    expect(f.enqueue.mock.calls[1]?.[0].sessionId).not.toBe(old.sessionId);
    await vi.waitFor(() => expect(f.service.busy(f.key)).toBe(false));
  });

  it('serializes newly arriving ingestion with an in-flight rotation', async () => {
    const f = fixture(); await due(f);
    const entered = deferred(); const finish = deferred();
    const remove = f.manager.remove.getMockImplementation();
    f.manager.remove.mockImplementationOnce(async () => { entered.resolve(); await finish.promise; await remove?.(); });
    const first = f.message('rotation-trigger'); const second = f.message('arrives-during-rotation');
    const firstRun = f.gate(first, () => f.inbound(first));
    await entered.promise;
    const secondRun = f.gate(second, () => f.inbound(second));
    await Promise.resolve();
    expect(f.service.store.hasMessage(f.key, 'arrives-during-rotation')).toBe(false);
    finish.resolve(); await Promise.all([firstRun, secondRun]);
    expect(f.service.store.hasMessage(f.key, 'arrives-during-rotation')).toBe(true);
    expect(f.manager.remove).toHaveBeenCalledTimes(2);
    expect(f.enqueue).toHaveBeenCalledTimes(2);
  });

  it.each(['nextTurn', 'nextStep'] as const)('preserves native %s inputs at an apparent idle boundary', async inbox => {
    const f = fixture(); const old = await due(f);
    const queued = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'queued Web input' }] });
    Object.assign(old.agent, { inbox: { nextTurn: [], nextStep: [], [inbox]: [queued] } });
    const input = f.message('queued'); await f.gate(input, () => f.inbound(input));
    expect(f.manager.remove).not.toHaveBeenCalled();
    expect(f.enqueue.mock.calls[0]?.[0]).toBe(old);
  });

  it('keeps a running native turn in the current Session', async () => {
    const f = fixture(); const old = await due(f); Object.assign(old.agent, { status: 'running' });
    const input = f.message('running'); await f.gate(input, () => f.inbound(input));
    expect(f.manager.remove).not.toHaveBeenCalled();
    expect(f.enqueue.mock.calls[0]?.[0]).toBe(old);
  });
});
