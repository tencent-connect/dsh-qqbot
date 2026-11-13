import { createHash } from 'node:crypto';
import { ApiError, MediaFileType, MsgType, type QQBot } from '@tencent-connect/qqbot-nodejs';
import { ApiClient, MediaApi, MessageApi, sanitizeFileName, type RequestOptions } from '@tencent-connect/qqbot-nodejs/protocol';
import { deliveryKey, type DeliveryLedger } from './delivery-ledger.ts';
import { canQuoteTimelineEntry, type WorkbenchSendResult } from '../shared/workbench-timeline-protocol.ts';
import type { ReplyTarget } from '../types.ts';
import { receivedEntryId, type QqTimeline } from '../runtime/qq-timeline.ts';
import { imageExtension } from './attachment.ts';

export interface ManualAttachment { name: string; bytes: Buffer }
type Send = (target: ReplyTarget, text: string, beforeRequest: (phase?: 'upload') => void,
  attachment?: ManualAttachment, quoteId?: string) => Promise<{ id: string }>;
type Outcome = Omit<WorkbenchSendResult, 'id' | 'status'> & { status: 'accepted' | 'rejected' | 'unknown'; platformId?: string };

export class ManualSendConflict extends Error {}

function keyFor(appId: string, target: ReplyTarget, operation: string): string {
  return deliveryKey('manual', appId, target.scope, target.targetId, operation);
}

export class ManualQqSender {
  private readonly pending = new Set<string>();

  constructor(
    private readonly appId: string,
    private readonly ledger: DeliveryLedger,
    private readonly send: Send,
    private readonly timeline?: QqTimeline,
  ) {}

  static status(ledger: DeliveryLedger, appId: string, target: ReplyTarget, operation: string, pending = false): WorkbenchSendResult | undefined {
    const id = keyFor(appId, target, operation);
    const receipt = ledger.delivery(id);
    if (!receipt) return undefined;
    return {
      id, status: receipt.state === 'not-sent' ? 'rejected' : receipt.state === 'sending' && !pending ? 'unknown' : receipt.state,
      httpStatus: receipt.httpStatus, platformCode: receipt.platformCode,
    };
  }

  status(target: ReplyTarget, operation: string): WorkbenchSendResult | undefined {
    return ManualQqSender.status(this.ledger, this.appId, target, operation, this.pending.has(keyFor(this.appId, target, operation)));
  }

  async submit(target: ReplyTarget, operation: string, text: string, allowed: () => boolean, recording: () => boolean,
    sourceSessionId?: string, attachment?: ManualAttachment, replyTo?: string): Promise<WorkbenchSendResult> {
    const id = keyFor(this.appId, target, operation);
    const fingerprint = attachment
      ? deliveryKey(text, attachment.name, createHash('sha256').update(attachment.bytes).digest('hex'))
      : replyTo ? deliveryKey('quote', text, replyTo) : deliveryKey(text);
    const prior = this.ledger.delivery(id);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new ManualSendConflict('这次发送的正文已变更、附件不同或引用不同，请先查询原发送结果。');
      return this.status(target, operation)!;
    }
    if (!allowed()) throw new ManualSendConflict('当前机器人或会话不允许发送。');
    const quoted = replyTo ? this.timeline?.entry(this.appId, target, replyTo) : undefined;
    if (replyTo && (attachment || !canQuoteTimelineEntry(quoted) || receivedEntryId(quoted.platformId) !== replyTo)) {
      throw new ManualSendConflict('引用消息不可用。请在当前 QQ 对话选择一条收到的消息。');
    }
    if (!this.ledger.begin(id, fingerprint)) return this.status(target, operation)!;
    this.pending.add(id);
    let posted = false;
    const quote = quoted && {
      text: quoted.text.slice(0, 400), attachments: quoted.attachments, senderName: quoted.senderName,
    };
    const entry = {
      id, at: Date.now(), direction: 'outbound' as const, source: sourceSessionId ? 'answer' as const : 'manual' as const,
      text, sessionId: sourceSessionId, quote, ...(attachment ? { attachments: 1, attachmentName: attachment.name } : {}),
    };
    const transmit = async (): Promise<Outcome> => {
      try {
        const result = await this.send(target, text, phase => {
          if (!allowed()) throw new ManualSendConflict('发送前发现机器人或会话已停用。');
          if (phase === 'upload') return;
          if (posted) throw new Error('QQ manual operation already submitted');
          posted = true;
        }, attachment, quoted?.platformId);
        return { status: 'accepted', platformId: result.id };
      } catch (error) {
        const httpStatus = error instanceof ApiError && error.httpStatus > 0 ? error.httpStatus : undefined;
        const platformCode = error instanceof ApiError && Number.isSafeInteger(error.bizCode) ? error.bizCode : undefined;
        return {
          status: !posted || (httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408 && httpStatus !== 499) ? 'rejected' : 'unknown',
          httpStatus, platformCode,
        };
      }
    };
    try {
      let outcome: Outcome;
      if (this.timeline && recording()) {
        outcome = await this.timeline.observe(this.appId, target, { ...entry, status: 'sending' }, transmit, result => result ?? { status: 'unknown' });
      } else {
        outcome = await transmit();
      }
      const { status, httpStatus, platformCode } = outcome;
      this.ledger.settle(id, status === 'rejected' ? 'not-sent' : status, { httpStatus, platformCode });
      return { id, status, httpStatus, platformCode };
    } finally {
      this.pending.delete(id);
    }
  }
}

/** Use the SDK's message path, token and sequence allocator, but never follow
 * redirects or retry a POST whose delivery status is unclear. */
export function createManualTransport(bot: QQBot, baseUrl: string, userAgent: string,
  replyFor: (target: ReplyTarget) => ReplyTarget = target => target): Send {
  return async (target, text, beforeRequest, attachment, quoteId) => {
    const client = new ApiClient();
    client.request = async <T>(token: string, method: string, path: string, body?: unknown, options?: RequestOptions): Promise<T> => {
      const upload = options?.uploadRequest === true;
      beforeRequest(upload ? 'upload' : undefined);
      const response = await fetch(baseUrl + path, {
        method, headers: { Authorization: `QQBot ${token}`, 'Content-Type': 'application/json', 'User-Agent': userAgent },
        body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(15_000),
      });
      const raw: unknown = await response.json().catch(() => undefined);
      const payload = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      const receipt = upload ? payload.file_info : payload.id;
      if (!response.ok || typeof receipt !== 'string' || !receipt) {
        const code = payload.code ?? payload.err_code;
        throw new ApiError('QQ manual submission did not return a valid receipt', response.status, path, typeof code === 'number' ? code : undefined);
      }
      return raw as T;
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
