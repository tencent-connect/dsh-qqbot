import { rm } from 'node:fs/promises';
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { MediaConfig } from '../config.ts';
import type { Logger, ReplyTarget } from '../types.ts';
import { MAX_TIMELINE_IMAGES } from '../shared/workbench-timeline-protocol.ts';
import { downloadMediaAttachments, isImageContentType } from '../transport/attachment.ts';
import { receivedEntryId, type QqTimeline } from './qq-timeline.ts';

const maxConcurrentPreviews = 4;

/** Cache images for messages stopped by the mention gate, independently of Agent input. */
export function timelinePreviews({ appId, timeline, media, mediaRoot, canRecord, getAccessToken, logger }: {
  appId: string;
  timeline: QqTimeline;
  media: MediaConfig;
  mediaRoot?: string | undefined;
  canRecord: (target: ReplyTarget) => boolean;
  getAccessToken: () => Promise<string>;
  logger: Logger;
}) {
  const lifetime = new AbortController();
  const pending = new Set<Promise<void>>();
  return {
    record({ replyTarget, message }: MiddlewareContext): void {
      if (lifetime.signal.aborted || !media.enabled || !replyTarget.msgId || pending.size >= maxConcurrentPreviews
        || !canRecord(replyTarget)) return;
      const attachments = (message.attachments ?? [])
        .filter(a => a && typeof a.url === 'string' && isImageContentType(a.content_type))
        .slice(0, MAX_TIMELINE_IMAGES)
        .map(a => ({ ...a, filename: typeof a.filename === 'string' ? a.filename : 'image', size: a.size ?? 0 }));
      if (!attachments.length) return;
      const stored = timeline.entry(appId, replyTarget, receivedEntryId(replyTarget.msgId));
      if (!stored || stored.imageCount || stored.text === '配对码已隐藏') return;
      const task = (async () => {
        const files = await downloadMediaAttachments(attachments, media, logger, mediaRoot, {
          signal: lifetime.signal, getAccessToken, imagesOnly: true,
        });
        const paths = files.map(file => file.localPath);
        if (!lifetime.signal.aborted && canRecord(replyTarget) && timeline.recordImages(appId, replyTarget, paths)) return;
        await Promise.allSettled(paths.map(path => rm(path, { force: true })));
      })().catch(() => {
        if (!lifetime.signal.aborted) logger.warn('im-qqbot: could not save timeline image previews');
      });
      pending.add(task);
      void task.then(() => pending.delete(task));
    },
    async close(): Promise<void> {
      lifetime.abort();
      await Promise.allSettled(pending);
    },
  };
}
