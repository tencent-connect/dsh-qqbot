import { QQBot } from '@tencent-connect/qqbot-nodejs';
import { SessionManager } from "../session/index.js";
import { handleInbound, createOutboundHandler } from "../transport/index.js";
import { cacheEventId } from "../transport/msgid-cache.js";
import { sendResolvedMarkdown } from "../transport/reply-target.js";
import { QuestionChannel } from "../features/question-channel.js";
import { ApprovalChannel } from "../features/approval-channel.js";
import { decodeButtonData } from "../features/button-utils.js";
import { buildUserAgent } from "../shared/index.js";
import { setupMiddlewares } from "./middleware-setup.js";
import { startMediaCleanup } from "../media/media-cleaner.js";
import { ensureVisionInputModal, registerDescribeImageTool } from "../media/vision-tool.js";
import { RuntimeState, RUNTIME_ERROR_HINTS } from "../runtime/state.js";
import { trackSdkOutbound } from "../runtime/sdk-outbound.js";
import { observeBotRuntime } from "../runtime/observe-bot.js";
import { ConversationService } from "../runtime/conversation-service.js";
import { registerConversationRoutes } from "../runtime/conversation-routes.js";
import { registerGroupHistoryTool } from "../runtime/history-tool.js";
/**
 * interaction 统一分发器：按 button_data 的顶层 `t` 判别字段，路由到对应
 * channel（question / approval）。QQ 只有一个 interaction 入口，集中路由
 * 避免多通道各自 try 导致误判。
 */
