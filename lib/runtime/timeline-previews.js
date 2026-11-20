import { rm } from 'node:fs/promises';
import { MAX_TIMELINE_IMAGES } from "../shared/workbench-timeline-protocol.js";
import { downloadMediaAttachments, isImageContentType } from "../transport/attachment.js";
import { receivedEntryId } from "./qq-timeline.js";
const maxConcurrentPreviews = 4;
/** Cache images for messages stopped by the mention gate, independently of Agent input. */
export function timelinePreviews({ appId, timeline, media, mediaRoot, canRecord, getAccessToken, logger }) {
    const lifetime = new AbortController();
    const pending = new Set();
    return {
        record({ replyTarget, message }) {
            if (lifetime.signal.aborted || !media.enabled || !replyTarget.msgId || pending.size >= maxConcurrentPreviews
                || !canRecord(replyTarget))
                return;
            const attachments = (message.attachments ?? [])
                .filter(a => a && typeof a.url === 'string' && isImageContentType(a.content_type))
                .slice(0, MAX_TIMELINE_IMAGES)
                .map(a => ({ ...a, filename: typeof a.filename === 'string' ? a.filename : 'image', size: a.size ?? 0 }));
            if (!attachments.length)
                return;
            const stored = timeline.entry(appId, replyTarget, receivedEntryId(replyTarget.msgId));
            if (!stored || stored.imageCount || stored.text === '配对码已隐藏')
                return;
            const task = (async () => {
                const files = await downloadMediaAttachments(attachments, media, logger, mediaRoot, {
                    signal: lifetime.signal, getAccessToken, imagesOnly: true,
                });
                const paths = files.map(file => file.localPath);
                if (!lifetime.signal.aborted && canRecord(replyTarget) && timeline.recordImages(appId, replyTarget, paths))
                    return;
                await Promise.allSettled(paths.map(path => rm(path, { force: true })));
            })().catch(() => {
                if (!lifetime.signal.aborted)
                    logger.warn('im-qqbot: could not save timeline image previews');
            });
            pending.add(task);
            void task.then(() => pending.delete(task));
        },
        async close() {
            lifetime.abort();
            await Promise.allSettled(pending);
        },
    };
}
//# sourceMappingURL=timeline-previews.js.map