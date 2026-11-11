import { ApiError } from '@tencent-connect/qqbot-nodejs';
export class StreamTargetExpired extends Error {
    constructor() { super('QQ stream target has expired or is unavailable'); }
}
export class MediaAlreadySubmitted extends Error {
    constructor() { super('QQ file was already submitted; check its result before sending again'); }
}
export function hasStreamMessageId(response) {
    return !!response && typeof response === 'object' && 'id' in response
        && typeof response.id === 'string' && response.id.trim().length > 0;
}
export function isMessageRejected(error) {
    return error instanceof ApiError && error.path.endsWith('/messages')
        && [400, 403, 422].includes(error.httpStatus);
}
//# sourceMappingURL=delivery-errors.js.map