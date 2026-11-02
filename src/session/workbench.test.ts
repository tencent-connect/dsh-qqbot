import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { ConfigSchema } from '../config.ts';
import { ConversationService } from '../runtime/conversation-service.ts';
import { ConversationStore } from '../conversations/index.ts';
import { SessionManager } from './session-manager.ts';
import type { DshAgent, DshAgentRegistry } from './types.ts';

vi.mock('../model/model-resolver.ts', () => ({ ModelResolver: class {
  private ids = new Map<string, string>();
  getPreset() { return undefined; }
  setPreset() {}
  getSessionId(key: string) { return this.ids.get(key); }
  setSessionId(key: string, value: string) { this.ids.set(key, value); }
  getEffectiveRoute() { return { provider: 'p', model: 'm' }; }
  getResumeRoute() { return this.getEffectiveRoute(); }
  resolveDefault() { return this.getEffectiveRoute(); }
  async validateRoute(route: { provider: string; model: string }) { return route; }
} }));
vi.mock('../host/adapter.ts', () => ({ createHostAdapter: () => ({ capabilities: [], resolveAgent: async () => undefined, sessionEvents: () => [] }) }));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'qq-workbench-')); roots.push(root);
  const live = new Map<string, DshAgent>();
  const handles = new Map<string, { agent: DshAgent; dispose: ReturnType<typeof vi.fn> }>();
  const selected = new Map<string, string>();
  const workspaces = new Map(['a', 'b'].map(id => [id, { id, title: id, path: join(root, id), attachSession: vi.fn(async () => {}), detachSession: vi.fn(async () => {}) }]));
  const set = vi.fn((session: Session, value: string) => { selected.set(session.id, value); session.append('permission/preset', { preset: value }); });
  const tools = { register: () => () => {}, definitions: () => [{ name: 'read' }, { name: 'write' }], restrict: () => () => {}, guard: () => () => {}, setExecutor: vi.fn(() => () => {}) };
  const services: Record<string, unknown> = {
    workspaceRegistry: { get: (id: string) => workspaces.get(id), archivedSessionIds: [] as string[], unarchiveSession: vi.fn(async () => {}) }, tools,
    agentPresets: { defaultId: 'standard', resolve: async (id?: string) => ({ id: id ?? 'standard' }), mount: async () => {}, list: async () => [{ id: 'standard' }, { id: 'chosen' }] },
    sessions: { get: (id: string) => live.get(id)?.session, flush: async () => true },
    agents: { get: (id: string) => live.get(id) },
    permissionPresets: { current: (session: Session) => selected.get(session.id) ?? 'read-only', set,
      catalog: () => ({ options: ['read-only', 'workspace-write', 'danger-full-access', 'custom'].map(value => ({ value })) }) },
  };
  const ctx = { systemPrompt: { getSectionOrder: () => 1 }, get: (name: string) => services[name], on: () => () => {}, effect: () => {} } as unknown as Context;
  const create = vi.fn<DshAgentRegistry['create']>(async options => {
    const session = Session.create(SessionId(options.sessionId), undefined, { version: 4, isSeeded: false, id: SessionId(options.sessionId), cwd: options.meta?.cwd ?? root, createdAt: Date.now() });
    // Host initialization may choose a different global default. QQ creation
    // must still seed this conversation's explicit read-only default.
    selected.set(session.id, 'workspace-write');
    const agent: DshAgent = { id: session.id, session, ctx, status: 'idle', inbox: { nextTurn: [], nextStep: [] }, model: { current: () => ({ provider: 'p', model: 'm' }) }, cancel: vi.fn(), followup: vi.fn(), whenIdle: async () => {}, runMaintenance: async task => task(new AbortController().signal) };
    const handle = { agent, dispose: vi.fn(async () => { live.delete(session.id); }) }; handles.set(session.id, handle); live.set(session.id, agent); return handle;
  });
  const registry: DshAgentRegistry = { get: id => live.get(id), create, resume: async () => { throw new Error('missing'); } };
  const config = ConfigSchema.default({ appId: 'fixture', appSecret: 'dummy', cwd: root, sessionIdleTimeout: 0 })();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const manager = new SessionManager(ctx, registry, config, logger);
  const service = new ConversationService(ctx, manager, config, logger, root); manager.conversations = service;
  const current = () => manager.getOrCreate('group', 'g', 'actor', { scope: 'group', targetId: 'g' });
  const initial = service.entry('group', 'g');
  service.store.updatePolicy(initial.key, initial.policy.version, { ...initial.policy, toolMode: 'restricted', nativeTools: false, allowedPresets: ['standard', 'chosen'], allowedPermissions: ['read-only'] });
  const key = initial.key;
  return { root, manager, service, key, current, create, set, selected, workspaces, handles, tools, services, ctx, config, logger };
}

