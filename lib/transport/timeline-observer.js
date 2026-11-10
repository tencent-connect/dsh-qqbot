import { randomUUID } from 'node:crypto';
import { ApiError, MsgType, StreamInputState } from '@tencent-connect/qqbot-nodejs';
import { deliveryTrace } from "./delivery-context.js";
import { deliveryKey } from "./delivery-ledger.js";
import { timelineText } from "../runtime/qq-timeline.js";
function object(value) {
    return value && typeof value === 'object' ? value : {};
}
/** Observe actual SDK HTTP submissions, including commands. Typing and uploads are not messages. */
export function observeTimelineRequests(bot, appId, timeline, canRecord) {
    const request = bot.apiClient.request.bind(bot.apiClient);
    const observe = (source) => async (...args) => {
        const [, method, path, raw] = args;
        const match = /^\/v2\/(users|groups)\/([^/]+)\/(messages|stream_messages)$/.exec(path);
        if (method !== 'POST' || !match?.[2])
            return request(...args);
        const body = object(raw);
        if (body.input_notify !== undefined)
            return request(...args);
        const target = {
            scope: match[1] === 'users' ? 'c2c' : 'group',
            targetId: match[2],
        };
        if (!canRecord(target))
            return request(...args);
        const streaming = match[3] === 'stream_messages';
        const trace = source && deliveryTrace(source);
        const text = body.content_raw ?? object(body.markdown).content ?? body.content;
        const attachments = body.msg_type === MsgType.MEDIA ? 1 : undefined;
        // No raw keyboard values, upload references or SDK payloads are persisted.
        if (typeof text !== 'string' && !attachments)
            return request(...args);
        const id = streaming ? trace?.streamKey ?? deliveryKey('stream', body.msg_id, body.msg_seq) : randomUUID();
        const entry = {
            id, at: Date.now(), direction: 'outbound', text: typeof text === 'string' ? timelineText(text) : '',
            status: 'sending', attachments, sessionId: trace?.sessionId,
            source: trace && (trace.reply ? 'automatic' : 'agent'),
        };
        return timeline.observe(appId, target, entry, () => request(...args), (result, error) => {
            if (error !== undefined) {
                const httpStatus = error instanceof ApiError ? error.httpStatus : undefined;
                return {
                    status: httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500
                        && httpStatus !== 408 && httpStatus !== 499 ? 'rejected' : 'unknown',
                    httpStatus: httpStatus || undefined,
                    platformCode: error instanceof ApiError ? error.bizCode : undefined,
                };
            }
            const platformId = object(result).id;
            return {
                status: streaming && body.input_state !== StreamInputState.DONE ? 'partial' : 'accepted',
                platformId: typeof platformId === 'string' ? platformId : undefined,
            };
        });
    };
    bot.apiClient.request = observe();
    return observe;
}
//# sourceMappingURL=timeline-observer.js.map