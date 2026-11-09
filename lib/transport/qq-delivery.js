import { ApiError, MediaFileType, MsgType, StreamSession } from '@tencent-connect/qqbot-nodejs';
import { ApiClient, MediaApi, MessageApi } from '@tencent-connect/qqbot-nodejs/protocol';
import { assertDeliveryAllowed } from "./delivery-context.js";
import { resolveReplyTarget } from "./reply-target.js";
import { StreamTargetExpired } from "./delivery-errors.js";
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
    const reply = resolveReplyTarget(target, replyIds, limiter, true);
    const client = new CheckedApiClient(observe?.(target) ?? bot.apiClient.request.bind(bot.apiClient), () => assertDeliveryAllowed(target));
    const api = new MessageApi(client, bot.tokenManager, { markdownSupport: true });
    api.onMessageSent((ref, meta) => bot.messageApi.notifyMessageSent(ref, meta));
    return api.sendRaw(reply.scope, reply.targetId, bot.getCredentials(), {
        msg_id: reply.msgId,
        event_id: reply.eventId,
        msg_type: MsgType.MARKDOWN,
        markdown: { content },
        keyboard: opts?.keyboard,
    });
}
export function openDeliveryStream(bot, replyIds, target, logger, observe) {
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
        assertDeliveryAllowed(target);
    });
    const api = new MessageApi(client, bot.tokenManager, { markdownSupport: true });
    const send = api.sendC2CStreamMessage.bind(api);
    api.sendC2CStreamMessage = async (...args) => {
        try {
            const result = await send(...args);
            sent = true;
            return result;
        }
        catch (error) {
            if (error instanceof ApiError && (error.httpStatus === 429 || error.bizCode === 50002)) {
                // StreamSession reads the legacy code field when applying its retry budget.
                throw Object.assign(error, { code: error.bizCode === 50002 ? 50002 : 429 });
            }
            if (error instanceof ApiError && error.httpStatus === 400 && error.bizCode === 40034005
                && error.path.endsWith('/stream_messages')) {
                replyIds.forgetMsgId(scope, targetId, msgId);
                if (!sent)
                    error = new StreamTargetExpired();
            }
            failure = { error };
            session.cancel();
            throw error;
        }
    };
    const session = new StreamSession(api, { openid: targetId, msgId, creds: bot.getCredentials(), logger });
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
export function createDeliveryMedia(bot, replyIds, limiter, observe) {
    const send = async (target, fileType, source, fileName) => {
        const upload = await bot.uploadMedia({ target, fileType, ...source, fileName, srvSendMsg: false });
        assertDeliveryAllowed(target);
        const reply = resolveReplyTarget(target, replyIds, limiter, false);
        const client = new CheckedApiClient(observe?.(target) ?? bot.apiClient.request.bind(bot.apiClient), () => assertDeliveryAllowed(target));
        const api = new MediaApi(client, bot.tokenManager);
        const message = await api.sendMediaMessage(reply.scope, reply.targetId, upload.file_info, bot.getCredentials(), { msgId: reply.msgId });
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