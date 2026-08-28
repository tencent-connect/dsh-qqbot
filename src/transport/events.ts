/**
 * 出站事件解析 — 将 dsh session/event 归一化为强类型
 *
 * 原始事件（ctx.on('session/event') 回调参数）是弱类型：
 *   { type: string, data: Record<string, unknown> }
 * 这里把可识别的事件解析为 discriminated union，未知类型或字段缺失返回 undefined。
 */

/** 原始 dsh 事件（弱类型，来自 ctx.on('session/event')） */
export interface RawSessionEvent {
  type: string;
  data: Record<string, unknown>;
}

/** turn/end 事件的 reason 结构（兼容 error/failure/顶层 message 三种形态） */
export interface TurnEndReason {
  kind?: string;
  error?: { message?: string; code?: string };
  failure?: { message?: string; code?: string };
  message?: string;
  code?: string;
}

/** assistant/chunk 事件（仅保留 text-delta） */
export interface ChunkEvent {
  type: 'assistant/chunk';
  text: string;
}

/** assistant/message 事件 */
export interface MessageEvent {
  type: 'assistant/message';
  content: Array<{ type: string; text?: string }>;
}

/** tool/call 事件 */
export interface ToolCallEvent {
  type: 'tool/call';
  callId: string;
  name: string;
  arguments: string;
}

/** tool/result 事件 */
export interface ToolResultEvent {
  type: 'tool/result';
  callId: string;
  error?: { name: string; code: string };
  /** 原始 data 透传给 presenter 做结构化展示 */
  raw: Record<string, unknown>;
}

/** turn/end 事件 */
export interface TurnEndEvent {
  type: 'turn/end';
  reason: TurnEndReason;
}

/** user/message 事件（Web 镜像用；QQ 入站回合由路由器按标记跳过） */
export interface UserMessageEvent {
  type: 'user/message';
  text: string;
}

/** 出站事件联合类型 */
export type OutboundEvent =
  | ChunkEvent
  | MessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | TurnEndEvent
  | UserMessageEvent;

/**
 * 解析原始事件为强类型
 *
 * 未知类型或缺失关键字段时返回 undefined，由调用方直接跳过。
 */
export function parseEvent(raw: RawSessionEvent): OutboundEvent | undefined {
  switch (raw.type) {
    case 'assistant/chunk': {
      const chunk = (raw.data as { chunk?: { type?: string; text?: string } }).chunk;
      if (chunk === undefined || chunk.type !== 'text-delta' || !chunk.text) return undefined;
      return { type: 'assistant/chunk', text: chunk.text };
    }

    case 'assistant/message': {
      const message = (raw.data as { message?: { content?: Array<{ type: string; text?: string }> } }).message;
      if (message === undefined || !Array.isArray(message.content)) return undefined;
      return { type: 'assistant/message', content: message.content };
    }

    case 'tool/call': {
      const data = raw.data as { callId?: string; name?: string; arguments?: string };
      if (!data.callId || !data.name) return undefined;
      return { type: 'tool/call', callId: data.callId, name: data.name, arguments: data.arguments ?? '' };
    }

    case 'tool/result': {
      const data = raw.data as { message?: { source?: { callId?: string } }; error?: { name: string; code: string } };
      const callId = data.message?.source?.callId;
      if (!callId) return undefined;
      return { type: 'tool/result', callId, error: data.error, raw: raw.data };
    }

    case 'turn/end': {
      const reason = (raw.data as { reason?: TurnEndReason }).reason ?? {};
      return { type: 'turn/end', reason };
    }

    case 'user/message': {
      // user/message 的 data 即消息本体（role/source/content 在顶层）
      const data = raw.data as { content?: Array<{ type: string; text?: string }> };
      if (!Array.isArray(data.content)) return undefined;
      const text = data.content
        .filter((b) => b.type === 'text' && typeof b.text === 'string' && b.text.trim().length > 0)
        .map((b) => b.text as string)
        .join('\n');
      return { type: 'user/message', text };
    }

    default:
      return undefined;
  }
}

/**
 * 从 turn/end reason 提取错误信息
 *
 * 兼容三种形态：error（新格式）、failure（旧格式）、顶层 message/code（最旧格式）。
 */
export function extractTurnError(reason: TurnEndReason): { code: string; message: string } | undefined {
  if (reason.kind !== 'error') return undefined;

  const detail = reason.error ?? reason.failure;
  return {
    code: detail?.code ?? reason.code ?? 'UNKNOWN',
    message: detail?.message ?? reason.message ?? 'unknown error',
  };
}
