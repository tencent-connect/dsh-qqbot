import { randomUUID } from 'node:crypto';
import { ApiError, MsgType, StreamInputState, type QQBot } from '@tencent-connect/qqbot-nodejs';
import type { ApiClient } from '@tencent-connect/qqbot-nodejs/protocol';
import { deliveryTrace } from './delivery-context.ts';
import { deliveryKey } from './delivery-ledger.ts';
import { timelineText, type QqTimeline } from '../runtime/qq-timeline.ts';
import type { TimelineEntry } from '../shared/workbench-timeline-protocol.ts';
import type { ReplyTarget } from '../types.ts';

export type TimelineRequest = (target: ReplyTarget) => ApiClient['request'];

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

/** Observe actual SDK HTTP submissions, including commands. Typing and uploads are not messages. */
export function observeTimelineRequests(
  bot: QQBot, appId: string, timeline: QqTimeline, canRecord: (target: ReplyTarget) => boolean,
): TimelineRequest {
  const request = bot.apiClient.request.bind(bot.apiClient);
  const observe = (source?: ReplyTarget): ApiClient['request'] => async <T>(
    ...args: Parameters<ApiClient['request']>
  ): Promise<T> => {
    const [, method, path, raw] = args;
    const match = /^\/v2\/(users|groups)\/([^/]+)\/(messages|stream_messages)$/.exec(path);
    if (method !== 'POST' || !match?.[2]) return request<T>(...args);
    const body = object(raw);
    if (body.input_notify !== undefined) return request<T>(...args);
    const target: ReplyTarget = {
      scope: match[1] === 'users' ? 'c2c' : 'group',
      targetId: match[2],
    };
    if (!canRecord(target)) return request<T>(...args);

    const streaming = match[3] === 'stream_messages';
    const trace = source && deliveryTrace(source);
    const text = body.content_raw ?? object(body.markdown).content ?? body.content;
    const attachments = body.msg_type === MsgType.MEDIA ? 1 : undefined;
    // No raw keyboard values, upload references or SDK payloads are persisted.
    if (typeof text !== 'string' && !attachments) return request<T>(...args);
    const id = streaming ? trace?.streamKey ?? deliveryKey('stream', body.msg_id, body.msg_seq) : randomUUID();
    const entry: TimelineEntry = {
      id, at: Date.now(), direction: 'outbound', text: typeof text === 'string' ? timelineText(text) : '',
      status: 'sending', attachments, sessionId: trace?.sessionId,
    };
    return timeline.observe(appId, target, entry, () => request<T>(...args), (result, error) => {
      if (error !== undefined) {
        const httpStatus = error instanceof ApiError ? error.httpStatus : undefined;
        return {
          status: httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500 ? 'rejected' : 'unknown',
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
