/**
 * SDK 中间件编排
 *
 * 根据插件配置组装 SDK 内置中间件链（洋葱模型）。
 * 中间件负责过滤与上下文富化；最终消息统一由 bot.on('message') 处理转发。
 */
import type { QQBot } from '@tencent-connect/qqbot-nodejs';
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
import type { Logger } from '../types.ts';
import { buildCommandList } from '../commands/index.ts';
import { attachmentProcessor } from '../middleware/attachment.ts';
import { questionAnswer } from '../middleware/question-answer.ts';
import { getHistoryStore, historyGroupKey } from '../features/history-store.ts';

export function setupMiddlewares(
  bot: QQBot,
  config: ImQQBotConfig,
  manager: SessionManager,
  logger: Logger,
): void {
  // 1. 错误兜底（最外层洋葱皮）
  bot.use(errorHandler());

  // 2. 消息过滤：bot 回声 + 消息去重
  bot.use(messageFilter({ skipSelfEcho: false }));

  // 3. 访问控制（空名单 = 拒绝所有人，fail-closed）
  bot.use(accessPolicy({
    c2c: {
      mode: config.access.c2cMode,
      allow: config.access.c2cAllow,
    },
    group: {
      mode: config.access.groupMode,
      allow: config.access.groupAllow,
    },
    onBlock: (_mCtx, reason) => {
      if (config.debug) {
        logger.debug(`Access blocked: ${reason}`);
      }
    },
  }));

  // 4. 群历史缓冲 — 放在门控之前，确保所有消息（含未 @bot）都计入上下文
  //    store 走共享单例（getHistoryStore），groupKey 带 appId 前缀，供回复后清空
  bot.use(historyBuffer({
    limit: config.historyLimit,
    store: getHistoryStore(),
    recordOnSkip: true,
    groupKey: (ctx) => {
      const gid = ctx.message.groupOpenid;
      if (ctx.message.kind !== 'group' || !gid) return undefined;
      return historyGroupKey(config.appId, gid);
    },
  }));

  // 5. 群聊 @bot 门控
  bot.use(mentionGate({
    requireMentionInGroup: config.requireMention,
  }));

  // 6. 内容清洗（去 @marker、表情标签、多余空白）
  bot.use(contentSanitizer({
    parseFaceTags: true,
  }));

  // 7. 三层限流（sender / group / global）
  bot.use(rateLimiter());

  bot.use(async (ctx, next) => {
    const service = manager.conversations;
    if (ctx.message.content.trim().startsWith('/') && !service?.isOwner(ctx.message.senderId)) {
      await ctx.bot.sendText(ctx.replyTarget, '斜杠命令仅机器人超管可用。');
      ctx.stop('slash-command-owner-required'); return;
    }
    await next();
  });

  // 8. 斜杠命令（在 concurrencyGuard 之前，命令匹配后不排队直接响应）
  const slash = slashCommand({
    // 关闭 autoHelp：help 命令由 qqbot 注册为 /bot-help，
    // 避免 SDK 再自动注册一个无前缀的 /help 造成重复
    autoHelp: false,
    commands: buildCommandList({ manager, config, logger }),
  });
  bot.use(slash.middleware);
  bot.use(async (ctx, next) => {
    if (ctx.message.content.trim().startsWith('/')) {
      await ctx.bot.sendText(ctx.replyTarget, '未知命令，请发送 /bot-help 查看可用命令。');
      ctx.stop('unknown-command'); return;
    }
    await next();
  });
  // 裸 token 认领：仅当消息文本恰好是"当前正在生成、未过期的配对码"时才拦截；否则原样放行给 agent。
  bot.use(async (ctx, next) => {
    const service = manager.conversations;
    const content = ctx.message.content.trim();
    if (service && content.length > 0 && content.length <= 32 && service.isActivePairCode(content)) {
      // 认领处理失败绝不能冒泡中断中间件链（否则 SDK 重连、消息丢失）。
      try {
        const result = service.beginClaimFromMessage(ctx.replyTarget.scope, ctx.replyTarget.targetId, content, ctx.message.senderId, ctx.message.senderName);
        await ctx.bot.sendText(ctx.replyTarget, result.message);
      } catch (err) {
        logger.error(`im-qqbot: 认领处理失败: ${err instanceof Error ? err.message : String(err)}`);
        try { await ctx.bot.sendText(ctx.replyTarget, '⚠️ 认领处理失败，请稍后重试。'); } catch { /* reply best-effort */ }
      }
      ctx.stop('claim-result'); return;
    }
    await next();
  });



  // 8.5. 待答问题截获（在 concurrencyGuard 之前，答案消息不排队直接作答）
  bot.use(questionAnswer(manager));

  // 9. 并发串行 + 消息合并（同 peer 排队，避免 session 冲突）
  bot.use(concurrencyGuard({
    strategy: 'merge',
    maxQueue: config.maxQueue,
    maxProcessingMs: config.processingTimeoutMs,
  }));

  // 10. C2C 输入状态指示
  bot.use(typingIndicator());

  // 11. 引用消息解析（记录 + 解析被引用原文）
  bot.use(quoteRef({
    maxSize: 500,
    preferMsgElements: true,
  }));

  // 11.5. 附件下载（file 附件下载到本地，供 @提及 / 工具访问）
  bot.use(attachmentProcessor(config, logger));

  // 12. 上下文组装（将 history + quote + sender 组成 envelope）
  bot.use(envelopeFormatter({
    historyLimit: config.historyLimit,
    includeQuote: true,
    includeSender: true,
  }));
}
