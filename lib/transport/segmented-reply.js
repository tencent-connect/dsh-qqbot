/**
 * 分条发送（多气泡）— 把一段助手回复拆成多条独立 QQ 消息
 *
 * 与 chunker 的分工：
 * - chunkMarkdownText：被动兜底，**只有超过单条字符上限才切**
 * - 本模块：主动分条，按「标点 / 换行 / 词表」切成若干条独立消息，条间留
 *   人类打字节奏的停顿，模拟真人连发多条气泡
 *
 * 策略取自 QQ 官方机器人与 AstrBot segmented_reply 的线上取值（2026-10 现值），
 * 关键取舍与互相约束见 docs/segmented-reply.md：
 * 1. 整段可见字数 <= wordsCountThreshold 才分条，> forwardThreshold 整条发，
 *    防止长分析被切成刷屏（QQ 无合并转发，超长只能整条 + 平台切块）
 * 2. Markdown 结构（围栏代码块、GFM 表格）内部绝不切，否则渲染会碎
 * 3. 条数受 maxBubbles 约束：QQ 对同一条来源消息的被动回复限额为 4 次
 *    （reply-limiter.ts），超出会被降级为主动推送
 * 4. 条间间隔是唯一风控敏感参数，默认 random [2.5, 5] 秒
 */
import { chunkMarkdownText } from "./chunker.js";
/** 单条发送上限的兜底 */
const MIN_LIMIT = 1;
/** 间隔上限（秒）：防止配置失误导致回复卡住数分钟 */
const MAX_INTERVAL_SECONDS = 60;
/** 可见字数：按码点计，emoji / CJK 各记 1，忽略首尾空白 */
export function countVisible(text) {
    return Array.from(text.trim()).length;
}
/**
 * 受保护区间：围栏代码块（含围栏行本身）与连续 GFM 表格行。
 * 切分点落在区间内部时会被推到区间末尾，保证结构不被切断。
 */
