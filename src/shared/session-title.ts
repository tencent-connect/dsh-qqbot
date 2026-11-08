/**
 * 会话显示标题折叠 — 纯函数，宿主与命令层共用。
 *
 * 优先级（对齐宿主 dsh-session-title 的 client 展示语义）：
 *   1. 最后一条 session/title 事件（宿主 session-title-llm 首条消息自动生成，
 *      或用户显式改名；last-wins）
 *   2. 首条 user/message 的文本（无标题事件时的摘要兜底）
 *   3. undefined（调用方回退会话 id 短码）
 */

/** 事件最小结构（标题折叠只读这两个字段族） */
interface TitleEventLike {
  type?: string;
  data?: { title?: unknown; content?: unknown };
}

/** 折叠只扫描前缀事件，标题事件通常紧跟首条用户消息（first-prompt 模式） */
export const TITLE_SCAN_EVENT_CAP = 256;

function textOfContent(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    const text = (block as { type?: string; text?: unknown } | null)?.text;
    if ((block as { type?: string } | null)?.type === 'text' && typeof text === 'string' && text) {
      parts.push(text);
    }
  }
  const joined = parts.join(' ').replace(/\s+/g, ' ').trim();
  return joined === '' ? undefined : joined;
}

/**
 * 从事件序列折叠显示标题：最后一条 session/title > 首条 user/message 文本。
 * 事件按 seq 升序传入（snapshotEvents / 持久层 read 均如此）。
 */
export function foldSessionDisplayTitle(events: readonly unknown[]): string | undefined {
  let title: string | undefined;
  let firstUserText: string | undefined;
  for (const raw of events) {
    const event = raw as TitleEventLike | null;
    if (!event || typeof event.type !== 'string') continue;
    if (event.type === 'session/title') {
      if (typeof event.data?.title === 'string' && event.data.title.trim() !== '') {
        title = event.data.title;
      }
    } else if (event.type === 'user/message' && firstUserText === undefined) {
      firstUserText = textOfContent(event.data?.content);
    }
  }
  return title ?? firstUserText;
}

/** 展示裁剪：按 Unicode 码点截断（QQ 列表单行有限长） */
export function clipTitle(text: string, cap: number): string {
  const chars = Array.from(text);
  return chars.length <= cap ? text : chars.slice(0, cap - 1).join('') + '…';
}

/** 切换确认附带的最近对话条目 */
export interface DigestMessage {
  role: 'user' | 'assistant';
  text: string;
}

/** 摘要条数（用户拍板 5 条）与单条裁剪长度 */
export const DIGEST_MESSAGE_COUNT = 5;
export const DIGEST_MESSAGE_CLIP = 60;

/**
 * 兼容两种 durable 事件形态提取文本：
 * user/message 的 data 即消息本体（data.content）；
 * assistant/message 的 data 包裹 message（data.message.content）。
 */
function textOfMessageEvent(data: unknown): string | undefined {
  const source = data as { content?: unknown; message?: { content?: unknown } } | null | undefined;
  if (!source) return undefined;
  if (source.content !== undefined) return textOfContent(source.content);
  if (source.message !== undefined) return textOfContent(source.message.content);
  return undefined;
}

/**
 * 提取最近 N 条 user/assistant 文本消息。
 * total = 可提取文本的消息总数（含未展示部分，供"更早 M 条"计数）；
 * 无文本的消息（纯图片等）跳过，不占名额。
 */
export function extractRecentMessages(
  events: readonly unknown[],
  count: number = DIGEST_MESSAGE_COUNT,
): { recent: DigestMessage[]; total: number } {
  const collected: DigestMessage[] = [];
  for (const raw of events) {
    const event = raw as { type?: string; data?: unknown } | null;
    if (!event || typeof event.type !== 'string') continue;
    if (event.type !== 'user/message' && event.type !== 'assistant/message') continue;
    const text = textOfMessageEvent(event.data);
    if (text === undefined) continue;
    collected.push({ role: event.type === 'user/message' ? 'user' : 'assistant', text });
  }
  return { recent: collected.slice(-count), total: collected.length };
}
