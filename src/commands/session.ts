/**
 * 会话相关命令
 *
 * - /new（别名 /reset /clear）：开始新会话（换新 sessionId）
 * - /compact：原地压缩会话历史（保留 sessionId，摘要替换旧历史）
 * - /switch：切换本通道桥接到的目标会话（免重启宿主，下一条消息生效）
 *
 * 均对应底层 dsh agent 能力，分类为 agent（通用能力）。
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import type { SwitchTarget, SwitchResult } from '../session/index.ts';
import { commandAllowlistAuth } from './auth.ts';
import { getScopePeer } from '../shared/index.ts';

/** /new（别名 /reset /clear）— 开始新会话 */
export function newCommand({ manager }: CommandDeps): CategorizedCommand {
  return {
    name: ['new', 'reset', 'clear'],
    category: 'agent',
    scope: 'all',
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
      return `❌ 切换失败: ${result.message ?? '未知错误'}`;
  }
}

/**
 * /switch — 将本通道桥接切换到另一个已有会话
 *
 * 回复一律以 handler 返回值（→ 框架 sendText）给出：命令行内 sendMarkdownChunked
 * 曾出现「QQ 端零回复且不抛异常」的静默失败，且行内 `<qqbot-cmd-input>` 点击标签
 * 客户端不认，列表改为纯文本（序号或完整 id 均可切换）。
 */
export function switchCommand({ manager, config, logger }: CommandDeps): CategorizedCommand {
  return {
    name: 'switch',
    category: 'agent',
    // 改绑定属管理动作：私聊/群聊均可用，仅限白名单用户（与 /model /preset 同构）
    scope: 'all',
    authorized: commandAllowlistAuth(config, logger),
    description: '切换桥接的目标会话（用法: /switch [序号|id|default]）',
    handler: async (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      const args = (cmdCtx.command?.raw ?? '').trim();
      const current = manager.currentBoundSessionId(scope, peerId);

      // 无参数：当前桥接 + 可切换列表
      if (!args) {
        const targets = await manager.listSwitchTargets();
        if (targets === undefined) {
          return [
            '🔀 会话桥接切换',
            '',
            `当前桥接: ${current}`,
            '',
            '宿主未提供会话列表（sessionPersistence.list 不可用），只能按完整 id 切换：/switch session-xxxx',
          ].join('\n');
        }

        const lines: string[] = ['🔀 会话桥接切换', '', `当前桥接: ${current}`];
        if (targets.length === 0) {
          lines.push('', '没有可切换的会话（宿主持久化层里还没有对话）。');
        } else {
          lines.push('', '可切换的对话（按创建时间倒序）:');
          targets.forEach((target: SwitchTarget, index: number) => {
            const marker = target.sessionId === current ? '（当前）' : '';
            lines.push(`${index + 1}. ${target.sessionId}  ${dirName(target.cwd)}${marker}`);
          });
        }
        lines.push('', '用法: /switch <序号|session-id 前缀|完整 id> 切换；/switch default 恢复通道默认会话');
        return lines.join('\n');
      }

      // 恢复通道默认路由（清 per-peer 绑定）
      if (args === 'default' || args === 'back') {
        const result = await manager.switchSession(scope, peerId);
        if (!result.ok) return switchFailureMessage(result);
        return `✅ 已恢复通道默认路由（${shortId(result.target)}），下一条消息立即生效。`;
      }

      // 有参数：序号 / id 前缀 / 完整 id
      const targets = (await manager.listSwitchTargets()) ?? [];
      let targetId: string | undefined;

      if (/^\d+$/.test(args)) {
        targetId = targets[Number(args) - 1]?.sessionId;
        if (!targetId) {
          return targets.length === 0
            ? '没有可切换的会话列表，请直接发送完整 id：/switch session-xxxx'
            : `序号 #${args} 超出范围（共 ${targets.length} 个，发送 /switch 查看最新列表）`;
        }
      } else {
        const lower = args.toLowerCase();
        const exact = targets.find((target) => target.sessionId.toLowerCase() === lower);
        if (exact) {
          targetId = exact.sessionId;
        } else {
          const prefixed = targets.filter((target) => target.sessionId.toLowerCase().startsWith(lower));
          if (prefixed.length === 1) {
            targetId = prefixed[0]!.sessionId;
          } else if (prefixed.length > 1) {
            return `前缀「${args}」匹配到 ${prefixed.length} 个会话，请用更长前缀或序号：\n`
              + prefixed.map((target) => `${target.sessionId}  ${dirName(target.cwd)}`).join('\n');
          } else {
            // 不在列表内：按完整 id 处理（可能是较早会话），由 manager 做存在性校验
            targetId = args;
          }
        }
      }

      const result = await manager.switchSession(scope, peerId, targetId);
      if (!result.ok) return switchFailureMessage(result);
      if (result.unchanged) return `当前已桥接到 ${shortId(result.target)}，无需切换。`;
      return `✅ 已切换到 ${shortId(result.target)}（原 ${shortId(result.previous)}）\n下一条消息立即生效，将恢复该对话的上下文。`;
    },
  };
}
