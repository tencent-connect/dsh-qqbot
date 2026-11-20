import { AsyncLocalStorage } from 'node:async_hooks';
import { ApiError, type QQBot } from '@tencent-connect/qqbot-nodejs';
import type { RequestOptions } from '@tencent-connect/qqbot-nodejs/protocol';
import type { ReplyTarget } from '../types.ts';

/**
 * Gate conversation POSTs after the SDK has acquired its token. This includes
 * middleware and inbound error replies that do not pass through TurnTracker.
 */
export function guardConversationPosts(
  bot: QQBot, baseUrl: string, userAgent: string, allowTarget: (target: ReplyTarget) => boolean,
) {
  const pairing = new AsyncLocalStorage<{ target: ReplyTarget; allowed: () => boolean }>();
  const request = bot.apiClient.request.bind(bot.apiClient);
  bot.apiClient.request = async <T>(token: string, method: string, path: string, body?: unknown, options?: RequestOptions): Promise<T> => {
    if (method !== 'POST' || !/^\/v2\/(users|groups)\//.test(path)) return request<T>(token, method, path, body, options);
    const match = /^\/v2\/(users|groups)\/([A-Za-z0-9_-]+)\/(messages|stream_messages|files|upload_prepare|upload_part_finish)$/.exec(path);
    if (!match?.[2]) throw new Error('Invalid QQ conversation POST path');
    const target: ReplyTarget = { scope: match[1] === 'groups' ? 'group' : 'c2c', targetId: match[2] };
    const grant = pairing.getStore();
    const isPairingReply = grant && match[3] === 'messages'
      && grant.target.scope === target.scope && grant.target.targetId === target.targetId;
    if (!(isPairingReply ? grant.allowed() : allowTarget(target))) {
      throw new Error('QQ delivery canceled: conversation is no longer authorized');
    }

    const upload = options?.uploadRequest || match[3] === 'files'
      || match[3] === 'upload_prepare' || match[3] === 'upload_part_finish';
    let response: Response;
    let payload: unknown;
    try {
      response = await fetch(baseUrl + path, {
        method, headers: { Authorization: `QQBot ${token}`, 'Content-Type': 'application/json', 'User-Agent': userAgent },
        body: JSON.stringify(body), signal: AbortSignal.timeout(options?.timeoutMs ?? (upload ? 120_000 : 30_000)),
        // A redirect can issue another POST without rechecking admission.
        redirect: 'manual',
      });
      payload = await response.json().catch(() => undefined);
    } catch (error) {
      throw new ApiError(`QQ request failed: ${error instanceof Error ? error.message : String(error)}`, 0, path);
    }
    if (!response.ok || payload === undefined) {
      const detail = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      const code = detail.code ?? detail.err_code;
      const message = typeof detail.message === 'string' ? detail.message : undefined;
      throw new ApiError(message ?? `QQ returned HTTP ${response.status} without a usable response`, response.status, path,
        typeof code === 'number' ? code : undefined, message);
    }
    return payload as T;
  };

  return (target: ReplyTarget, text: string, allowed: () => boolean) =>
    pairing.run({ target, allowed }, () => bot.sendText(target, text));
}
