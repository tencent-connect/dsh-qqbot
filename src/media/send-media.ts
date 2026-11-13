/**
 * 共享的媒体文件发送 — 按扩展名分发到 SDK 的四类发送器
 *
 * 单一事实源：qqbot_send_file 工具与交付物投递（present 声明的文件）共用
 * 同一套扩展名分类与路径白名单，行为不会漂移。
 */
import { stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { ReplyTarget } from '../types.ts';
import type { SendFileConfig } from '../config.ts';
import { MEDIA_ROOT } from './media-cleaner.ts';
import { MediaAlreadySubmitted } from '../transport/delivery-errors.ts';
import { resolveAgentCwd } from '../shared/dirs.ts';

export { resolveAgentCwd };

/** 发送器最小接口（QQBot 实例满足） */
export interface MediaSendResult {
  upload: { file_uuid: string };
  message?: { id?: string };
}

export interface MediaSenderLike {
  sendImage(target: ReplyTarget, source: { localPath?: string }): Promise<MediaSendResult>;
  sendVideo(target: ReplyTarget, source: { localPath?: string }): Promise<MediaSendResult>;
  sendVoice(target: ReplyTarget, source: { localPath?: string }): Promise<MediaSendResult>;
  sendFile(target: ReplyTarget, source: { localPath?: string }, opts?: { fileName?: string }): Promise<MediaSendResult>;
}

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
const VOICE_EXTS = new Set(['.mp3', '.wav', '.ogg', '.aac', '.silk', '.amr']);

/**
 * 解析路径的真实形态：存在的部分全部 realpath（防目录级符号链接逃逸），
 * 不存在的尾部段保持词法拼接（macOS 的 /var → /private/var 等系统级
 * symlink 前缀因此被正确展开，不会与 root 的真实前缀错位）。
 */
function realishPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    const abs = resolve(p);
    const segments = abs.split('/').filter(Boolean);
    for (let i = segments.length; i > 0; i -= 1) {
      const prefix = `/${segments.slice(0, i).join('/')}`;
      try {
        return join(realpathSync(prefix), ...segments.slice(i));
      } catch {
        continue;
      }
    }
    return abs;
  }
}

/**
 * 判断 filePath 是否位于 root 目录内（含 root 本身）。
 *
 * root 侧 realpath 解析符号链接；file 不存在时按最近存在祖先解析
 * （存在性由调用方 existsSync/stat 兜底，不应把「文件不存在」误报成
 * 「路径不允许」）；root 不存在则该 root 无效。
 */
export function isWithinRoot(filePath: string, root: string): boolean {
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return false; // root 不可解析（不存在/坏链接）→ 该 root 无效
  }
  const rel = relative(realRoot, realishPath(filePath));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** 路径白名单校验：restrictPaths 关闭时放行任意路径，否则限定 media + cwd + extraRoots */
export function isPathAllowed(filePath: string, config: SendFileConfig, cwd: string, mediaRoot = MEDIA_ROOT): boolean {
  if (!config.restrictPaths) return true;
  const roots = [mediaRoot, cwd, ...config.extraRoots];
  return roots.some((root) => isWithinRoot(filePath, root));
}

/** sendMediaFile 的结果：成功附带元数据；缺失不抛错；失败携带原因供日志与错误信息透出 */
export type SendMediaResult =
  | { outcome: 'sent'; size: number; fileUuid?: string; messageId?: string }
  | { outcome: 'missing' }
  | { outcome: 'already-submitted'; error: string }
  | { outcome: 'failed'; error: string };

/**
 * 按扩展名分类发送一个本地文件
 *
 * 文件不存在、不是普通文件时返回 missing（不抛错，调用方决定降级文案）；
 * 平台发送失败返回 failed。文件名透传给通用文件通道。
 */
export async function sendMediaFile(
  bot: MediaSenderLike,
  target: ReplyTarget,
  filePath: string,
  opts: { fileName?: string } = {},
): Promise<SendMediaResult> {
  let size: number;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return { outcome: 'missing' };
    size = info.size;
  } catch {
    return { outcome: 'missing' };
  }

  const fileName = opts.fileName ?? basename(filePath);
  const ext = extname(filePath).toLowerCase();
  const source = { localPath: filePath };

  try {
    const result = ext === '.gif' || IMAGE_EXTS.has(ext)
      ? await bot.sendImage(target, source)
      : VIDEO_EXTS.has(ext)
        ? await bot.sendVideo(target, source)
        : VOICE_EXTS.has(ext)
          ? await bot.sendVoice(target, source)
          : await bot.sendFile(target, source, { fileName });
    return {
      outcome: 'sent',
      size,
      ...(result.upload.file_uuid !== undefined ? { fileUuid: result.upload.file_uuid } : {}),
      ...(result.message?.id !== undefined ? { messageId: result.message.id } : {}),
    };
  } catch (err) {
    if (err instanceof MediaAlreadySubmitted) return { outcome: 'already-submitted', error: err.message };
    return { outcome: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
}