export function protectedRanges(text) {
    const ranges = [];
    let offset = 0;
    let fenceStart = null;
    let tableStart = null;
    let tableEnd = 0;
    const flushTable = () => {
        if (tableStart === null)
            return;
        ranges.push({ start: tableStart, end: tableEnd });
        tableStart = null;
    };
    for (const line of text.split('\n')) {
        const lineStart = offset;
        offset += line.length + 1; // +1 为被 split 吃掉的换行
        const trimmed = line.trim();
        if (trimmed.startsWith('\u0060\u0060\u0060')) {
            flushTable();
            if (fenceStart === null) {
                fenceStart = lineStart;
            }
            else {
                ranges.push({ start: fenceStart, end: lineStart + line.length });
                fenceStart = null;
            }
            continue;
        }
        if (fenceStart !== null)
            continue; // 代码块内部
        if (/^\|.*\|$/.test(trimmed)) {
            if (tableStart === null)
                tableStart = lineStart;
            tableEnd = lineStart + line.length;
            continue;
        }
        flushTable();
    }
    flushTable();
    if (fenceStart !== null)
        ranges.push({ start: fenceStart, end: text.length });
    return ranges;
}
/** 把越界的切分点推到受保护区间末尾（可能连带吞掉后续片段，由去重合并处理） */
function adjustBoundary(boundary, ranges) {
    let x = boundary;
    for (let guard = 0; guard < ranges.length + 1; guard += 1) {
        const hit = ranges.find((r) => x > r.start && x < r.end);
        if (hit === undefined)
            return x;
        x = hit.end;
    }
    return x;
}
/** 按切分点切片（切分点为首尾相接的片段末尾偏移） */
function sliceByBoundaries(text, boundaries) {
    const cuts = [...new Set(boundaries)]
        .filter((b) => b > 0 && b < text.length)
        .sort((a, b) => a - b);
    const pieces = [];
    let prev = 0;
    for (const cut of cuts) {
        const piece = text.slice(prev, cut).trim();
        if (piece !== '')
            pieces.push(piece);
        prev = cut;
    }
    const tail = text.slice(prev).trim();
    if (tail !== '')
        pieces.push(tail);
    return pieces;
}
/** regex 模式：拿到每个片段的末尾偏移；非法正则返回 null */
function regexBoundaries(text, pattern) {
    let re;
    try {
        re = new RegExp(pattern, 'g');
    }
    catch {
        return null;
    }
    const boundaries = [];
    for (const match of text.matchAll(re)) {
        const matched = match[0];
        if (matched === '')
            continue; // 零宽匹配不当作切分点（matchAll 会自增 lastIndex）
        const start = match.index ?? 0;
        boundaries.push(start + matched.length);
    }
    return boundaries;
}
/** words 模式：按词表 + 换行切分，分隔符留在前一段（由收尾清理决定是否剥掉） */
function wordsBoundaries(text, words) {
    const terms = words.filter((w) => w.length > 0);
    const boundaries = [];
    let i = 0;
    while (i < text.length) {
        if (text[i] === '\n') {
            i += 1;
            boundaries.push(i);
            continue;
        }
        const hit = terms.find((term) => text.startsWith(term, i));
        if (hit === undefined) {
            i += 1;
            continue;
        }
        i += hit.length;
        boundaries.push(i);
    }
    return boundaries;
}
/** line 模式：每个非空行一条 */
function lineBoundaries(text) {
    const boundaries = [];
    let offset = 0;
    for (const line of text.split('\n')) {
        offset += line.length;
        if (line.trim() !== '')
            boundaries.push(offset);
        offset += 1;
    }
    return boundaries;
}
/** 收尾清理：只对每段结尾应用，非法正则原样返回并记录告警 */
function cleanupSegment(segment, rule, notes) {
    const trimmed = segment.trim();
    if (trimmed === '' || rule.trim() === '')
        return trimmed;
    try {
        return trimmed.replace(new RegExp(rule, 'g'), '').trim();
    }
    catch {
        notes.push('contentCleanupRule 不是合法正则：' + rule);
        return trimmed;
    }
}
/** 单条长度兜底：超限先按 Markdown 边界切块，仍超限则硬切 */
export function fitLimit(text, limit) {
    const safeLimit = Math.max(MIN_LIMIT, Math.floor(limit));
    if (text === '')
        return [];
    if (text.length <= safeLimit)
        return [text];
    const out = [];
    for (const chunk of chunkMarkdownText(text, safeLimit)) {
        if (chunk.length <= safeLimit) {
            out.push(chunk);
            continue;
        }
        for (let i = 0; i < chunk.length; i += safeLimit)
            out.push(chunk.slice(i, i + safeLimit));
    }
    return out.length > 0 ? out : [text];
}
/** 气泡数封顶：超出的尾巴并回最后一条，避免耗尽被动回复额度 */
function capBubbles(bubbles, maxBubbles) {
    const max = Math.max(1, Math.floor(maxBubbles));
    if (bubbles.length <= max)
        return [...bubbles];
    if (max === 1)
        return [bubbles.join('\n')];
    return [...bubbles.slice(0, max - 1), bubbles.slice(max - 1).join('\n')];
}
/**
 * 计算分条计划（纯函数，无副作用）。
 *
 * 决策顺序：总开关 -> 可见字数阈值 -> 切分 -> 收尾清理 -> 条数封顶 -> 长度兜底。
 * 只有「真正切成多条」才算分条；其余情况一律走「整条 + 平台切块」的旧路径。
 */
