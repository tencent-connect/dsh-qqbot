import type { ReplyTarget } from '../types.ts';
import type { QQBotSender, StreamSessionLike } from './outbound-buffer.ts';
import type { MediaSenderLike, MediaSendResult } from '../media/send-media.ts';
import { DeliveryLedger, deliveryKey } from './delivery-ledger.ts';
import { chunkMarkdownText } from './chunker.ts';
import { isMessageRejected, MediaAlreadySubmitted, StreamTargetExpired } from './delivery-errors.ts';

interface DeliveryContext { key: string; sessionId?: string; allowed: () => boolean; fixed?: boolean; streamKey?: string; staticKey?: string }
const contexts = new WeakMap<ReplyTarget, DeliveryContext>();

/** Keep routing metadata out of the SDK payload and the public ReplyTarget. */
export function bindDelivery(target: ReplyTarget, context: DeliveryContext): ReplyTarget {
  const bound = { ...target };
  contexts.set(bound, context);
  return bound;
}

export function continueDelivery(source: ReplyTarget, reply: ReplyTarget): ReplyTarget | undefined {
  if (source.scope !== reply.scope || source.targetId !== reply.targetId) return undefined;
  const context = contexts.get(source);
  return context ? bindDelivery(reply, context) : reply;
}

export function deliveryPart(target: ReplyTarget, ...identity: unknown[]): ReplyTarget {
  const context = contexts.get(target);
  return context ? bindDelivery(target, { ...context, key: deliveryKey(context.key, ...identity), fixed: true }) : target;
}

export function replyDelivery(target: ReplyTarget, step: unknown): ReplyTarget {
  const context = contexts.get(target);
  if (!context) return target;
  const key = deliveryKey(context.key, 'reply', step);
  return bindDelivery(target, { ...context, key, streamKey: deliveryKey(key, 'stream'), staticKey: deliveryKey(key, 'static'), fixed: true });
}

export function deliveryTrace(target: ReplyTarget): { sessionId?: string; streamKey: string; reply: boolean } | undefined {
  const context = contexts.get(target);
  return context && {
    sessionId: context.sessionId, streamKey: context.streamKey ?? deliveryKey(context.key, 'stream'),
    reply: context.staticKey !== undefined,
  };
}

function authorize(context: DeliveryContext): void {
  if (!context.allowed()) throw new Error('QQ delivery canceled: source or access is no longer authorized');
}

export function assertDeliveryAllowed(target: ReplyTarget): void {
  const context = contexts.get(target);
  if (!context) throw new Error('QQ automatic delivery has no source identity');
  authorize(context);
}

export function guardSender(sender: QQBotSender, ledger: DeliveryLedger): QQBotSender {
  return {
    async sendText(target, content, limit) {
      const context = contexts.get(target);
      if (!context) throw new Error('QQ automatic delivery has no source identity');
      authorize(context);
      const streamState = context.streamKey && ledger.state(context.streamKey);
      if (streamState && streamState !== 'not-sent') return;
      await ledger.run(context.staticKey ?? deliveryKey(context.key, 'static'), async () => {
        for (const chunk of chunkMarkdownText(content, limit)) {
          authorize(context);
          await sender.sendMarkdown(target, chunk);
        }
      });
    },
    async sendMarkdown(target, content, opts) {
      const context = contexts.get(target);
      if (!context) throw new Error('QQ automatic delivery has no source identity');
      authorize(context);
      const streamState = context.streamKey && ledger.state(context.streamKey);
      if (streamState && streamState !== 'not-sent') return false;
      return ledger.run(deliveryKey(context.key, 'markdown', context.fixed ? null : [content, opts]), async () => {
        authorize(context);
        const options = opts?.keyboard ? { keyboard: opts.keyboard } : undefined;
        try {
          await sender.sendMarkdown(target, content, options);
        } catch (error) {
          if (opts?.fallbackText === undefined || !isMessageRejected(error)) throw error;
          authorize(context);
          await sender.sendMarkdown(target, opts.fallbackText);
        }
      });
    },
    openStream(target) {
      const context = contexts.get(target);
      if (!context) throw new Error('QQ stream has no source identity');
      authorize(context);
      if (context.staticKey && ledger.state(context.staticKey)) throw new Error('QQ reply was already submitted as static text');
      const key = context.streamKey ?? deliveryKey(context.key, 'stream');
      if (!ledger.begin(key)) throw new Error('QQ stream was already submitted; it will not be replayed');
      let stream: StreamSessionLike;
      try { stream = sender.openStream(target); }
      catch (error) { ledger.settle(key, 'not-sent'); throw error; }
      let complete = false;
      const fail = (error: unknown): never => {
        complete = true;
        stream.cancel?.();
        ledger.settle(key, error instanceof StreamTargetExpired ? 'not-sent' : 'unknown');
        throw error;
      };
      return {
        async update(content) {
          if (complete) return;
          try {
            authorize(context);
            return await stream.update(content);
          } catch (error) { return fail(error); }
        },
        async complete() {
          if (complete) return;
          complete = true;
          if (!context.allowed()) {
            stream.cancel?.();
            ledger.settle(key, 'unknown');
            return;
          }
          try { await stream.complete(); ledger.settle(key, 'accepted'); }
          catch (error) { fail(error); }
        },
        cancel() {
          if (complete) return;
          complete = true;
          stream.cancel?.();
          ledger.settle(key, 'unknown');
        },
      };
    },
  };
}

export function guardMedia(sender: MediaSenderLike, ledger: DeliveryLedger): MediaSenderLike {
  const run = async (target: ReplyTarget, kind: string, source: unknown, action: () => Promise<MediaSendResult>) => {
    const context = contexts.get(target);
    if (!context) throw new Error('QQ file delivery has no source identity');
    authorize(context);
    let result: MediaSendResult | undefined;
    const submitted = await ledger.run(deliveryKey(context.key, kind, context.fixed ? null : source), async () => {
      authorize(context);
      result = await action();
    });
    if (!submitted) throw new MediaAlreadySubmitted();
    if (!result) throw new Error('QQ file delivery returned no result');
    return result;
  };
  return {
    sendImage: (target, source) => run(target, 'image', source, () => sender.sendImage(target, source)),
    sendVideo: (target, source) => run(target, 'video', source, () => sender.sendVideo(target, source)),
    sendVoice: (target, source) => run(target, 'voice', source, () => sender.sendVoice(target, source)),
    sendFile: (target, source, opts) => run(target, 'file', [source, opts], () => sender.sendFile(target, source, opts)),
  };
}
