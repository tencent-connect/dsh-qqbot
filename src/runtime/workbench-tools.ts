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
const excluded = new Set(['run_code', 'subagent', 'subagent_fork', 'spawn_agent', 'send_message', 'workflow', 'plugin_manager']);
const usable = (name: string): boolean => !excluded.has(name) && !name.startsWith('schedule_');
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

export class WorkbenchToolPolicies {
  private readonly installed = new WeakMap<DshAgent, { release(): void; replaceable: boolean }>();
  private readonly owners = new Map<string, string>();

  constructor(
    ctx: Context,
    private readonly agents: DshAgentRegistry,
    private readonly read: (key: string) => WorkbenchAgentSettings | undefined,
    owner: (id: string) => string | undefined,
  ) {
    const lifecycle = ctx as unknown as {
      on(event: 'agent/created' | 'agent/disposed', handler: (event: { agent: DshAgent }) => void | Promise<void>, options: { global: true }): void;
    };
    lifecycle.on('agent/created', async ({ agent }) => {
      const parent = agent.session.header?.parentSession;
      const key = this.owners.get(agent.id) ?? owner(agent.id)
        ?? (parent && (this.owners.get(parent) ?? owner(parent)));
      if (key && read(key)?.tools !== undefined) await this.attach(agent, key);
    }, { global: true });
    lifecycle.on('agent/disposed', ({ agent }) => {
      this.owners.delete(agent.id);
      this.installed.delete(agent);
    }, { global: true });
  }

  async attach(agent: DshAgent, key: string, force = false): Promise<void> {
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
    const allows = (name: string): boolean => {
      const policy = this.read(key);
      if (policy?.tools === undefined) return true;
      if (!usable(name) || !policy.tools.includes(name)) return false;
      const limit = rank(policy.permission);
      const actual = rank(permission.current(agent.session));
      return actual >= 0 && limit >= actual;
    };
    const unguard = tools.guard(execution => {
      try {
        return (this.read(key)?.tools === undefined || (execution.agent === agent && allows(execution.name))) ? undefined : '此 QQ 会话未允许该工具，或当前原生权限超出基础权限。';
      } catch { return '无法验证此 QQ 会话的工具权限。'; }
    });
    try {
      const select = replaceable ? tools.overrideExecutor! : tools.setExecutor!;
      const deselect = select.call(tools, {
        describe: definitions => executor.describe(definitions.filter(tool => allows(tool.name))),
        execute: input => executor.execute(input),
      });
      this.installed.set(agent, { replaceable, release: () => { deselect(); unguard(); } });
      this.owners.set(agent.id, key);
    } catch (error) {
      unguard();
      throw error;
    }
  }

  async beforeSave(key: string, sessions: readonly string[], next: WorkbenchAgentSettings): Promise<() => void> {
    const live = () => sessions.flatMap(id => {
      const agent = this.agents.get(id);
      return agent ? [agent] : [];
    });
    const checkIdle = () => {
      const current = this.read(key);
      const previous = current?.tools;
      const widens = current && previous !== undefined && (next.tools === undefined
        || next.tools.some(name => !previous.includes(name)) || rank(next.permission) > rank(current.permission));
      if (widens && live().some(agent => agent.status !== 'idle')) throw new Error('会话正在运行，请在空闲后扩大工具权限。');
    };
    checkIdle();
    if (next.tools !== undefined) for (const agent of live()) await this.attach(agent, key, true);
    return () => {
      checkIdle();
      if (next.tools !== undefined && live().some(agent => !this.installed.has(agent))) {
        throw new Error('会话已重新打开，请重试保存。');
      }
    };
  }

  reconcile(key: string, sessions: readonly string[]): void {
    if (this.read(key)?.tools !== undefined) return;
    for (const id of sessions) {
      const agent = this.agents.get(id);
      const installed = agent && this.installed.get(agent);
      if (agent && installed?.replaceable) {
        installed.release();
        this.installed.delete(agent);
      }
    }
  }
}
