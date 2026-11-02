/**
 * workspace-attach — 会话创建/恢复后挂载到对应工作区（侧边栏可见性）
 *
 * 背景：Web 侧边栏按工作区（目录）成员列表展示会话。宿主只在客户端
 * `session.create` RPC 路径调用 `workspace.attachSession`（见 dsh-session-controller
 * 的 `SessionCommandController.create`），而 dsh-workspace 的"认领遗漏会话"
 * （bootstrap）仅在首次初始化（`initialized === false`）时执行。插件创建的会话
 * （如本插件的 QQ 会话）两条路径都不经过 → 不在任何工作区成员列表里 →
 * 仅在 agent 存活期间短暂可见，闲置回收后从侧边栏永久消失。
 *
 * 本模块在插件侧补齐：会话创建/恢复后，把会话挂到其 cwd 对应的工作区。
 * 全部 fail-soft：workspaceRegistry 服务不存在（如 headless profile 未挂载
 * dsh-workspace）时静默降级（debug），挂载失败时 warn 留痕，绝不影响消息处理。
 *
 * 关键约束：传给 `create()` 的 cwd 必须与会话 header 的 cwd 同源。宿主的
 * `attachSession` 会校验 `realpath(header.cwd) === 工作区 path`，两者不一致会被
 * 拒绝——因此调用方务必传入与 `meta.cwd` 相同的 `workspaceDir()`。
 *
 * 上游机制问题（bootstrap 只在首次初始化认领、插件会话无统一挂载途径）
 * 另见 deepseek-ai/deepseek-harness 讨论。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Logger } from '../types.ts';

/** dsh-workspace 通过 `ctx.workspaceRegistry` 暴露的服务名 */
const WORKSPACE_REGISTRY_SERVICE = 'workspaceRegistry';

/** 工作区实体最小接口（对齐 dsh-workspace Workspace） */
export interface WorkspaceLike {
  readonly path?: string;
  attachSession(sessionId: string): Promise<void>;
}

/** workspaceRegistry 服务最小接口（对齐 dsh-workspace WorkspaceRegistry） */
export interface WorkspaceRegistryLike {
  /** 获取目录对应的现有工作区；不存在时创建（幂等；路径须已存在且为目录） */
  create(path: string, title?: string): Promise<WorkspaceLike>;
}

/** ctx.get 的非抛出版本：服务未挂载（如 headless profile）返回 undefined */
function getWorkspaceRegistry(ctx: Context): WorkspaceRegistryLike | undefined {
  try {
    const svc = ctx.get(WORKSPACE_REGISTRY_SERVICE);
    if (svc && typeof svc.create === 'function') return svc as WorkspaceRegistryLike;
  } catch {
    // 服务不存在时 ctx.get 抛错 → 视为未挂载
  }
  return undefined;
}

/**
 * 将会话挂载到其工作目录对应的工作区。
 *
 * `attachSession` 幂等（已是成员则原样返回），因此创建与恢复路径都可安全调用；
 * 升级后老会话在下一次创建记录时会自动补挂。所有失败都被吞掉：这只是展示层的
 * 副作用，绝不能因为工作区记账失败而打断消息处理。
 */
export async function attachSessionToWorkspace(
  ctx: Context,
  cwd: string,
  sessionId: string,
  logger: Logger,
): Promise<void> {
  const registry = getWorkspaceRegistry(ctx);
  if (!registry) {
    // 未挂载 dsh-workspace（如 headless profile）→ 无侧边栏，属预期降级
    logger.debug(`im-qqbot: workspaceRegistry 未挂载，跳过会话 ${sessionId} 的工作区归属`);
    return;
  }
  try {
    const workspace = await registry.create(cwd);
    if (!workspace || typeof workspace.attachSession !== 'function') {
      // 宿主接口演进：返回对象不含 attachSession → warn 避免静默失效
      logger.warn(`im-qqbot: workspaceRegistry.create 返回了无 attachSession 的对象，跳过会话 ${sessionId}`);
      return;
    }
    await workspace.attachSession(sessionId);
    logger.debug(`im-qqbot: attached session ${sessionId} to workspace ${workspace.path ?? cwd}`);
  } catch (err) {
    // 仅影响侧边栏展示，绝不打断消息处理；但属异常（cwd 不匹配/目录缺失等），warn 留痕
    logger.warn(`im-qqbot: workspace attach failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
