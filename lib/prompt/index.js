/**
 * QQ 插件 prompt 构造统一入口（唯一 owner）。
 *
 * 分层：
 *  - system 稳定段：rules / scope(群/私) / persona(role-card) / extra(补充词) —— 由 session-manager 用 systemPrompt.section() 注册
 *  - runtime context：turn-meta —— 由 systemPrompt.context() 注册为 user 快照
 *  - user 本轮正文：inbound 传入用户真实内容（引用块由 inbound 的 buildQuotePart 产出），见 assembleUserBlocks
 *
 * 所有面向前端的文本集中在本目录；inbound / session-manager 只调用，不写死文案。
 */
export * from "./rules.js";
export * from "./scope.js";
export * from "./persona.js";
export * from "./extra.js";
export * from "./turn-meta.js";
export { assembleUserBlocks } from "./user-blocks.js";
export { installQQPrompt } from "./install.js";
//# sourceMappingURL=index.js.map