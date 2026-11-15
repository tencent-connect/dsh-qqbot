export const WORKBENCH_CONVERSATIONS_PATH = '/api/qqbot/workbench/conversations';
export const WORKBENCH_NEW_SESSION_PATH = '/api/qqbot/workbench/conversations/new-session';
export function retentionDays(value) {
    return value === '7d' ? 7 : value === '30d' ? 30 : undefined;
}
export function shortensRetention(before, after) {
    return (retentionDays(after) ?? Infinity) < (retentionDays(before) ?? Infinity);
}
//# sourceMappingURL=workbench-conversation-protocol.js.map