/**
 * SDK 中间件编排
 *
 * 根据插件配置组装 SDK 内置中间件链（洋葱模型）。
 * 中间件负责过滤与上下文富化；最终消息统一由 bot.on('message') 处理转发。
 */
import type { Middleware, MiddlewareContext, QQBot } from '@tencent-connect/qqbot-nodejs';
import {
  errorHandler,
  messageFilter,
  accessPolicy,
  mentionGate,
  contentSanitizer,
  rateLimiter,
  slashCommand,
  concurrencyGuard,
  typingIndicator,
  quoteRef,
  historyBuffer,
  envelopeFormatter,
} from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.ts';
import type { SessionManager } from '../session/index.ts';
import type { Logger, ReplyTarget } from '../types.ts';
import { buildCommandList } from '../commands/index.ts';
import { attachmentProcessor } from '../middleware/attachment.ts';
import { questionAnswer } from '../middleware/question-answer.ts';
import type { ReplyIdCache } from '../transport/msgid-cache.ts';
import { getHistoryStore, historyGroupKey } from '../features/history-store.ts';
import { messageSenderName } from '../shared/message-sender-name.ts';

export function setupMiddlewares(
  bot: QQBot,
  config: ImQQBotConfig,
  manager: SessionManager,
  logger: Logger,
  replyIds: ReplyIdCache,
  isActive: () => boolean,
  mediaRoot?: string,
  receiving?: (target: ReplyTarget) => boolean,
): void {
  const blocked = (ctx: MiddlewareContext): boolean => {
    if (!isActive()) {
      ctx.stop('gateway-inactive');
      return true;
    }
    if (receiving?.(ctx.replyTarget) === false) {
      ctx.stop('conversation-paused');
      return true;
    }
    return false;
  };
  const requireReceiving: Middleware = async (ctx, next) => {
    if (!blocked(ctx)) await next();
  };
  bot.use(requireReceiving);

  // 1. 错误兜底
  bot.use(errorHandler());

  // 2. 消息过滤：bot 回声 + 消息去重
  bot.use(messageFilter({ skipSelfEcho: false }));

  const mention = mentionGate({ requireMentionInGroup: config.requireMention });
  const limit = rateLimiter();

  // 有效网页邀请是加白入口，必须先于访问控制；普通消息仍走下方策略。
  bot.use(async (ctx, next) => {
    const service = manager.accountAccess;
    const content = ctx.message.content
      .replaceAll(`<@!${config.appId}>`, '').replaceAll(`<@${config.appId}>`, '').trim();
    if (!service || !content || content.length > 32 || !service.isActivePairCode(content)) {
      await next();
      return;
    }
    await mention(ctx, async () => limit(ctx, async () => {
      if (blocked(ctx)) return;
      try {
        const result = service.beginClaimFromMessage(
          ctx.replyTarget.scope, ctx.replyTarget.targetId, content,
          ctx.message.senderId, messageSenderName(ctx.message),
        );
        await ctx.bot.sendText(ctx.replyTarget, result.message);
      } catch (err) {
        logger.error(`im-qqbot: 认领处理失败: ${err instanceof Error ? err.message : String(err)}`);
        if (isActive()) {
          try { await ctx.bot.sendText(ctx.replyTarget, '⚠️ 认领处理失败，请稍后重试。'); } catch { /* reply best-effort */ }
        }
      }
      ctx.stop('claim-result');
    }));
  });

  // 3. 访问控制（空名单 = 拒绝所有人，fail-closed）
  const admit: Middleware = (ctx, next) => {
    const access = manager.accountAccess?.currentAccess() ?? config.access;
    return accessPolicy({
      c2c: { mode: access.c2cMode, allow: access.c2cAllow },
      group: { mode: access.groupMode, allow: access.groupAllow },
      onBlock: (_ctx, reason) => { if (config.debug) logger.debug('Access blocked: ' + reason); },
    })(ctx, next);
  };
  bot.use(admit);

  // 4. 群历史缓冲 — 放在门控之前，确保所有消息（含未 @bot）都计入上下文
  //    store 走共享单例（getHistoryStore），groupKey 带 appId 前缀，供回复后清空
  const history = getHistoryStore();
  bot.use(historyBuffer({
    limit: config.historyLimit,
    store: {
      list: (key, limit) => history.list(key, limit),
      append: (key, entry, limit) => {
        const targetId = key.slice(config.appId.length + 1);
        if (isActive() && receiving?.({ scope: 'group', targetId }) !== false) return history.append(key, entry, limit);
      },
    },
    recordOnSkip: true,
    groupKey: (ctx) => {
      const gid = ctx.message.groupOpenid;
      if (ctx.message.kind !== 'group' || !gid) return undefined;
      return historyGroupKey(config.appId, gid);
    },
  }));
  bot.use(requireReceiving);

  // 5. 群聊 @bot 门控
  bot.use(mention);

  // 6. 内容清洗（去 @marker、表情标签、多余空白）
  bot.use(contentSanitizer({
    parseFaceTags: true,
  }));

  // 7. 三层限流（sender / group / global）
  bot.use(limit);

  // 8. 斜杠命令（在 concurrencyGuard 之前，命令匹配后不排队直接响应）
  const slash = slashCommand({
    // 关闭 autoHelp：help 命令由 qqbot 注册为 /bot-help，
    // 避免 SDK 再自动注册一个无前缀的 /help 造成重复
    autoHelp: false,
    commands: buildCommandList({ manager, config, logger }),
  });
  bot.use(requireReceiving);
  bot.use(slash.middleware);
  bot.use(async (ctx, next) => {
    if (ctx.message.content.trim().startsWith('/')) {
      const service = manager.accountAccess;
      const error = service ? service.commandAccessError(ctx.message.senderId) : '斜杠命令服务尚未就绪。';
      await ctx.bot.sendText(ctx.replyTarget, error ?? '未知命令，请发送 /bot-help 查看可用命令。');
      ctx.stop(error ? 'slash-command-access-denied' : 'unknown-command');
      return;
    }
    await next();
  });
  // 8.5. 待答问题截获（在 concurrencyGuard 之前，答案消息不排队直接作答）
  bot.use(questionAnswer(manager, replyIds));

  // 9. 同 peer 串行。不能合并不同发送者，否则无法保留每条输入的身份和回复窗口。
  bot.use(concurrencyGuard({
    strategy: 'queue',
    maxQueue: config.maxQueue,
    maxProcessingMs: config.processingTimeoutMs,
  }));
  bot.use(requireReceiving);
  bot.use(admit);

  // 10. C2C 输入状态指示
  bot.use(typingIndicator());

  // 11. 引用消息解析（记录 + 解析被引用原文）
  bot.use(quoteRef({
    maxSize: 500,
    preferMsgElements: true,
  }));

  // 11.5. 附件下载（file 附件下载到本地，供 @提及 / 工具访问）
  bot.use(attachmentProcessor(config, logger, mediaRoot));

  // 12. 上下文组装（将 history + quote + sender 组成 envelope）
  bot.use(envelopeFormatter({
    historyLimit: config.historyLimit,
    includeQuote: true,
    includeSender: true,
  }));
}
