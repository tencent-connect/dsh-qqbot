import { AsyncLocalStorage } from 'node:async_hooks';
import { ApiError, MediaFileType, MsgType, StreamSession } from '@tencent-connect/qqbot-nodejs';
import { ApiClient, MediaApi, MessageApi, uploadPreparePath } from '@tencent-connect/qqbot-nodejs/protocol';
import { assertDeliveryAllowed } from "./delivery-context.js";
import { resolveReplyTarget } from "./reply-target.js";
import { hasStreamMessageId, StreamTargetExpired } from "./delivery-errors.js";
class CheckedApiClient extends ApiClient {
    submit;
    check;
    constructor(submit, check) {
        super();
        this.submit = submit;
        this.check = check;
    }
    async request(token, method, path, body, options) {
        this.check();
        return this.submit(token, method, path, body, options);
    }
}
export function sendDeliveryMarkdown(bot, replyIds, limiter, target, content, opts, observe) {
    const credentials = bot.getCredentials();
    assertDeliveryAllowed(target, credentials.appId);
    const reply = resolveReplyTarget(target, replyIds, limiter, true);
    const client = new CheckedApiClient(observe?.(target) ?? bot.apiClient.request.bind(bot.apiClient), () => assertDeliveryAllowed(target, credentials.appId));
    const api = new MessageApi(client, bot.tokenManager, { markdownSupport: true });
    api.onMessageSent((ref, meta) => bot.messageApi.notifyMessageSent(ref, meta));
    return api.sendRaw(reply.scope, reply.targetId, credentials, {
        msg_id: reply.msgId,
        event_id: reply.eventId,
        msg_type: MsgType.MARKDOWN,
        markdown: { content },
        keyboard: opts?.keyboard,
    });
}
export function openDeliveryStream(bot, replyIds, target, logger, observe) {
    const creds = bot.getCredentials();
    assertDeliveryAllowed(target, creds.appId);
    const { scope, targetId, msgId } = target;
    if (scope !== 'c2c' || !msgId || !replyIds.getCachedReplyIds(scope, targetId).some(id => id.kind === 'msg' && id.id === msgId)) {
        throw new StreamTargetExpired();
    }
    let canceled = false;
    let sent = false;
    let failure;
    const client = new CheckedApiClient(observe?.(target) ?? bot.apiClient.request.bind(bot.apiClient), () => {
        if (canceled)
            throw new Error('QQ stream canceled');
        if (failure)
            throw failure.error;
        assertDeliveryAllowed(target, creds.appId);
    });
    const api = new MessageApi(client, bot.tokenManager, { markdownSupport: true });
    const send = api.sendC2CStreamMessage.bind(api);
    api.sendC2CStreamMessage = async (...args) => {
        try {
            const result = await send(...args);
            // Without the opening ID the SDK would issue another frame without stream_msg_id.
            if (!sent && !hasStreamMessageId(result))
                throw new Error('QQ stream opening response has no message ID');
            sent = true;
            return result;
        }
        catch (error) {
            if (error instanceof ApiError && error.path.endsWith('/stream_messages')) {
                const { httpStatus, bizCode } = error;
                const rejected = httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408 && httpStatus !== 499;
                if (httpStatus === 429 || (rejected && bizCode === 50002)) {
                    // StreamSession reads the legacy code field when applying its retry budget.
                    throw Object.assign(error, { code: bizCode === 50002 ? 50002 : 429 });
                }
                if (httpStatus === 400 && bizCode === 40034005) {
                    replyIds.forgetMsgId(scope, targetId, msgId);
                    if (!sent)
                        error = new StreamTargetExpired();
                }
            }
            failure = { error };
            session.cancel();
            throw error;
        }
    };
    const session = new StreamSession(api, { openid: targetId, msgId, creds, logger });
    const throwIfFailed = () => {
        if (failure)
            throw failure.error;
    };
    return {
        async update(content) {
            throwIfFailed();
            await session.update(content);
            throwIfFailed();
        },
        async complete() {
            throwIfFailed();
            await session.complete();
            throwIfFailed();
        },
        cancel() {
            canceled = true;
            session.cancel();
        },
    };
}
function guardSdkUploads(bot) {
    const uploadScope = new AsyncLocalStorage();
    const request = bot.apiClient.request.bind(bot.apiClient);
    bot.apiClient.request = async (token, method, path, body, options) => {
        const scope = uploadScope.getStore();
        scope?.check();
        const result = await request(token, method, path, body, options);
        if (scope && path === uploadPreparePath(scope.target.scope, scope.target.targetId)) {
            guardUploadParts(result, scope.check);
        }
        return result;
    };
    return uploadScope;
}
function guardUploadParts(prepared, check) {
    if (!prepared || typeof prepared !== 'object' || !('parts' in prepared) || !Array.isArray(prepared.parts)) {
        throw new Error('Invalid QQ chunked upload response');
    }
    for (const part of prepared.parts) {
        const url = part?.presigned_url;
        if (typeof url !== 'string')
            throw new Error('Invalid QQ chunked upload URL');
        // SDK 1.0.5 constructs a new URL from the original value before each direct COS PUT, including retries.
        Object.defineProperty(part, 'presigned_url', {
            value: { [Symbol.toPrimitive]() { check(); return url; } },
        });
    }
}
export function createDeliveryMedia(bot, replyIds, limiter, observe) {
    const uploadScope = guardSdkUploads(bot);
    const send = async (target, fileType, source, fileName) => {
        const credentials = bot.getCredentials();
        let denied;
        const check = () => {
            if (denied)
                throw denied.error;
            try {
                assertDeliveryAllowed(target, credentials.appId);
            }
            catch (error) {
                denied = { error };
                throw error;
            }
        };
        check();
        const upload = await uploadScope.run({ target, check }, () => bot.uploadMedia({ target, fileType, ...source, fileName, srvSendMsg: false }));
        check();
        const reply = resolveReplyTarget(target, replyIds, limiter, false);
        const client = new CheckedApiClient(observe?.(target) ?? bot.apiClient.request.bind(bot.apiClient), check);
        const api = new MediaApi(client, bot.tokenManager);
        const message = await api.sendMediaMessage(reply.scope, reply.targetId, upload.file_info, credentials, { msgId: reply.msgId });
        return { upload, message };
    };
    return {
        sendImage: (target, source) => send(target, MediaFileType.IMAGE, source),
        sendVideo: (target, source) => send(target, MediaFileType.VIDEO, source),
        sendVoice: (target, source) => send(target, MediaFileType.VOICE, source),
        sendFile: (target, source, opts) => send(target, MediaFileType.FILE, source, opts?.fileName),
    };
}
//# sourceMappingURL=qq-delivery.js.map