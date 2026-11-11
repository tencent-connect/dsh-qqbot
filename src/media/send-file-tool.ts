/**
 * 内置 qqbot_send_file 工具 — 将本地文件发送给 QQ 用户或群。
 *
 *   - QQ 会话使用已验证的本轮对话。独立 DSH 会话可以显式指定目标。
 *   - 按扩展名分发到 SDK 的 sendImage / sendVideo / sendVoice / sendFile。
 *   - 路径白名单：默认只允许访问 media 目录 + agent cwd，可开关 + 扩展白名单。
 */
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { ImQQBotConfig } from '../config.ts';
import type { SessionManager } from '../session/index.ts';
import type { Logger, ReplyTarget } from '../types.ts';
import { isPathAllowed, resolveAgentCwd, sendMediaFile, type MediaSenderLike } from './send-media.ts';
import type { DeliveryTargetResolver } from '../transport/turn-tracker.ts';
import { bindDelivery } from '../transport/delivery-context.ts';
import { deliveryKey } from '../transport/delivery-ledger.ts';

/** 工具名（qqbot 前缀避免与其他通道的同名工具冲突） */
export const SEND_FILE_TOOL_NAME = 'qqbot_send_file';

const DESCRIPTION =
  'Send a local file (image, video, voice, or generic file) to the QQ user or group '
  + 'of the current conversation. Pass the absolute path of a file that already exists on disk. '
  + 'Use this when the user asks you to deliver a generated file (chart, report, exported data, '
  + 'screenshot, etc.) or to send an existing media/file back to them.';

/** 发送器与分类发送的共享实现见 send-media.ts（扩展名分发 + 白名单为单一事实源） */
export type { MediaSenderLike, MediaSendResult } from './send-media.ts';

/** tools 服务最小接口 */
interface ToolsRegistryLike {
  register(definition: unknown): unknown;
}

/** qqbot_send_file 的合法参数 */
interface SendFileArgs {
  file_path: string;
  target?: string;
}

/** 解析显式 target（"c2c:openid" / "group:openid"），非法返回 undefined */
function parseTarget(input: string): ReplyTarget | undefined {
  const idx = input.indexOf(':');
  if (idx <= 0) return undefined;
  const scope = input.slice(0, idx);
  const targetId = input.slice(idx + 1);
  if (!targetId || (scope !== 'c2c' && scope !== 'group')) return undefined;
  return { scope, targetId };
}

function samePeer(current: ReplyTarget | undefined, destination: ReplyTarget): boolean {
  return current?.scope === destination.scope && current.targetId === destination.targetId;
}

export interface SendFileRuntime {
  bot: MediaSenderLike;
  manager: Pick<SessionManager, 'findBySessionId' | 'deliveryAddress'>;
  config: Pick<ImQQBotConfig, 'appId' | 'cwd' | 'sendFile'>;
  targets: DeliveryTargetResolver;
  active: () => boolean;
  allowTarget: (target: ReplyTarget) => boolean;
  mediaRoot?: string;
}

interface SendFileRouting {
  runtimes: () => readonly SendFileRuntime[];
  ownerOf: (sessionId: string) => string | undefined;
  defaultAppId: () => string | undefined;
}

