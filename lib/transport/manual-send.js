import { createHash } from 'node:crypto';
import { ApiError, MediaFileType, MsgType } from '@tencent-connect/qqbot-nodejs';
import { ApiClient, MediaApi, MessageApi, sanitizeFileName } from '@tencent-connect/qqbot-nodejs/protocol';
import { deliveryKey } from "./delivery-ledger.js";
import { canQuoteTimelineEntry } from "../shared/workbench-timeline-protocol.js";
import { receivedEntryId } from "../runtime/qq-timeline.js";
import { imageExtension } from "./attachment.js";
export class ManualSendConflict extends Error {
}
function keyFor(appId, target, operation) {
    return deliveryKey('manual', appId, target.scope, target.targetId, operation);
}
export class ManualQqSender {
    appId;
    ledger;
    send;
    timeline;
    pending = new Set();
    constructor(appId, ledger, send, timeline) {
        this.appId = appId;
        this.ledger = ledger;
        this.send = send;
        this.timeline = timeline;
    }
    static status(ledger, appId, target, operation, pending = false) {
        const id = keyFor(appId, target, operation);
        const receipt = ledger.delivery(id);
        if (!receipt)
            return undefined;
        return {
            id, status: receipt.state === 'not-sent' ? 'rejected' : receipt.state === 'sending' && !pending ? 'unknown' : receipt.state,
            httpStatus: receipt.httpStatus, platformCode: receipt.platformCode,
        };
    }
    status(target, operation) {
        return ManualQqSender.status(this.ledger, this.appId, target, operation, this.pending.has(keyFor(this.appId, target, operation)));
    }
    async submit(target, operation, text, allowed, recording, sourceSessionId, attachment, replyTo) {
        const id = keyFor(this.appId, target, operation);
        const fingerprint = attachment
            ? deliveryKey(text, attachment.name, createHash('sha256').update(attachment.bytes).digest('hex'))
            : replyTo ? deliveryKey('quote', text, replyTo) : deliveryKey(text);
        const prior = this.ledger.delivery(id);
        if (prior) {
            if (prior.fingerprint !== fingerprint)
                throw new ManualSendConflict('这次发送的正文已变更、附件不同或引用不同，请先查询原发送结果。');
            return this.status(target, operation);
        }
        if (!allowed())
            throw new ManualSendConflict('当前机器人或会话不允许发送。');
        const quoted = replyTo ? this.timeline?.entry(this.appId, target, replyTo) : undefined;
        if (replyTo && (attachment || !canQuoteTimelineEntry(quoted) || receivedEntryId(quoted.platformId) !== replyTo)) {
            throw new ManualSendConflict('引用消息不可用。请在当前 QQ 对话选择一条收到的消息。');
        }
        if (!this.ledger.begin(id, fingerprint))
            return this.status(target, operation);
        this.pending.add(id);
        let posted = false;
        const quote = quoted && {
            text: quoted.text.slice(0, 400), attachments: quoted.attachments, senderName: quoted.senderName,
        };
        const entry = {
            id, at: Date.now(), direction: 'outbound', source: sourceSessionId ? 'answer' : 'manual',
            text, sessionId: sourceSessionId, quote, ...(attachment ? { attachments: 1, attachmentName: attachment.name } : {}),
        };
        const transmit = async () => {
            try {
                const result = await this.send(target, text, phase => {
                    if (!allowed())
                        throw new ManualSendConflict('发送前发现机器人或会话已停用。');
                    if (phase === 'upload')
                        return;
                    if (posted)
                        throw new Error('QQ manual operation already submitted');
                    posted = true;
                }, attachment, quoted?.platformId);
                return { status: 'accepted', platformId: result.id };
            }
            catch (error) {
                const httpStatus = error instanceof ApiError && error.httpStatus > 0 ? error.httpStatus : undefined;
                const platformCode = error instanceof ApiError && Number.isSafeInteger(error.bizCode) ? error.bizCode : undefined;
                return {
                    status: !posted || (httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408 && httpStatus !== 499) ? 'rejected' : 'unknown',
                    httpStatus, platformCode,
                };
            }
        };
        try {
            let outcome;
            if (this.timeline && recording()) {
                outcome = await this.timeline.observe(this.appId, target, { ...entry, status: 'sending' }, transmit, result => result ?? { status: 'unknown' });
            }
            else {
                outcome = await transmit();
            }
            const { status, httpStatus, platformCode } = outcome;
            this.ledger.settle(id, status === 'rejected' ? 'not-sent' : status, { httpStatus, platformCode });
            return { id, status, httpStatus, platformCode };
        }
        finally {
            this.pending.delete(id);
        }
    }
}
/** Use the SDK's message path, token and sequence allocator, but never follow
 * redirects or retry a POST whose delivery status is unclear. */
export function createManualTransport(bot, baseUrl, userAgent, replyFor = target => target) {
    return async (target, text, beforeRequest, attachment, quoteId) => {
        const client = new ApiClient();
        client.request = async (token, method, path, body, options) => {
            const upload = options?.uploadRequest === true;
            beforeRequest(upload ? 'upload' : undefined);
            const response = await fetch(baseUrl + path, {
                method, headers: { Authorization: `QQBot ${token}`, 'Content-Type': 'application/json', 'User-Agent': userAgent },
                body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(15_000),
            });
            const raw = await response.json().catch(() => undefined);
            const payload = raw && typeof raw === 'object' ? raw : {};
            const receipt = upload ? payload.file_info : payload.id;
            if (!response.ok || typeof receipt !== 'string' || !receipt) {
                const code = payload.code ?? payload.err_code;
                throw new ApiError('QQ manual submission did not return a valid receipt', response.status, path, typeof code === 'number' ? code : undefined);
            }
            return raw;
        };
        const api = new MessageApi(client, bot.tokenManager, { markdownSupport: false });
        api.onMessageSent((ref, meta) => bot.messageApi.notifyMessageSent(ref, meta));
        if (attachment) {
            const media = new MediaApi(client, bot.tokenManager, { sanitizeFileName });
            const creds = bot.getCredentials();
            const kind = imageExtension(attachment.bytes) ? MediaFileType.IMAGE : MediaFileType.FILE;
            const { file_info } = await media.uploadMedia(target.scope, target.targetId, kind, creds, {
                buffer: attachment.bytes, fileName: attachment.name, srvSendMsg: false,
            });
            const reply = replyFor(target);
            return api.sendRaw(target.scope, target.targetId, creds, {
                content: text.trim() ? text : undefined, msg_type: MsgType.MEDIA, msg_id: reply.msgId, media: { file_info },
            });
        }
        const reply = replyFor(quoteId ? { ...target, msgId: quoteId } : target);
        return api.sendRaw(target.scope, target.targetId, bot.getCredentials(), {
            content: text, msg_type: MsgType.TEXT, msg_id: reply.msgId,
            ...(quoteId ? { message_reference: { message_id: quoteId, ignore_get_message_error: false } } : {}),
        });
    };
}
//# sourceMappingURL=manual-send.js.map