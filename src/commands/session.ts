/**
 * 会话相关命令
 *
 * - /new（别名 /reset /clear）：开始新会话（换新 sessionId）
 * - /compact：原地压缩会话历史（保留 sessionId，摘要替换旧历史）
 * - /unarchive（别名 /restore）：取消当前会话的归档
 *
 * 三者都对应底层 dsh agent 能力，分类为 agent（通用能力）。
 */
import { SessionSwitchConflict } from '../session/session-manager.ts';
import type { CommandDeps, CategorizedCommand } from './types.ts';
import { getScopePeer } from '../shared/index.ts';

/** /new（别名 /reset /clear）— 开始新会话 */
export function newCommand({ manager }: CommandDeps): CategorizedCommand {
  return {
    name: ['new', 'reset', 'clear'],
    category: 'agent',
    scope: 'all',
    description: '开始新会话（清空上下文）',
    handler: async (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      try { await manager.remove(scope, peerId); }
      catch (error) {
        if (error instanceof SessionSwitchConflict) return error.message;
        throw error;
      }
      return '已开启新会话 ✓';
    },
  };
}

/**
 * /unarchive（别名 /restore）— 取消当前会话的归档
 *
 * 归档会话的消息会被宿主门禁丢弃（不进会话、模型不跑），在 QQ 里除了开新会话
 * 没有别的出路；这条命令把「去 DSH 手动取消归档」这一步搬到聊天里。
 */
export function unarchiveCommand({ manager }: CommandDeps): CategorizedCommand {
  return {
    name: ['unarchive', 'restore'],
    category: 'agent',
    scope: 'all',
    description: '取消归档当前会话（归档后消息不会被处理）',
    handler: async (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      const outcome = await manager.unarchive(scope, peerId);

      switch (outcome) {
        case 'ok':
          return '✅ 已取消归档，重发刚才那条消息即可继续。';
        case 'not-archived':
          return '当前会话没有被归档，直接发消息即可。';
        case 'no-session':
          return '当前还没有会话，直接发消息即可开始。';
        default:
          return '⚠️ 取消归档失败：请在 DSH 中手动取消归档。';
      }
    },
  };
}

/** /compact — 原地压缩会话历史 */
export function compactCommand({ manager }: CommandDeps): CategorizedCommand {
  return {
    name: 'compact',
    category: 'agent',
    scope: 'all',
    description: '压缩会话历史（摘要替换旧记录，保留上下文）',
    handler: async (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      const msg = cmdCtx.message;
      const outcome = await manager.compact(scope, peerId, {
        senderId: msg.senderId,
        replyTarget: { scope, targetId: peerId, msgId: msg.messageId },
      });

      if (outcome.ok) {
        if (!outcome.shadowed) return '没有可压缩的历史';
        return `✅ 已压缩 ${outcome.shadowed} 条历史记录（约 ${outcome.tokens ?? 0} tokens）`;
      }

      switch (outcome.reason) {
        case 'no-session':
          return '当前无活跃会话';
        case 'busy':
          return '正在生成中，无法压缩';
        case 'archived':
          return '当前会话已归档，无法压缩。请发送 /unarchive 取消归档，或发送 /new 创建新会话。';
        case 'unavailable':
          return '压缩能力不可用（当前会话的 agent preset 未加载 compaction 服务）';
        default:
          return `压缩失败: ${outcome.message ?? '未知错误'}`;
      }
    },
  };
}
