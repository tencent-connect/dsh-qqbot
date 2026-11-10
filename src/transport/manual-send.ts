import { ApiError, MsgType, type QQBot } from '@tencent-connect/qqbot-nodejs';
import { ApiClient, MessageApi } from '@tencent-connect/qqbot-nodejs/protocol';
import { deliveryKey, type DeliveryLedger } from './delivery-ledger.ts';
import type { WorkbenchSendResult } from '../shared/workbench-timeline-protocol.ts';
import type { ReplyTarget } from '../types.ts';
import type { QqTimeline } from '../runtime/qq-timeline.ts';

type Send = (target: ReplyTarget, text: string, beforeRequest: () => void) => Promise<{ id: string }>;
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

  async submit(target: ReplyTarget, operation: string, text: string, allowed: () => boolean, recording: () => boolean, sourceSessionId?: string): Promise<WorkbenchSendResult> {
    const id = keyFor(this.appId, target, operation);
    const fingerprint = deliveryKey(text);
    const prior = this.ledger.delivery(id);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new ManualSendConflict('这次发送的正文已变更，请先查询原发送结果。');
      return this.status(target, operation)!;
    }
    if (!allowed()) throw new ManualSendConflict('当前机器人或会话不允许发送。');
    if (!this.ledger.begin(id, fingerprint)) return this.status(target, operation)!;
    this.pending.add(id);
    let posted = false;
    const entry = { id, at: Date.now(), direction: 'outbound' as const, source: sourceSessionId ? 'answer' as const : 'manual' as const, text, sessionId: sourceSessionId };
    const transmit = async (): Promise<Outcome> => {
      try {
        const result = await this.send(target, text, () => {
          if (!allowed()) throw new ManualSendConflict('发送前发现机器人或会话已停用。');
          if (posted) throw new Error('QQ manual operation already submitted');
          posted = true;
        });
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
export function createManualTextTransport(bot: QQBot, baseUrl: string, userAgent: string): Send {
  return async (target, text, beforeRequest) => {
    const client = new ApiClient();
    client.request = async <T>(token: string, method: string, path: string, body?: unknown): Promise<T> => {
      beforeRequest();
      const response = await fetch(baseUrl + path, {
        method, headers: { Authorization: `QQBot ${token}`, 'Content-Type': 'application/json', 'User-Agent': userAgent },
        body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(15_000),
      });
      const raw: unknown = await response.json().catch(() => undefined);
      const payload = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      if (!response.ok || typeof payload.id !== 'string' || !payload.id) {
        const code = payload.code ?? payload.err_code;
        throw new ApiError('QQ manual text submission did not return a message ID', response.status, path, typeof code === 'number' ? code : undefined);
      }
      return raw as T;
    };
    const api = new MessageApi(client, bot.tokenManager, { markdownSupport: false });
    api.onMessageSent((ref, meta) => bot.messageApi.notifyMessageSent(ref, meta));
    return api.sendRaw(target.scope, target.targetId, bot.getCredentials(), {
      content: text, msg_type: MsgType.TEXT, msg_id: target.msgId,
    });
  };
}
