export const WORKBENCH_TIMELINE_PATH = '/api/qqbot/workbench/timeline';
export const WORKBENCH_SEND_PATH = '/api/qqbot/workbench/send';
export const QQ_MANUAL_MESSAGE_LIMIT = 2000;
export const QQ_MANUAL_ATTACHMENT_LIMIT = 4 * 1024 * 1024;
export const TIMELINE_PAGE_SIZE = 40;
export const MAX_TIMELINE_IMAGES = 8;
export function canQuoteTimelineEntry(row) {
    return row?.direction === 'inbound' && row.status === 'received'
        && typeof row.platformId === 'string' && row.platformId.length > 0
        && row.text !== '配对码已隐藏' && !/^\/[a-z]/i.test(row.text)
        && (!!row.text || !!row.attachments);
}
//# sourceMappingURL=workbench-timeline-protocol.js.map