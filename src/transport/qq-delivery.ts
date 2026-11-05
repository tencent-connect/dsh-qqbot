import { ApiError, MediaFileType, MsgType, StreamSession, type InlineKeyboard, type QQBot } from '@tencent-connect/qqbot-nodejs';
import { ApiClient, MediaApi, MessageApi, type RequestOptions } from '@tencent-connect/qqbot-nodejs/protocol';
import type { MediaSenderLike } from '../media/send-media.ts';
import type { Logger, ReplyTarget } from '../types.ts';
import { assertDeliveryAllowed } from './delivery-context.ts';
import { forgetMsgId, getCachedReplyIds } from './msgid-cache.ts';
import type { StreamSessionLike } from './outbound-buffer.ts';
import type { ReplyLimiter } from './reply-limiter.ts';
import { resolveReplyTarget } from './reply-target.ts';
import { StreamTargetExpired } from './delivery-errors.ts';

class CheckedApiClient extends ApiClient {
  constructor(private readonly client: ApiClient, private readonly check: () => void) { super(); }

  override async request<T>(token: string, method: string, path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    this.check();
    return this.client.request<T>(token, method, path, body, options);
  }
}

export function sendDeliveryMarkdown(
  bot: QQBot,
  limiter: ReplyLimiter,
  target: ReplyTarget,
  content: string,
  opts?: { keyboard?: InlineKeyboard },
) {
  const reply = resolveReplyTarget(target, limiter, true);
  const client = new CheckedApiClient(bot.apiClient, () => assertDeliveryAllowed(target));
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

export function openDeliveryStream(bot: QQBot, target: ReplyTarget, logger: Logger): StreamSessionLike {
  const { scope, targetId, msgId } = target;
  if (scope !== 'c2c' || !msgId || !getCachedReplyIds(scope, targetId).some(id => id.kind === 'msg' && id.id === msgId)) {
    throw new StreamTargetExpired();
  }

  let canceled = false;
  let sent = false;
  let failure: { error: unknown } | undefined;
  const client = new CheckedApiClient(bot.apiClient, () => {
    if (canceled) throw new Error('QQ stream canceled');
    if (failure) throw failure.error;
    assertDeliveryAllowed(target);
  });
  const api = new MessageApi(client, bot.tokenManager, { markdownSupport: true });
  const send = api.sendC2CStreamMessage.bind(api);
  api.sendC2CStreamMessage = async (...args) => {
    try {
      const result = await send(...args);
      sent = true;
      return result;
    } catch (error) {
      if (error instanceof ApiError && (error.httpStatus === 429 || error.bizCode === 50002)) {
        // StreamSession reads the legacy code field when applying its retry budget.
        throw Object.assign(error, { code: error.bizCode === 50002 ? 50002 : 429 });
      }
      if (error instanceof ApiError && error.httpStatus === 400 && error.bizCode === 40034005
        && error.path.endsWith('/stream_messages')) {
        forgetMsgId(scope, targetId, msgId);
        if (!sent) error = new StreamTargetExpired();
      }
      failure = { error };
      session.cancel();
      throw error;
    }
  };
  const session = new StreamSession(api, { openid: targetId, msgId, creds: bot.getCredentials(), logger });
  const throwIfFailed = () => {
    if (failure) throw failure.error;
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

export function createDeliveryMedia(bot: QQBot, limiter: ReplyLimiter): MediaSenderLike {
  const send = async (target: ReplyTarget, fileType: MediaFileType, source: { localPath?: string }, fileName?: string) => {
    const upload = await bot.uploadMedia({ target, fileType, ...source, fileName, srvSendMsg: false });
    assertDeliveryAllowed(target);
    const reply = resolveReplyTarget(target, limiter, false);
    const client = new CheckedApiClient(bot.apiClient, () => assertDeliveryAllowed(target));
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
