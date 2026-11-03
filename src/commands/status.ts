/**
 * 状态命令：/bot-status（QQBot 特有）
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import { getScopePeer, formatRelativeTime } from '../shared/index.ts';

/** /bot-status — 查看当前会话状态 */
export function statusCommand({ manager }: CommandDeps): CategorizedCommand {
  return {
    name: 'bot-status',
    category: 'qqbot',
    authority: 'query',
    scope: 'all',
    description: '查看当前会话状态',
    handler: async (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      try { await manager.restoreExisting(scope, peerId); }
      catch (error) { return `无法读取当前 QQ 会话：${error instanceof Error ? error.message : String(error)}`; }
      const status = manager.getStatus(scope, peerId);
      if (!status.active) return '此 QQ 对话尚无可用的当前会话；历史可在 DSH 查看。';
      const modelInfo = status.model ? `${status.provider}/${status.model}` : '宿主默认';
      return [
        '📊 会话状态',
        `会话: ${status.sessionId ? status.sessionId.slice(0, 8) : '—'}`,
        `模型: ${modelInfo}`,
        `Preset: ${status.preset ?? '无'}`,
        ...(status.nextPreset !== status.preset ? [`新会话预设: ${status.nextPreset || '继承 DSH 默认'}（/new 后生效）`] : []),
        `消息数: ${status.messageCount ?? 0}`,
        `最后活动: ${formatRelativeTime(status.lastActivity)}`,
      ].join('\n');
    },
  };
}
