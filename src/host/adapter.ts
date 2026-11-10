/**
 * 宿主 API 适配层 — 收口所有版本漂移点，一次探测按需复用。
 *
 * 宿主新旧版本 API 形态不同（本插件踩过的漂移：events → snapshotEvents、
 * presets.serviceFor 实例方法 → serviceForAgent 模块函数、./fork 子路径导出）。
 * 调用方只依赖本模块的稳定签名，不再直接假设宿主形态。
 */
import type { Context } from '@deepseek-ai/cordis';
import {
  foldSessionDisplayTitle,
  extractRecentMessages,
  TITLE_SCAN_EVENT_CAP,
  type DigestMessage,
} from '../shared/session-title.ts';

/** 日志最小接口 */
export interface AdapterLogger {
  info(msg: string): void;
  warn(msg: string): void;
  debug?(msg: string): void;
}

export interface HostAdapter {
  /** 会话事件读取：新宿主 snapshotEvents()（上游已标记 deprecated），旧宿主 events getter；漂移统一收口于此 */
  sessionEvents(session: { snapshotEvents?: () => readonly unknown[]; events?: readonly unknown[] }): readonly unknown[];
  /** preset 作用域服务解析：旧宿主实例方法 / 新宿主模块函数 */
  serviceFor(agent: { ctx: unknown }, name: string): Promise<unknown | undefined>;
  /** 全局服务读取（未注册返回 undefined，不抛） */
  globalService(name: string): unknown | undefined;
  /** 官方 fork seed 构造；旧宿主无导出时返回 undefined */
  buildForkSeed(events: readonly unknown[], boundary: number): Promise<readonly unknown[] | undefined>;
  /** 会话 header 读取（取 agentPreset 等）；会话不存在、服务缺失或读取失败返回 undefined */
  sessionHeader(sessionId: string): Promise<SessionHeaderLike | undefined>;
  /**
   * 会话是否存在于持久化层。
   *
   * `undefined` = 没有求证手段（宿主未注册 sessionPersistence，或其形态不含
   * `stat`）。调用方不得把它当成「不存在」——那正是重建已存在会话、撞出重复
   * id 的根因。后端真故障时照常抛出。
   */
  sessionExists(sessionId: string): Promise<boolean | undefined>;
  /**
   * 将会话挂载到其 cwd 对应的工作区（侧边栏可见性）。
   *
   * 全部 fail-soft：workspaceRegistry 未挂载（如 headless profile）→ debug；
   * create/attach 失败或宿主接口演进（无 attachSession）→ warn，绝不抛出。
   * `attachSession` 幂等，创建与恢复路径都可安全调用；升级后老会话自动补挂。
   */
  attachSessionToWorkspace(sessionId: string, cwd: string): Promise<void>;
  /**
   * 列出宿主已登记的全部工作区（含各自会话账目）。注册表未挂载或形态
   * 不符返回空数组（headless 组合属预期降级）；本方法只读、同步。
   */
  listWorkspaces(): WorkspaceSummary[];
  /**
   * 向会话追加 sandbox/mode 与 approval/policy 两个 knob 事件（宿主模块函数
   * 是唯一写路径，事件 durable 可重放，下一受限调用生效）。模块不可解析、
   * 会话无 append 或写入失败返回 false（fail-soft，不抛）。
   */
  applyPermissionKnobs(session: unknown, knobs: PermissionKnobs): Promise<boolean>;
  /**
   * 读会话当前生效的权限 knob：扫描事件流取最后一条 sandbox/mode 与
   * approval/policy。两类事件都无则返回 undefined（部署默认）。
   */
  readPermissionKnobs(session: unknown): PermissionKnobs | undefined;
  /**
   * 读一个已存储会话的显示标题：前缀事件折叠（session/title > 首条
   * user/message 摘要）。无持久层只读句柄、会话不存在或读取失败返回
   * undefined（fail-soft，调用方回退 id 短码）。
   */
  sessionTitle(sessionId: string): Promise<string | undefined>;
  /**
   * 读一个已存储会话的完整显示信息（标题 + 最近对话）：一次全量只读读取。
   * 无只读句柄、会话不存在或读取失败返回 undefined（fail-soft，调用方仅省略摘要）。
   */
  sessionDigest(sessionId: string): Promise<SessionDigest | undefined>;
  /**
   * 枚举宿主已存储的会话（无工作区服务时的 /sessions 回退数据源）。
   * 只读 header 元数据，不读事件日志；服务不可用返回空数组。
   */
  listStoredSessions(): Promise<StoredSessionSummary[]>;
  /** 探测结果摘要（启动契约检查用） */
  readonly capabilities: string[];
}

