/**
 * 命令鉴权 — 挂到 SlashCommand.authorized 的白名单校验
 *
 * 名单语义与审批按钮校验（approval-channel）一致：c2cMode=allowlist 时发送者
 * 必须在 c2cAllow；身份缺失同样拒绝（fail-closed）。open 模式放行。
 */
import type { SlashCommandHandlerContext } from '@tencent-connect/qqbot-nodejs';
import type { Logger } from '../types.ts';

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

/** Applies after conversation admission and also guards direct command-handler calls. */
export function commandAccessError(mode: string | undefined, senderId: string | undefined, allowed: boolean): string | undefined {
  if (mode === 'disabled') return 'QQ 斜杠命令已关闭。';
  if (!senderId) return '无法确认发送者身份，不能执行斜杠命令。';
  if (mode === 'open') return undefined;
  if ((mode === undefined || mode === 'allowlist') && allowed) return undefined;
  return '你不在斜杠命令白名单中，请联系机器人管理者。';
}
