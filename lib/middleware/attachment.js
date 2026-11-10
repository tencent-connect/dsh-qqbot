import { downloadMediaAttachments } from "../transport/attachment.js";
export function attachmentProcessor(config, logger, mediaRoot) {
    return async (ctx, next) => {
        const msg = ctx.message;
        try {
            // 当前消息附件
            const downloaded = await downloadMediaAttachments(msg.attachments, config.media, logger, mediaRoot);
            ctx.state.downloadedFiles = downloaded;
            // 引用消息附件：转成 RawAttachment 结构复用下载（voice 由 downloadMediaAttachments 自动跳过）
            const quoteAttachments = ctx.state.quote?.attachments;
            if (quoteAttachments && quoteAttachments.length > 0) {
                const rawQuote = quoteAttachments
                    .filter(a => a.url)
                    .map((a) => ({
                    content_type: a.contentType ?? '',
                    filename: a.filename ?? '',
                    size: 0,
                    url: a.url,
                }));
                const downloadedQuote = await downloadMediaAttachments(rawQuote, config.media, logger, mediaRoot);
                ctx.state.downloadedQuoteFiles = downloadedQuote;
            }
        }
        catch (err) {
            logger.warn(`im-qqbot: attachment download failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        await next();
    };
}
//# sourceMappingURL=attachment.js.map