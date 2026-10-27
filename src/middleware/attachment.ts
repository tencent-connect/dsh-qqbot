/**
 * 富媒体下载中间件 — 在中间件链中下载 image/video/file 附件
 *
 * 结果写入 ctx.state.downloadedFiles，供 handleInbound 读取。
 * 下载失败不阻断消息（记录告警后放行），确保附件异常不影响正常文本处理。
 */
import type { Middleware, MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import { downloadMediaAttachments, isImageContentType } from '../transport/attachment.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger, QuotedAttachment, RawAttachment } from '../types.ts';
import type { DownloadedFile } from '../transport/attachment.ts';

export function groupImagePreloader(config: ImQQBotConfig, logger: Logger): Middleware {
  return async (ctx, next) => {
    if (ctx.message.kind === 'group') {
      const attachments = ctx.message.attachments ?? [];
      const images: RawAttachment[] = attachments
        .filter(attachment => isImageContentType(attachment.content_type))
        .map(attachment => ({
          content_type: attachment.content_type,
          filename: attachment.filename ?? 'image',
          size: attachment.size ?? 0,
          url: attachment.url,
          width: attachment.width,
          height: attachment.height,
        }));
      try {
        ctx.state.preDownloadedFiles = await downloadMediaAttachments(images, config.media, logger);
      } catch (err) {
        logger.warn(`im-qqbot: group image pre-download failed: ${err instanceof Error ? err.message : String(err)}`);
        ctx.state.preDownloadedFiles = [];
      }
    }
    await next();
  };
}

export function attachmentProcessor(config: ImQQBotConfig, logger: Logger) {
  return async (ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> => {
    const msg = ctx.message;
    try {
      const preDownloaded: DownloadedFile[] = Array.isArray(ctx.state.preDownloadedFiles) ? ctx.state.preDownloadedFiles : [];
      const remaining = (msg.attachments ?? []).filter(attachment =>
        !preDownloaded.some(file => file.contentType === 'image' && file.filename === (attachment.filename ?? 'attachment') && isImageContentType(attachment.content_type)),
      );
      const downloadedRemaining = remaining.length === 0
        ? []
        : await downloadMediaAttachments(remaining.map(attachment => ({
          content_type: attachment.content_type,
          filename: attachment.filename ?? 'attachment',
          size: attachment.size ?? 0,
          url: attachment.url,
        })), config.media, logger);
      ctx.state.downloadedFiles = [...preDownloaded, ...downloadedRemaining];
      const quoteAttachments = (ctx.state as { quote?: { attachments?: QuotedAttachment[] } }).quote?.attachments;
      if (quoteAttachments && quoteAttachments.length > 0) {
        const rawQuote = quoteAttachments.filter(a => a.url).map((a): RawAttachment => ({
          content_type: a.contentType ?? '', filename: a.filename ?? '', size: 0, url: a.url as string,
        }));
        ctx.state.downloadedQuoteFiles = await downloadMediaAttachments(rawQuote, config.media, logger);
      }
    } catch (err) {
      logger.warn(`im-qqbot: attachment download failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    await next();
  };
}
