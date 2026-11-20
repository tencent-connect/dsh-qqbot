import type { CommandDeps, CategorizedCommand } from './types.ts';
import { ARCHIVED_SESSION_NOTICE, getScopePeer, sendMarkdownChunked } from '../shared/index.ts';
import { classifySessionError } from '../session/errors.ts';
import { ReasoningEffortError, SessionSwitchConflict } from '../session/session-manager.ts';

export function reasoningLabel(explicit?: string, defaultEffort?: string): string {
  return explicit ?? (defaultEffort ? `默认（${defaultEffort}）` : '模型默认');
}

export function effortCommand({ manager, config, logger, canReceive }: CommandDeps): CategorizedCommand {
  return {
    name: 'effort',
    category: 'agent',
    scope: 'all',
    description: '查看或调整推理强度（/effort [档位]）',
    handler: async (ctx) => {
      const { scope, peerId } = getScopePeer(ctx);
      const effort = (ctx.command?.raw ?? '').trim();
      const assertAllowed = () => {
        ctx.signal.throwIfAborted();
        const access = manager.accountAccess;
        if (!access) throw new ReasoningEffortError('斜杠命令服务尚未就绪。');
        const error = access.commandAccessError(ctx.message.senderId);
        if (error) throw new ReasoningEffortError(error);
        if (canReceive?.(ctx.replyTarget) === false || !access.allowsConversation(scope, peerId)) {
          throw new ReasoningEffortError('此 QQ 会话已暂停或不再获准接入。');
        }
      };
      try {
        assertAllowed();
        if (effort) {
          const label = await manager.setReasoningEffort({
            target: ctx.replyTarget, senderId: ctx.message.senderId, effort, assertAllowed,
          });
          return `✅ 推理强度已设为 ${label}。当前 Session 的下一轮生效。`;
        }
        const { target, selection } = await manager.reasoningSelection(scope, peerId);
        if (!selection) return '暂时无法读取此 Session 的模型选择。';
        const reasoning = await manager.resolveReasoning(selection);
        assertAllowed();
        const lines = [
          '### 推理强度',
          '',
          target === 'current' ? '**当前 Session**' : '**新建 Session 默认值**',
          `模型：${selection.provider}/${selection.model}`,
          `推理强度：${reasoningLabel(selection.reasoningEffort, reasoning?.defaultEffort)}`,
        ];
        if (reasoning?.efforts.length) {
          lines.push('', '**可用档位**');
          for (const { id } of reasoning.efforts) {
            lines.push(/^[a-zA-Z0-9_-]+$/.test(id)
              ? `<qqbot-cmd-input text="/effort ${id}" show="${id}"/>`
              : `/effort ${id}`);
          }
          lines.push('<qqbot-cmd-input text="/effort default" show="恢复默认"/>');
        } else {
          lines.push('', '当前模型没有可选推理档位。');
        }
        if (target === 'next') lines.push('', '请先发一条普通消息建立 Session，再设置推理强度。');
        await sendMarkdownChunked(ctx, lines.join('\n'), config.textChunkLimit);
        return { kind: 'noop' };
      } catch (error) {
        if (classifySessionError(error) === 'session-archived') return ARCHIVED_SESSION_NOTICE;
        if (error instanceof ReasoningEffortError || error instanceof SessionSwitchConflict) return error.message;
        logger?.warn(`QQ /effort failed: ${error instanceof Error ? error.message : String(error)}`);
        return '暂时无法读取或设置推理强度，请稍后重试。';
      }
    },
  };
}
