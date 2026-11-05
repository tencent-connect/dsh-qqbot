import { ApiError } from '@tencent-connect/qqbot-nodejs';

export class StreamTargetExpired extends Error {
  constructor() { super('QQ stream target has expired or is unavailable'); }
}

export function isMessageRejected(error: unknown): boolean {
  return error instanceof ApiError && error.path.endsWith('/messages')
    && [400, 403, 422].includes(error.httpStatus);
}
