/**
 * 传输层
 *
 * 协议对接：QQ 消息入站 / 出站 / Markdown 切分。
 */
export { handleInbound } from "./inbound.js";
export { createOutboundHandler, createTurnTracker } from "./outbound.js";
export { TurnTracker } from "./turn-tracker.js";
export { QqInputRegistry } from "./qq-input-origin.js";
export { OutboundBuffer } from "./outbound-buffer.js";
export { chunkMarkdownText } from "./chunker.js";
//# sourceMappingURL=index.js.map