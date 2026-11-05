/**
 * Web 镜像 — 把 Web/桌面端输入的用户消息整理成一条 QQ 消息。
 *
 * QQ 会话被桥接到 Web/桌面续聊时，读者在网页里打的字不进 QQ 出站管道
 * （user/message 原本只按来源记账、不发送），QQ 端看不到「另一端问了什么」。
 * 开启 mirrorWeb 后由 OutboundRouter 在 user/message 上补发一条带前缀的镜像。
 *
 * 这里只做纯文本工作（判定来源 / 取正文 / 加前缀），发送与目标解析留在
 * outbound.ts，便于单测。
 */
import type { MessageOrigin } from './turn-origin.ts';

/** 镜像消息前缀（`🌐 来自 Web：<原文>`） */
export const MIRROR_WEB_PREFIX = '🌐 来自 Web：';

/**
 * 只有 external（读者在别的界面输入）才镜像。
 * qq：QQ 端已经有这条消息，再推一遍是刷屏；
 * internal：宿主/插件自己注入的消息（schedule、已回答的提问、notice、每轮注入的
 * 上下文、快捷按钮注入的编号与答案回显），镜像这些会自激。
 */
export function isMirrorableOrigin(origin: MessageOrigin | undefined): boolean {
  return origin === 'external';
}

/**
 * 取 user/message 的正文文本块。
 *
 * 宿主契约：`data` 即 UserMessage（content 在顶层），兼容 `{ message }` 包裹形态
 * （与 TurnTracker.readUserMessage 一致）。非文本块（图片等附件）跳过；
 * 没有可用文本时返回 undefined（仅附件的消息不镜像）。
 */
export function extractUserMessageText(data: Record<string, unknown>): string | undefined {
  const wrapped = data as { content?: unknown; message?: { content?: unknown } };
  const content = Array.isArray(wrapped.content)
    ? wrapped.content
    : Array.isArray(wrapped.message?.content)
      ? wrapped.message.content
      : undefined;
  if (content === undefined) return undefined;

  const parts: string[] = [];
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue;
    const { type, text } = block as { type?: unknown; text?: unknown };
    if (type === 'text' && typeof text === 'string' && text.trim() !== '') parts.push(text);
  }
  const text = parts.join('\n').trim();
  return text === '' ? undefined : text;
}

/** 按约定格式组装镜像正文 */
export function formatMirrorWebText(text: string): string {
  return `${MIRROR_WEB_PREFIX}${text}`;
}