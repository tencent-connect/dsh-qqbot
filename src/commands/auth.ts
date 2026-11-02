/**
 * 命令鉴权 — 挂到 SlashCommand.authorized 的白名单校验
 *
 * 名单语义与审批按钮校验（approval-channel）一致：c2cMode=allowlist 时发送者
 * 必须在 c2cAllow；身份缺失同样拒绝（fail-closed）。open 模式放行。
 */
import type { SlashCommandHandlerContext } from '@tencent-connect/qqbot-nodejs';
import type { ChatScope, Logger } from '../types.ts';
import type { CommandDeps } from './types.ts';

/** 鉴权配置投影（结构化，便于单测） */
export interface CommandAuthConfigLike {
  access: {
    c2cMode: 'open' | 'allowlist' | 'disabled';
    c2cAllow: readonly string[];
  };
}

const DENIED = '⚠️ 无权限执行此命令';

/** 构造命令白名单鉴权回调 */
export function commandAllowlistAuth(
  config: CommandAuthConfigLike,
  logger?: Logger,
): (ctx: SlashCommandHandlerContext) => boolean | string {
  return (ctx) => {
    if (config.access.c2cMode !== 'allowlist') return true;
    const senderId = ctx.message.senderId;
    if (!senderId || !config.access.c2cAllow.includes(senderId)) {
      logger?.warn(`im-qqbot: command auth denied: sender=${senderId ?? '(missing)'}`);
      return DENIED;
    }
    return true;
  };
}

/** Menus and mutations share the service's authorization range. */
export function selectionMenuAccess(deps: Pick<CommandDeps, 'manager' | 'origin'>, scope: ChatScope, peerId: string, actor: string, kind: 'model' | 'preset') {
  const service = deps.manager.conversations;
  const allowed = service?.allowedSelections(scope, peerId, kind);
  return {
    editable: !service || deps.origin === 'web-owner' || service.canManage(scope, peerId, actor),
    allows: (value: string): boolean => !allowed || allowed.includes(value),
  };
}
