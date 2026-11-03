import type {} from '@deepseek-ai/dsh-agent/types';
import { Context } from '@deepseek-ai/cordis';
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema } from '../config.ts';
import { PrefsStore } from '../model/prefs-store.ts';
import { SessionManager } from '../session/session-manager.ts';
import type { DshAgent, DshAgentHandle, DshAgentRegistry, SessionRecord } from '../session/types.ts';
import { ConversationService } from './conversation-service.ts';

const isolated = vi.hoisted(() => ({ home: '' }));
vi.mock('../shared/dirs.ts', async original => ({
  ...await original<typeof import('../shared/dirs.ts')>(),
  get PLUGIN_HOME() { return isolated.home; },
}));

const appId = 'upgrade-fixture';
const peerId = 'legacy-group';
const key = `qqbot:${appId}:group:${peerId}`;
const oldId = 'legacy-fork-session';
const target = { scope: 'group', targetId: peerId } satisfies SessionRecord['replyTarget'];
const contexts: Context[] = [];
const managers: SessionManager[] = [];

beforeEach(() => { isolated.home = mkdtempSync(join(tmpdir(), 'qq-runtime-upgrade-')); });
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.disposeAll();
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
  vi.restoreAllMocks();
  rmSync(isolated.home, { recursive: true, force: true });
});

const prefsPath = (): string => join(isolated.home, 'model-prefs.json');
function legacyPrefs(): PrefsStore { return new PrefsStore(undefined, { path: prefsPath() }); }

function fixture(cwd = join(isolated.home, 'agent-workspace')) {
  const config = ConfigSchema.default({ appId, appSecret: 'dummy', cwd, sessionIdleTimeout: 0,
    access: { groupMode: 'open', c2cMode: 'open', groupAllow: [], c2cAllow: [] } })();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const nativeSessions = new Map<string, Session>();
  const live = new Map<string, DshAgent>();
  const permissions = new Map<string, string>();
  const services: Record<string, unknown> = {};
  // Only the public Host service boundary is controlled; Cordis lifecycle and
  // every native Session, preference file, manager and conversation store are real.
  const ctx = new Context().extend({ get: (name: string) => services[name] });
  contexts.push(ctx);
  const tools = { definitions: () => [], guard: () => () => {}, restrict: () => () => {} };
  const systemPrompt = { section: () => () => {}, context: () => () => {} };
  const permissionSet = vi.fn((session: Session, value: string) => { permissions.set(session.id, value); });
  const permissionPresets = { current: (session: Session) => permissions.get(session.id) ?? 'read-only',
    catalog: () => ({ options: [{ value: 'read-only' }, { value: 'workspace-write' }, { value: 'danger-full-access' }] }), set: permissionSet };
  Object.assign(services, {
    tools, systemPrompt, permissionPresets,
    agentDefaultModel: { currentSelection: () => ({ provider: 'fixture', model: 'host-default' }) },
    sandboxPolicy: { resolve: ({ session }: { session: Session }) => ({ mode: permissions.get(session.id) ?? 'read-only' }) },
    sessions: { get: (id: string) => nativeSessions.get(id), flush: vi.fn(async () => true) },
  });

  function agentFor(session: Session): DshAgent {
    const nextTurn: unknown[] = [];
    const agent: DshAgent = {
      id: session.id, session, ctx, status: 'idle', inbox: { nextTurn, nextStep: [] },
      model: { current: () => ({ provider: 'fixture', model: 'original-model' }) },
      cancel: vi.fn(), whenIdle: async () => {}, runMaintenance: async task => task(new AbortController().signal),
      followup: message => { nextTurn.push(message); },
    };
    return agent;
  }
  function addNative(id = oldId): Session {
    const sessionId = SessionId(id);
    const session = Session.create(sessionId, [], { version: 4, id: sessionId, createdAt: Date.now(),
      isSeeded: false, cwd: join(isolated.home, 'original-native-workspace'), agentPreset: 'original-preset' });
    nativeSessions.set(id, session);
    permissions.set(id, 'workspace-write');
    return session;
  }
  const resolveAgent = vi.fn(async (id: string) => {
    const session = nativeSessions.get(id);
    if (!session) return { error: Object.assign(new Error('native Session is missing'), { code: 'session/not-found' }) };
    const agent = live.get(id) ?? agentFor(session);
    live.set(id, agent);
    return { agent };
  });
  const create = vi.fn(async (options: Parameters<DshAgentRegistry['create']>[0]): Promise<DshAgentHandle> => {
    const sessionId = SessionId(options.sessionId);
    const session = Session.create(sessionId, [], { version: 4, id: sessionId, createdAt: Date.now(),
      isSeeded: false, ...options.meta });
    nativeSessions.set(session.id, session);
    permissions.set(session.id, 'danger-full-access');
    const agent = agentFor(session); live.set(session.id, agent);
    return { agent, dispose: async () => { live.delete(session.id); } };
  });
  const resume = vi.fn(async (): Promise<DshAgentHandle> => { throw new Error('use the public Session controller'); });
  const registry: DshAgentRegistry = { get: id => live.get(id), create, resume };
  Object.assign(services, { agents: registry, sessionController: { resolveAgent },
    sessionPersistence: { stat: async (id: string) => {
      const session = nativeSessions.get(id);
      return session ? { header: session.header } : undefined;
    } },
  });
  const sendMarkdown = vi.fn(async () => {});
  const openStream = vi.fn(() => ({ update: async () => {}, complete: async () => {} }));
  function start() {
    const manager = new SessionManager(ctx, registry, config, logger); managers.push(manager);
    const service = new ConversationService(ctx, manager, config, logger, isolated.home);
    manager.conversations = service;
    service.setSender({ sendMarkdown, openStream });
    return { manager, service };
  }
  return { config, ctx, nativeSessions, live, permissions, permissionSet, permissionPresets,
    resolveAgent, create, resume, sendMarkdown, openStream, start, addNative };
}

