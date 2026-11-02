import { redactRecordingText } from "../runtime/recording-redaction.js";
import { cacheMsgId } from "../transport/msgid-cache.js";
/** Discovery retains identity only, even when an existing allowlist blocks content. */
export function conversationDiscovery(manager) {
    return async (ctx, next) => {
        const msg = ctx.message;
        const scope = msg.kind === 'group' ? 'group' : 'c2c';
        const peerId = scope === 'group' ? msg.groupOpenid : msg.senderId;
        if (peerId)
            manager.conversations?.store.ensure(scope, peerId, { senderId: msg.senderId, senderName: msg.senderName, allMessages: msg.rawEventType === 'GROUP_MESSAGE_CREATE', admitted: manager.conversations.admitted(scope, peerId) });
        await next();
    };
}
/** Never treat another bot in the mentions array as this bot. */
export function wasBotMentioned(event, content, mentions, selfIds) {
    if (event === 'GROUP_AT_MESSAGE_CREATE')
        return true;
    if (mentions.some(item => item.is_you === true || [item.id, item.member_openid].some(id => !!id && selfIds.has(id))))
        return true;
    return [...content.matchAll(/<@!?([^>]+)>/g)].some(match => selfIds.has(match[1] ?? ''));
}
export function conversationGate(manager) {
    return async (ctx, next) => {
        const service = manager.conversations;
        if (!service) {
            await next();
            return;
        }
        const msg = ctx.message;
        const scope = msg.kind === 'group' ? 'group' : 'c2c';
        const peerId = scope === 'group' ? msg.groupOpenid : msg.senderId;
        if (!peerId) {
            ctx.stop('missing-peer');
            return;
        }
        if (!service.admitted(scope, peerId)) {
            ctx.stop('conversation-disabled');
            return;
        }
        const entry = service.store.ensure(scope, peerId, { senderId: msg.senderId, senderName: msg.senderName, allMessages: msg.rawEventType === 'GROUP_MESSAGE_CREATE', admitted: true });
        const mentioned = scope !== 'group' || wasBotMentioned(msg.rawEventType, msg.content, msg.mentions ?? [], service.selfIds);
        ctx.state.mention = { wasMentioned: mentioned, shouldAnswer: !entry.policy.requireMention || mentioned, implicit: false, reason: mentioned ? 'passthrough' : 'no_mention' };
        const isCommand = msg.content.replace(/<@!?[^>]+>/g, '').trim().startsWith('/');
        const isAnswer = manager.questionChannel?.canAcceptText?.(scope, peerId, msg.content, msg.senderId) ?? false;
        const isTrigger = !isAnswer && entry.policy.replyEnabled !== false && (!entry.policy.requireMention || mentioned) && !msg.content.replace(/<@!?[^>]+>/g, '').trim().startsWith('/');
        const text = msg.content.replace(/<@!?([^>]+)>/g, (tag, id) => service.selfIds.has(id) ? '' : tag).trim();
        const receipt = await service.ingestion.run(entry.key, async () => service.recordInbound(entry.key, {
            id: msg.messageId, senderId: msg.senderId, senderName: msg.senderName || '', text: redactRecordingText(text, [service.config.appSecret]),
            contextEligible: !isCommand && !isAnswer, provenance: isCommand ? 'command' : isAnswer ? 'interaction' : 'qq',
            at: Date.parse(msg.timestamp) || Date.now(), mentioned,
            attachments: (msg.attachments ?? []).map(att => {
                const ct = att.content_type || '';
                const kind = ct === 'image' || ct.startsWith('image/') ? 'image' : ct === 'video' || ct.startsWith('video/') ? 'video' : ct === 'voice' || ct.startsWith('audio/') ? 'voice' : 'file';
                const raw = att.url;
                const normalized = raw ? (raw.startsWith('//') ? `https:${raw}` : raw) : undefined;
                // 只保留 http/https 媒体地址（防 javascript:/data: 等注入到 <a href>/<img src>）。
                const url = normalized && /^https?:\/\//i.test(normalized) ? normalized : undefined;
                return { name: att.filename || '', type: ct, kind, ...(url ? { url } : {}) };
            }),
        }, isTrigger));
        if (!receipt.accepted) {
            ctx.stop('duplicate-message');
            return;
        }
        const { releaseTrigger } = receipt;
        ctx.state.qqRecord = { cursor: receipt.cursor, ...(releaseTrigger ? { releaseTrigger } : {}) };
        cacheMsgId(scope, peerId, msg.messageId, Date.parse(msg.timestamp));
        if (entry.policy.replyEnabled === false && !isCommand) {
            ctx.stop('automatic-reply-disabled');
            return;
        }
        if (scope === 'group' && entry.policy.requireMention && !mentioned) {
            ctx.stop('mention-gate:no_mention');
            return;
        }
        // SDK slash middleware requires an AT event even when full-message payloads
        // carry a valid structured mention. Canonicalize only verified self mentions.
        if (scope === 'group' && mentioned)
            msg.rawEventType = 'GROUP_AT_MESSAGE_CREATE';
        try {
            await next();
        }
        finally {
            releaseTrigger?.();
        }
    };
}
//# sourceMappingURL=conversation-gate.js.map