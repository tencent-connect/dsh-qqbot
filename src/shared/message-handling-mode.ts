/**
 * 会话忙时新消息的处理方式。
 * - queue：当前任务结束后再处理新消息（默认，同 peer 串行 + 忙时缓冲合并）；
 * - interrupt：任务进行中的新消息立即通过 `steer()` 补充到当前任务。
 */
export type MessageHandlingMode = 'queue' | 'interrupt';

/**
 * 枚举值单一来源：config schema、服务端 configSet 校验、client 草稿校验
 * 共用这一份，新增取值时三处同步生效。
 */
export const MESSAGE_HANDLING_MODES: readonly MessageHandlingMode[] = ['queue', 'interrupt'];
