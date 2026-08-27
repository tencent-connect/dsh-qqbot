/**
 * workspace-attach — 会话创建/恢复后挂载到对应工作区（侧边栏可见性）
 *
 * 背景：Web 侧边栏按工作区（目录）成员列表展示会话。宿主只在客户端
 * `session.create` RPC 路径调用 `workspace.attachSession`（见 dsh-host-apiproxy），
 * 而 dsh-workspace 的"认领遗漏会话"（bootstrap）仅在首次初始化
 * （`initialized === false`）时执行。插件创建的会话（如本插件的 QQ 会话）
 * 两条路径都不经过 → 不在任何工作区成员列表里 → 仅在 agent 存活期间
 * 短暂可见，闲置回收后从侧边栏永久消失。
 *
 * 本模块在插件侧补齐：会话创建/恢复后，把会话挂到其 cwd 对应的工作区。
 * 全部 fail-soft：workspaceRegistry 服务不存在（如 headless profile 未挂载
 * dsh-workspace）或挂载失败时静默降级，绝不影响消息处理。
 *
 * 上游机制问题另见 deepseek-ai/deepseek-harness 的讨论（PR 描述中附链接）。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Logger } from '../types.ts';

/** 工作区实体最小接口（对齐 dsh-workspace WorkspaceEntity） */
export interface WorkspaceLike {
  readonly path?: string;
  attachSession(sessionId: string): Promise<void>;
}

/** workspaceRegistry 服务最小接口（对齐 dsh-workspace WorkspaceRegistry） */
export interface WorkspaceRegistryLike {
  /** 获取目录对应的现有工作区；不存在时创建（幂等） */
  create(path: string, title?: string): Promise<WorkspaceLike>;
}

/**
 * 将会话挂载到其工作目录对应的工作区。
 *
 * `attachSession` 幂等（已是成员则原样返回），因此创建与恢复路径都可安全调用；
 * 升级后老会话在下一次创建记录时会自动补挂。
 */
export async function attachSessionToWorkspace(
  ctx: Context,
  cwd: string,
  sessionId: string,
  logger: Logger,
): Promise<void> {
  let registry: WorkspaceRegistryLike | undefined;
  try {
    const svc = ctx.get('workspaceRegistry') as WorkspaceRegistryLike | undefined;
    if (svc && typeof svc.create === 'function') registry = svc;
  } catch {
    registry = undefined;
  }
  if (!registry) return; // 未挂载 dsh-workspace（如 headless profile）→ 无侧边栏，跳过
  try {
    const workspace = await registry.create(cwd);
    await workspace.attachSession(sessionId);
    logger.debug(`im-qqbot: attached session ${sessionId} to workspace ${workspace.path ?? cwd}`);
  } catch (err) {
    // 仅影响侧边栏展示，绝不打断消息处理
    logger.debug(`im-qqbot: workspace attach skipped for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
