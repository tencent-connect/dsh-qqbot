import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { setSandboxMode, type SandboxMode } from '@deepseek-ai/dsh-sandbox-policy';
import { setApprovalPolicy, type ApprovalPolicy } from '@deepseek-ai/dsh-user-approval';
import { ConfigSchema } from '../config.ts';
import type { SessionManager } from '../session/session-manager.ts';
import type { SessionRecord } from '../session/types.ts';
import { QQ_EXTRA_PROMPT_MAX_CHARS } from '../shared/agent-settings.ts';
import { ConversationService } from './conversation-service.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'qq-live-settings-')); roots.push(root);
  const session = Session.create(SessionId('current'));
  let route = { provider: 'p', model: 'old' };
  let current: SessionRecord | undefined;
  const services: Record<string, unknown> = {};
  const tools = { definitions: () => [{ name: 'read' }], restrict: () => () => {}, guard: () => () => {} };
  const ctx = { on: () => () => {}, get: (name: string) => name === 'tools' ? tools : name === 'sessions' ? { get: () => session } : name === 'agents' ? { get: () => current?.agent } : services[name] } as unknown as Context;
  const config = ConfigSchema({ appId: 'settings', appSecret: 'dummy', cwd: root, groupPrompt: 'old scope', access: { groupMode: 'open', c2cMode: 'open' } });
  const manager = { getDefaultModel: () => ({ provider: 'p', model: 'old' }), getDefaultPreset: () => 'standard', getEffectiveModel: () => route,
    getStatus: () => ({ active: !!current, preset: 'standard', nextPreset: 'chosen' }), findBySessionId: () => current, getSessionRecord: () => current,
    restoreExisting: async () => current, validateModelSetting: async (value: typeof route) => value, listPresets: async () => [{ id: 'standard' }, { id: 'chosen' }],
  } as unknown as SessionManager;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const service = new ConversationService(ctx, manager, config, logger, root); manager.conversations = service;
  const entry = service.entry('group', 'g');
  const select = vi.fn((value: typeof route) => { route = value; });
  const agent = { id: session.id, session, ctx, status: 'idle' as const, model: { current: () => route, select }, inbox: { nextTurn: [], nextStep: [] }, cancel: vi.fn(), followup: vi.fn(), whenIdle: async () => {}, runMaintenance: async <T>(task: (signal: AbortSignal) => Promise<T>) => task(new AbortController().signal) };
  current = { sessionKey: entry.key, sessionId: session.id, scope: 'group', peerId: 'g', senderId: 'actor', replyTarget: { scope: 'group', targetId: 'g' }, lastActivity: Date.now(), agent, handle: { agent, dispose: async () => {} } };
  service.attach(current);
  const failCatalogSave = () => {
    const name = readdirSync(root).find(value => value.startsWith('conversations-') && value.endsWith('.json'));
    if (!name) throw new Error('Conversation catalog missing');
    const path = join(root, name);
    renameSync(path, `${path}.original`);
    mkdirSync(path);
  };
  return { service, key: entry.key, agent, select, session, config, services, failCatalogSave };
}

