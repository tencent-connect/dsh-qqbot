/**
 * 出站回复目标解析与发送 — 被动回复三级兜底 + msg_id/event_id 区分。
 *
 * 从 gateway 层抽离，保持 bootstrap 只做组装。三级兜底：
 *   1. 优先显式 target.msgId；
 *   2. 超频/过期后，用缓存里「最近一条未超频未过期」的 target；
 *   3. 全部候选都超频/过期，才降级为主动推送（proactive）。
 */
import { MsgType } from '@tencent-connect/qqbot-nodejs';
import { getCachedReplyIds } from "./msgid-cache.js";
/**
 * 解析被动回复目标。
 *
 * 显式 msgId 须经 cache 确认未超平台被动窗口（群 5min/私聊 30min），
 * 否则跳过（延迟投递携带的旧 id 会被平台 40034005 拒绝）。
 *
 * @param allowEvent 是否允许返回互动事件 eventId。markdown 发送支持 event_id
 *   （bot.send 的 extra），传 true；文件发送 SDK 暂不支持 event_id，传 false
 *   跳过 event 候选，降级为 msg 候选或主动推送。
 */
export function resolveReplyTarget(target, limiter, allowEvent) {
    // 主动推送不占用、也不复用被动回复额度
    if (target.forceProactive) {
        return { scope: target.scope, targetId: target.targetId };
    }
    const cached = getCachedReplyIds(target.scope, target.targetId);
    const explicitMsgId = target.msgId;
    const candidates = [];
    // 显式 id 在 cache TTL 内（未超平台被动窗口）才置顶优先，否则跳过
    if (explicitMsgId !== undefined && cached.some((c) => c.id === explicitMsgId)) {
        candidates.push({ kind: 'msg', id: explicitMsgId });
    }
    for (const c of cached) {
        if (c.id === explicitMsgId)
            continue; // undefined 时恒 false，安全
        candidates.push(c);
    }
    for (const c of candidates) {
        if (c.kind === 'event' && !allowEvent)
            continue;
        if (limiter.checkLimit(c.id).allowed) {
            limiter.record(c.id);
            if (c.kind === 'event') {
                return { ...target, msgId: undefined, eventId: c.id };
            }
            return { ...target, msgId: c.id, eventId: undefined };
        }
    }
    return { ...target, msgId: undefined, eventId: undefined };
}
/**
 * 发送 markdown：区分 msg_id 与 event_id。
 * 带 eventId 时通过 bot.send 的 extra 填 event_id（SDK sendMarkdown 不支持）；
 * 否则走 sendMarkdown 填 msg_id。
 */
export function sendResolvedMarkdown(bot, target, content, opts) {
    if (target.eventId) {
        return bot.send({
            target: { scope: target.scope, targetId: target.targetId, msgId: undefined },
            msgType: MsgType.MARKDOWN,
            markdown: { content },
            keyboard: opts?.keyboard,
            extra: { event_id: target.eventId },
        });
    }
    return bot.sendMarkdown(target, content, opts);
}
//# sourceMappingURL=reply-target.js.map