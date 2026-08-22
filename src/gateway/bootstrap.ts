/**
 * 网关组装 — 创建 bot、编排中间件、注册事件、出站、生命周期
 *
 * 将 QQ 消息平台作为 dsh 前端协议驱动：入站消息 → handleInbound → dsh agent，
 * dsh session/event → createOutboundHandler → QQ 出站。
 */
import type { Context } from '@deepseek-ai/cordis';
import { QQBot } from '@tencent-connect/qqbot-nodejs';
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import { SessionManager, type DshAgentRegistry } from '../session/index.js';
import { handleInbound, createOutboundHandler } from '../transport/index.js';
import type { ToolsRegistryLike } from '../transport/tool-presenter.js';
import type { QQBotSender } from '../transport/outbound-buffer.js';
import { buildUserAgent } from '../shared/index.js';
import type { ImQQBotConfig } from '../config.js';
import type { Logger } from '../types.js';
import { setupMiddlewares } from './middleware-setup.js';
import { startMediaCleanup } from '../media/media-cleaner.js';
import { ensureVisionInputModal, registerDescribeImageTool } from '../media/vision-tool.js';
import { QuestionChannel } from '../features/question-channel.js';

export async function bootstrapGateway(
  ctx: Context,
  agents: DshAgentRegistry,
  config: ImQQBotConfig,
  logger: Logger,
): Promise<void> {
  const manager = new SessionManager(ctx, agents, config, logger);

  // ── 初始化 QQ Bot SDK ──
  const userAgent = buildUserAgent();
  const bot = new QQBot({
    appId: config.appId,
    appSecret: config.appSecret,
    transport: 'websocket',
    baseUrl: process.env.QQBOT_BASE_URL?.replace(/\/+$/, '') || 'https://api.bot.qq.com',
    tokenBaseUrl: process.env.QQBOT_TOKEN_BASE_URL?.replace(/\/+$/, '') || 'https://api.bot.qq.com',
    userAgent,
    logger,
  } as ConstructorParameters<typeof QQBot>[0]);
  logger.info(`QQBot SDK initialized (UA: ${userAgent})`);

  // ── 中间件链 ──
  setupMiddlewares(bot, config, manager, logger);

  // ── 入站：经过中间件链后的消息交给 dsh agent ──
  bot.on('message', async (mCtx: MiddlewareContext) => {
    const msg = mCtx.message;
    if (config.debug) {
      logger.debug(`← message (post-middleware): ${JSON.stringify(msg, null, 2).slice(0, 500)}`);
    }
    await handleInbound(msg, manager, config, logger, mCtx.state);
  });

  // ── 出站：dsh session/event → QQ 消息 ──
  // 获取 tools 服务（工具结果结构化展示，参考 dsh-TUI presentResult），可选
  let toolsRegistry: ToolsRegistryLike | undefined;
  try {
    toolsRegistry = ctx.get('tools') as ToolsRegistryLike | undefined;
  } catch {
    toolsRegistry = undefined;
  }

  // 发送适配器：将 QQBot 实例适配为 QQBotSender（openStream 参数形态不同）
  // sendMarkdown 透传 opts（承载 { keyboard } 内联按钮，交互式提问用）
  const sender: QQBotSender = {
    sendMarkdown: (target, content, opts) => bot.sendMarkdown(target, content, opts),
    openStream: (target) => bot.openStream({
      target: {
        scope: target.scope,
        targetId: target.targetId,
        msgId: target.msgId as string,
      },
    }),
  };

  const outboundHandler = createOutboundHandler(manager, sender, config, logger, toolsRegistry);
  (ctx as unknown as { on(event: string, handler: (...args: unknown[]) => void): void })
    .on('session/event', outboundHandler as (...args: unknown[]) => void);

  // ── 交互式提问通道：QQ 会话的 ask_user_question 渲染为文本/按钮，回复即答案 ──
  const questionChannel = new QuestionChannel(manager, sender, config, logger);
  questionChannel.install(ctx as unknown as { get(name: string): unknown });
  manager.questionChannel = questionChannel;

  // ── 按钮点击回调：解析为答案（平台要求 5 秒内 ACK） ──
  bot.on('interaction', async (_iCtx, event) => {
    logger.info(`im-qqbot: interaction received id=${event?.id ?? '-'} button=${event?.data?.resolved?.button_id ?? '-'} data=${event?.data?.resolved?.button_data ?? '-'} from=${event?.group_openid ? 'group:' + event.group_openid : 'c2c:' + (event?.user_openid ?? '-')}`);
    let matched = false;
    try {
      matched = questionChannel.handleInteraction(event);
    } catch (err) {
      logger.error(`im-qqbot: interaction handling failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      await bot.acknowledgeInteraction(event.id, matched ? 0 : 3);
      logger.info(`im-qqbot: interaction acked id=${event?.id ?? '-'} matched=${matched}`);
    } catch (err) {
      logger.error(`im-qqbot: interaction ack failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  bot.on('error', (err: unknown) => {
    logger.error(`bot error: ${err instanceof Error ? err.message : String(err)}`);
  });

  bot.on('ready', () => {
    console.log(`[im-qqbot] Bot ready! appId=${config.appId}`);
  });

  // ── 富媒体过期清理 ──
  if (config.media.enabled) {
    startMediaCleanup(ctx, config.media.ttlHours, logger);
  }

  // ── 视觉工具注册（qqbot_describe_image，复用 dsh llm + attachments） ──
  ensureVisionInputModal(config.vision, logger);
  registerDescribeImageTool(ctx, config.vision, logger);

  // ── 生命周期 ──
  (ctx as unknown as { effect(fn: () => (() => Promise<void>) | void, name?: string): void })
    .effect(() => {
      logger.info(`Starting bot (appId=${config.appId})`);
      bot.start().catch((err: unknown) => {
        logger.error(`Bot start failed: ${err instanceof Error ? err.message : String(err)}`);
      });

      return async () => {
        logger.info('Shutting down');
        questionChannel.uninstall();
        await manager.disposeAll();
        bot.stop();
      };
    }, 'im-qqbot.lifecycle');
}
