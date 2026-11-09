/**
 * 网关组装 — 创建 bot、编排中间件、注册事件、出站、生命周期
 *
 * 将 QQ 消息平台作为 dsh 前端协议驱动：入站消息 → handleInbound → dsh agent，
 * dsh session/event → createOutboundHandler → QQ 出站。
 */
import { join } from 'node:path';
import { QQBot } from '@tencent-connect/qqbot-nodejs';
import { SessionManager } from "../session/index.js";
import { handleInbound, createOutboundHandler, createTurnTracker } from "../transport/index.js";
import { QqInputRegistry, inputOriginTtlMs } from "../transport/qq-input-origin.js";
import { parseStreamFrame } from "../transport/events.js";
import { ReplyLimiter } from "../transport/reply-limiter.js";
import { ReplyIdCache } from "../transport/msgid-cache.js";
import { QuestionChannel } from "../features/question-channel.js";
import { ApprovalChannel } from "../features/approval-channel.js";
import { decodeButtonData } from "../features/button-utils.js";
import { buildUserAgent } from "../shared/index.js";
import { DeliveryLedger, deliveryKey } from "../transport/delivery-ledger.js";
import { guardSender, guardMedia } from "../transport/delivery-context.js";
import { createDeliveryMedia, openDeliveryStream, sendDeliveryMarkdown } from "../transport/qq-delivery.js";
import { PLUGIN_HOME } from "../shared/dirs.js";
import { AccountAccessService } from "../runtime/account-service.js";
import { setupMiddlewares } from "./middleware-setup.js";
import { startMediaCleanup } from "../media/media-cleaner.js";
import { DeliverablesDeliverer } from "../transport/deliverables.js";
/**
 * interaction 统一分发器：按 button_data 的顶层 `t` 判别字段，路由到对应
 * channel（question / approval）。QQ 只有一个 interaction 入口，集中路由
 * 避免多通道各自 try 导致误判。
 */
