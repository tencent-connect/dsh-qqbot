/**
 * 待答问题截获中间件 — 在中间件链中截获 ask_user_question 的答案
 *
 * 必须放在 concurrencyGuard 之前：答案消息需绕过并发守卫的 merge 缓冲，
 * 否则会被排队而无法到达 tryAnswer，导致「turn 等答案 ↔ 答案被缓冲」死锁。
 */
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { SessionManager } from '../session/index.js';

export function questionAnswer(manager: SessionManager) {
  return async (ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> => {
    const questionChannel = manager.questionChannel;
    if (!questionChannel) {
      await next();
      return;
    }
    if (questionChannel.tryAnswer(ctx.replyTarget.scope, ctx.replyTarget.targetId, ctx.message.content.trim())) {
      ctx.stop('question-answer');
      return;
    }
    await next();
  };
}
