/**
 * 富媒体过期清理 — 避免下载文件持续膨胀
 *
 * 下载目录 ~/.dsh-qqbot/media，文件写入后不再变更，故文件 mtime 即「下载时间」。
 * 清理时按文件 mtime 判断是否超过保留时长。
 */
import { existsSync } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PLUGIN_HOME } from "../shared/dirs.js";
/** 富媒体下载根目录（attachment.ts 复用） */
export const MEDIA_ROOT = resolve(PLUGIN_HOME, 'media');
/** 定期清理间隔（毫秒），固定 1 小时 */
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
/**
 * 清理过期的富媒体文件（按文件 mtime 判断，异步并发执行，不阻塞事件循环）
 *
 * @param ttlHours 保留时长（小时），<=0 表示永不过期（跳过清理）
 * @returns 删除的文件数
 */
export async function cleanupExpiredMedia(ttlHours, logger, mediaRoot = MEDIA_ROOT) {
    if (ttlHours <= 0)
        return 0;
    if (!existsSync(mediaRoot))
        return 0;
    const now = Date.now();
    const ttlMs = ttlHours * 60 * 60 * 1000;
    const entries = await readdir(mediaRoot, { withFileTypes: true });
    const files = entries.filter(entry => entry.isFile()).map(entry => entry.name);
    const results = await Promise.all(files.map(async (name) => {
        const filePath = join(mediaRoot, name);
        try {
            const info = await stat(filePath);
            if (now - info.mtimeMs <= ttlMs)
                return false;
            await rm(filePath, { force: true });
            logger?.debug(`im-qqbot: cleaned expired media: ${name}`);
            return true;
        }
        catch (err) {
            logger?.warn(`im-qqbot: media cleanup failed for ${name}: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    }));
    return results.filter(Boolean).length;
}
/**
 * 启动富媒体过期清理：启动时清理一次 + 定期清理（每 1 小时）
 *
 * 用 ctx.effect 挂载定时器，插件卸载时自动 clearInterval。
 * ttlHours <= 0 时不启动（永不过期）。
 */
export function startMediaCleanup(ctx, ttlHours, logger, mediaRoot = MEDIA_ROOT) {
    if (ttlHours <= 0)
        return;
    logger.info(`im-qqbot: media cleanup started (ttl=${ttlHours}h, interval=1h, root=${mediaRoot})`);
    // 启动时立即清理一次（异步，不阻塞启动流程）
    void cleanupExpiredMedia(ttlHours, logger, mediaRoot)
        .then((cleaned) => {
        if (cleaned > 0)
            logger.info(`im-qqbot: cleaned ${cleaned} expired media files`);
    })
        .catch((err) => {
        logger.warn(`im-qqbot: media cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    ctx
        .effect(() => {
        const timer = setInterval(() => {
            void cleanupExpiredMedia(ttlHours, logger, mediaRoot)
                .then((n) => {
                if (n > 0)
                    logger.info(`im-qqbot: cleaned ${n} expired media files`);
            })
                .catch((err) => {
                logger.warn(`im-qqbot: media cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
            });
        }, CLEANUP_INTERVAL_MS);
        return async () => { clearInterval(timer); };
    }, 'im-qqbot.media-cleanup');
}
//# sourceMappingURL=media-cleaner.js.map