/**
 * /pwd — 显示当前位置（工作区 - 会话名），与每条回复顶部的标题头同格式。
 *
 * 用途：久未使用 QQ 时不必翻聊天记录即可确认「我在哪个工作区的哪个会话」。
 * 会话已被闲置回收时仍可显示（从持久层还原标题与工作区）。
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import { getScopePeer } from '../shared/index.ts';

export function pwdCommand({ manager }: CommandDeps): CategorizedCommand {
  return {
    name: 'pwd',
    category: 'qqbot',
    scope: 'all',
    description: '显示当前位置（工作区 - 会话名）',
    handler: async (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      const header = await manager.currentLocationHeader(scope, peerId);
      if (header === undefined) {
        return '当前无活跃会话；发送消息即开启新会话（可用 /sessions 查看与切换）。';
      }
      return header;
    },
  };
}
