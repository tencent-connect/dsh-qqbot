/**
 * 文件出站发送 — 识别 agent 输出中的 [[FILE:path]] 标记并发送到 QQ。
 *
 * 标记协议（一行一个）：
 *   [[FILE:/abs/path/to/file]]              → 文件名取 basename
 *   [[FILE:/abs/path|display.txt]]          → 指定 QQ 显示文件名
 *
 * 设计约束：
 *   - 标记本身不透传给用户（从文本中剥离）
 *   - 文件不存在/发送失败：记录日志并降级提示，绝不抛出（出站尽力而为）
 *   - 未闭合的标记（[[FILE: 后未出现 ]]）剥离并提示，避免半个标记透传
 */
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import type { Logger, ReplyTarget } from '../types.js';
import type { QQBotFileSender } from './outbound-buffer.js';

/** 完整闭合标记（允许空内容，空内容降级为提示） */
export const FILE_TAG_RE = /\[\[FILE:([^\]]*)\]\]/g;
/** 未闭合标记（从 [[FILE: 到文本结尾，未出现 ]]） */
export const OPEN_TAG_RE = /\[\[FILE:[^\]]*$/g;
/** 未闭合文件标记的最大拦截长度，超过则放弃等待按普通文本降级 */
export const FILE_TAG_MAX_HOLD = 400;

/**
 * 从完整文本中提取所有闭合标记并触发发送，返回清理后的文本。
 * 同步返回；文件发送为 fire-and-forget（错误在内部记录，不抛出）。
 */
export function processFileMarkers(
  bot: QQBotFileSender,
  target: ReplyTarget,
  text: string,
  logger: Logger,
): string {
  return text
    .replace(FILE_TAG_RE, (_match, expr: string | undefined) => {
      const pathExpr = (expr ?? '').trim();
      if (!pathExpr) return '⚠️ 文件标记为空';
      void sendMarkerFile(bot, target, pathExpr, logger);
      return '';
    })
    .replace(OPEN_TAG_RE, (m) => `⚠️ 文件标记未闭合: \`${m.slice(7)}\``);
}

/** 解析 "path" 或 "path|fileName" */
export function splitPathExpr(pathExpr: string): { localPath: string; fileName: string } {
  const bar = pathExpr.indexOf('|');
  if (bar === -1) return { localPath: pathExpr, fileName: basename(pathExpr) };
  const localPath = pathExpr.slice(0, bar).trim();
  const fileName = pathExpr.slice(bar + 1).trim() || basename(localPath);
  return { localPath, fileName };
}

/** 发送单个标记文件（异步，错误内部消化） */
export async function sendMarkerFile(
  bot: QQBotFileSender,
  target: ReplyTarget,
  pathExpr: string,
  logger: Logger,
): Promise<void> {
  const { localPath, fileName } = splitPathExpr(pathExpr);
  if (bot.sendFile === undefined) {
    logger.warn('im-qqbot: sendFile unavailable on bot instance (SDK too old?)');
    return;
  }
  if (!localPath || !existsSync(localPath)) {
    logger.warn(`im-qqbot: file not found: ${localPath}`);
    return;
  }
  try {
    const res = await bot.sendFile(target, { localPath }, { fileName });
    if (!res.message) {
      logger.warn(`im-qqbot: sendFile no message (missing file permission?): ${fileName}`);
      return;
    }
    logger.info(`im-qqbot: file sent: ${fileName} (${localPath})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`im-qqbot: sendFile failed: ${fileName} — ${msg}`);
  }
}
