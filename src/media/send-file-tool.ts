/**
 * 内置 qqbot_send_file 工具 — 将本地文件发送给 QQ 用户或群。
 *
 *   - 发送目标默认自动定位（exec.agent → SessionManager.findByAgent → replyTarget），
 *     无需模型手动传 openid；显式 target 参数作为覆盖。
 *   - 按扩展名分发到 SDK 的 sendImage / sendVideo / sendVoice / sendFile。
 *   - 路径白名单：默认只允许访问 media 目录 + agent cwd，可开关 + 扩展白名单。
 */
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { ImQQBotConfig, SendFileConfig } from '../config.js';
import type { DshAgent, SessionManager } from '../session/index.js';
import type { Logger, ReplyTarget } from '../types.js';
import { MEDIA_ROOT } from './media-cleaner.js';

/** 工具名（qqbot 前缀避免与其他通道的同名工具冲突） */
export const SEND_FILE_TOOL_NAME = 'qqbot_send_file';

const DESCRIPTION =
  'Send a local file (image, video, voice, or generic file) to the QQ user or group '
  + 'of the current conversation. Pass the absolute path of a file that already exists on disk. '
  + 'Use this when the user asks you to deliver a generated file (chart, report, exported data, '
  + 'screenshot, etc.) or to send an existing media/file back to them.';

/** 发送器最小接口（QQBot 实例满足） */
interface MediaSendResult {
  upload: { file_uuid: string };
  message?: { id?: string };
}

interface MediaSenderLike {
  sendImage(target: ReplyTarget, source: { localPath?: string }): Promise<MediaSendResult>;
  sendVideo(target: ReplyTarget, source: { localPath?: string }): Promise<MediaSendResult>;
  sendVoice(target: ReplyTarget, source: { localPath?: string }): Promise<MediaSendResult>;
  sendFile(target: ReplyTarget, source: { localPath?: string }, opts?: { fileName?: string }): Promise<MediaSendResult>;
}

/** tools 服务最小接口 */
interface ToolsRegistryLike {
  register(definition: unknown): unknown;
}

/** qqbot_send_file 的合法参数 */
interface SendFileArgs {
  file_path: string;
  target?: string;
}

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
const VOICE_EXTS = new Set(['.mp3', '.wav', '.ogg', '.aac', '.silk', '.amr']);

/** 解析显式 target（"c2c:openid" / "group:openid"），非法返回 undefined */
function parseTarget(input: string): ReplyTarget | undefined {
  const idx = input.indexOf(':');
  if (idx <= 0) return undefined;
  const scope = input.slice(0, idx);
  const targetId = input.slice(idx + 1);
  if (!targetId || (scope !== 'c2c' && scope !== 'group')) return undefined;
  return { scope, targetId };
}

/** 判断 filePath 是否位于 root 目录内（含 root 本身） */
function isWithinRoot(filePath: string, root: string): boolean {
  const rel = relative(resolve(root), filePath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** 路径白名单校验：restrictPaths 关闭时放行任意路径，否则限定 media + cwd + extraRoots */
function isPathAllowed(filePath: string, config: SendFileConfig, cwd: string): boolean {
  if (!config.restrictPaths) return true;
  const roots = [MEDIA_ROOT, cwd, ...config.extraRoots];
  return roots.some((root) => isWithinRoot(filePath, root));
}

/** 注册 qqbot_send_file 工具（tools 服务缺失时优雅降级，不阻断插件启动） */
export function registerSendFileTool(
  ctx: Context,
  bot: MediaSenderLike,
  manager: SessionManager,
  config: ImQQBotConfig,
  logger: Logger,
): void {
  const tools = ctx.get('tools') as ToolsRegistryLike | undefined;
  if (!tools?.register) {
    logger.warn('im-qqbot: tools 服务不可用，qqbot_send_file 工具未注册');
    return;
  }

  const cwd = config.cwd || process.cwd();

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
          description: 'Optional send target as "c2c:openid" or "group:openid". Omit to send to the current conversation.',
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
    async execute(args: unknown, exec: { signal: AbortSignal; agent?: unknown }): Promise<Record<string, unknown>> {
      const { file_path, target } = args as SendFileArgs;
      if (typeof file_path !== 'string' || file_path.length === 0) {
        throw new Error('qqbot_send_file: `file_path` must be a non-empty string');
      }

      // 1. 解析发送目标：显式 target > 当前会话（exec.agent → SessionRecord）
      let replyTarget: ReplyTarget | undefined;
      if (target !== undefined && target !== '') {
        replyTarget = parseTarget(target);
        if (replyTarget === undefined) {
          throw new Error(`qqbot_send_file: target 格式错误，需要 c2c:openid 或 group:openid，收到: ${target}`);
        }
      } else if (exec.agent !== undefined) {
        replyTarget = manager.findByAgent(exec.agent as DshAgent)?.replyTarget;
      }
      if (replyTarget === undefined) {
        throw new Error('qqbot_send_file: 无法确定发送目标，请显式传 target 参数');
      }

      // 2. 校验文件 + 路径白名单
      const absPath = resolve(file_path);
      if (!isPathAllowed(absPath, config.sendFile, cwd)) {
        throw new Error(`qqbot_send_file: file_path 不在允许的目录内: ${absPath}`);
      }
      if (!existsSync(absPath)) {
        throw new Error(`qqbot_send_file: 文件不存在: ${absPath}`);
      }
      const info = await stat(absPath);
      if (!info.isFile()) {
        throw new Error(`qqbot_send_file: 路径不是普通文件: ${absPath}`);
      }

      // 3. 按扩展名分类发送
      const fileName = basename(absPath);
      const ext = absPath.slice(absPath.lastIndexOf('.')).toLowerCase();
      const source = { localPath: absPath };

      let result: MediaSendResult;
      if (IMAGE_EXTS.has(ext)) {
        result = await bot.sendImage(replyTarget, source);
      } else if (VIDEO_EXTS.has(ext)) {
        result = await bot.sendVideo(replyTarget, source);
      } else if (VOICE_EXTS.has(ext)) {
        result = await bot.sendVoice(replyTarget, source);
      } else {
        result = await bot.sendFile(replyTarget, source, { fileName });
      }

      logger.info(`im-qqbot: qqbot_send_file 发送 ${fileName} (${info.size} bytes) → ${replyTarget.scope}:${replyTarget.targetId}`);

      return {
        fileName,
        fileSize: info.size,
        target: `${replyTarget.scope}:${replyTarget.targetId}`,
        fileUuid: result.upload.file_uuid,
        ...(result.message?.id !== undefined ? { messageId: result.message.id } : {}),
      };
    },
  };

  tools.register(definition);
  logger.info('im-qqbot: qqbot_send_file 工具已注册');
}
