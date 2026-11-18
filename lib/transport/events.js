/**
 * 出站事件解析 — 将 dsh session/event 归一化为强类型
 *
 * 原始事件（ctx.on('session/event') 回调参数）是弱类型：
 *   { type: string, data: Record<string, unknown> }
 * 这里把可识别的事件解析为 discriminated union，未知类型或字段缺失返回 undefined。
 */
const UNAVAILABLE_MODEL_CODES = new Set(['AUTH', 'ACCOUNT_TOKEN_INVALID', 'UNKNOWN_MODEL', 'MODEL_UNSUPPORTED', 'NO_ADAPTER']);
/**
 * 解析原始事件为强类型
 *
 * 未知类型或缺失关键字段时返回 undefined，由调用方直接跳过。
 */
export function parseEvent(raw) {
    switch (raw.type) {
        case 'assistant/chunk': {
            const chunk = raw.data.chunk;
            if (chunk === undefined || chunk.type !== 'text-delta' || !chunk.text)
                return undefined;
            return { type: 'assistant/chunk', text: chunk.text };
        }
        case 'assistant/message': {
            const message = raw.data.message;
            if (message === undefined || !Array.isArray(message.content))
                return undefined;
            return { type: 'assistant/message', ...(typeof message.id === 'string' ? { id: message.id } : {}), content: message.content };
        }
        case 'tool/call': {
            const data = raw.data;
            if (!data.callId || !data.name)
                return undefined;
            return { type: 'tool/call', callId: data.callId, name: data.name, arguments: data.arguments ?? '' };
        }
        case 'tool/result': {
            const data = raw.data;
            const callId = data.message?.source?.callId;
            if (!callId)
                return undefined;
            return { type: 'tool/result', callId, failed: data.error !== undefined || data.message?.isError === true, raw: raw.data };
        }
        case 'turn/end': {
            const reason = raw.data.reason;
            if (reason === null || typeof reason !== 'object' || !('kind' in reason)) {
                return { type: 'turn/end', completed: false };
            }
            if (reason.kind === 'max-tokens')
                return { type: 'turn/end', completed: false, truncated: true };
            if (reason.kind !== 'error')
                return { type: 'turn/end', completed: reason.kind === 'completed' };
            const error = 'error' in reason ? reason.error : undefined;
            const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
            return {
                type: 'turn/end', completed: false,
                failure: typeof code === 'string' && UNAVAILABLE_MODEL_CODES.has(code) ? 'model-unavailable' : 'other',
            };
        }
        case 'deliverables/presented': {
            const data = raw.data;
            if (typeof data.turn !== 'number' || typeof data.callId !== 'string' || !data.callId)
                return undefined;
            if (!Array.isArray(data.files) || data.files.length === 0)
                return undefined;
            const files = [];
            for (const file of data.files) {
                if (file === null || typeof file !== 'object' || Array.isArray(file))
                    return undefined;
                const { path, description } = file;
                if (typeof path !== 'string' || !path)
                    return undefined;
                if (description !== undefined && typeof description !== 'string')
                    return undefined;
                files.push(description === undefined ? { path } : { path, description });
            }
            return { type: 'deliverables/presented', turn: data.turn, callId: data.callId, files };
        }
        default:
            return undefined;
    }
}
/**
 * 解析 `agent/assistant-stream` 的 payload（对齐 @deepseek-ai/dsh-agent 的
 * AssistantStreamFrame 最小契约，避免硬依赖）。
 *
 * 只归一化两类帧：start（新 attempt）与 chunk 的 text-delta（文本增量）。
 * reasoning-delta / tool-call-delta 不进用户消息；end 帧不处理——收尾由 durable
 * `assistant/message` / `turn/end` 事件负责。未知形态返回 undefined。
 */
export function parseStreamFrame(raw) {
    if (raw === null || typeof raw !== 'object')
        return undefined;
    const agentId = raw.agent?.id;
    if (typeof agentId !== 'string' || !agentId)
        return undefined;
    const frame = raw.frame;
    if (frame === null || typeof frame !== 'object')
        return undefined;
    const { type, attemptId } = frame;
    if (typeof attemptId !== 'string' || !attemptId)
        return undefined;
    if (type === 'start') {
        const identity = frame;
        return { agentId, delta: { kind: 'attempt-start', attemptId,
                ...(typeof identity.turn === 'number' ? { turn: identity.turn } : {}),
                ...(typeof identity.step === 'number' ? { step: identity.step } : {}),
                ...(typeof identity.revision === 'number' ? { revision: identity.revision } : {}),
            } };
    }
    if (type === 'chunk') {
        const chunk = frame.chunk;
        if (chunk?.type !== 'text-delta' || typeof chunk.text !== 'string' || !chunk.text)
            return undefined;
        const identity = frame;
        return { agentId, delta: { kind: 'text-delta', attemptId, text: chunk.text,
                ...(typeof identity.revision === 'number' ? { revision: identity.revision } : {}),
                ...(typeof identity.index === 'number' ? { index: identity.index } : {}),
            } };
    }
    return undefined;
}
//# sourceMappingURL=events.js.map