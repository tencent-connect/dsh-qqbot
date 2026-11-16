import { describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import type { DshAgent, DshAgentRegistry } from '../session/index.ts';
import type { WorkbenchAgentSettings } from '../shared/workbench-agent-settings.ts';
import { WorkbenchToolPolicies } from './workbench-tools.ts';

vi.mock('@deepseek-ai/dsh-tool-executor-native', () => ({
  NativeToolExecutor: class {
    describe(tools: readonly { name: string }[]) { return { schemas: tools }; }
    execute() { throw new Error('Execution uses the Host pipeline in the integration test'); }
  },
}));

const key = 'qqbot:app:group:peer';
const peer = 'qqbot:other:c2c:peer';
const custom: WorkbenchAgentSettings = {
  model: null, reasoningEffort: '', preset: 'ptc', cwd: '', permission: 'workspace-write',
  tools: ['read', 'write'], groupPrompt: '', directPrompt: '', streaming: false, showToolResults: false,
};
const native = { ...custom, tools: undefined };
const narrow = { ...custom, tools: ['read'] };

type Execution = { name: string; agent: object };
function fixture(initial = native) {
  const saved = new Map([[key, initial], [peer, native]]);
  const live = new Map<string, DshAgent>();
  const events = new Map<string, (event: { agent: DshAgent }) => unknown>();
  type SessionListener = (session: DshAgent['session'], event: { type: string }) => void;
  let observeSession: SessionListener | undefined;
  const stored = new Map<string, { header: { parentSession?: string } }>();
  const ctx = {
    on(event: string, callback: SessionListener & ((event: { agent: DshAgent }) => unknown)) {
      if (event === 'session/event') observeSession = callback;
      else events.set(event, callback);
    },
    get: (name: string) => name === 'sessionPersistence' ? { stat: async (id: string) => stored.get(id) } : undefined,
    effect: vi.fn(),
  };
  const registry = { get: (id: string) => live.get(id), list: () => [...live.values()] };
  const policies = new WorkbenchToolPolicies(ctx as unknown as Context, registry as DshAgentRegistry,
    id => saved.get(id), id => id === 'root' ? key : id === 'independent' ? peer : undefined);
  async function start(id: string, parentSession?: string, broken: boolean | 'legacy' = false) {
    let check: ((exec: Execution) => string | undefined) | undefined;
    let describe = (tools: readonly { name: string }[]) => ({ schemas: tools });
    let permission = 'workspace-write';
    const signal = new AbortController();
    const tools = {
      guard(fn: typeof check) { check = fn; return () => { check = undefined; }; },
      overrideExecutor(executor: { describe: typeof describe }) {
        if (broken) throw new Error('no executor');
        describe = executor.describe;
        return () => { describe = entries => ({ schemas: entries }); };
      },
    };
    if (broken === 'legacy') Reflect.deleteProperty(tools, 'overrideExecutor');
    const cancel = vi.fn(() => signal.abort());
    const simulated = { id, status: 'running', session: { id, header: { agentPreset: 'ptc', parentSession } }, cancel,
      ctx: { get: (name: string) => name === 'tools' ? tools : { current: () => permission } } };
    const agent = simulated as unknown as DshAgent;
    live.set(id, agent);
    stored.set(id, { header: { parentSession } });
    try { await events.get('agent/created')?.({ agent }); }
    catch (error) { live.delete(id); throw error; }
    return { cancel, signal: signal.signal, setIdle: () => { simulated.status = 'idle'; },
      setPermission: (next: string, type = 'permission/preset') => {
        permission = next;
        observeSession?.(agent.session, { type });
      },
      guard: (name: string) => check?.({ name, agent }),
      tools: () => describe(['read', 'write', 'subagent', 'run_code'].map(name => ({ name }))).schemas.map(tool => tool.name),
      dispose() { events.get('agent/disposed')?.({ agent }); live.delete(id); },
    };
  }
  async function save(policy: WorkbenchAgentSettings) {
    const check = await policies.beforeSave(key, ['root'], policy);
    const afterSave = check();
    saved.set(key, policy);
    afterSave?.();
    policies.reconcile(key, ['root']);
  }
  return { start, save, policies };
}

describe('QQ custom tool permissions', () => {
  it('restricts already live descendants when switching from native and leaves other conversations alone', async () => {
    const { start, save } = fixture();
    const root = await start('root');
    const child = await start('child', 'root');
    const grandchild = await start('grandchild', 'child');
    const independent = await start('independent');
    await save(narrow);
    for (const agent of [root, child, grandchild]) {
      expect(agent.tools()).toEqual(['read']);
      expect(agent.guard('write')).toMatch(/未允许/);
      expect(agent.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true });
    }
    expect(independent.guard('write')).toBeUndefined();
    expect(independent.cancel).not.toHaveBeenCalled();
  });

  it('fences a call admitted before narrowing without undoing work that already started', async () => {
    const { start, save } = fixture(custom);
    const root = await start('root');
    const invoked = vi.fn();
    expect(root.guard('write')).toBeUndefined();
    invoked('already started');
    const waitingToDispatch = () => { if (!root.signal.aborted) invoked('still waiting'); };
    await save(narrow);
    waitingToDispatch();
    expect(invoked.mock.calls).toEqual([['already started']]);
    expect(root.guard('write')).toMatch(/未允许/);
  });

  it.each([
    ['permission/preset', 'danger-full-access'],
    ['sandbox/mode', 'danger-full-access'],
    ['approval/policy', 'custom'],
  ])('cancels an admitted call when %s leaves the base permission', async (event, permission) => {
    const { start } = fixture(custom);
    const root = await start('root');
    const independent = await start('independent');
    expect(root.guard('write')).toBeUndefined();

    root.setPermission(permission, event);
    expect(root.tools()).toEqual([]);
    expect(root.cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true });
    expect(independent.cancel).not.toHaveBeenCalled();

    root.setPermission('workspace-write');
    expect(root.signal.aborted).toBe(true);
    expect(root.tools()).toEqual(['read', 'write']);
  });

  it('keeps running when native permission stays within the cap or the Session has no custom policy', async () => {
    const { start } = fixture(custom);
    const root = await start('root');
    root.setPermission('read-only');
    expect(root.cancel).not.toHaveBeenCalled();
    const independent = await start('independent');
    independent.setPermission('danger-full-access');
    expect(independent.cancel).not.toHaveBeenCalled();
  });

  it('recovers QQ ownership for a child reopened after its ancestor is disposed', async () => {
    const { start } = fixture(narrow);
    const root = await start('root');
    const child = await start('child', 'root');
    child.dispose();
    root.dispose();
    const reopened = await start('grandchild', 'child');
    expect(reopened.tools()).toEqual(['read']);
    expect(reopened.guard('write')).toMatch(/未允许/);
    reopened.setPermission('danger-full-access');
    expect(reopened.tools()).toEqual([]);
    expect(reopened.guard('read')).toMatch(/基础权限/);
  });

  it('refuses to activate the policy when one descendant cannot mount its executor', async () => {
    const { start, save } = fixture();
    const root = await start('root');
    await start('child', 'root', true);
    await expect(save(narrow)).rejects.toThrow('no executor');
    expect(root.guard('write')).toBeUndefined();
    expect(root.cancel).not.toHaveBeenCalled();
  });

  it('releases a robot policy and descendants while keeping the original native Sessions open', async () => {
    const { start, policies } = fixture(narrow);
    const root = await start('root');
    const child = await start('child', 'root');
    const other = await start('independent');
    for (const agent of [root, child]) expect(agent.tools()).toEqual(['read']);
    policies.detachAccount('app');
    for (const agent of [root, child]) {
      expect(agent.tools()).toEqual(['read', 'write', 'subagent', 'run_code']);
      expect(agent.guard('write')).toBeUndefined();
      expect(agent.signal.aborted).toBe(true);
    }
    expect(other.cancel).not.toHaveBeenCalled();
    const later = await start('later-child', 'root');
    expect(later.guard('write')).toBeUndefined();
  });

  it('contains an unsupported policy and releases the deny guard on disable', async () => {
    const { start, policies } = fixture(narrow);
    const restricted = await start('root', undefined, 'legacy');
    const independent = await start('independent', undefined, 'legacy');
    expect(restricted.guard('read')).toContain('更新 DSH');
    expect(independent.guard('write')).toBeUndefined();
    expect(independent.cancel).not.toHaveBeenCalled();
    policies.close();
    expect(restricted.guard('read')).toBeUndefined();
  });

  it('rejects widening while a child is running and leaves a no-op save alone', async () => {
    const { start, save } = fixture(narrow);
    const root = await start('root');
    const child = await start('child', 'root');
    root.setIdle();
    await save({ ...narrow, groupPrompt: 'unrelated change' });
    expect(child.cancel).not.toHaveBeenCalled();
    await expect(save(custom)).rejects.toThrow('请在空闲后扩大工具权限');
    expect(child.guard('write')).toMatch(/未允许/);
  });
});