/**
 * 会话 header 的最小结构（只读插件关心的字段；`agentPreset` 在 header 顶层）。
 * `cwd`/`createdAt` 供 /sessions 列表展示（对齐 dsh-session SessionHeader）。
 */
export interface SessionHeaderLike {
  agentPreset?: string;
  /** 会话创建时的绝对工作目录（durable，attachSession 按它校验） */
  cwd?: string;
  /** 创建时间（Unix epoch ms） */
  createdAt?: number;
}

/** 工作区摘要（/sessions 分组列表用；对齐 dsh-workspace Workspace 的只读投影） */
export interface WorkspaceSummary {
  /** 规范化目录路径（realpath，create 后不再改写） */
  readonly path: string;
  /** 显示标题（缺省为路径末段） */
  readonly title: string;
  /** 该工作区的会话有序账目（attach 前插，人工可排序） */
  readonly sessionIds: readonly string[];
}

/** 权限 knob 组合（sandbox 模式 + 审批策略，对齐宿主两个 policy 模块的事件载荷） */
export interface PermissionKnobs {
  sandbox: string;
  approval: string;
}

/** 已存储会话的最小元数据（/sessions 无工作区服务时的回退列表） */
export interface StoredSessionSummary {
  readonly sessionId: string;
  /** 创建时间（Unix epoch ms，header 不可得时缺省） */
  readonly createdAt?: number;
  /** 会话创建时的绝对工作目录 */
  readonly cwd?: string;
  /** 是否为子代理会话（不面向用户导航） */
  readonly isSubagent: boolean;
}

/** 一个已存储会话的显示信息：标题 + 最近对话摘要（/sessions 切换确认用） */
export interface SessionDigest {
  /** session/title 投影 > 首条消息摘要（缺省 undefined） */
  readonly title: string | undefined;
  /** 尾部最近 N 条 user/assistant 文本 */
  readonly recent: readonly DigestMessage[];
  /** 可提取文本的消息总数（含未展示，供「更早 M 条」计数） */
  readonly totalMessages: number;
}

/** 工作区实体最小契约（对齐 dsh-workspace Workspace） */
export interface WorkspaceLike {
  readonly path?: string;
  attachSession(sessionId: string): Promise<void>;
}

/** workspaceRegistry 服务最小契约（对齐 dsh-workspace WorkspaceRegistry） */
export interface WorkspaceRegistryLike {
  /** 获取目录对应的现有工作区；不存在时创建（幂等；路径须已存在且为目录） */
  create(path: string, title?: string): Promise<WorkspaceLike>;
}

/** 插件创建的工作区显示名；仅在该 cwd 尚无工作区时生效（幂等 create 不改既有 title） */
const WORKSPACE_TITLE = 'QQBot';

/**
 * 持久化服务的最小只读契约（stat 面）。
 *
 * 只用 `stat`：它不读事件日志、不取写所有权，且**会话不存在时返回 `undefined`
 * 而非抛错**，正好是存在性判定需要的语义。
 */
interface SessionPersistenceLike {
  stat(id: string): Promise<{ header?: SessionHeaderLike } | undefined>;
}

/** 只读句柄的最小契约（标题读取用；对齐宿主 SessionHandle 的 read/close） */
interface SessionReadHandleLike {
  read(offset?: number, length?: number): Promise<{ events?: readonly unknown[] }>;
  close(): Promise<void>;
}

/** 可 open 只读句柄的持久化服务（标题读取需要） */
interface ReadCapablePersistence {
  open(id: string, access: 'read'): Promise<SessionReadHandleLike>;
}

/** 可枚举已存储会话的持久化服务（无工作区服务时的会话列表回退） */
interface ListCapablePersistence {
  list(): Promise<readonly { header?: { id?: string; createdAt?: number; cwd?: string; origin?: string } }[]>;
}

/**
 * 取出可用的持久化服务；形态不匹配返回 undefined。
 *
 * 宿主服务是版本漂移点，必须探测方法是否存在再调用：直接调用缺失的方法会抛
 * `TypeError`，与「后端故障」混在一起，让调用方误以为求证过了。
 */
function statCapablePersistence(ctx: Context): SessionPersistenceLike | undefined {
  const persistence = safeGet(ctx, 'sessionPersistence') as SessionPersistenceLike | undefined;
  return typeof persistence?.stat === 'function' ? persistence : undefined;
}

