export function questionAnswer(manager) {
    return async (ctx, next) => {
        const questionChannel = manager.questionChannel;
        if (!questionChannel) {
            await next();
            return;
        }
        if (questionChannel.tryAnswer(ctx.replyTarget.scope, ctx.replyTarget.targetId, ctx.message.content.trim(), ctx.message.senderId)) {
            ctx.stop('question-answer');
            return;
        }
        await next();
    };
}
//# sourceMappingURL=question-answer.js.map