export function planSegmentedReply(text, config, options) {
    const notes = [];
    const length = countVisible(text);
    const trimmed = text.trim();
    const single = (reason) => ({
        bubbles: fitLimit(trimmed, options.limit),
        split: false,
        reason,
        length,
        notes,
    });
    if (trimmed === '')
        return { bubbles: [], split: false, reason: 'empty', length, notes };
    if (!config.enable)
        return single('disabled');
    if (length > config.forwardThreshold)
        return single('above-forward-threshold');
    if (length > config.wordsCountThreshold)
        return single('above-words-threshold');
    let boundaries;
    switch (config.splitMode) {
        case 'words':
            boundaries = wordsBoundaries(trimmed, config.splitWords);
            break;
        case 'line':
            boundaries = lineBoundaries(trimmed);
            break;
        case 'regex':
        default:
            boundaries = regexBoundaries(trimmed, config.regex);
            if (boundaries === null) {
                notes.push('regex 不是合法正则，退化为逐行切分：' + config.regex);
                boundaries = lineBoundaries(trimmed);
            }
            break;
    }
    // 切分点不得落在代码块 / 表格内部
    const ranges = protectedRanges(trimmed);
    const adjusted = boundaries.map((b) => adjustBoundary(b, ranges));
    let bubbles = sliceByBoundaries(trimmed, adjusted)
        .map((piece) => cleanupSegment(piece, config.contentCleanupRule, notes))
        .filter((piece) => piece !== '');
    if (bubbles.length === 0) {
        notes.push('切分后没有有效片段，改为整条发送');
        return single('single-segment');
    }
    if (bubbles.length === 1)
        return single('single-segment');
    bubbles = capBubbles(bubbles, config.maxBubbles);
    const out = [];
    for (const bubble of bubbles)
        out.push(...fitLimit(bubble, options.limit));
    for (const note of notes)
        options.logger?.warn('im-qqbot: 分条 ' + note);
    return { bubbles: out, split: out.length > 1, length, notes };
}
/**
 * 条间间隔（毫秒）。
 *
 * - random：在 [intervalMin, intervalMax] 内均匀取值（制造打字抖动）
 * - log：log(字数+1, logBase) 秒 + [0, logJitter] 秒随机，短句快、长句慢
 * 结果统一夹在 [0, 60] 秒，避免配置失误把回复拖死。
 */
export function nextIntervalMs(config, charCount, rng = Math.random) {
    let seconds;
    if (config.intervalMethod === 'log') {
        const base = config.logBase > 1 ? config.logBase : 2.6;
        const jitter = Math.max(0, config.logJitter);
        seconds = Math.log(Math.max(0, charCount) + 1) / Math.log(base) + rng() * jitter;
    }
    else {
        const a = Math.max(0, config.intervalMin);
        const b = Math.max(0, config.intervalMax);
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        seconds = lo + rng() * (hi - lo);
    }
    return Math.round(Math.min(MAX_INTERVAL_SECONDS, Math.max(0, seconds)) * 1000);
}
/**
 * 逐条投递：串行 await，条间按策略停顿；单条失败只记录不中断。
 * 全部发完后打一条汇总日志（条数 + 实际间隔），便于线上核对节奏。
 */
export async function deliverSegmentedReply(options) {
    const { sender, target, plan, config, logger, tag } = options;
    const rng = options.rng ?? Math.random;
    const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const bubbles = plan.bubbles;
    if (bubbles.length === 0)
        return;
    const intervals = [];
    for (let i = 0; i < bubbles.length; i += 1) {
        const bubble = bubbles[i];
        try {
            await sender.sendMarkdown(target, bubble);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error('im-qqbot: ' + tag + ' 第 ' + (i + 1) + '/' + bubbles.length + ' 条发送失败: ' + message);
        }
        if (i === bubbles.length - 1)
            break;
        const delay = nextIntervalMs(config, countVisible(bubble), rng);
        intervals.push(delay);
        if (delay > 0)
            await sleep(delay);
    }
    if (bubbles.length > 1) {
        const shown = intervals.map((ms) => (ms / 1000).toFixed(1)).join(', ');
        logger.info('im-qqbot: ' + tag + ' 分条 ' + bubbles.length + ' 条，间隔 [' + shown + ']s');
    }
}
//# sourceMappingURL=segmented-reply.js.map