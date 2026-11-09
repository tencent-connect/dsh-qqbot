import { ApiError, MsgType } from '@tencent-connect/qqbot-nodejs';
import { ApiClient, MessageApi } from '@tencent-connect/qqbot-nodejs/protocol';
import { deliveryKey } from "./delivery-ledger.js";
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
    async submit(target, operation, text, allowed, recording) {
        const id = keyFor(this.appId, target, operation);
        const fingerprint = deliveryKey(text);
        const prior = this.ledger.delivery(id);
        if (prior) {
            if (prior.fingerprint !== fingerprint)
                throw new ManualSendConflict('这次发送的正文已变更，请先查询原发送结果。');
            return this.status(target, operation);
        }
        if (!allowed())
            throw new ManualSendConflict('当前机器人或会话不允许发送。');
        if (!this.ledger.begin(id, fingerprint))
            return this.status(target, operation);
        this.pending.add(id);
        let posted = false;
        const entry = { id, at: Date.now(), direction: 'outbound', source: 'manual', text };
        const transmit = async () => {
            try {
                const result = await this.send(target, text, () => {
                    if (!allowed())
                        throw new ManualSendConflict('发送前发现机器人或会话已停用。');
                    if (posted)
                        throw new Error('QQ manual operation already submitted');
                    posted = true;
                });
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
export function createManualTextTransport(bot, baseUrl, userAgent) {
    return async (target, text, beforeRequest) => {
        const client = new ApiClient();
        client.request = async (token, method, path, body) => {
            beforeRequest();
            const response = await fetch(baseUrl + path, {
                method, headers: { Authorization: `QQBot ${token}`, 'Content-Type': 'application/json', 'User-Agent': userAgent },
                body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(15_000),
            });
            const raw = await response.json().catch(() => undefined);
            const payload = raw && typeof raw === 'object' ? raw : {};
            if (!response.ok || typeof payload.id !== 'string' || !payload.id) {
                const code = payload.code ?? payload.err_code;
                throw new ApiError('QQ manual text submission did not return a message ID', response.status, path, typeof code === 'number' ? code : undefined);
            }
            return raw;
        };
        const api = new MessageApi(client, bot.tokenManager, { markdownSupport: false });
        api.onMessageSent((ref, meta) => bot.messageApi.notifyMessageSent(ref, meta));
        return api.sendRaw(target.scope, target.targetId, bot.getCredentials(), {
            content: text, msg_type: MsgType.TEXT, msg_id: target.msgId,
        });
    };
}
//# sourceMappingURL=manual-send.js.map