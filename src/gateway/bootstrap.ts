/**
 * 网关组装 — 创建 bot、编排中间件、注册事件、出站、生命周期
 *
 * 将 QQ 消息平台作为 dsh 前端协议驱动：入站消息 → handleInbound → dsh agent，
 * dsh session/event → createOutboundHandler → QQ 出站。
 */
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { QQBot } from '@tencent-connect/qqbot-nodejs';
import type { GatewayDisconnect, InteractionEvent, MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import { SessionManager, type DshAgentRegistry } from '../session/index.ts';
import type { PeerAgentSettings } from '../session/session-manager.ts';
import { handleInbound, createOutboundHandler, createTurnTracker } from '../transport/index.ts';
import { QqInputRegistry, inputOriginTtlMs } from '../transport/qq-input-origin.ts';
import { parseStreamFrame } from '../transport/events.ts';
import { ReplyLimiter } from '../transport/reply-limiter.ts';
import { ReplyIdCache } from '../transport/msgid-cache.ts';
import type { ToolsRegistryLike } from '../transport/tool-presenter.ts';
import type { QQBotSender } from '../transport/outbound-buffer.ts';
import { QuestionChannel, type UserQuestionRequest, type UserQuestionResult } from '../features/question-channel.ts';
import { ApprovalChannel, type ApprovalChannelContext } from '../features/approval-channel.ts';
import { decodeButtonData } from '../features/button-utils.ts';
import { buildUserAgent } from '../shared/index.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';
import { DeliveryLedger, deliveryKey } from '../transport/delivery-ledger.ts';
import { guardSender, guardMedia } from '../transport/delivery-context.ts';
import { createDeliveryMedia, openDeliveryStream, sendDeliveryMarkdown } from '../transport/qq-delivery.ts';
import { guardConversationPosts } from '../transport/qq-wire-admission.ts';
import { PLUGIN_HOME } from '../shared/dirs.ts';
import { ManualQqSender, createManualTransport } from '../transport/manual-send.ts';
import { resolveReplyTarget } from '../transport/reply-target.ts';
import { AccountAccessService } from '../runtime/account-service.ts';
import type { WorkbenchRobot } from '../shared/workbench-protocol.ts';
import type { TimelineInboundOutcome } from '../shared/workbench-timeline-protocol.ts';
import { receivedEntryId, timelineText, type QqTimeline } from '../runtime/qq-timeline.ts';
import type { DownloadedFile } from '../transport/attachment.ts';
import { observeTimelineRequests } from '../transport/timeline-observer.ts';
import { messageSenderName } from '../shared/message-sender-name.ts';
import { setupMiddlewares } from './middleware-setup.ts';
import { startMediaCleanup } from '../media/media-cleaner.ts';
import type { PrefsStore } from '../model/prefs-store.ts';
import type { SendFileRuntime } from '../media/send-file-tool.ts';
import { DeliverablesDeliverer } from '../transport/deliverables.ts';

/**
 * interaction 统一分发器：按 button_data 的顶层 `t` 判别字段，路由到对应
 * channel（question / approval）。QQ 只有一个 interaction 入口，集中路由
 * 避免多通道各自 try 导致误判。
 */
function dispatchInteraction(event: InteractionEvent, manager: SessionManager): boolean {
  const raw = event.data?.resolved?.button_data;
  if (!raw) return false;
  const button = decodeButtonData(raw);
  if (!button) return false;
  if (button.t === 'question') return manager.questionChannel?.handleInteraction(event) ?? false;
  if (button.t === 'approval') return manager.approvalChannel?.handleInteraction(event) ?? false;
  return false;
}

export interface GatewayRuntime extends SendFileRuntime {
  readonly manager: SessionManager;
  readonly state: WorkbenchRobot['state'];
  readonly manual: ManualQqSender;
  deactivate(): void;
}

export function openDeliveryLedger(appId: string): DeliveryLedger {
  return new DeliveryLedger(join(PLUGIN_HOME, `delivery-${deliveryKey(appId)}.jsonl`));
}

export function bootstrapGateway(
  ctx: Context,
  agents: DshAgentRegistry,
  config: ImQQBotConfig,
  logger: Logger,
  accountAccess = new AccountAccessService(config, logger),
  mediaRoot?: string,
  prefs?: PrefsStore,
  receiving?: (target: ReplyTarget) => boolean,
  history?: {
    timeline: QqTimeline;
    recording: (target: ReplyTarget) => boolean;
    initialize?: (target: ReplyTarget) => Promise<void>;
    agent?: PeerAgentSettings;
  },
): GatewayRuntime {
  const manager = new SessionManager(ctx, agents, config, logger, prefs, history?.agent);

  manager.accountAccess = accountAccess;
  // ── 回合归属：入站登记 + 回合跟踪，出站/提问/审批/发文件共享同一投递目标解析 ──
  const ledger = openDeliveryLedger(config.appId);
  let active = true;
  let state: WorkbenchRobot['state'] = 'connecting';
  const isActive = () => active;
  const deactivate = () => {
    active = false;
    manager.deactivate();
  };
  const qqInputs = new QqInputRegistry({ ttlMs: inputOriginTtlMs(config.processingTimeoutMs), ledger });
  const allowTarget = (target: ReplyTarget) => {
    if (!active || receiving?.(target) === false) return false;
    try {
      return accountAccess.allowsConversation(target.scope, target.targetId);
    } catch {
      logger.warn('im-qqbot: access settings unavailable; QQ conversation denied');
      return false;
    }
  };
  const turnTracker = createTurnTracker(manager, config, logger, qqInputs, allowTarget);

  // ── 初始化 QQ Bot SDK ──
  const userAgent = buildUserAgent();
  const baseUrl = process.env.QQBOT_BASE_URL?.replace(/\/+$/, '') || 'https://api.bot.qq.com';
  const bot = new QQBot({
    appId: config.appId,
    appSecret: config.appSecret,
    transport: 'websocket',
    baseUrl,
    tokenBaseUrl: process.env.QQBOT_TOKEN_BASE_URL?.replace(/\/+$/, '') || 'https://api.bot.qq.com',
    userAgent,
    logger,
  } as ConstructorParameters<typeof QQBot>[0]);
  const sendPairingReply = guardConversationPosts(bot, baseUrl, userAgent, allowTarget);
  logger.info(`QQBot SDK initialized (UA: ${userAgent})`);

  // ── 中间件链 ──
  const replyIds = new ReplyIdCache();
  const canRecord = (target: ReplyTarget): boolean => {
    try { return !!history && allowTarget(target) && history.recording(target); }
    catch { return false; }
  };
  const reportInbound = history && ((target: ReplyTarget, outcome: TimelineInboundOutcome, sessionId?: string) => {
    if (canRecord(target)) history.timeline.reportInbound(config.appId, target, outcome, sessionId);
  });
  const observe = history && observeTimelineRequests(bot, config.appId, history.timeline, canRecord);
  setupMiddlewares(bot, config, manager, logger, replyIds, isActive, mediaRoot, receiving, history && (async messageContext => {
    const { message, replyTarget } = messageContext;
    const peer = message.kind === 'group' ? message.groupOpenid : message.senderId;
    if (!message.messageId || !peer || peer !== replyTarget.targetId || message.kind !== replyTarget.scope) return;
    await history.initialize?.(replyTarget);
    if (!canRecord(replyTarget)) return;
    const body = message.content.replaceAll(`<@!${config.appId}>`, '').replaceAll(`<@${config.appId}>`, '').trim();
    const command = /^\/([a-z][a-z0-9_-]*)\b/i.exec(body);
    const pairing = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(body);
    // Only display the quote actually carried by the QQ event. Never consult
    // the SDK's cross-message cache for text to persist in this peer.
    const quoted = message.refMsgIdx && !command && !pairing ? message.msgElements?.[0] : undefined;
    const quotedText = quoted?.content?.trim().slice(0, 400);
    const quotedAttachments = quoted?.attachments?.length || undefined;
    const quote = message.refMsgIdx && !command && !pairing ? {
      text: quotedText && /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(quotedText) ? '配对码已隐藏'
        : quotedText && /^\/[a-z]/i.test(quotedText) ? quotedText.split(/\s+/, 1)[0]!
          : quotedText || (quotedAttachments ? '' : '引用消息不可用'),
      attachments: quotedAttachments,
    } : undefined;
    history.timeline.record(config.appId, replyTarget, {
      id: receivedEntryId(message.messageId), at: Date.parse(message.timestamp) || Date.now(),
      direction: 'inbound', status: 'received', platformId: message.messageId,
      text: pairing ? '配对码已隐藏' : command ? command[0] : timelineText(body),
      senderId: message.senderId, senderName: messageSenderName(message),
      attachments: message.attachments?.length || undefined, quote,
    }, true);
  }), reportInbound, (messageContext, text) => {
    const target = messageContext.replyTarget;
    const wasAdmitted = allowTarget(target);
    return sendPairingReply(target, text, () => !messageContext.signal.aborted
      && isActive() && receiving?.(target) !== false && (!wasAdmitted || allowTarget(target)));
  });

  // ── 入站：经过中间件链后的消息交给 dsh agent ──
  bot.on('message', async (mCtx: MiddlewareContext) => {
    if (mCtx.signal.aborted || !allowTarget(mCtx.replyTarget)) return;
    if (history && canRecord(mCtx.replyTarget)) {
      const { downloadedFiles } = mCtx.state as { downloadedFiles?: DownloadedFile[] };
      history.timeline.recordImages(config.appId, mCtx.replyTarget,
        downloadedFiles?.filter(file => file.contentType === 'image').map(file => file.localPath) ?? []);
    }
    const msg = mCtx.message;
    // 记录最近 msgId，供无上下文的出站发送（文件发送显式 target、主动推送等）获取被动回复目标
    replyIds.cacheMsgId(mCtx.replyTarget.scope, mCtx.replyTarget.targetId, mCtx.replyTarget.msgId);
    if (config.debug) {
      logger.debug(`← message (post-middleware): ${JSON.stringify(msg, null, 2).slice(0, 500)}`);
    }
    await handleInbound(mCtx, manager, config, logger, qqInputs, allowTarget, reportInbound);
  });

  // ── 出站：dsh session/event → QQ 消息 ──
  // 获取 tools 服务（工具结果结构化展示），可选
  let toolsRegistry: ToolsRegistryLike | undefined;
  try {
    toolsRegistry = ctx.get('tools') as ToolsRegistryLike | undefined;
  } catch {
    toolsRegistry = undefined;
  }

  // 发送适配器：将 QQBot 实例适配为 QQBotSender（openStream 参数形态不同）。
  // sendMarkdown 统一做被动回复限额管控：同一 msgId 超限/过期时降级主动推送。
  const replyLimiter = new ReplyLimiter({ limit: 4 });
  const sender: QQBotSender = guardSender({
    sendMarkdown: (target, content, opts) => sendDeliveryMarkdown(bot, replyIds, replyLimiter, target, content, opts, observe),
    openStream: (target) => openDeliveryStream(bot, replyIds, target, logger, observe),
  }, ledger);

  // ── 附件发送适配器（qqbot_send_file 工具与交付物投递共用） ──
  // 包装 bot：让文件发送也走 msgId 兜底 + 被动回复限额管控。
  // 注意：SDK 文件发送暂不支持 event_id，故 allowEvent=false，跳过 event 候选。
  const mediaSender = guardMedia(createDeliveryMedia(bot, replyIds, replyLimiter, observe), ledger);

  // 交付物投递：present 声明的文件在轮末发送到当前会话（outbound 路由触发）
  const deliverablesDeliverer = new DeliverablesDeliverer(sender, mediaSender, config, logger, mediaRoot);

  const outbound = createOutboundHandler(
    manager, sender, config, logger, toolsRegistry, deliverablesDeliverer, turnTracker,
  );
  // session/event 按会话作用域派发。根作用域监听不带 global 收不到
  // 桌面恢复出来的 agent，主动回合的 user/message 会直接丢。
  // 全局监听下非 QQ 会话在 TurnTracker.begin 即被过滤，不进入回合状态表。
  const routeSessionEvent: typeof outbound.routeSessionEvent = (...args) => {
    if (active) outbound.routeSessionEvent(...args);
  };
  (ctx as unknown as { on(event: string, handler: (...args: unknown[]) => void, options?: { global?: boolean }): void })
    .on('session/event', routeSessionEvent as (...args: unknown[]) => void, { global: true });

  // ── 出站流式：agent/assistant-stream → 流式帧路由 ──
  // 实时流式走瞬态 agent/assistant-stream（chunk 不进 session log）。
  // 该事件按 agent 作用域派发，根作用域监听器不带 global 会被过滤（同
  // approval/request），帧到达后自行按 agent.id 路由，非 QQ 会话在 router 内忽略。
  (ctx as unknown as { on(event: string, handler: (...args: unknown[]) => void, options?: { global?: boolean }): void })
    .on('agent/assistant-stream', (payload: unknown) => {
      if (!active) return;
      const parsed = parseStreamFrame(payload);
      if (parsed !== undefined) outbound.routeStreamFrame(parsed.agentId, parsed.delta);
    }, { global: true });

  // ── 问答通道（ask_user_question → QQ 文本 + 按钮） ──
  const questionChannel = new QuestionChannel(manager, sender, config, logger, turnTracker);
  manager.questionChannel = questionChannel;
  questionChannel.install(ctx);
  const questionEvents = ctx as unknown as { on(
    event: 'user-questions/request',
    handler: (request: UserQuestionRequest, next: () => Promise<UserQuestionResult>) => Promise<UserQuestionResult>,
    options: { global: true; prepend: true },
  ): void };
  questionEvents.on('user-questions/request', (request, next) =>
    active ? questionChannel.routeRequest(request, next) : next(), { global: true, prepend: true });

  // ── 审批通道（approval/request → QQ 两按钮审批） ──
  const approvalChannel = new ApprovalChannel(manager, sender, config, logger, turnTracker);
  manager.approvalChannel = approvalChannel;
  approvalChannel.install(ctx as unknown as ApprovalChannelContext);

  // ── 按钮点击回调（interaction）：统一分发到问答/审批通道 ──
  bot.on('interaction', async (_iCtx: unknown, event: InteractionEvent) => {
    if (!active || !event.id) return;
    const scope: ChatScope = event.scene === 'group' || event.group_openid ? 'group' : 'c2c';
    const targetId = scope === 'group' ? event.group_openid : event.user_openid;
    let matched = false;
    if (targetId && allowTarget({ scope, targetId })) {
      replyIds.cacheEventId(scope, targetId, event.id);
      matched = dispatchInteraction(event, manager);
    }

    if (active) await bot.acknowledgeInteraction(event.id, matched ? 0 : 3).catch(() => {});
  });

  bot.on('error', (err: unknown) => {
    logger.error(`bot error: ${err instanceof Error ? err.message : String(err)}`);
  });

  // 掉线可观测：willReconnect=false 表示不会再重连（随后 bot.start() 的 Promise 会失败）。
  // disconnected 事件为 SDK 1.0.5+ 新增：旧版 handlers 表缺该键，bot.on 会抛
  // TypeError（profiles 增量安装可能残留旧版 SDK）——降级为跳过监听而非崩溃
  try {
    bot.on('disconnected', (event: GatewayDisconnect) => {
      if (!active) return;
      state = event.willReconnect ? 'reconnecting' : 'failed';
      const detail = `code=${event.code}${event.reason ? ` reason=${event.reason}` : ''}`;
      if (event.willReconnect) {
        logger.warn(`Bot disconnected (${detail}), reconnecting...`);
      } else {
        logger.error(`Bot disconnected permanently (${detail}), giving up`);
      }
    });
  } catch (err) {
    logger.warn(`qqbot-nodejs SDK 不支持 disconnected 事件（请升级 @tencent-connect/qqbot-nodejs 至 1.0.5+）: ${err instanceof Error ? err.message : String(err)}`);
  }

  bot.on('ready', () => {
    if (!active) return;
    state = 'connected';
    console.log(`[im-qqbot] Bot ready! appId=${config.appId}`);
  });
  bot.on('resumed', () => { if (active) state = 'connected'; });

  // ── 富媒体过期清理 ──
  if (config.media.enabled) {
    startMediaCleanup(ctx, config.media.ttlHours, logger, mediaRoot);
  }

  // ── 生命周期 ──
  (ctx as unknown as { effect(fn: () => (() => Promise<void>) | void, name?: string): void })
    .effect(() => {
      logger.info(`Starting bot (appId=${config.appId})`);
      bot.start().catch((err: unknown) => {
        if (!active) return;
        state = 'failed';
        logger.error(`Bot start failed: ${err instanceof Error ? err.message : String(err)}`);
      });

      return async () => {
        deactivate();
        logger.info('Shutting down');
        const cleanups = [
          () => bot.stop(),
          () => outbound.dispose(),
          () => questionChannel.uninstall(),
          () => manager.disposeAll(),
        ];
        const results = await Promise.allSettled(cleanups.map(cleanup => Promise.resolve().then(cleanup)));
        const failed = results.find(result => result.status === 'rejected');
        if (failed) throw failed.reason;
      };
    }, 'im-qqbot.lifecycle');

  const sendManual = createManualTransport(bot, baseUrl, userAgent, target => resolveReplyTarget(target, replyIds, replyLimiter, false));
  const manual = new ManualQqSender(config.appId, ledger, sendManual, history?.timeline);
  return {
    manual,
    bot: mediaSender, manager, config, targets: turnTracker, active: isActive, allowTarget, mediaRoot,
    get state() { return state; },
    deactivate,
  };
}
