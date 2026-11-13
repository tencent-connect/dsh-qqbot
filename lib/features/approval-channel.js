import { randomBytes } from 'node:crypto';
import { decodeButtonData } from "./button-utils.js";
import { buildApprovalKeyboard, buildApprovalText } from "./approval-renderer.js";
const COMMAND_CLIP = 500;
/**
 * 从 session log 按 callId 找回被 gate 的命令（审批请求本身不重复携带 arguments）。
 * 对齐 TUI/web 的 `commandOf` 语义。
 */
function commandOf(req) {
    if (req.callId === undefined)
        return undefined;
    // 审批请求可能来自没有 live session 的上下文（例如跨进程/投影后的 Agent），
    // 此时只是拿不到命令原文，不能因此让整个审批失败。
    const events = req.agent.session?.snapshotEvents?.();
    if (!Array.isArray(events))
        return undefined;
    for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i];
        if (!event || event.type !== 'tool/call')
            continue;
        const data = event.data;
        if (String(data?.callId) !== String(req.callId))
            continue;
        const raw = data?.arguments;
        if (typeof raw !== 'string')
            return undefined;
        try {
            const parsed = JSON.parse(raw);
            if (parsed !== null && typeof parsed === 'object' && 'command' in parsed) {
                const command = parsed.command;
                if (typeof command === 'string')
                    return command;
            }
        }
        catch {
            // 非 JSON，回退到原始字符串
        }
        return raw.length <= COMMAND_CLIP ? raw : `${raw.slice(0, COMMAND_CLIP)}…`;
    }
    return undefined;
}
export class ApprovalChannel {
    pending = new Map();
    manager;
    sender;
    logger;
    config;
    targets;
    /**
     * @param targets 回合投递目标解析（与出站共享）。缺省时按会话 replyTarget 被动回复。
     */
    constructor(manager, sender, config, logger, targets) {
        this.manager = manager;
        this.sender = sender;
        this.config = config;
        this.logger = logger;
        this.targets = targets;
    }
    /**
     * 注册 approval/request waterfall answerer。
     *
     * 不再探测 approval 服务是否已挂载：它是 optional peer，挂载时机可能晚于
     * 本插件的 apply，一次性探测失败会让通道永久失效。监听事件本身不依赖服务
     * 存在——服务就绪后请求自然经过同一条瀑布，未挂载时不会有请求到达。
     *
     * `global` 是必需的：approval/request 按 agent 作用域派发，根作用域注册的
     * 监听器不带 global 会被作用域过滤掉。
     */
    install(ctx) {
        const self = this;
        ctx.on('approval/request', (req, next) => {
            const request = req;
            const nextFn = next;
            const record = self.manager.findBySessionId(request.agent.id);
            // 本回合按策略不投递到 QQ → 交给链上其他 answerer（Web/TUI）
            const target = record ? self.resolveTarget(request.agent.id, record) : undefined;
            if (record && target)
                return self.park(record, target, request);
            return nextFn();
        }, { global: true, prepend: true });
        this.logger.info('im-qqbot: QQ approval channel installed');
    }
    /** 会话回收时清理其 pending 审批，避免 Promise 悬挂 */
    cancelPending(sessionKey) {
        const entry = this.pending.get(sessionKey);
        if (entry)
            this.finish(sessionKey, entry, 'cancelled');
    }
    /** 按钮点击决策：解码 button_data，校验点击者授权，settle pending 审批 */
    handleInteraction(event) {
        const peerId = event.group_openid ?? event.user_openid;
        if (!peerId)
            return false;
        const scope = event.group_openid ? 'group' : 'c2c';
        const record = this.manager.getSessionRecord(scope, peerId);
        if (!record)
            return false;
        const entry = this.pending.get(record.sessionKey);
        if (!entry?.ready)
            return false;
        const data = event.data?.resolved?.button_data;
        if (!data)
            return false;
        const button = decodeButtonData(data);
        if (!button || button.t !== 'approval' || (button.d !== 'allow' && button.d !== 'deny'))
            return false;
        // nonce 必须匹配 pending：旧卡片/其它会话的卡片点击不 settle（#94-3）
        if (button.n !== entry.nonce) {
            this.logger.warn(`im-qqbot: approval button nonce mismatch: key=${record.sessionKey}`);
            return false;
        }
        // 白名单模式下审批只认名单内用户；点击者身份缺失同样拒绝（fail-closed，#94-3）
        const clicker = event.group_member_openid ?? event.user_openid;
        if (this.config.access.c2cMode === 'allowlist'
            && (!clicker || !this.config.access.c2cAllow.includes(clicker))) {
            this.logger.warn(`im-qqbot: approval button rejected (clicker not allowlisted): user=${clicker ?? '(missing)'} key=${record.sessionKey}`);
            return false;
        }
        this.finish(record.sessionKey, entry, button.d === 'allow' ? 'allowed-once' : 'rejected');
        return true;
    }
    /** 走 QQ 通道：发审批消息 + 挂起 Promise，等待用户决策 */
    async park(record, target, request) {
        const key = record.sessionKey;
        // 会话回收/取消可能在发送前发生：signal 已 abort 则直接失败
        if (request.signal?.aborted)
            return 'cancelled';
        this.cancelPending(key);
        return new Promise(resolve => {
            const entry = { request, resolve, nonce: randomBytes(12).toString('hex'), ready: false };
            this.pending.set(key, entry);
            if (request.signal) {
                entry.onAbort = () => this.finish(key, entry, 'cancelled');
                request.signal.addEventListener('abort', entry.onAbort, { once: true });
            }
            void this.publish(key, entry, target);
        });
    }
    async publish(key, entry, target) {
        try {
            const submitted = await this.sender.sendMarkdown(target, buildApprovalText(entry.request, commandOf(entry.request)), { keyboard: buildApprovalKeyboard(entry.nonce) });
            if (this.pending.get(key) !== entry)
                return;
            if (submitted === false) {
                this.finish(key, entry, 'unavailable');
                return;
            }
            entry.ready = true;
            this.logger.info(`im-qqbot: approval sent to QQ, waiting for decision key=${key}`);
        }
        catch (err) {
            if (this.pending.get(key) !== entry)
                return;
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`im-qqbot: approval send failed key=${key}: ${msg}`);
            this.finish(key, entry, 'unavailable');
        }
    }
    finish(key, entry, outcome) {
        if (this.pending.get(key) !== entry)
            return;
        this.pending.delete(key);
        if (entry.onAbort)
            entry.request.signal?.removeEventListener('abort', entry.onAbort);
        entry.resolve(outcome);
    }
    /** 本回合的投递目标；未注入解析器时沿用会话 replyTarget */
    resolveTarget(sessionId, record) {
        return this.targets ? this.targets.targetFor(sessionId) : record.replyTarget;
    }
}
//# sourceMappingURL=approval-channel.js.map