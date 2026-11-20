export const WORKBENCH_CONVERSATIONS_PATH = '/api/qqbot/workbench/conversations';
export const WORKBENCH_NEW_SESSION_PATH = '/api/qqbot/workbench/conversations/new-session';
export const RETENTION_DAY_MS = 86_400_000;
export function retentionDays(value) {
    if (typeof value !== 'string' || !/^[1-9]\d*d$/.test(value))
        return undefined;
    const days = Number(value.slice(0, -1));
    return days <= Math.floor(Number.MAX_SAFE_INTEGER / RETENTION_DAY_MS) ? days : undefined;
}
export function isMessageRetention(value) {
    return value === 'forever' || value === 'paused' || retentionDays(value) !== undefined;
}
export function shortensRetention(before, after) {
    return (retentionDays(after) ?? Infinity) < (retentionDays(before) ?? Infinity);
}
//# sourceMappingURL=workbench-conversation-protocol.js.map