describe('QQ native workbench ownership', () => {
  it('creates exactly one Session for a combined workspace and preset selection, including replay after reload', async () => {
    const f = fixture(); const old = await f.current(); const before = f.service.requireEntry(f.key);
    const input = { operationId: 'combined-1', expectedCurrentSessionId: old.sessionId, expectedPolicyVersion: before.policy.version, workspaceId: 'b', presetId: 'chosen' };
    const count = f.create.mock.calls.length;
    const id = await f.service.createSession(f.key, input);
    expect(f.create).toHaveBeenCalledTimes(count + 1);
    expect(f.create.mock.calls.at(-1)?.[0].meta).toMatchObject({ cwd: f.workspaces.get('b')?.path, agentPreset: 'chosen' });
    expect(await f.service.createSession(f.key, input)).toBe(id);
    const restored = new ConversationService(f.ctx, f.manager, f.config, f.logger, f.root);
    expect(await restored.createSession(f.key, input)).toBe(id);
    expect(f.create).toHaveBeenCalledTimes(count + 1);
    expect(f.service.requireEntry(f.key).sessions).toHaveLength(2);
    expect(f.service.requireEntry(f.key).settings?.preset).toBe('chosen');
    expect(new ConversationStore(f.root, 'fixture').get(f.key)?.settings?.preset).toBe('chosen');
    expect(f.service.snapshot().conversations.find(entry => entry.key === f.key)).toMatchObject({ currentPreset: 'chosen', nextPreset: 'chosen' });
    await f.manager.remove('group', 'g');
    const newest = await f.current();
    expect(newest.sessionId).not.toBe(id);
    expect(f.create.mock.calls.at(-1)?.[0].meta).toMatchObject({ cwd: f.workspaces.get('b')?.path, agentPreset: 'chosen' });
    expect(f.service.snapshot().conversations.find(entry => entry.key === f.key)).toMatchObject({ currentPreset: 'chosen', nextPreset: 'chosen' });
  });
  it('preserves the old mapping on combined creation failure and rejects the same operation replay', async () => {
    const f = fixture(); const old = await f.current(); const before = f.service.requireEntry(f.key);
    f.workspaces.get('b')!.attachSession.mockRejectedValueOnce(new Error('attach failed'));
    const input = { operationId: 'combined-failed', expectedCurrentSessionId: old.sessionId, expectedPolicyVersion: before.policy.version, workspaceId: 'b', presetId: 'chosen' };
    await expect(f.service.createSession(f.key, input)).rejects.toThrow('attach failed');
    const count = f.create.mock.calls.length;
    await expect(f.service.createSession(f.key, input)).rejects.toThrow('attach failed');
    expect(f.create).toHaveBeenCalledTimes(count);
    expect(f.service.requireEntry(f.key).currentSessionId).toBe(old.sessionId);
    expect(f.service.requireEntry(f.key).settings).toEqual(before.settings);
    expect(new ConversationStore(f.root, 'fixture').get(f.key)?.settings).toEqual(before.settings);
    expect(f.service.snapshot().conversations.find(entry => entry.key === f.key)).toMatchObject({ currentPreset: 'standard', nextPreset: 'standard' });
    expect(f.manager.getSessionRecord('group', 'g')).toBe(old);
    await f.manager.remove('group', 'g');
    expect(f.create.mock.calls.at(-1)?.[0].meta?.agentPreset).toBe('standard');
    expect(f.service.requireEntry(f.key).settings).toEqual(before.settings);
  });
  it('keeps a saved next-session cwd when the current Session is attached again', async () => {
    const f = fixture(); const old = await f.current(); const before = f.service.requireEntry(f.key);
    const pendingCwd = join(f.root, 'pending-workspace');
    await f.service.saveSettings(f.key, before.policy.version, { ...before.settings!, cwd: pendingCwd }, before.alias, before.policy.receiveEnabled !== false);
    expect(old.agent.session.header?.cwd).toBe(f.root);
    f.service.attach(old);
    expect(f.service.requireEntry(f.key).settings?.cwd).toBe(pendingCwd);
    expect(new ConversationStore(f.root, 'fixture').get(f.key)?.settings?.cwd).toBe(pendingCwd);
    expect(f.service.requireEntry(f.key).currentSessionId).toBe(old.sessionId);
    await f.manager.remove('group', 'g');
    expect(f.create.mock.calls.at(-1)?.[0].meta?.cwd).toBe(pendingCwd);
  });
  it('shows actual permission conflicts without downgrading and unarchives only an explicitly matched current Session', async () => {
    const f = fixture(); const record = await f.current();
    f.selected.set(record.sessionId, 'danger-full-access');
    const registry = f.services.workspaceRegistry as { archivedSessionIds: string[]; unarchiveSession: ReturnType<typeof vi.fn> };
    registry.archivedSessionIds.push(record.sessionId);
    expect(f.service.snapshot().conversations.find(entry => entry.key === f.key)).toMatchObject({ archived: true, currentPermission: 'danger-full-access', permissionConflict: expect.stringContaining('不在') });
    expect(f.selected.get(record.sessionId)).toBe('danger-full-access');
    await expect(f.service.unarchive(f.key, 'old-session')).rejects.toThrow('已更新');
    expect(registry.unarchiveSession).not.toHaveBeenCalled();
    await f.service.unarchive(f.key, record.sessionId);
    expect(registry.unarchiveSession).toHaveBeenCalledExactlyOnceWith(record.sessionId);
    expect(record.agent.followup).not.toHaveBeenCalled();
  });
  it('updates recording independently during active work without cancelling or changing policy authorization', async () => {
    const f = fixture(); const record = await f.current(); const before = f.service.requireEntry(f.key);
    Object.assign(record.agent, { status: 'running' });
    f.service.store.updateRecording(f.key, before.recording!.version, { enabled: false, retentionDays: 3 });
    expect(f.service.requireEntry(f.key).policy).toEqual(before.policy);
    expect(record.agent.cancel).not.toHaveBeenCalled();
    expect(f.service.requireEntry(f.key).recording).toMatchObject({ enabled: false, retentionDays: 3, version: before.recording!.version + 1 });
  });

  it('selects a real workspace via a fresh Session, keeps history and inherits it on /new', async () => {
    const f = fixture(); const old = await f.current();
    expect(f.service.currentPermission(old)).toBe('read-only');
    const next = await f.service.selectWorkspace(f.key, 'a');
    expect(next.sessionId).not.toBe(old.sessionId);
    expect(f.create.mock.calls.at(-1)?.[0].meta?.cwd).toBe(f.workspaces.get('a')?.path);
    expect(f.workspaces.get('a')?.attachSession).toHaveBeenCalledWith(next.sessionId);
    const entry = f.service.requireEntry(f.key);
    expect(entry.workspaceId).toBe('a'); expect(entry.sessions).toHaveLength(2);
    expect(entry.sessions.find(row => row.sessionId === old.sessionId)?.endedAt).toEqual(expect.any(Number));
    expect(f.handles.get(old.sessionId)?.dispose).toHaveBeenCalledOnce();
    await f.manager.remove('group', 'g');
    const newest = await f.current();
    expect(newest.sessionId).not.toBe(next.sessionId);
    expect(f.create.mock.calls.at(-1)?.[0].meta?.cwd).toBe(f.workspaces.get('a')?.path);
    const restored = new ConversationStore(f.root, 'fixture').get(f.key);
    expect(restored?.workspaceId).toBe('a'); expect(restored?.currentSessionId).toBe(newest.sessionId);
  });
  it('keeps the original live Session on missing workspace, busy, or attachment failure', async () => {
    const f = fixture(); const old = await f.current();
    await expect(f.service.selectWorkspace(f.key, 'missing')).rejects.toThrow('不存在');
    const release = f.service.reserveTrigger(f.key);
    await expect(f.service.selectWorkspace(f.key, 'a')).rejects.toThrow('生成'); release();
    f.workspaces.get('a')!.attachSession.mockRejectedValueOnce(new Error('disk error'));
    await expect(f.service.selectWorkspace(f.key, 'a')).rejects.toThrow('disk error');
    expect(f.service.requireEntry(f.key).currentSessionId).toBe(old.sessionId);
    expect(f.manager.getSessionRecord('group', 'g')).toBe(old);
    expect(f.handles.get(old.sessionId)?.dispose).not.toHaveBeenCalled();
  });
  it('uses native catalog IDs only for this Session and does not rewrite group defaults', async () => {
    const f = fixture(); const record = await f.current();
    const base = f.service.requireEntry(f.key).policy;
    f.service.store.updatePolicy(f.key, base.version, { ...base, nativeTools: true, allowedPermissions: ['read-only', 'workspace-write', 'danger-full-access', 'custom'] });
    // Native conversations follow the host permission presets: a real catalog id is applied directly,
    // only genuinely unavailable ids are rejected, and other conversations keep their own default.
    await f.service.selectPermission(f.key, 'custom');
    expect(f.set).toHaveBeenLastCalledWith(record.agent.session, 'custom');
    await f.service.selectPermission(f.key, 'danger-full-access');
    expect(f.set).toHaveBeenLastCalledWith(record.agent.session, 'danger-full-access');
    await expect(f.service.selectPermission(f.key, 'guessed')).rejects.toThrow('不可用');
    const other = await f.manager.getOrCreate('group', 'other', 'actor', { scope: 'group', targetId: 'other' });
    expect(f.service.currentPermission(other)).toBe('read-only');
    const changed = f.service.requireEntry(f.key);
    f.service.updatePolicy(f.key, changed.policy.version, { ...changed.policy, name: 'rename' }, changed.alias);
    expect(f.service.currentPermission(record)).toBe('danger-full-access');
    const revoked = f.service.requireEntry(f.key);
    f.service.updatePolicy(f.key, revoked.policy.version, { ...revoked.policy, receiveEnabled: false }, '');
    const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'QQ input after revocation' }] });
    await expect(f.service.enqueueQQ(record, message, { messageId: 'msg', senderId: 'actor' }, 0, [])).rejects.toThrow('停止回复');
  });
  it('does not roll back a concurrent revocation when native Session creation fails', async () => {
    const f = fixture(); await f.current();
    let enter!: () => void; let fail!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { fail = resolve; });
    vi.spyOn(f.manager, 'replaceSession').mockImplementation(async () => { enter(); await gate; throw new Error('creation failed'); });
    const entry = f.service.requireEntry(f.key);
    const save = f.service.savePolicy(f.key, entry.policy.version, { ...entry.policy, toolMode: 'native', tools: { read: 'allow' } }, '');
    await entered;
    const concurrent = f.service.requireEntry(f.key);
    f.service.updatePolicy(f.key, concurrent.policy.version, { ...concurrent.policy, tools: { read: 'deny' }, receiveEnabled: false }, 'revoked');
    fail(); await expect(save).rejects.toThrow('creation failed');
    expect(f.service.requireEntry(f.key)).toMatchObject({ alias: 'revoked', policy: { tools: { read: 'deny' }, receiveEnabled: false } });
  });
  it('rejects stale UI controls, and native capability mode starts a new Agent without replacing its executor', async () => {
    const f = fixture(); const old = await f.current();
    const p = f.service.requireEntry(f.key).policy;
    const callsBefore = f.tools.setExecutor.mock.calls.length;
    await f.service.savePolicy(f.key, p.version, { ...p, toolMode: 'native', tools: { read: 'allow' } }, '');
    expect(f.service.requireEntry(f.key).currentSessionId).not.toBe(old.sessionId);
    expect(f.tools.setExecutor.mock.calls.length).toBe(callsBefore);
    expect(() => f.service.assertCurrentSession(f.key, old.sessionId)).toThrow('已更新');
    expect(f.service.requireEntry(f.key).policy.tools).toEqual({ read: 'allow' });
  });
});
