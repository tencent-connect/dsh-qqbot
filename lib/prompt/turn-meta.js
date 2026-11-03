export const TURN_META_CONTEXT_NAME = 'qqbot:turn-meta';
export const TURN_META_ORDER = 100;
/** 相对时间：历史或未知返回空串，刚刚/近未来返回"刚刚"，否则 N 秒/分钟/小时/天前。 */
export function relTime(at, now) {
    if (at === undefined || now === undefined || !Number.isFinite(at) || !Number.isFinite(now))
        return '';
    const diff = Math.max(0, Math.floor((now - at) / 1000));
    if (diff < 60)
        return '刚刚';
    if (diff < 3600)
        return `${Math.floor(diff / 60)} 分钟前`;
    if (diff < 86400)
        return `${Math.floor(diff / 3600)} 小时前`;
    return `${Math.floor(diff / 86400)} 天前`;
}
/** 消息发出时刻的本地时间（HH:mm），仅在有 at 时给出。 */
export function clockOf(at) {
    if (at === undefined || !Number.isFinite(at))
        return '';
    const d = new Date(at);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}
/** 生成本轮元信息文本；无有效信息时返回空串（空 section 会被丢弃）。 */
export function turnMetaText(meta) {
    const parts = [];
    parts.push(`来源：QQ ${meta.scope === 'group' ? '群聊' : '私聊'}`);
    const who = meta.senderName ? (meta.senderId ? `${meta.senderName}（QQ ${meta.senderId}）` : meta.senderName) : (meta.senderId ? `QQ ${meta.senderId}` : '');
    if (who)
        parts.push(`发送者：${who}`);
    if (meta.scope === 'group' && meta.mentioned)
        parts.push(`@：${meta.senderName ? `「${meta.senderName}」` : '本轮消息'} @ 了你`);
    const rel = relTime(meta.at, meta.now);
    const clock = clockOf(meta.at);
    if (rel)
        parts.push(clock ? `时间：${clock}（${rel}）` : `时间：${rel}`);
    if (meta.scope === 'group' && meta.unread !== undefined && meta.unread > 0)
        parts.push(`待处理消息：${meta.unread} 条`);
    return parts.join('\n');
}
//# sourceMappingURL=turn-meta.js.map