describe('idle per-peer Agent settings', () => {
  it('applies model and native setters; extra prompt applies immediately while cwd/preset defer to the next Session', async () => {
    const f = fixture(); const before = f.service.requireEntry(f.key);
    const tail = 'LAST_GROUP_INSTRUCTION';
    const prompt = 'x'.repeat(QQ_EXTRA_PROMPT_MAX_CHARS - tail.length) + tail;
    const settings = { ...before.settings!, model: { provider: 'p', model: 'new' }, promptGroup: prompt, promptDirect: 'PRIVATE_SCOPE_ONLY', cwd: '/tmp/next-cwd', preset: 'chosen', execution: { kind: 'native' as const, permission: 'workspace-write' as const }, slashCommands: false };
    const notice = await f.service.saveSettings(f.key, before.policy.version, settings, 'alias', true);
    expect(notice).toContain('新会话生效');
    expect(f.select).toHaveBeenCalledExactlyOnceWith(settings.model);
    expect(f.session.snapshotEvents()).toContainEqual(expect.objectContaining({ type: 'sandbox/mode', data: { mode: 'workspace-write' } }));
    expect(f.session.snapshotEvents()).toContainEqual(expect.objectContaining({ type: 'approval/policy', data: { policy: 'ask' } }));
    // 补充提示词即时生效：保存后当前 session 的人设 prompt 立刻反映新值。
    expect(f.service.rolePrompt(f.session.id)).toContain(prompt);
    expect(f.service.rolePrompt(f.session.id)).not.toContain('PRIVATE_SCOPE_ONLY');
    expect(f.service.requireEntry(f.key).currentSessionId).toBe(f.session.id);
    expect(f.service.requireEntry(f.key).settings).toEqual(settings);
    expect(f.agent.cancel).not.toHaveBeenCalled();
    expect(f.service.slashAllowed('group', 'g', 'actor')).toBe(false);
    f.service.store.setOwnerIds(['superadmin']);
    expect(f.service.slashAllowed('group', 'g', 'superadmin')).toBe(true);
    f.service.store.bindSession(f.key, 'next'); expect(f.service.rolePrompt('next')).toContain(prompt);
  });
  it.each(['promptGroup', 'promptDirect'])('rejects an over-limit %s before changing live or persisted settings', async field => {
    const f = fixture();
    const before = f.service.requireEntry(f.key);
    const events = f.session.snapshotEvents();
    const settings = { ...before.settings!, [field]: 'x'.repeat(QQ_EXTRA_PROMPT_MAX_CHARS + 1), model: { provider: 'p', model: 'new' } };
    await expect(f.service.saveSettings(f.key, before.policy.version, settings, 'rejected alias', false)).rejects.toThrow('不能超过 80000 个字符');
    expect(f.service.requireEntry(f.key)).toEqual(before);
    expect(f.session.snapshotEvents()).toEqual(events);
    expect(f.select).not.toHaveBeenCalled();
  });
  it('rejects busy edits and recording conflicts before changing live or persisted settings', async () => {
    const f = fixture(); const before = f.service.requireEntry(f.key);
    const settings = { ...before.settings!, model: { provider: 'p', model: 'new' } };
    Object.assign(f.agent, { status: 'running' });
    await expect(f.service.saveSettings(f.key, before.policy.version, settings, '', true)).rejects.toThrow('正在生成');
    Object.assign(f.agent, { status: 'idle' });
    expect(f.service.requireEntry(f.key)).toEqual(before); expect(f.select).not.toHaveBeenCalled();
  });
  it.each([
    { permissions: 'absent', pendingChange: false },
    { permissions: 'named', pendingChange: false },
    { permissions: 'derived custom', pendingChange: false },
    { permissions: 'absent', pendingChange: true },
  ])('restores actual native knobs and model after a catalog write fails with $permissions permissions and pending change $pendingChange', async ({ permissions, pendingChange }) => {
    const f = fixture();
    let identity = 'reviewed-full-access';
    if (permissions !== 'absent') {
      const bundles = new Map<string, { sandbox: SandboxMode; approval: ApprovalPolicy }>([
        ['reviewed-full-access', { sandbox: 'danger-full-access', approval: 'ask' }],
        ['workspace-write', { sandbox: 'workspace-write', approval: 'ask' }],
      ]);
      f.services.permissionPresets = {
        catalog: () => ({ options: [...bundles.keys(), 'custom'].map(value => ({ value })) }),
        current: () => permissions === 'derived custom' ? 'custom' : identity,
        set: (session: Session, value: string) => {
          const bundle = bundles.get(value);
          if (!bundle) throw new Error('Unknown permission preset');
          identity = value;
          session.append('permission/preset', { preset: value });
          setSandboxMode(session, bundle.sandbox);
          setApprovalPolicy(session, bundle.approval);
        },
      };
      f.session.append('permission/preset', { preset: identity });
    }
    setSandboxMode(f.session, pendingChange ? 'read-only' : 'danger-full-access');
    setApprovalPolicy(f.session, 'ask');
    const before = f.service.requireEntry(f.key);
    f.failCatalogSave();
    let maintenanceEntered = () => {};
    let continueMaintenance = () => {};
    const entered = new Promise<void>(resolve => { maintenanceEntered = resolve; });
    const continuation = new Promise<void>(resolve => { continueMaintenance = resolve; });
    if (pendingChange) vi.spyOn(f.agent, 'runMaintenance').mockImplementation(async task => {
      maintenanceEntered();
      await continuation;
      return task(new AbortController().signal);
    });
    const saving = f.service.saveSettings(f.key, before.policy.version, {
      ...before.settings!, model: { provider: 'p', model: 'new' },
      execution: { kind: 'native', permission: 'workspace-write' },
    }, 'rejected alias', true);
    if (pendingChange) {
      await entered;
      setSandboxMode(f.session, 'danger-full-access');
      setApprovalPolicy(f.session, 'ask');
      continueMaintenance();
    }
    await expect(saving).rejects.toThrow(/EISDIR|rename/);
    expect(f.service.requireEntry(f.key)).toEqual(before);
    expect(f.agent.model.current()).toEqual({ provider: 'p', model: 'old' });
    expect(f.session.snapshotEvents().filter(event => event.type === 'sandbox/mode').at(-1)?.data).toEqual({ mode: 'danger-full-access' });
    expect(f.session.snapshotEvents().filter(event => event.type === 'approval/policy').at(-1)?.data).toEqual({ policy: 'ask' });
    if (permissions === 'named') {
      expect(identity).toBe('reviewed-full-access');
      expect(f.session.snapshotEvents().filter(event => event.type === 'permission/preset').at(-1)?.data).toEqual({ preset: 'reviewed-full-access' });
    }
  });
  it('reports that the global access gate still blocks a locally enabled peer', async () => {
    const f = fixture(); f.config.access.groupMode = 'disabled'; const before = f.service.requireEntry(f.key);
    const notice = await f.service.saveSettings(f.key, before.policy.version, before.settings, '', true);
    expect(f.service.admitted('group', 'g')).toBe(false); expect(notice).toContain('全局访问规则阻止');
  });
});
