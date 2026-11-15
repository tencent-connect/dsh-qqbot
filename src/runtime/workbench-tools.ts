import type { Context } from '@deepseek-ai/cordis';
import type { DshAgent, DshAgentRegistry } from '../session/index.ts';
import { WORKBENCH_BASE_PERMISSIONS, type WorkbenchAgentSettings, type WorkbenchToolChoice } from '../shared/workbench-agent-settings.ts';

type ToolDefinition = Readonly<WorkbenchToolChoice>;
interface ToolExecutor {
  describe(tools: readonly ToolDefinition[]): { schemas: readonly ToolDefinition[] };
  execute(input: unknown): unknown;
}
interface Tools {
  definitions(scope?: object): readonly ToolDefinition[];
  guard(check: (execution: { name: string; agent?: object }) => string | undefined): () => void;
  setExecutor?(executor: ToolExecutor): () => void;
  overrideExecutor?(executor: ToolExecutor): () => void;
}
interface Permissions {
  current(session: unknown): string;
}
interface PresetScope {
  readonly defaultId: string;
  acquireScope(id?: string): Promise<{ key: object } & AsyncDisposable>;
}
interface SessionLineage {
  stat(id: string): Promise<{ header: { parentSession?: string } } | undefined>;
}
type NativeExecutor = new (ctx: Context) => ToolExecutor;
const nativeModule = '@deepseek-ai/dsh-tool-executor-native';
let native: Promise<NativeExecutor> | undefined;

function loadNative(): Promise<NativeExecutor> {
  return native ??= import(nativeModule).then(module => {
    if (typeof module.NativeToolExecutor !== 'function') throw new Error('当前 DSH 缺少原生工具执行器。');
    return module.NativeToolExecutor as NativeExecutor;
  }, () => { throw new Error('当前 DSH 缺少原生工具执行器。'); });
}

// Delegation can outlive the calling Agent or use a different provider. The
// PTC transport is not a capability that can appear in a custom tool list.
const excluded = new Set(['run_code', 'subagent', 'spawn_agent', 'send_message', 'interrupt_agent', 'workflow', 'plugin_manager']);
const usable = (name: string): boolean => !excluded.has(name) && !name.startsWith('subagent_') && !name.startsWith('schedule_');
const nativePermissionEvents = new Set(['permission/preset', 'sandbox/mode', 'approval/policy']);
const definitions = (ctx: Context): Tools | undefined => ctx.get('tools') as Tools | undefined;
const presetOf = (agent: DshAgent): string | undefined => agent.session.header?.agentPreset;

