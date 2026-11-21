/**
 * 消息处理方式中间件 — 决定「会话忙时的新消息」去哪。
 *
 * - queue（默认）：concurrencyGuard merge，同 peer 串行 + 忙时缓冲合并；
 *   maxQueue 是缓冲上限，maxProcessingMs 超时释放锁并 drain（turn 不自动取消）。
 * - interrupt：不挂守卫，消息直达 handleInbound 由 agent.steer() 补充到当前
 *   任务；并发安全由宿主 inbox 保证，超时对齐宿主自身的 LLM/工具超时。
 *
 * followup/steer 的分派在 handleInbound（拿到 agent 才能读 status）。
 */
import { concurrencyGuard } from '@tencent-connect/qqbot-nodejs';
/** queue 模式返回并发守卫；interrupt 模式返回 undefined（不挂守卫）。 */
export function createMessageHandlingMiddleware(config) {
    if (config.messageHandlingMode === 'interrupt')
        return undefined;
    return concurrencyGuard({
        strategy: 'merge',
        maxQueue: config.maxQueue,
        maxProcessingMs: config.processingTimeoutMs,
    });
}
//# sourceMappingURL=message-handling.js.map