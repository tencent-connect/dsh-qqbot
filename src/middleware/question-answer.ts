/**
 * 待答问题截获中间件 — 在中间件链中截获 ask_user_question 的答案
 *
 * 必须放在 concurrencyGuard 之前：答案消息需绕过并发守卫的 merge 缓冲，
 * 否则会被排队而无法到达 tryAnswer，导致「turn 等答案 ↔ 答案被缓冲」死锁。
 */
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { SessionManager } from '../session/index.ts';
import type { ReplyIdCache } from '../transport/msgid-cache.ts';

export function questionAnswer(manager: SessionManager, replyIds: ReplyIdCache) {
  return async (ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> => {
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
