/**
 * 待答问题截获中间件 — 在中间件链中截获 ask_user_question 的答案
 *
 * 必须放在 concurrencyGuard 之前：答案消息需绕过并发守卫的 merge 缓冲，
 * 否则会被排队而无法到达 tryAnswer，导致「turn 等答案 ↔ 答案被缓冲」死锁。
 */
import type { QQMiddlewareContext } from './qq-context.ts';
import type { SessionManager } from '../session/index.ts';

export function questionAnswer(manager: SessionManager) {
  return async (ctx: QQMiddlewareContext, next: () => Promise<void>): Promise<void> => {
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
