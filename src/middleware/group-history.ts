import type { Middleware, MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { GroupHistoryEntry, GroupHistoryStore } from '../features/history-store.ts';
import type { DownloadedFile } from '../transport/attachment.ts';

export function createGroupHistoryBuffer(options: {
  limit: number;
  store: GroupHistoryStore;
  groupKey: (ctx: MiddlewareContext) => string | undefined;
}): Middleware {
  return async (ctx, next) => {
    if (ctx.message.kind !== 'group') {
      await next();
      return;
    }
    const key = options.groupKey(ctx);
    if (!key) {
      await next();
      return;
    }
    ctx.state.history = await options.store.list(key, options.limit);
    const attachments = ctx.message.attachments ?? [];
    const preDownloaded: DownloadedFile[] = Array.isArray(ctx.state.preDownloadedFiles) ? ctx.state.preDownloadedFiles : [];
    const images = attachments
      .filter(attachment => attachment.content_type === 'image' || attachment.content_type.startsWith('image/'))
      .map(attachment => {
        const filename = attachment.filename ?? 'image';
        const downloaded = preDownloaded.find(file => file.contentType === 'image' && file.filename === filename);
        return {
          contentType: attachment.content_type,
          filename,
          size: attachment.size ?? 0,
          url: attachment.url,
          ...(attachment.width === undefined ? {} : { width: attachment.width }),
          ...(attachment.height === undefined ? {} : { height: attachment.height }),
          ...(downloaded ? { localPath: downloaded.localPath } : {}),
        };
      });
    const entry: GroupHistoryEntry = {
      senderId: ctx.message.senderId,
      senderName: ctx.message.senderName,
      content: ctx.message.content,
      timestamp: Date.parse(ctx.message.timestamp) || Date.now(),
      messageId: ctx.message.messageId,
      ...(images.length ? { images } : {}),
    };
    await options.store.append(key, entry, options.limit);
    await next();
  };
}
