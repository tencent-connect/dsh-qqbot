import type { QQMiddlewareContext } from '../middleware/qq-context.ts';
import type { SessionManager } from '../session/session-manager.ts';
import { redactRecordingText } from '../runtime/recording-redaction.ts';
import { cacheMsgId } from '../transport/msgid-cache.ts';

interface MentionIdentity { id?: string; member_openid?: string; is_you?: boolean }
/** Discovery retains identity only, even when an existing allowlist blocks content. */
export function conversationDiscovery(manager: SessionManager) {
  return async (ctx: QQMiddlewareContext, next: () => Promise<void>): Promise<void> => {
    const msg = ctx.message;
    const scope = msg.kind === 'group' ? 'group' : 'c2c';
    const peerId = scope === 'group' ? msg.groupOpenid : msg.senderId;
    if (peerId) manager.conversations?.store.ensure(scope, peerId, { senderId: msg.senderId, senderName: msg.senderName, allMessages: msg.rawEventType === 'GROUP_MESSAGE_CREATE', admitted: manager.conversations.admitted(scope, peerId) });
    await next();
  };
}
/** Never treat another bot in the mentions array as this bot. */
export function wasBotMentioned(event: string, content: string, mentions: readonly MentionIdentity[], selfIds: ReadonlySet<string>): boolean {
  if (event === 'GROUP_AT_MESSAGE_CREATE') return true;
  if (mentions.some(item => item.is_you === true || [item.id, item.member_openid].some(id => !!id && selfIds.has(id)))) return true;
  return [...content.matchAll(/<@!?([^>]+)>/g)].some(match => selfIds.has(match[1] ?? ''));
}
export function conversationGate(manager: SessionManager) {
  return async (ctx: QQMiddlewareContext, next: () => Promise<void>): Promise<void> => {
    const service = manager.conversations;
    if (!service) { await next(); return; }
    const msg = ctx.message;
    const scope = msg.kind === 'group' ? 'group' : 'c2c';
    const peerId = scope === 'group' ? msg.groupOpenid : msg.senderId;
    if (!peerId) { ctx.stop('missing-peer'); return; }
    if (!service.admitted(scope, peerId)) { ctx.stop('conversation-disabled'); return; }
    const entry = service.store.ensure(scope, peerId, { senderId: msg.senderId, senderName: msg.senderName, allMessages: msg.rawEventType === 'GROUP_MESSAGE_CREATE', admitted: true });
    const mentioned = scope !== 'group' || wasBotMentioned(msg.rawEventType, msg.content, msg.mentions ?? [], service.selfIds);
    const isCommand = msg.content.replace(/<@!?[^>]+>/g, '').trim().startsWith('/');
    const isAnswer = !isCommand && (manager.questionChannel?.canAcceptText?.(scope, peerId, msg.content, msg.senderId) ?? false);
    const provenance = isCommand ? 'command' : isAnswer ? 'interaction' : 'qq';
    ctx.state.mention = { wasMentioned: mentioned, shouldAnswer: isAnswer || !entry.policy.requireMention || mentioned, implicit: isAnswer && !mentioned, reason: mentioned || isAnswer ? 'passthrough' : 'no_mention' };
    const isTrigger = !isAnswer && entry.policy.replyEnabled !== false && (!entry.policy.requireMention || mentioned) && !isCommand;
    const text = msg.content.replace(/<@!?([^>]+)>/g, (tag, id: string) => service.selfIds.has(id) ? '' : tag).trim();
    const receipt = await service.ingestion.run(entry.key, async () => service.recordInbound(entry.key, {
      id: msg.messageId, senderId: msg.senderId, senderName: msg.senderName || '', text: redactRecordingText(text, [service.config.appSecret]),
      contextEligible: !isCommand && !isAnswer, provenance,
      at: Date.parse(msg.timestamp) || Date.now(), mentioned,
      attachments: (msg.attachments ?? []).map(att => {
        const ct = att.content_type || '';
        const kind: 'image' | 'video' | 'voice' | 'file' = ct === 'image' || ct.startsWith('image/') ? 'image' : ct === 'video' || ct.startsWith('video/') ? 'video' : ct === 'voice' || ct.startsWith('audio/') ? 'voice' : 'file';
        const raw = (att as { url?: string }).url;
        const normalized = raw ? (raw.startsWith('//') ? `https:${raw}` : raw) : undefined;
        // 只保留 http/https 媒体地址（防 javascript:/data: 等注入到 <a href>/<img src>）。
        const url = normalized && /^https?:\/\//i.test(normalized) ? normalized : undefined;
        return { name: att.filename || '', type: ct, kind, ...(url ? { url } : {}) };
      }),
    }, isTrigger));
    if (!receipt.accepted) { ctx.stop('duplicate-message'); return; }
    const { releaseTrigger } = receipt;
    ctx.state.qqRecord = { cursor: receipt.cursor, provenance, ...(releaseTrigger ? { releaseTrigger } : {}) };
    cacheMsgId(scope, peerId, msg.messageId, Date.parse(msg.timestamp));
    if (entry.policy.replyEnabled === false && !isCommand && !isAnswer) { ctx.stop('automatic-reply-disabled'); return; }
    if (scope === 'group' && entry.policy.requireMention && !mentioned && !isAnswer) { ctx.stop('mention-gate:no_mention'); return; }
    // SDK slash middleware requires an AT event even when full-message payloads
    // carry a valid structured mention. Canonicalize only verified self mentions.
    if (scope === 'group' && mentioned) msg.rawEventType = 'GROUP_AT_MESSAGE_CREATE';
    try { await next(); } finally { releaseTrigger?.(); }
  };
}
