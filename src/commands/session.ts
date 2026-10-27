/**
 * 会话相关命令
 *
 * - /new（别名 /reset /clear）：开始新会话（换新 sessionId）
 * - /compact：原地压缩会话历史（保留 sessionId，摘要替换旧历史）
 * - /switch：切换本通道桥接到的目标会话（可点击列表选择，立即生效）
 *
 * 均对应底层 dsh agent 能力，分类为 agent（通用能力）。
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import type { SwitchResult } from '../session/index.ts';
import { getScopePeer, sendMarkdownChunked } from '../shared/index.ts';

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

/** /switch 展示用短 id（剥离 session- 前缀后取前 8 位，保证可辨识） */
function shortId(id: string): string {
  const bare = id.replace(/^session-/i, '');
  return bare.length > 8 ? `${bare.slice(0, 8)}…` : bare;
}

/** 从 cwd 取目录名做人类可读标签 */
function dirName(cwd: string | undefined): string {
  if (!cwd) return '未知目录';
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

/** 切换失败的用户可读文案 */
function switchFailureMessage(result: SwitchResult): string {
  if (result.ok) return '切换失败';
  switch (result.reason) {
    case 'busy':
      return '正在生成回复，无法切换会话，请等待本轮结束后再试';
    case 'not-found':
      return `❌ ${result.message ?? '目标会话不存在'}\n发送 /switch 查看可切换列表`;
    default:
      return `切换失败: ${result.message ?? '未知错误'}`;
  }
}

/** /switch — 将本通道桥接切换到另一个已有会话 */
export function switchCommand({ manager, config }: CommandDeps): CategorizedCommand {
  return {
    name: 'switch',
    category: 'agent',
    description: '切换桥接的目标会话（用法: /switch [id|序号|default]）',
    handler: async (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      const args = (cmdCtx.command?.raw ?? '').trim();
      const current = manager.currentBoundSessionId(scope, peerId);

      // 无参数：当前桥接 + 可切换列表（可点击）
      if (!args) {
        const targets = await manager.listSwitchTargets();
        const lines: string[] = ['### 🔀 会话桥接切换', '', `**当前桥接:** ${shortId(current)}`];

        if (targets.length === 0) {
          lines.push('', '未找到可切换的会话（宿主 sessionPersistence 服务不可用或无其它顶层会话）。');
        } else {
          lines.push('', '**可切换的对话（点击进入，按创建时间倒序）:**');
          targets.forEach((t, i) => {
            const marker = t.sessionId === current ? '（当前）' : '';
            lines.push(`<qqbot-cmd-input text="/switch ${t.sessionId}" show="/switch #${i + 1} ${dirName(t.cwd)} ${shortId(t.sessionId)}${marker}"/>`);
          });
        }
        lines.push('', '也支持序号 / id 前缀：`/switch 2`、`/switch session-ab12`；恢复通道默认会话：`/switch default`');

        await sendMarkdownChunked(cmdCtx, lines.join('\n'), config.textChunkLimit);
        return { kind: 'noop' as const };
      }

      // 恢复默认哈希路由
      if (args === 'default' || args === 'back') {
        const result = await manager.switchSession(scope, peerId);
        if (!result.ok) return switchFailureMessage(result);
        return `✅ 已恢复通道默认桥接（${shortId(result.target)}），下一条消息立即生效。`;
      }

      const targets = await manager.listSwitchTargets();
      let targetId: string | undefined;

      if (/^\d+$/.test(args)) {
        const idx = Number(args) - 1;
        targetId = targets[idx]?.sessionId;
        if (!targetId) return `序号 #${args} 超出范围（共 ${targets.length} 个，发送 /switch 查看最新列表）`;
      } else {
        const lower = args.toLowerCase();
        const exact = targets.find((t) => t.sessionId.toLowerCase() === lower);
        if (exact) {
          targetId = exact.sessionId;
        } else {
          const prefixed = targets.filter((t) => t.sessionId.toLowerCase().startsWith(lower));
          if (prefixed.length === 1) {
            targetId = prefixed[0]!.sessionId;
          } else if (prefixed.length > 1) {
            return `前缀「${args}」匹配到 ${prefixed.length} 个会话，请用更长前缀或点击选择：\n`
              + prefixed.map((t) => `${t.sessionId}  ${dirName(t.cwd)}`).join('\n');
          } else {
            // 不在列表内：按完整 id 处理（可能是较早会话），由 manager 做存在性校验
            targetId = args;
          }
        }
      }

      const result = await manager.switchSession(scope, peerId, targetId);
      if (!result.ok) return switchFailureMessage(result);
      if (result.unchanged) return `当前已桥接到 ${shortId(result.target)}，无需切换。`;
      return `✅ 已切换到 ${shortId(targetId)}（原 ${shortId(result.previous)}）\n下一条消息立即生效，将恢复该对话的上下文。`;
    },
  };
}
