import { createHash, randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImQQBotConfig } from '../config.ts';
import type { ChatScope, Logger } from '../types.ts';
import { SessionManager } from './session-manager.ts';
import type { DshAgent, DshAgentRegistry, DshSessionLike, SessionPersistenceReader } from './types.ts';

const savedIds = vi.hoisted(() => new Map<string, string>());
vi.mock('../model/model-resolver.ts', () => ({
  ModelResolver: class {
    getEffectiveRoute() { return undefined; }
    getSessionId(key: string) { return savedIds.get(key); }
  },
}));

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(dispose => dispose()));
  savedIds.clear();
});

function defaultId(scope: ChatScope, peer: string): string {
  const hash = createHash('sha256').update(`qqbot:test:${scope}:${peer}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function conversation(id: string, text = '可以用链式法则。'): Session {
  const session = Session.create(SessionId(id));
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: '如何求导？' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' });
  session.append('assistant/message', {
    turn: 0, step: 0,
    message: createAssistantMessage({
      content: [{ type: 'text', text }], source: { provider: 'test', model: 'test' },
    }),
  }, { surfaceOp: 'append' });
  return session;
}

function harness(storeAvailable = true, persistence?: Partial<SessionPersistenceReader>) {
  const live = new Map<string, DshAgent>();
  const retained = new Map<string, DshSessionLike>();
  const store = {
    retained,
    messageProjections: [],
    get: vi.fn(function (this: { retained: Map<string, DshSessionLike> }, id: string) {
      return this.retained.get(id);
    }),
  };
  const ctx = {
    on: vi.fn(),
    get: vi.fn((name: string) => name === 'sessionPersistence'
      ? persistence : name === 'sessions' && storeAvailable ? store : undefined),
  } as unknown as Context;
  const agents = {
    get: vi.fn((id: string) => live.get(id)),
    resume: vi.fn(), create: vi.fn(),
  };
  const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const manager = new SessionManager(ctx, agents as unknown as DshAgentRegistry,
    { appId: 'test', sessionIdleTimeout: 0 } as ImQQBotConfig, logger);
  cleanup.push(() => manager.disposeAll());
  function register(session: DshSessionLike): DshAgent {
    const agent = {
      id: session.id, ctx, session, status: 'idle',
      cancel: vi.fn(), followup: vi.fn(), whenIdle: async () => {},
    } as unknown as DshAgent;
    live.set(session.id, agent);
    return agent;
  }
  function expectReadOnly() {
    expect(agents.create).not.toHaveBeenCalled();
    expect(agents.resume).not.toHaveBeenCalled();
    for (const agent of live.values()) {
      expect(agent.followup).not.toHaveBeenCalled();
      expect(agent.cancel).not.toHaveBeenCalled();
    }
  }
  return { manager, agents, live, retained, store, ctx, register, expectReadOnly };
}

describe('SessionManager read-only conversation history', () => {
  it('reads the mapped session projection with its receiver and leaves history untouched', async () => {
    const test = harness();
    const session = conversation(defaultId('group', 'group-1'));
    test.register(session);
    await test.manager.getOrCreate('group', 'group-1', 'alice', {
      scope: 'group', targetId: 'group-1', msgId: 'm1',
    });
    const before = session.events;
    const projection = vi.spyOn(session, 'deriveMessages');
    test.agents.get.mockClear();

    const messages = await test.manager.getConversationMessages('group', 'group-1');

    expect(messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(messages.at(-1)?.content).toEqual([{ type: 'text', text: '可以用链式法则。' }]);
    expect(projection.mock.contexts).toEqual([session]);
    expect(test.agents.get).not.toHaveBeenCalled();
    expect(test.store.get).not.toHaveBeenCalled();
    expect(session.events).toBe(before);
    expect(Object.isFrozen(messages.at(-1))).toBe(true);
    expect(test.manager.size).toBe(1);
    test.expectReadOnly();
  });

  it('reads an existing registry agent before a QQ mapping exists, without requiring .events', async () => {
    const test = harness();
    const session = conversation(defaultId('group', 'group-1'));
    // Current hosts expose snapshots instead of an events property. The public
    // message projection is enough; no raw-event representation is assumed.
    test.register({ id: session.id, deriveMessages: () => session.deriveMessages() });

    expect(await test.manager.getConversationMessages('group', 'group-1')).toEqual(session.deriveMessages());
    expect(test.manager.size).toBe(0);
    expect(test.store.get).not.toHaveBeenCalled();
    test.expectReadOnly();
  });

  it('reads a retained session when there is no mapped or registry agent', async () => {
    const test = harness();
    const session = conversation(defaultId('group', 'group-1'));
    test.retained.set(session.id, session);

    expect(await test.manager.getConversationMessages('group', 'group-1')).toEqual(session.deriveMessages());
    expect(test.store.get).toHaveBeenCalledWith(session.id);
    expect(test.manager.size).toBe(0);
    test.expectReadOnly();
  });

  it.each([true, false])('returns no history for an unknown session (store available: %s)', async storeAvailable => {
    const test = harness(storeAvailable);
    expect(await test.manager.getConversationMessages('group', 'unknown')).toEqual([]);
    expect(test.manager.size).toBe(0);
    test.expectReadOnly();
  });

  it('uses the saved current session id after a fork or reset', async () => {
    const test = harness();
    const oldSession = conversation(defaultId('group', 'group-1'), 'OLD_SESSION');
    const currentSession = conversation(randomUUID(), 'CURRENT_SESSION');
    test.register(oldSession);
    test.register(currentSession);
    savedIds.set('qqbot:test:group:group-1', currentSession.id);

    const messages = await test.manager.getConversationMessages('group', 'group-1');

    expect(messages.at(-1)?.content).toEqual([{ type: 'text', text: 'CURRENT_SESSION' }]);
    expect(test.agents.get).toHaveBeenCalledWith(currentSession.id);
    expect(test.agents.get).not.toHaveBeenCalledWith(oldSession.id);
    test.expectReadOnly();
  });

  it('isolates other groups and direct chats with the same peer id', async () => {
    const test = harness();
    test.register(conversation(defaultId('group', 'group-1'), 'GROUP_ONE'));
    test.register(conversation(defaultId('group', 'group-2'), 'GROUP_TWO'));
    test.register(conversation(defaultId('c2c', 'group-1'), 'DIRECT_CHAT'));

    expect((await test.manager.getConversationMessages('group', 'group-1')).at(-1)?.content)
      .toEqual([{ type: 'text', text: 'GROUP_ONE' }]);
    expect((await test.manager.getConversationMessages('group', 'group-2')).at(-1)?.content)
      .toEqual([{ type: 'text', text: 'GROUP_TWO' }]);
    expect((await test.manager.getConversationMessages('c2c', 'group-1')).at(-1)?.content)
      .toEqual([{ type: 'text', text: 'DIRECT_CHAT' }]);
    test.expectReadOnly();
  });

  it('propagates projection failures instead of silently discarding context', async () => {
    const test = harness();
    const failure = new Error('projection failed');
    test.register({ id: defaultId('group', 'group-1'), deriveMessages() { throw failure; } });

    await expect(test.manager.getConversationMessages('group', 'group-1')).rejects.toThrow(failure);
    test.expectReadOnly();
  });

  it('rejects an existing session without a supported projection API', async () => {
    const test = harness();
    test.register({ id: defaultId('group', 'group-1'), events: [] });

    await expect(test.manager.getConversationMessages('group', 'group-1'))
      .rejects.toThrow('Session message projection is unavailable');
    test.expectReadOnly();
  });

  it('replays persisted history after reload without restoring or registering an agent', async () => {
    const session = conversation(randomUUID(), 'PERSISTED_CURRENT_SESSION');
    savedIds.set('qqbot:test:group:group-1', session.id);
    const snapshot = { events: structuredClone(session.events), eventState: 'detached' as const };
    const before = structuredClone(snapshot.events);
    const handle = {
      header: structuredClone(session.header), inheritedEventCount: 0,
      read: vi.fn(async () => snapshot), close: vi.fn(async () => {}),
      append: vi.fn(), flush: vi.fn(),
    };
    const persistence = { open: vi.fn(async () => handle), create: vi.fn() };
    const test = harness(true, persistence);
    const restore = vi.spyOn(Session, 'fromRestore');

    const messages = await test.manager.getConversationMessages('group', 'group-1');

    expect(messages).toEqual(session.deriveMessages());
    expect(persistence.open).toHaveBeenCalledExactlyOnceWith(session.id, 'read');
    expect(handle.read).toHaveBeenCalledExactlyOnceWith();
    expect(handle.close).toHaveBeenCalledExactlyOnceWith();
    expect(restore).toHaveBeenCalledWith(session.id, snapshot.events, handle.header,
      0, 'detached', test.store.messageProjections);
    expect(snapshot.events).toEqual(before);
    expect(handle.append).not.toHaveBeenCalled();
    expect(handle.flush).not.toHaveBeenCalled();
    expect(persistence.create).not.toHaveBeenCalled();
    expect(test.manager.size).toBe(0);
    expect(test.live.size).toBe(0);
    expect(test.retained.size).toBe(0);
    test.expectReadOnly();
    restore.mockRestore();
  });

  it('prefers retained history without opening persistence', async () => {
    const persistence = { open: vi.fn() };
    const test = harness(true, persistence);
    const session = conversation(defaultId('group', 'group-1'));
    test.retained.set(session.id, session);

    expect(await test.manager.getConversationMessages('group', 'group-1')).toEqual(session.deriveMessages());
    expect(persistence.open).not.toHaveBeenCalled();
    test.expectReadOnly();
  });

  it('returns no history only when the requested persisted session is absent', async () => {
    const failure = Object.assign(new Error('session not found'), {
      name: 'SessionPersistenceNotFoundError', sessionId: defaultId('group', 'unknown'),
    });
    const test = harness(true, { open: vi.fn().mockRejectedValue(failure) });

    expect(await test.manager.getConversationMessages('group', 'unknown')).toEqual([]);
    test.expectReadOnly();
  });

  it.each([
    new Error('storage permission denied'),
    Object.assign(new Error('session not found'), { name: 'SessionPersistenceNotFoundError', sessionId: 'other' }),
  ])('propagates persistence open failures instead of treating them as empty history: %s', async failure => {
    const test = harness(true, { open: vi.fn().mockRejectedValue(failure) });

    await expect(test.manager.getConversationMessages('group', 'group-1')).rejects.toThrow(failure);
    test.expectReadOnly();
  });

  it('closes the read handle and propagates a corrupt history read', async () => {
    const failure = new Error('invalid JSONL event');
    const session = conversation(defaultId('group', 'group-1'));
    const handle = {
      header: session.header, read: vi.fn().mockRejectedValue(failure), close: vi.fn(async () => {}),
    };
    const test = harness(true, { open: vi.fn(async () => handle) });

    await expect(test.manager.getConversationMessages('group', 'group-1')).rejects.toThrow(failure);
    expect(handle.close).toHaveBeenCalledExactlyOnceWith();
    test.expectReadOnly();
  });

  it('closes the handle when a persisted event cannot be replayed', async () => {
    const session = conversation(defaultId('group', 'group-1'));
    const events = structuredClone(session.events);
    events[0].seq = 10;
    const handle = {
      header: session.header, read: vi.fn(async () => ({ events })), close: vi.fn(async () => {}),
    };
    const test = harness(true, { open: vi.fn(async () => handle) });

    await expect(test.manager.getConversationMessages('group', 'group-1')).rejects.toThrow();
    expect(handle.close).toHaveBeenCalledExactlyOnceWith();
    test.expectReadOnly();
  });

  it('rejects an available persistence service with no supported read API', async () => {
    const test = harness(true, {});

    await expect(test.manager.getConversationMessages('group', 'group-1'))
      .rejects.toThrow('Session persistence read API is unavailable');
    test.expectReadOnly();
  });
});