function dispatchInteraction(event, manager) {
    const raw = event.data?.resolved?.button_data;
    if (!raw)
        return false;
    const button = decodeButtonData(raw);
    if (!button)
        return false;
    if (button.t === 'question')
        return manager.questionChannel?.handleInteraction(event) ?? false;
    if (button.t === 'approval')
        return manager.approvalChannel?.handleInteraction(event) ?? false;
    return false;
}
export function bootstrapGateway(ctx, agents, config, logger, accountAccess = new AccountAccessService(config, logger), mediaRoot, prefs) {
    const manager = new SessionManager(ctx, agents, config, logger, prefs);
    manager.accountAccess = accountAccess;
    // ── 回合归属：入站登记 + 回合跟踪，出站/提问/审批/发文件共享同一投递目标解析 ──
    const ledger = new DeliveryLedger(join(PLUGIN_HOME, `delivery-${deliveryKey(config.appId)}.jsonl`));
    let active = true;
    let state = 'connecting';
    const isActive = () => active;
    const qqInputs = new QqInputRegistry({ ttlMs: inputOriginTtlMs(config.processingTimeoutMs), ledger });
    const allowTarget = (target) => {
        if (!active)
            return false;
        try {
            return accountAccess.allowsConversation(target.scope, target.targetId);
        }
        catch {
            logger.warn('im-qqbot: access settings unavailable; QQ conversation denied');
            return false;
        }
    };
    const turnTracker = createTurnTracker(manager, config, logger, qqInputs, allowTarget);
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
    // ── 中间件链 ──
    const replyIds = new ReplyIdCache();
    setupMiddlewares(bot, config, manager, logger, replyIds, isActive, mediaRoot);
    // ── 入站：经过中间件链后的消息交给 dsh agent ──
    bot.on('message', async (mCtx) => {
        if (mCtx.signal.aborted || !allowTarget(mCtx.replyTarget))
            return;
        const msg = mCtx.message;
        // 记录最近 msgId，供无上下文的出站发送（文件发送显式 target、主动推送等）获取被动回复目标
        replyIds.cacheMsgId(mCtx.replyTarget.scope, mCtx.replyTarget.targetId, mCtx.replyTarget.msgId);
        if (config.debug) {
            logger.debug(`← message (post-middleware): ${JSON.stringify(msg, null, 2).slice(0, 500)}`);
        }
        await handleInbound(mCtx, manager, config, logger, qqInputs, allowTarget);
    });
    // ── 出站：dsh session/event → QQ 消息 ──
    // 获取 tools 服务（工具结果结构化展示），可选
    let toolsRegistry;
    try {
        toolsRegistry = ctx.get('tools');
    }
    catch {
        toolsRegistry = undefined;
    }
    // 发送适配器：将 QQBot 实例适配为 QQBotSender（openStream 参数形态不同）。
    // sendMarkdown 统一做被动回复限额管控：同一 msgId 超限/过期时降级主动推送。
    const replyLimiter = new ReplyLimiter({ limit: 4 });
    const sender = guardSender({
        sendMarkdown: (target, content, opts) => sendDeliveryMarkdown(bot, replyIds, replyLimiter, target, content, opts),
        openStream: (target) => openDeliveryStream(bot, replyIds, target, logger),
    }, ledger);
    // ── 附件发送适配器（qqbot_send_file 工具与交付物投递共用） ──
    // 包装 bot：让文件发送也走 msgId 兜底 + 被动回复限额管控。
    // 注意：SDK 文件发送暂不支持 event_id，故 allowEvent=false，跳过 event 候选。
    const mediaSender = guardMedia(createDeliveryMedia(bot, replyIds, replyLimiter), ledger);
    // 交付物投递：present 声明的文件在轮末发送到当前会话（outbound 路由触发）
    const deliverablesDeliverer = new DeliverablesDeliverer(sender, mediaSender, config, logger, mediaRoot);
    const outbound = createOutboundHandler(manager, sender, config, logger, toolsRegistry, deliverablesDeliverer, turnTracker);
    // session/event 按会话作用域派发。根作用域监听不带 global 收不到
    // 桌面恢复出来的 agent，主动回合的 user/message 会直接丢。
    // 全局监听下非 QQ 会话在 TurnTracker.begin 即被过滤，不进入回合状态表。
    const routeSessionEvent = (...args) => {
        if (active)
            outbound.routeSessionEvent(...args);
    };
    ctx
        .on('session/event', routeSessionEvent, { global: true });
    // ── 出站流式：agent/assistant-stream → 流式帧路由 ──
    // 实时流式走瞬态 agent/assistant-stream（chunk 不进 session log）。
    // 该事件按 agent 作用域派发，根作用域监听器不带 global 会被过滤（同
    // approval/request），帧到达后自行按 agent.id 路由，非 QQ 会话在 router 内忽略。
    ctx
        .on('agent/assistant-stream', (payload) => {
        if (!active)
            return;
        const parsed = parseStreamFrame(payload);
        if (parsed !== undefined)
            outbound.routeStreamFrame(parsed.agentId, parsed.delta);
    }, { global: true });
    // ── 问答通道（ask_user_question → QQ 文本 + 按钮） ──
    const questionChannel = new QuestionChannel(manager, sender, config, logger, turnTracker);
    manager.questionChannel = questionChannel;
    questionChannel.install(ctx);
    // ── 审批通道（approval/request → QQ 两按钮审批） ──
    const approvalChannel = new ApprovalChannel(manager, sender, config, logger, turnTracker);
    manager.approvalChannel = approvalChannel;
    approvalChannel.install(ctx);
    // ── 按钮点击回调（interaction）：统一分发到问答/审批通道 ──
    bot.on('interaction', async (_iCtx, event) => {
        if (!active || !event.id)
            return;
        const scope = event.scene === 'group' || event.group_openid ? 'group' : 'c2c';
        const targetId = scope === 'group' ? event.group_openid : event.user_openid;
        let matched = false;
        if (targetId && allowTarget({ scope, targetId })) {
            replyIds.cacheEventId(scope, targetId, event.id);
            matched = dispatchInteraction(event, manager);
        }
        if (active)
            await bot.acknowledgeInteraction(event.id, matched ? 0 : 3).catch(() => { });
    });
    bot.on('error', (err) => {
        logger.error(`bot error: ${err instanceof Error ? err.message : String(err)}`);
    });
    // 掉线可观测：willReconnect=false 表示不会再重连（随后 bot.start() 的 Promise 会失败）。
    // disconnected 事件为 SDK 1.0.5+ 新增：旧版 handlers 表缺该键，bot.on 会抛
    // TypeError（profiles 增量安装可能残留旧版 SDK）——降级为跳过监听而非崩溃
    try {
        bot.on('disconnected', (event) => {
            if (!active)
                return;
            state = event.willReconnect ? 'reconnecting' : 'failed';
            const detail = `code=${event.code}${event.reason ? ` reason=${event.reason}` : ''}`;
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
    bot.on('ready', () => {
        if (!active)
            return;
        state = 'connected';
        console.log(`[im-qqbot] Bot ready! appId=${config.appId}`);
    });
    bot.on('resumed', () => { if (active)
        state = 'connected'; });
    // ── 富媒体过期清理 ──
    if (config.media.enabled) {
        startMediaCleanup(ctx, config.media.ttlHours, logger, mediaRoot);
    }
    // ── 生命周期 ──
    ctx
        .effect(() => {
        logger.info(`Starting bot (appId=${config.appId})`);
        bot.start().catch((err) => {
            if (!active)
                return;
            state = 'failed';
            logger.error(`Bot start failed: ${err instanceof Error ? err.message : String(err)}`);
        });
        return async () => {
            active = false;
            logger.info('Shutting down');
            const cleanups = [
                () => bot.stop(),
                () => outbound.dispose(),
                () => questionChannel.uninstall(),
                () => manager.disposeAll(),
            ];
            const results = await Promise.allSettled(cleanups.map(cleanup => Promise.resolve().then(cleanup)));
            const failed = results.find(result => result.status === 'rejected');
            if (failed)
                throw failed.reason;
        };
    }, 'im-qqbot.lifecycle');
    return {
        bot: mediaSender, manager, config, targets: turnTracker, active: isActive, allowTarget, mediaRoot,
        get state() { return state; },
        deactivate() { active = false; },
    };
}
//# sourceMappingURL=bootstrap.js.map