export function questionAnswer(manager, replyIds) {
    return async (ctx, next) => {
        const questionChannel = manager.questionChannel;
        if (!questionChannel) {
            await next();
            return;
        }
        if (questionChannel.tryAnswer(ctx.replyTarget.scope, ctx.replyTarget.targetId, ctx.message.content.trim())) {
            // 答案消息被截获（不再走到 bot.on('message')），在此补录其 msgId，
            // 供被动回复超限时切换到缓存的最近 msgId。
            replyIds.cacheMsgId(ctx.replyTarget.scope, ctx.replyTarget.targetId, ctx.replyTarget.msgId);
            ctx.stop('question-answer');
            return;
        }
        await next();
    };
}
//# sourceMappingURL=question-answer.js.map