function appendHistory(session: Session): void {
  session.append('turn/start', { turn: 1 });
  session.append('step/start', { turn: 1, step: 1 });
  session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Original QQ question' }] }), { surfaceOp: 'append' });
  session.append('assistant/message', { turn: 1, step: 1,
    message: createAssistantMessage({ source: { provider: 'fixture', model: 'original-model' }, content: [{ type: 'text', text: 'Original QQ answer' }] }), stream: [] }, { surfaceOp: 'append' });
  session.append('step/end', { turn: 1, step: 1 });
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
}

async function replayEvents(service: ConversationService, session: Session): Promise<void> {
  for (const event of session.snapshotEvents()) await service.observeSessionEvent(session.id, event.type, { ...event.data }, event.seq);
}

describe('upgrading the legacy QQ runtime', () => {
  it('resolves a relative legacy cwd consistently without creating a repository directory', () => {
    const launchCwd = process.cwd();
    const expected = resolve(launchCwd, './legacy-dir');
    const existed = existsSync(expected);
    const f = fixture('./legacy-dir');
    legacyPrefs().setSessionId(key, oldId);
    const { service } = f.start();
    const entry = service.entry('group', peerId);
    expect(service.store.defaults().settings.cwd).toBe(expected);
    expect(entry.settings?.cwd).toBe(expected);
    expect(entry.policy.cwd).toBe(expected);
    expect(service.snapshot().defaultCwd).toBe(expected);
    expect(existsSync(expected)).toBe(existed);
  });

  it('restores the original native Session and history without overwriting its permission or header', async () => {
    legacyPrefs().setSessionId(key, oldId);
    const bytes = readFileSync(prefsPath());
    const f = fixture();
    const session = f.addNative(); appendHistory(session);
    const events = session.snapshotEvents(); const header = session.header;
    const { manager, service } = f.start();
    expect(service.store.get(key)?.legacySessionAssociation).toEqual({ state: 'pending', sessionId: oldId });
    const record = await manager.getOrCreate('group', peerId, 'actor', target);
    expect(f.resolveAgent).toHaveBeenCalledExactlyOnceWith(oldId);
    expect(record.sessionId).toBe(oldId);
    expect(record.agent.session).toBe(session);
    expect(session.snapshotEvents()).toEqual(events);
    expect(session.header).toBe(header);
    expect(service.store.get(key)?.legacySessionAssociation).toBeUndefined();
    expect(service.store.get(key)?.sessions.map(row => row.sessionId)).toEqual([oldId]);
    expect(f.permissionPresets.current(session)).toBe('workspace-write');
    expect(f.permissionSet).not.toHaveBeenCalled();
    expect(service.snapshot().conversations[0]?.currentPermission).toBe('workspace-write');
    expect(f.create).not.toHaveBeenCalled(); expect(f.resume).not.toHaveBeenCalled();
    expect(readFileSync(prefsPath())).toEqual(bytes);
  });

  it('preserves an unresolved old /new mapping until an explicit /new creates one replacement', async () => {
    legacyPrefs().setSessionId(key, oldId);
    const f = fixture(); const { manager, service } = f.start();
    const bytes = readFileSync(prefsPath());
    await expect(manager.getOrCreate('group', peerId, 'actor', target)).rejects.toThrow('明确发送 /new');
    expect(f.create).not.toHaveBeenCalled();
    expect(readFileSync(prefsPath())).toEqual(bytes);
    expect(service.store.get(key)).toMatchObject({ currentSessionId: oldId,
      legacySessionAssociation: { state: 'pending', sessionId: oldId }, sessions: [{ sessionId: oldId }] });
    await manager.remove('group', peerId);
    const record = await manager.getOrCreate('group', peerId, 'actor', target);
    expect(record.sessionId).not.toBe(oldId);
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.permissionSet).toHaveBeenCalledExactlyOnceWith(record.agent.session, 'read-only');
    expect(f.permissions.get(record.sessionId)).toBe('read-only');
    expect(legacyPrefs().getSessionId(key)).toBe(record.sessionId);
    const entry = service.store.get(key);
    expect(entry?.currentSessionId).toBe(record.sessionId);
    expect(entry?.legacySessionAssociation).toBeUndefined();
    expect(entry?.sessions.map(row => row.sessionId)).toEqual([oldId, record.sessionId]);
    expect(entry?.sessions[0]?.endedAt).toEqual(expect.any(Number));
  });

  it('keeps corrupt preferences visible and blocks creation until a repaired-file restart migrates them', async () => {
    legacyPrefs().setSessionId(key, oldId);
    const valid = readFileSync(prefsPath());
    const corrupt = Buffer.from('{"sessionIds":{"qqbot:upgrade-fixture:group:legacy-group":');
    writeFileSync(prefsPath(), corrupt);
    const f = fixture(); const native = f.addNative();
    const { manager, service } = f.start();
    expect(service.snapshot().errors).toContainEqual(expect.stringContaining('旧偏好读取失败'));
    expect(service.admitted('group', peerId)).toBe(false);
    await expect(manager.getOrCreate('group', peerId, 'actor', target)).rejects.toThrow('迁移受阻');
    await expect(manager.replaceSession('group', peerId)).rejects.toThrow('迁移受阻');
    await expect(manager.remove('group', peerId)).rejects.toThrow('迁移受阻');
    expect(f.resolveAgent).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
    expect(service.store.list()).toEqual([]);
    expect(readFileSync(prefsPath())).toEqual(corrupt);
    writeFileSync(prefsPath(), valid);
    const restarted = f.start();
    expect(restarted.service.store.get(key)?.currentSessionId).toBe(oldId);
    expect(restarted.service.snapshot().errors).toEqual([]);
    expect(restarted.service.admitted('group', peerId)).toBe(true);
    const restored = await restarted.manager.getOrCreate('group', peerId, 'actor', target);
    expect(restored.agent.session).toBe(native);
    expect(f.create).not.toHaveBeenCalled();
    expect(readFileSync(prefsPath())).toEqual(valid);
  });

  it('does not publish old native history after migration or a second runtime restart', async () => {
    legacyPrefs().setSessionId(key, oldId);
    const f = fixture(); const session = f.addNative(); appendHistory(session);
    const first = f.start();
    const original = await first.manager.getOrCreate('group', peerId, 'actor', target);
    await replayEvents(first.service, session);
    // A real durable QQ operation completed before shutdown, but its old answer
    // was never delivered. Replaying it after restart must not publish history.
    const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Completed before restart' }] });
    const admitted = first.service.enqueueQQ(original, message, { messageId: 'pre-restart-message', senderId: 'actor' }, 0, []);
    session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message] });
    session.append('turn/start', { turn: 2 });
    session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] });
    session.append('step/start', { turn: 2, step: 1 });
    const input = session.append('user/message', message, { surfaceOp: 'append' });
    await first.service.observeSessionEvent(session.id, input.type, { ...input.data }, input.seq);
    await admitted;
    session.append('assistant/message', { turn: 2, step: 1,
      message: createAssistantMessage({ source: { provider: 'fixture', model: 'original-model' }, content: [{ type: 'text', text: 'Undelivered historical answer' }] }), stream: [] }, { surfaceOp: 'append' });
    session.append('step/end', { turn: 2, step: 1 });
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } });
    const eventsBeforeRestart = session.snapshotEvents(); const headerBeforeRestart = session.header;
    f.live.clear();
    const second = f.start();
    const record = await second.manager.getOrCreate('group', peerId, 'actor', target);
    expect(f.permissionPresets.current(session)).toBe('workspace-write');
    expect(f.permissionSet).not.toHaveBeenCalled();
    expect(session.header).toBe(headerBeforeRestart);
    expect(session.snapshotEvents()).toEqual(eventsBeforeRestart);
    expect(second.service.snapshot().conversations[0]).toMatchObject({
      currentPermission: 'workspace-write', effectiveRestriction: { sandbox: 'workspace-write' },
    });
    await replayEvents(second.service, session);
    expect(record.sessionId).toBe(oldId);
    expect(second.service.operations.forSession(oldId)).toHaveLength(1);
    expect(f.sendMarkdown).not.toHaveBeenCalled();
    expect(f.openStream).not.toHaveBeenCalled();
    expect(second.service.store.deliveries(key)).toEqual([]);
    expect(f.create).not.toHaveBeenCalled();
  });
});