/** 取出可 open 只读句柄的持久化服务；形态不匹配返回 undefined */
function readCapablePersistence(ctx: Context): ReadCapablePersistence | undefined {
  const persistence = safeGet(ctx, 'sessionPersistence') as ReadCapablePersistence | undefined;
  return typeof persistence?.open === 'function' ? persistence : undefined;
}

/** 取出可枚举已存储会话的持久化服务；形态不匹配返回 undefined */
function listCapablePersistence(ctx: Context): ListCapablePersistence | undefined {
  const persistence = safeGet(ctx, 'sessionPersistence') as ListCapablePersistence | undefined;
  return typeof persistence?.list === 'function' ? persistence : undefined;
}

/** 取出可用的 workspaceRegistry；形态不匹配返回 undefined（dsh-workspace 未挂载时无侧边栏） */
function workspaceRegistry(ctx: Context): WorkspaceRegistryLike | undefined {
  const registry = safeGet(ctx, 'workspaceRegistry') as WorkspaceRegistryLike | undefined;
  return typeof registry?.create === 'function' ? registry : undefined;
}

/** workspaceRegistry 的 list 投影（只读，/sessions 分组列表用） */
interface WorkspaceListLike {
  list?(): unknown[];
}

/** 取出可 list 的 workspaceRegistry；形态不匹配返回 undefined */
function listCapableRegistry(ctx: Context): WorkspaceListLike | undefined {
  const registry = safeGet(ctx, 'workspaceRegistry') as WorkspaceListLike | undefined;
  return typeof registry?.list === 'function' ? registry : undefined;
}

/** 模块级函数的动态 import 结果缓存（spec 变量路径绕开本地依赖类型检查） */
const moduleCache = new Map<string, Record<string, unknown> | undefined>();

async function importModule(spec: string, logger?: AdapterLogger): Promise<Record<string, unknown> | undefined> {
  if (moduleCache.has(spec)) return moduleCache.get(spec);
  let mod: Record<string, unknown> | undefined;
  try {
    mod = (await import(spec)) as Record<string, unknown>;
  } catch {
    mod = undefined;
    logger?.warn(`host adapter: module not resolvable: ${spec}`);
  }
  moduleCache.set(spec, mod);
  return mod;
}