function dispatchInteraction(event, manager) {
    const raw = event.data?.resolved?.button_data;
    if (!raw)
        return { handled: false };
    const button = decodeButtonData(raw);
    if (!button)
        return { handled: false };
    if (button.t === 'question')
        return { handled: manager.questionChannel?.handleInteraction(event) ?? false };
    if (button.t === 'approval')
        return { handled: manager.approvalChannel?.handleInteraction(event) ?? false };
    if (button.t === 'claim')
        return manager.conversations?.handleClaimInteraction(event) ?? { handled: false };
    return { handled: false };
}
export async function bootstrapGateway(ctx, agents, config, logger, runtime = new RuntimeState()) {
    const manager = new SessionManager(ctx, agents, config, logger);
    const conversations = new ConversationService(ctx, manager, config, logger);
    manager.conversations = conversations;
    registerConversationRoutes(ctx, conversations);
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
    });
    logger.info(`QQBot SDK initialized (UA: ${userAgent})`);
    observeBotRuntime(bot, runtime);
    trackSdkOutbound(bot, conversations);
    // ── 中间件链 ──
    setupMiddlewares(bot, config, manager, logger);
    // ── 入站：经过中间件链后的消息交给 dsh agent ──
    bot.on('message', async (mCtx) => {
        const msg = mCtx.message;
        if (config.debug) {
            logger.debug(`← message (post-middleware): ${JSON.stringify(msg, null, 2).slice(0, 500)}`);
        }
        await handleInbound(mCtx, manager, config, logger);
    });
    // ── 出站：dsh session/event → QQ 消息 ──
    // 发送适配器：将 QQBot 实例适配为 QQBotSender（openStream 参数形态不同）。
    // sendMarkdown 统一做被动回复限额管控：同一 msgId 超限/过期时降级主动推送。
    const sender = {
        sendMarkdown: (target, content, opts) => sendResolvedMarkdown(bot, target, content, opts),
        openStream: (target) => bot.openStream({
            target: {
                scope: target.scope,
                targetId: target.targetId,
                msgId: target.msgId,
            },
        }),
    };
    conversations.setSender({ ...sender, sendMarkdown: (target, content, opts) => sendResolvedMarkdown(bot, target, content, opts) });
    const trackedSender = {
        sendMarkdown: async (target, content, opts) => conversations.withOutboundContext({ provenance: 'interaction' }, () => conversations.trackAutomatic(target, content, () => sender.sendMarkdown(target, content, opts))),
        openStream: (target) => {
            if (!conversations.admitted(target.scope, target.targetId))
                throw new Error('该对话已停止发送');
            const stream = sender.openStream(target);
            let text = '';
            return { update: async (content) => { if (!conversations.admitted(target.scope, target.targetId))
                    throw new Error('该对话已停止发送'); text = content; return stream.update(content); },
                complete: () => conversations.trackAutomatic(target, text, () => stream.complete()) };
        },
    };
    const outbound = createOutboundHandler(manager, trackedSender, config, logger);
    ctx
        .on('session/event', outbound.routeSessionEvent);
    // ── 问答通道（ask_user_question → QQ 文本 + 按钮） ──
    const questionChannel = new QuestionChannel(manager, trackedSender, config, logger);
    manager.questionChannel = questionChannel;
    questionChannel.install(ctx);
    // ── 审批通道（approval/request → QQ 两按钮审批） ──
    const approvalChannel = new ApprovalChannel(manager, trackedSender, config, logger);
    manager.approvalChannel = approvalChannel;
    approvalChannel.install(ctx);
    // ── 按钮点击回调（interaction）：统一分发到问答/审批通道 ──
    bot.on('interaction', async (_iCtx, event) => {
        // scope/targetId 推导对齐消息事件（inbound.ts）：按 scene 判定类型，群用 group_openid，私聊用 user_openid
        const scope = event.scene === 'group' ? 'group' : 'c2c';
        const targetId = scope === 'group' ? (event.group_openid ?? event.user_openid) : event.user_openid;
        // 记录互动事件 id，作为后续被动回复候选（event_id）
        cacheEventId(scope, targetId, event.id);
        const actor = event.group_member_openid ?? event.user_openid;
        if (targetId && actor && conversations.admitted(scope, targetId)) {
            const entry = conversations.entry(scope, targetId);
            await conversations.ingestion.run(entry.key, async () => conversations.recordInbound(entry.key, { id: `interaction:${event.id}`, senderId: actor, senderName: '', text: '[QQ 交互按钮]', at: Date.now(), mentioned: true, attachments: [], contextEligible: false, provenance: 'interaction' }));
        }
        const result = dispatchInteraction(event, manager);
        await bot.acknowledgeInteraction(event.id, result.handled ? 0 : 3).catch(() => { });
        // 认领确认/取消后，主动给该会话回一条结果消息（被动回复）。
        if (result.reply !== undefined && result.reply !== '' && targetId) {
            const replyTarget = { scope, targetId, msgId: event.id };
            await bot.sendText(replyTarget, result.reply).catch((err) => logger.warn(`claim reply send failed: ${err instanceof Error ? err.message : String(err)}`));
        }
    });
    bot.on('error', (err) => {
        logger.error(`bot error: ${err instanceof Error ? err.message : String(err)}`);
    });
    // 掉线可观测：willReconnect=false 表示不会再重连（随后 bot.start() 的 Promise 会失败）。
    // disconnected 事件为 SDK 1.0.5+ 新增：旧版 handlers 表缺该键，bot.on 会抛
    // TypeError（profiles 增量安装可能残留旧版 SDK）——降级为跳过监听而非崩溃
    try {
        bot.on('disconnected', (event) => {
            const detail = `code=${event.code}${event.reason ? ` reason=${event.reason}` : ''}`;
            runtime.setPhase(event.willReconnect ? 'reconnecting' : 'failed', event.willReconnect ? RUNTIME_ERROR_HINTS.disconnected : RUNTIME_ERROR_HINTS.terminal);
            if (event.willReconnect) {
                logger.warn(`Bot disconnected (${detail}), reconnecting...`);
            }
            else {
                logger.error(`Bot disconnected permanently (${detail}), giving up`);
            }
        });
    }
    catch (err) {
        logger.warn(`qqbot-nodejs SDK 不支持 disconnected 事件（请升级 @tencent-connect/qqbot-nodejs 至 1.0.5+）: ${err instanceof Error ? err.message : String(err)}`);
    }
    bot.on('ready', (data) => {
        if (data && typeof data === 'object' && 'user' in data && data.user && typeof data.user === 'object' && 'id' in data.user && typeof data.user.id === 'string')
            conversations.selfIds.add(data.user.id);
        console.log(`[im-qqbot] Bot ready! appId=${config.appId}`);
    });
    // ── 富媒体过期清理 ──
    if (config.media.enabled) {
        startMediaCleanup(ctx, config.media.ttlHours, logger);
    }
    // ── 视觉工具注册（qqbot_describe_image，复用 dsh llm + attachments） ──
    ensureVisionInputModal(config.vision, logger);
    registerDescribeImageTool(ctx, config.vision, logger);
    registerGroupHistoryTool(ctx, manager);
    const pruneTimer = setInterval(() => { try {
        conversations.pruneExpired();
        void conversations.sweepOperationRetention().catch(() => logger.warn('QQ 旧请求终态核对未完成，未自动重投'));
    }
    catch (error) {
        logger.error(`QQ record cleanup failed: ${error instanceof Error ? error.message : 'unknown'}`);
    } }, 3600_000);
    pruneTimer.unref();
    conversations.pruneExpired();
    void conversations.sweepOperationRetention().catch(() => logger.warn('QQ 旧请求终态核对未完成，未自动重投'));
    ctx.effect(() => () => { clearInterval(pruneTimer); }, 'im-qqbot.history-retention');
    // ── 生命周期 ──
    ctx
        .effect(() => {
        runtime.setPhase('connecting');
        logger.info(`Starting bot (appId=${config.appId})`);
        bot.start().catch((err) => {
            runtime.setPhase('failed', RUNTIME_ERROR_HINTS.terminal);
            logger.error(`Bot start failed: ${err instanceof Error ? err.message : String(err)}`);
        });
        return async () => {
            runtime.setPhase('stopped');
            logger.info('Shutting down');
            await manager.disposeAll();
            bot.stop();
        };
    }, 'im-qqbot.lifecycle');
}
//# sourceMappingURL=bootstrap.js.map