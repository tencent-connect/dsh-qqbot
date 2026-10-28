/** 群智能回复：串行处理完整批次，先判断，再下载附件和启动 Agent。 */
import type { Middleware, MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import type { GroupReplyMessage, GroupReplyPolicy } from '../features/group-reply-policy.ts';
import { getHistoryStore, historyGroupKey } from '../features/history-store.ts';

interface Job {
  ctx: MiddlewareContext;
  next: () => Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

interface GroupQueue {
  pending: Job[];
  active?: MiddlewareContext;
}

function enabled(config: ImQQBotConfig, ctx: MiddlewareContext): boolean {
  return config.groupSmartReply === true && !config.requireMention && ctx.message.kind === 'group';
}

function snapshot(ctx: MiddlewareContext): GroupReplyMessage {
  const m = ctx.message;
  const quote = ctx.state.quote;
  const resolvedQuote = quote ? {
    text: quote.text,
    senderId: quote.entry?.senderId,
    isBot: typeof quote.entry?.isBot === 'boolean' ? quote.entry.isBot : undefined,
    attachments: quote.attachments?.map(attachment => ({ ...attachment })),
  } : undefined;
  return {
    messageId: m.messageId, senderId: m.senderId, senderName: m.senderName,
    content: typeof ctx.state.groupReplyOriginalContent === 'string' ? ctx.state.groupReplyOriginalContent : m.content,
    timestamp: m.timestamp, attachments: m.attachments,
    wasMentioned: (ctx.state.mention as { wasMentioned?: boolean } | undefined)?.wasMentioned === true,
    quote: resolvedQuote,
  };
}

/** SDK merge 的 survivor 提前释放锁，且丢失后续 @/sender；智能模式独立串行。 */
export function createSmartGroupQueue(config: ImQQBotConfig, logger: Logger): {
  middleware: Middleware; dispose(): void;
} {
  const groups = new Map<string, GroupQueue>();
  let disposed = false;

  async function drain(key: string, queue: GroupQueue): Promise<void> {
    try {
      while (queue.pending.length && !disposed) {
        const batch = queue.pending.splice(0).filter(job => {
          if (!job.ctx.signal.aborted) return true;
          job.resolve();
          return false;
        });
        if (!batch.length) continue;
        // 最新消息提供仍有效的被动回复 id；每条消息的发送者和 @ 状态独立保存。
        const survivor = batch[batch.length - 1]!;
        const messages = batch.map(job => snapshot(job.ctx));
        const ctx = survivor.ctx;
        ctx.state.groupReplyMessages = messages;
        ctx.state.mention = {
          implicit: false, shouldAnswer: true, reason: 'passthrough',
          ...ctx.state.mention, wasMentioned: messages.some(m => m.wasMentioned),
        };
        if (batch.length > 1) {
          ctx.message.content = messages.map(m => m.content).join('\n');
          ctx.message.attachments = batch.flatMap(job => job.ctx.message.attachments ?? []);
          // 下载中间件仍消费 survivor 的 quote；聚合附件，正文引用由每条 snapshot 保留。
          const attachments = batch.flatMap(job => job.ctx.state.quote?.attachments ?? []);
          if (attachments.length) {
            ctx.state.quote = {
              ...(ctx.state.quote ?? { refKey: '', source: 'none', text: '' }),
              attachments,
            };
          }
        }
        queue.active = ctx;
        const timeout = config.processingTimeoutMs > 0
          ? setTimeout(() => ctx.abort('group-reply:processing-timeout'), config.processingTimeoutMs)
          : undefined;
        try {
          await survivor.next();
          for (const job of batch) job.resolve();
        } catch (error) {
          survivor.reject(error);
          for (const job of batch) if (job !== survivor) job.resolve();
        } finally {
          if (timeout) clearTimeout(timeout);
          queue.active = undefined;
        }
      }
    } finally {
      // Dispose drains pending waiters itself; never leave a middleware suspended.
      groups.delete(key);
    }
  }

  const middleware: Middleware = async (ctx, next) => {
    if (!enabled(config, ctx)) return next();
    if (disposed || ctx.signal.aborted) { ctx.stop('group-reply:disposed'); return; }
    const key = ctx.message.groupOpenid ?? ctx.replyTarget.targetId;
    let queue = groups.get(key);
    if (queue && queue.pending.length >= Math.max(1, config.maxQueue)) {
      ctx.stop('group-reply:queue-full');
      logger.debug('im-qqbot: smart reply queue full');
      return;
    }
    const fresh = !queue;
    if (!queue) { queue = { pending: [] }; groups.set(key, queue); }
    const current = queue;
    await new Promise<void>((resolve, reject) => {
      current.pending.push({ ctx, next, resolve, reject });
      if (fresh) void drain(key, current);
    });
  };

  return {
    middleware,
    dispose() {
      disposed = true;
      for (const queue of groups.values()) {
        queue.active?.abort('group-reply:disposed');
        for (const job of queue.pending.splice(0)) {
          job.ctx.abort('group-reply:disposed');
          job.resolve();
        }
      }
    },
  };
}

export function createGroupReplyGate(
  config: ImQQBotConfig,
  policy: Pick<GroupReplyPolicy, 'decide'>,
): Middleware {
  return async (ctx, next) => {
    if (!enabled(config, ctx)) return next();
    if (ctx.signal.aborted) return;
    const messages = (ctx.state.groupReplyMessages as GroupReplyMessage[] | undefined) ?? [snapshot(ctx)];
    const groupId = ctx.message.groupOpenid ?? ctx.replyTarget.targetId;
    const ids = new Set(messages.map(m => m.messageId));
    // 进入队列前的 history 快照可能包含上一轮已消费的内容；从共享 store 重取。
    const all = await getHistoryStore().list(historyGroupKey(config.appId, groupId), config.historyLimit);
    const currentIndex = all.findIndex(entry => ids.has(entry.messageId));
    const previous = ctx.state.history as Array<{ messageId: string }> | undefined;
    const previousIds = previous && new Set(previous.map(entry => entry.messageId));
    const history = (previousIds ? all.filter(entry => previousIds.has(entry.messageId))
      : currentIndex < 0 ? [] : all.slice(0, currentIndex))
      .filter(entry => !ids.has(entry.messageId));
    ctx.state.history = history;
    const reply = messages.some(m => m.wasMentioned) || await policy.decide({
      groupId, messages, history, signal: ctx.signal,
    });
    if (!reply || ctx.signal.aborted) { ctx.stop('group-reply:silent'); return; }
    ctx.state.groupSmartReplyAccepted = true;
    await next();
  };
}