/** 注册 qqbot_send_file 工具（tools 服务缺失时优雅降级，不阻断插件启动） */
export function registerSendFileTool(
  ctx: Context,
  routing: SendFileRouting,
  logger: Logger,
): void {
  const tools = ctx.get('tools') as ToolsRegistryLike | undefined;
  if (!tools?.register) {
    logger.warn('im-qqbot: tools 服务不可用，qqbot_send_file 工具未注册');
    return;
  }

  const definition = {
    name: SEND_FILE_TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the local file to send (image/video/voice/generic file).',
        },
        target: {
          type: 'string',
          description: 'Omit in a QQ session, or specify its current conversation only. Use "c2c:openid" or "group:openid" in a standalone DSH session.',
        },
      },
      required: ['file_path'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          fileName: { type: 'string' },
          fileSize: { type: 'integer' },
          target: { type: 'string' },
          fileUuid: { type: 'string' },
          messageId: { type: 'string' },
        },
        required: ['fileName', 'fileSize', 'target', 'fileUuid'],
        additionalProperties: false,
      },
      render: (_args: unknown, value: unknown): ContentBlock[] => {
        const v = value as { fileName: string; target: string };
        return [{ type: 'text', text: `已发送 ${v.fileName} → ${v.target}` }];
      },
    },
    async execute(args: unknown, exec: {
      signal: AbortSignal;
      agent?: { id?: string; session?: { header?: { cwd?: string } } };
      callId?: string;
    }): Promise<Record<string, unknown>> {
      const { file_path, target } = args as SendFileArgs;
      if (typeof file_path !== 'string' || file_path.length === 0) {
        throw new Error('qqbot_send_file: `file_path` must be a non-empty string');
      }

      const agentId = exec.agent?.id;
      if (!agentId || !exec.callId) throw new Error('qqbot_send_file: 缺少原生调用身份，不能确认发送归属');

      const runtimes = routing.runtimes();
      const owners = new Set(runtimes.filter(({ manager }) =>
        manager.findBySessionId(agentId) || manager.deliveryAddress(agentId),
      ).map(({ config }) => config.appId));
      const persistedOwner = routing.ownerOf(agentId);
      if (persistedOwner) owners.add(persistedOwner);
      if (owners.size > 1) throw new Error('qqbot_send_file: 会话归属不唯一，无法发送到 QQ');
      const [owner] = owners;
      const appId = owner ?? routing.defaultAppId();
      const runtime = runtimes.find(candidate => candidate.config.appId === appId);
      if (!runtime?.active()) throw new Error('qqbot_send_file: 无法确定启用的 QQ 账号');

      const { bot, config, targets, allowTarget, mediaRoot } = runtime;
      const explicit = target ? parseTarget(target) : undefined;
      if (target && !explicit) {
        throw new Error('qqbot_send_file: target 格式错误，需要 c2c:openid 或 group:openid');
      }
      const current = owner === undefined ? undefined : targets.targetFor(agentId);
      if (owner !== undefined && !current) throw new Error('qqbot_send_file: 当前来源不允许发送到 QQ');
      if (current && explicit && !samePeer(current, explicit)) {
        throw new Error('qqbot_send_file: QQ 会话只能发送文件到当前对话');
      }
      const destination = current ?? explicit;
      if (!destination) throw new Error('qqbot_send_file: 无法确定发送目标');
      const allowed = () => runtime.active() && !exec.signal.aborted && allowTarget(destination)
        && (owner === undefined ? routing.defaultAppId() === appId : samePeer(targets.targetFor(agentId), destination));
      if (!allowed()) throw new Error('qqbot_send_file: 当前来源或目标不允许发送到 QQ');
      const replyTarget = bindDelivery(destination, {
        key: deliveryKey('file-tool', agentId, exec.callId), sessionId: owner ? agentId : undefined, allowed, fixed: true,
      });

      const sessionCwd = owner === undefined ? undefined : exec.agent?.session?.header?.cwd;
      const cwd = resolveAgentCwd(sessionCwd || config.cwd);
      const absPath = resolve(file_path);
      if (!isPathAllowed(absPath, config.sendFile, cwd, mediaRoot)) {
        throw new Error(`qqbot_send_file: file_path 不在允许的目录内: ${absPath}`);
      }
      if (!existsSync(absPath)) {
        throw new Error(`qqbot_send_file: 文件不存在: ${absPath}`);
      }

      // 3. 按扩展名分类发送（与交付物投递共用 send-media 的分发实现）
      const fileName = basename(absPath);
      const result = await sendMediaFile(bot, replyTarget, absPath);
      if (result.outcome === 'missing') {
        throw new Error(`qqbot_send_file: 文件不存在或不可读: ${absPath}`);
      }
      if (result.outcome === 'already-submitted') {
        throw new Error(`qqbot_send_file: ${result.error}`);
      }
      if (result.outcome === 'failed') {
        throw new Error(`qqbot_send_file: 发送失败: ${result.error}`);
      }

      logger.info(`im-qqbot: qqbot_send_file 发送 ${fileName} (${result.size} bytes) → ${replyTarget.scope}:${replyTarget.targetId}`);

      return {
        fileName,
        fileSize: result.size,
        target: `${replyTarget.scope}:${replyTarget.targetId}`,
        fileUuid: result.fileUuid ?? '',
        ...(result.messageId !== undefined ? { messageId: result.messageId } : {}),
      };
    },
  };

  tools.register(definition);
  logger.info('im-qqbot: qqbot_send_file 工具已注册');
}
