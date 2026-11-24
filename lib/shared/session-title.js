/**
 * 会话显示标题折叠 — 纯函数，宿主与命令层共用。
 *
 * 优先级（对齐宿主 dsh-session-title 的 client 展示语义）：
 *   1. 最后一条 session/title 事件（宿主 session-title-llm 首条消息自动生成，
 *      或用户显式改名；last-wins）
 *   2. 首条 user/message 的文本（无标题事件时的摘要兜底）
 *   3. undefined（调用方回退会话 id 短码）
 */
/** 折叠只扫描前缀事件，标题事件通常紧跟首条用户消息（first-prompt 模式） */
export const TITLE_SCAN_EVENT_CAP = 256;
function textOfContent(content) {
    if (!Array.isArray(content))
        return undefined;
    const parts = [];
    for (const block of content) {
        const text = block?.text;
        if (block?.type === 'text' && typeof text === 'string' && text) {
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
export function foldSessionDisplayTitle(events) {
    let title;
    let firstUserText;
    for (const raw of events) {
        const event = raw;
        if (!event || typeof event.type !== 'string')
            continue;
        if (event.type === 'session/title') {
            if (typeof event.data?.title === 'string' && event.data.title.trim() !== '') {
                title = event.data.title;
            }
        }
        else if (event.type === 'user/message' && firstUserText === undefined) {
            firstUserText = textOfContent(event.data?.content);
        }
    }
    return title ?? firstUserText;
}
/** 展示裁剪：按 Unicode 码点截断（QQ 列表单行有限长） */
export function clipTitle(text, cap) {
    const chars = Array.from(text);
    return chars.length <= cap ? text : chars.slice(0, cap - 1).join('') + '…';
}
/** 摘要条数（用户拍板 5 条）与单条裁剪长度（预览用，46 码点≈一行半） */
export const DIGEST_MESSAGE_COUNT = 5;
export const DIGEST_MESSAGE_CLIP = 46;
/**
 * 兼容两种 durable 事件形态提取文本：
 * user/message 的 data 即消息本体（data.content）；
 * assistant/message 的 data 包裹 message（data.message.content）。
 */
function textOfMessageEvent(data) {
    const source = data;
    if (!source)
        return undefined;
    if (source.content !== undefined)
        return textOfContent(source.content);
    if (source.message !== undefined)
        return textOfContent(source.message.content);
    return undefined;
}
/**
 * 提取最近 N 条 user/assistant 文本消息。
 * total = 可提取文本的消息总数（含未展示部分，供"更早 M 条"计数）；
 * 无文本的消息（纯图片等）跳过，不占名额。
 */
export function extractRecentMessages(events, count = DIGEST_MESSAGE_COUNT) {
    const collected = [];
    for (const raw of events) {
        const event = raw;
        if (!event || typeof event.type !== 'string')
            continue;
        if (event.type !== 'user/message' && event.type !== 'assistant/message')
            continue;
        const text = textOfMessageEvent(event.data);
        if (text === undefined)
            continue;
        collected.push({ role: event.type === 'user/message' ? 'user' : 'assistant', text });
    }
    return { recent: collected.slice(-count), total: collected.length };
}
//# sourceMappingURL=session-title.js.map