export function createHostAdapter(ctx: Context, logger?: AdapterLogger): HostAdapter {
  const capabilities: string[] = [];

  // events 读取路径只有运行时才能确定，sessionEvents 内自适应
  capabilities.push('sessionEvents(s自适应)');

  // 可能在插件启动后才注册，sessionExists/sessionHeader 内每次重新探测；此处仅记录启动时形态
  capabilities.push(statCapablePersistence(ctx)
    ? 'sessionPersistence.stat(可用)'
    : 'sessionPersistence.stat(不可用，会话存在性判定降级)');
  capabilities.push(workspaceRegistry(ctx)
    ? 'workspaceRegistry.create(可用)'
    : 'workspaceRegistry.create(不可用，侧边栏工作区归属降级)');
  capabilities.push(listCapableRegistry(ctx)
    ? 'workspaceRegistry.list(可用)'
    : 'workspaceRegistry.list(不可用，/sessions 分组列表降级)');

  let resolveFn: ((agent: { ctx: unknown }, name: string) => unknown | undefined) | undefined;
  const presets = safeGet(ctx, 'agentPresets') as
    | { serviceFor?: (agent: unknown, name: string) => unknown }
    | undefined;
  if (presets && typeof presets.serviceFor === 'function') {
    resolveFn = (agent, name) => presets.serviceFor!(agent, name);
    capabilities.push('serviceFor(presets实例方法)');
  } else {
    capabilities.push('serviceFor(serviceForAgent动态)');
  }

  return {
    capabilities,

    sessionEvents(session) {
      if (typeof session.snapshotEvents === 'function') return session.snapshotEvents();
      const legacy = session.events;
      return Array.isArray(legacy) ? legacy : [];
    },

    async serviceFor(agent, name) {
      if (resolveFn) {
        try {
          const found = resolveFn(agent, name);
          if (found) return found;
        } catch { /* 宿主实现差异，走模块函数 */ }
      }
      const mod = await importModule('@deepseek-ai/dsh-agent-presets', logger);
      const fn = mod?.serviceForAgent as
        | ((ctx: unknown, agent: { ctx: unknown }, name: string) => unknown)
        | undefined;
      if (typeof fn !== 'function') return undefined;
      try {
        return fn(ctx, agent, name);
      } catch {
        return undefined;
      }
    },

    globalService(name) {
      return safeGet(ctx, name);
    },

    async sessionHeader(sessionId) {
      const persistence = statCapablePersistence(ctx);
      if (!persistence) return undefined;
      try {
        return (await persistence.stat(sessionId))?.header;
      } catch {
        return undefined; // 读不到 preset 不该阻断会话打开，回落到当前 effective preset
      }
    },

    async sessionExists(sessionId) {
      const persistence = statCapablePersistence(ctx);
      if (!persistence) return undefined;
      return (await persistence.stat(sessionId)) !== undefined;
    },

    async attachSessionToWorkspace(sessionId, cwd) {
      const registry = workspaceRegistry(ctx);
      if (!registry) {
        // 未挂载 dsh-workspace（如 headless profile）→ 无侧边栏，属预期降级
        logger?.debug?.(`host adapter: workspaceRegistry 未挂载，跳过会话 ${sessionId} 的工作区归属`);
        return;
      }
      try {
        const workspace = await registry.create(cwd, WORKSPACE_TITLE);
        if (!workspace || typeof workspace.attachSession !== 'function') {
          // 宿主接口演进：返回对象不含 attachSession → warn 避免静默失效
          logger?.warn?.(`host adapter: workspaceRegistry.create 返回了无 attachSession 的对象，跳过会话 ${sessionId}`);
          return;
        }
        await workspace.attachSession(sessionId);
        logger?.debug?.(`host adapter: attached session ${sessionId} to workspace ${workspace.path ?? cwd}`);
      } catch (err) {
        // 仅影响侧边栏展示，绝不打断消息处理；但属异常（cwd 不匹配/目录缺失等），warn 留痕
        logger?.warn?.(`host adapter: workspace attach failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    },

    listWorkspaces(): WorkspaceSummary[] {
      const registry = listCapableRegistry(ctx);
      if (!registry) return [];
      try {
        const list = registry.list?.() ?? [];
        const out: WorkspaceSummary[] = [];
        for (const raw of list) {
          const workspace = raw as { path?: unknown; title?: unknown; sessionIds?: unknown };
          if (!workspace || typeof workspace.path !== 'string' || !workspace.path) continue;
          out.push({
            path: workspace.path,
            title: typeof workspace.title === 'string' && workspace.title ? workspace.title : workspace.path,
            sessionIds: Array.isArray(workspace.sessionIds)
              ? workspace.sessionIds.filter((id): id is string => typeof id === 'string')
              : [],
          });
        }
        return out;
      } catch (err) {
        logger?.warn?.(`host adapter: list workspaces failed: ${err instanceof Error ? err.message : String(err)}`);
        return [];
      }
    },

    async applyPermissionKnobs(session, knobs) {
      const appendable = session as { append?: (...args: unknown[]) => unknown } | null | undefined;
      if (typeof appendable?.append !== 'function') {
        logger?.warn?.('host adapter: session has no append, permission switch unavailable');
        return false;
      }
      // 模块可解析不等于事件会生效：真正折叠 knob 的是宿主两个服务。
      // headless/精简组合未注册时，事件只是 inert log，必须明确降级而非假成功。
      if (safeGet(ctx, 'sandboxPolicy') === undefined || safeGet(ctx, 'approval') === undefined) {
        logger?.warn?.('host adapter: sandboxPolicy/approval services not composed, permission switch unavailable');
        return false;
      }
      const sandboxMod = await importModule('@deepseek-ai/dsh-sandbox-policy', logger);
      const approvalMod = await importModule('@deepseek-ai/dsh-user-approval', logger);
      const setSandboxMode = sandboxMod?.setSandboxMode as
        | ((session: unknown, mode: string) => void)
        | undefined;
      const setApprovalPolicy = approvalMod?.setApprovalPolicy as
        | ((session: unknown, policy: string) => void)
        | undefined;
      const sandboxModes = sandboxMod?.SANDBOX_MODES as readonly unknown[] | undefined;
      const approvalPolicies = approvalMod?.APPROVAL_POLICIES as readonly unknown[] | undefined;
      if (typeof setSandboxMode !== 'function' || typeof setApprovalPolicy !== 'function'
        || !Array.isArray(sandboxModes) || !Array.isArray(approvalPolicies)) {
        logger?.warn?.('host adapter: permission policy modules unavailable, switch declined');
        return false;
      }
      // 先校验两个值再 append，避免 sandbox 已写、approval 校验失败的半应用状态。
      if (!sandboxModes.includes(knobs.sandbox) || !approvalPolicies.includes(knobs.approval)) {
        logger?.warn?.(`host adapter: invalid permission knobs: ${knobs.sandbox}+${knobs.approval}`);
        return false;
      }
      try {
        setSandboxMode(session, knobs.sandbox);
        setApprovalPolicy(session, knobs.approval);
        return true;
      } catch (err) {
        logger?.warn?.(`host adapter: apply permission knobs failed: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      }
    },

    async sessionTitle(sessionId) {
      const persistence = readCapablePersistence(ctx);
      if (!persistence) return undefined;
      let handle: SessionReadHandleLike;
      try {
        handle = await persistence.open(sessionId, 'read');
      } catch {
        return undefined; // 会话不存在 / 后端故障 / 句柄形态漂移：标题缺失不该阻断列表
      }
      try {
        const read = await handle.read(0, TITLE_SCAN_EVENT_CAP);
        return foldSessionDisplayTitle(read.events ?? []);
      } catch (err) {
        logger?.warn?.(`host adapter: session title read failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
      } finally {
        try {
          await handle.close();
        } catch {
          // 只读句柄关闭失败无副作用，吞掉避免盖过真实结果
        }
      }
    },

    async sessionDigest(sessionId) {
      const persistence = readCapablePersistence(ctx);
      if (!persistence) return undefined;
      let handle: SessionReadHandleLike;
      try {
        handle = await persistence.open(sessionId, 'read');
      } catch {
        return undefined;
      }
      try {
        // 全量读取（无长度上限）：摘要需要尾部消息，标题顺带折叠，一次 I/O 完成
        const read = await handle.read(0);
        const events = read.events ?? [];
        const { recent, total } = extractRecentMessages(events);
        return { title: foldSessionDisplayTitle(events), recent, totalMessages: total };
      } catch (err) {
        logger?.warn?.(`host adapter: session digest read failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
      } finally {
        try {
          await handle.close();
        } catch {
          // 只读句柄关闭失败无副作用，吞掉避免盖过真实结果
        }
      }
    },

    async listStoredSessions() {
      const persistence = listCapablePersistence(ctx);
      if (!persistence) return [];
      try {
        const snapshots = await persistence.list();
        const out: StoredSessionSummary[] = [];
        for (const snapshot of snapshots) {
          const header = snapshot?.header;
          if (!header || typeof header.id !== 'string' || header.id === '') continue;
          out.push({
            sessionId: header.id,
            ...(typeof header.createdAt === 'number' ? { createdAt: header.createdAt } : {}),
            ...(typeof header.cwd === 'string' ? { cwd: header.cwd } : {}),
            isSubagent: header.origin === 'subagent',
          });
        }
        return out;
      } catch (err) {
        logger?.warn?.(`host adapter: list stored sessions failed: ${err instanceof Error ? err.message : String(err)}`);
        return [];
      }
    },

    readPermissionKnobs(session) {
      const events = this.sessionEvents(
        session as { snapshotEvents?: () => readonly unknown[]; events?: readonly unknown[] },
      );
      let sandbox: string | undefined;
      let approval: string | undefined;
      for (const raw of events) {
        const event = raw as { type?: string; data?: { mode?: unknown; policy?: unknown } };
        if (event?.type === 'sandbox/mode' && typeof event.data?.mode === 'string') {
          sandbox = event.data.mode;
        } else if (event?.type === 'approval/policy' && typeof event.data?.policy === 'string') {
          approval = event.data.policy;
        }
      }
      if (sandbox === undefined && approval === undefined) return undefined;
      return { sandbox: sandbox ?? '', approval: approval ?? '' };
    },

    async buildForkSeed(events, boundary) {
      const mod = await importModule('@deepseek-ai/dsh-session/fork', logger);
      const fn = mod?.buildForkSeed as
        | ((events: readonly unknown[], boundary: number) => readonly unknown[])
        | undefined;
      if (typeof fn !== 'function') return undefined;
      try {
        return fn(events, boundary);
      } catch {
        return undefined;
      }
    },
  };
}

/** ctx.get 的非抛出版本 */
function safeGet(ctx: Context, name: string): unknown {
  try {
    return ctx.get(name) as unknown;
  } catch {
    return undefined;
  }
}

/** 测试辅助：清空模块缓存 */
export function _resetAdapterCache(): void {
  moduleCache.clear();
}
