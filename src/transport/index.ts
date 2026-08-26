/**
 * 传输层
 *
 * 协议对接：QQ 消息入站 / 出站 / Markdown 切分。
 */
export { handleInbound } from './inbound.ts';
export { createOutboundHandler } from './outbound.ts';
export { OutboundBuffer, type QQBotSender } from './outbound-buffer.ts';
export { chunkMarkdownText } from './chunker.ts';