export async function workbenchToolChoices(ctx: Context, preset?: string): Promise<WorkbenchToolChoice[]> {
  const tools = definitions(ctx);
  if (!tools?.guard || !tools.setExecutor) throw new Error('当前 DSH 不支持会话级工具限制。');
  const presets = ctx.get('agentPresets') as PresetScope | undefined;
  if (!presets) throw new Error('无法读取 DSH Agent 预设。');
  const id = preset || presets.defaultId;
  if (!tools.overrideExecutor && id !== 'standard') throw new Error('当前 DSH 仅支持标准模式使用自定义工具。');
  await loadNative();
  await using lease = await presets.acquireScope(id);
  return tools.definitions(lease.key).filter(tool => usable(tool.name)).map(({ name, description }) => ({
    name, ...(description ? { description: description.slice(0, 500) } : {}),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

function rank(permission: string): number {
  return WORKBENCH_BASE_PERMISSIONS.findIndex(value => value === permission);
}

function expands(from: WorkbenchAgentSettings | undefined, to: WorkbenchAgentSettings | undefined): boolean {
  if (from?.tools === undefined) return false;
  const tools = from.tools;
  return to?.tools === undefined || to.tools.some(name => !tools.includes(name))
    || rank(to.permission) > rank(from.permission);
}

export class WorkbenchToolPolicies {
  private readonly installed = new WeakMap<DshAgent, {
    release(): void;
    replaceable: boolean;
    withinNativeCap(): boolean;
  }>();
  private readonly owners = new WeakMap<DshAgent, string>();

  constructor(
    private readonly ctx: Context,
    private readonly agents: DshAgentRegistry,
    private readonly read: (key: string) => WorkbenchAgentSettings | undefined,
    private readonly owner: (id: string) => string | undefined,
  ) {
    const lifecycle = ctx as unknown as {
      on(event: 'agent/created' | 'agent/disposed', handler: (event: { agent: DshAgent }) => void | Promise<void>, options: { global: true }): void;
      on(event: 'session/event', handler: (session: DshAgent['session'], event: { type: string }) => void, options: { global: true }): void;
    };
    lifecycle.on('agent/created', async ({ agent }) => {
      const key = await this.resolveOwner(agent);
      if (key) await this.attach(agent, key);
    }, { global: true });
    lifecycle.on('agent/disposed', ({ agent }) => {
      this.owners.delete(agent);
      this.installed.delete(agent);
    }, { global: true });
    lifecycle.on('session/event', (session, event) => {
      if (!nativePermissionEvents.has(event.type)) return;
      const agent = this.agents.get(session.id);
      if (agent?.session !== session || agent.status !== 'running') return;
      if (this.installed.get(agent)?.withinNativeCap() === false) {
        // Cancel synchronously so work already past the guard cannot start.
        agent.cancel({ kind: 'user' }, { keepInbox: true });
      }
    }, { global: true });
  }

  private knownOwner(agent: DshAgent): string | undefined {
    return this.owners.get(agent) ?? this.owner(agent.id);
  }

  private async resolveOwner(agent: DshAgent): Promise<string | undefined> {
    const direct = this.knownOwner(agent);
    if (direct !== undefined) return direct;
    const seen = new Set([agent.id]);
    let parent = agent.session.header?.parentSession;
    while (parent !== undefined && !seen.has(parent)) {
      seen.add(parent);
      const live = this.agents.get(parent);
      const key = live ? this.knownOwner(live) : this.owner(parent);
      if (key !== undefined) return key;
      const lineage = this.ctx.get('sessionPersistence') as SessionLineage | undefined;
      parent = live ? live.session.header?.parentSession : (await lineage?.stat(parent))?.header.parentSession;
    }
    return undefined;
  }

  async restoreLive(onlyKey?: string): Promise<void> {
    for (const agent of this.agents.list?.() ?? []) {
      const key = await this.resolveOwner(agent);
      if (key && (onlyKey === undefined || onlyKey === key) && this.agents.get(agent.id) === agent) await this.attach(agent, key);
    }
  }

  async attach(agent: DshAgent, key: string, force = false): Promise<void> {
    this.owners.set(agent, key);
    if (this.installed.has(agent) || (!force && this.read(key)?.tools === undefined)) return;
    const tools = definitions(agent.ctx);
    const permission = agent.ctx.get('permissionPresets') as Permissions | undefined;
    if (!tools?.guard || !permission?.current) throw new Error('当前 DSH 无法约束 QQ 会话的工具执行。');
    // Older Hosts can supply a scoped executor but cannot restore the previous
    // executor. Only keep a pass-through replacement for the standard preset.
    const replaceable = typeof tools.overrideExecutor === 'function';
    if (!replaceable && (!tools.setExecutor || presetOf(agent) !== 'standard')) {
      throw new Error('当前 DSH 无法为此 Agent 预设启用自定义工具。');
    }
    const Native = await loadNative();
    if (this.installed.has(agent)) return;
    const executor = new Native(agent.ctx);
    const withinCap = (policy: WorkbenchAgentSettings): boolean => {
      const limit = rank(policy.permission);
      const actual = rank(permission.current(agent.session));
      return actual >= 0 && limit >= actual;
    };
    const allows = (policy: WorkbenchAgentSettings | undefined, name: string): boolean =>
      policy?.tools === undefined || (usable(name) && policy.tools.includes(name) && withinCap(policy));
    const unguard = tools.guard(execution => {
      try {
        const policy = this.read(key);
        return (policy?.tools === undefined || (execution.agent === agent && allows(policy, execution.name))) ? undefined : '此 QQ 会话未允许该工具，或当前原生权限超出基础权限。';
      } catch { return '无法验证此 QQ 会话的工具权限。'; }
    });
    try {
      const select = replaceable ? tools.overrideExecutor! : tools.setExecutor!;
      const deselect = select.call(tools, {
        describe: definitions => {
          const policy = this.read(key);
          return executor.describe(definitions.filter(tool => allows(policy, tool.name)));
        },
        execute: input => executor.execute(input),
      });
      this.installed.set(agent, {
        replaceable,
        release: () => { deselect(); unguard(); },
        withinNativeCap: () => {
          try {
            const policy = this.read(key);
            return policy?.tools === undefined || withinCap(policy);
          } catch { return false; }
        },
      });
    } catch (error) {
      unguard();
      throw error;
    }
  }

  private live(key: string, sessions: readonly string[]): DshAgent[] {
    const roots = new Set(sessions);
    return (this.agents.list?.() ?? sessions.flatMap(id => this.agents.get(id) ?? []))
      .filter(agent => roots.has(agent.id) || this.knownOwner(agent) === key);
  }

  async beforeSave(key: string, sessions: readonly string[], next: WorkbenchAgentSettings): Promise<() => () => void> {
    const previous = this.read(key);
    if (next.tools === undefined && previous?.tools === undefined) return () => () => {};
    if (!this.agents.list) throw new Error('当前 DSH 无法验证运行中的子 Agent 工具权限。');
    const widening = expands(previous, next);
    const narrowing = expands(next, previous);
    const checkIdle = (live: readonly DshAgent[]) => {
      if (widening && live.some(agent => agent.status !== 'idle')) throw new Error('会话正在运行，请在空闲后扩大工具权限。');
    };
    await this.restoreLive(key);
    const live = this.live(key, sessions);
    checkIdle(live);
    if (next.tools !== undefined) for (const agent of live) {
      if (this.agents.get(agent.id) === agent) await this.attach(agent, key, true);
    }
    return () => {
      const current = this.live(key, sessions);
      checkIdle(current);
      if (next.tools !== undefined && current.some(agent => !this.installed.has(agent))) {
        throw new Error('会话已重新打开，请重试保存。');
      }
      // Host guards run before dispatch wrappers such as the async checkpoint.
      // Fence work already admitted by the old policy after the write succeeds.
      return () => {
        if (narrowing) for (const agent of current) {
          if (agent.status === 'running') agent.cancel({ kind: 'user' }, { keepInbox: true });
        }
      };
    };
  }

  reconcile(key: string, sessions: readonly string[]): void {
    if (this.read(key)?.tools !== undefined) return;
    for (const agent of this.live(key, sessions)) {
      const installed = this.installed.get(agent);
      if (installed?.replaceable) {
        installed.release();
        this.installed.delete(agent);
      }
    }
  }
}
