import { ApiError } from '@tencent-connect/qqbot-nodejs';
import { redactRecordingText } from "./recording-redaction.js";
function safeMessage(message, secrets) {
    return redactRecordingText(message, secrets).replace(/https?:\/\/\S+/gi, '[链接已隐藏]')
        .replace(/\b(?:Bearer|QQBot)\s+[^\s,;]+/gi, '[凭据已隐藏]')
        .replace(/((?:access_token|app[_-]?secret|client[_-]?secret|token|secret|api[_-]?key|msg[_-]?id|event[_-]?id)\s*["']?\s*[=:]\s*["']?)[^"'\s,;]+/gi, '$1[已隐藏]')
        .replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 400);
}
export class DeliveryNotSubmittedError extends Error {
}
/** SDK middleware may log and format this error after the facade rejects. */
export function sanitizedDeliveryError(error, secrets) {
    const failure = deliveryFailure(error, secrets);
    if (error instanceof ApiError)
        return new ApiError(failure.error, error.httpStatus, '[路径已隐藏]', error.bizCode, safeMessage(error.bizMessage ?? error.message, secrets));
    return new Error(failure.error);
}
/** A rejection response is different from losing confirmation after submission. */
export function deliveryFailure(error, secrets = []) {
    if (error instanceof DeliveryNotSubmittedError)
        return { state: 'failed', error: safeMessage(error.message, secrets) };
    if (error instanceof ApiError) {
        const rejected = error.httpStatus >= 400 && error.httpStatus < 500 && error.httpStatus !== 408;
        const details = [error.httpStatus ? `HTTP ${error.httpStatus}` : '', error.bizCode === undefined ? '' : `QQ 错误码 ${error.bizCode}`].filter(Boolean).join('，');
        const reason = error.bizCode === 40034005 ? '被动回复窗口已过期（群聊为 5 分钟），请在 QQ 中重新联系机器人后显式发送；未自动重发' : error.bizMessage ? safeMessage(error.bizMessage, secrets)
            : error.httpStatus === 0 ? '网络请求失败或超时，未能取得 QQ 的确认'
                : rejected ? 'QQ 接口拒绝了本次发送' : '未能读取有效的 QQ 发送确认';
        return { state: rejected ? 'failed' : 'unknown', error: `${rejected ? 'QQ 拒绝发送' : 'QQ 发送结果未确认'}${details ? `（${details}）` : ''}：${reason}` };
    }
    const reason = error instanceof Error ? safeMessage(error.message, secrets) : '';
    return { state: 'unknown', error: `QQ 发送结果未确认${reason ? `：${reason}` : '，请核对后决定是否重新发送'}` };
}
//# sourceMappingURL=delivery-error.js.map