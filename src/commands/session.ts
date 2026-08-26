/**
 * 会话相关命令
 *
 * - /new（别名 /reset /clear）：开始新会话（换新 sessionId）
 * - /compact：原地压缩会话历史（保留 sessionId，摘要替换旧历史）
 *
 * 两者都对应底层 dsh agent 能力，分类为 agent（通用能力）。
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import { getScopePeer } from '../shared/index.ts';

/** /new（别名 /reset /clear）— 开始新会话 */
export function newCommand({ manager }: CommandDeps): CategorizedCommand {
  return {
    name: ['new', 'reset', 'clear'],
    category: 'agent',
    description: '开始新会话（清空上下文）',
    handler: (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      void manager.remove(scope, peerId);
      return '已开启新会话 ✓';
    },
  };
}

/** /compact — 原地压缩会话历史 */
export function compactCommand({ manager }: CommandDeps): CategorizedCommand {
  return {
    name: 'compact',
    category: 'agent',
    description: '压缩会话历史（摘要替换旧记录，保留上下文）',
    handler: async (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      const outcome = await manager.compact(scope, peerId);

      if (outcome.ok) {
        if (!outcome.shadowed) return '没有可压缩的历史';
        return `✅ 已压缩 ${outcome.shadowed} 条历史记录（约 ${outcome.tokens ?? 0} tokens）`;
      }

      switch (outcome.reason) {
        case 'no-session':
          return '当前无活跃会话';
        case 'busy':
          return '正在生成中，无法压缩';
        case 'unavailable':
          return '压缩能力不可用（当前会话的 agent preset 未加载 compaction 服务）';
        default:
          return `压缩失败: ${outcome.message ?? '未知错误'}`;
      }
    },
  };
}
