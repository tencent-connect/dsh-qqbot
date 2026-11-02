export function questionAnswer(manager) {
    return async (ctx, next) => {
        const answered = manager.questionChannel?.tryAnswer(ctx.replyTarget.scope, ctx.replyTarget.targetId, ctx.message.content.trim(), ctx.message.senderId) ?? false;
        // A question may expire while the admitted answer waits for ingestion.
        // Keep that message out of the ordinary Agent turn path even then.
        if (answered || ctx.state.qqRecord?.provenance === 'interaction') {
            ctx.stop('question-answer');
            return;
        }
        await next();
    };
}
//# sourceMappingURL=question-answer.js.map