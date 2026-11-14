/**
 * 消息处理方式中间件 —— 决定「当前任务未结束时到达的新消息」去哪。
 *
 * - 排队（queue，默认）：沿用 SDK concurrencyGuard 的 merge 策略。忙时到达的
 *   消息进入缓冲，等当前任务的 handleInbound 在 agent.whenIdle() 收敛后，
 *   缓冲批次才合并下发 —— 新消息严格在当前任务结束后处理。
 *
 * - 插话（interrupt）：复用同一个 guard，但打开 urgentPredicate 恒真通道。
 *   忙时的新消息不进缓冲，立即并行走完剩余中间件链 → handleInbound →
 *   agent.followup()，由 dsh agent 把这条用户消息补充到正在运行的 turn。
 *   SDK 对每个入站事件 fire-and-forget（gateway notify 不 await），所以后一条
 *   消息不会被前一条的 whenIdle() 阻塞。
 *
 * 不变量：插话模式下所有忙时消息都走 urgent 分支，mergeBuffer/mergeWaiters
 * 始终为空，SDK urgent 分支的「清空缓冲」不会丢消息。保留 guard 也保留了
 * maxQueue 与 maxProcessingMs 的超时看门狗，两条路径的生命周期一致。
 *
 * 配置变更（保存设置）会触发 HMR 重载插件，中间件按新模式重新构建，
 * 不存在两种模式混用导致的残留队列。
 */
import { concurrencyGuard } from '@tencent-connect/qqbot-nodejs';
export function createMessageHandlingMiddleware(config) {
    const options = {
        strategy: 'merge',
        maxQueue: config.maxQueue,
        maxProcessingMs: config.processingTimeoutMs,
    };
    if (config.messageHandlingMode === 'interrupt') {
        return concurrencyGuard({ ...options, urgentPredicate: () => true });
    }
    return concurrencyGuard(options);
}
//# sourceMappingURL=message-handling.js.map