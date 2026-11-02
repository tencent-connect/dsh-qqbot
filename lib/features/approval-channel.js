import { randomUUID } from 'node:crypto';
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
    constructor(manager, sender, config, logger) {
        this.manager = manager;
        this.sender = sender;
        this.config = config;
        this.logger = logger;
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
            const record = self.manager.interactionRecord(request.agent.id);
            if (record)
                return self.park(record, request);
            return nextFn();
        }, { global: true, prepend: true });
        this.logger.info('im-qqbot: QQ approval channel installed');
    }
    /** 会话回收时清理其 pending 审批，避免 Promise 悬挂 */
    cancelPending(sessionKey) {
        const entry = this.pending.get(sessionKey);
        if (!entry)
            return;
        this.settle(entry, 'cancelled');
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
        if (!entry)
            return false;
        const data = event.data?.resolved?.button_data;
        if (!data)
            return false;
        const button = decodeButtonData(data);
        if (!button || button.t !== 'approval')
            return false;
        // nonce 必须匹配 pending：旧卡片/其它会话的卡片点击不 settle（#94-3）
        if (button.n !== entry.nonce) {
            this.logger.warn(`im-qqbot: approval button nonce mismatch: key=${record.sessionKey}`);
            return false;
        }
        // 白名单模式下审批只认名单内用户；点击者身份缺失同样拒绝（fail-closed，#94-3）
        const clicker = event.group_member_openid ?? event.user_openid;
        if (this.manager.canApprove && !this.manager.canApprove(scope, peerId, clicker))
            return false;
        if (!this.manager.canApprove && this.config.access.c2cMode === 'allowlist'
            && (!clicker || !this.config.access.c2cAllow.includes(clicker))) {
            this.logger.warn(`im-qqbot: approval button rejected (clicker not allowlisted): user=${clicker ?? '(missing)'} key=${record.sessionKey}`);
            return false;
        }
        this.settle(entry, button.d === 'allow' ? 'allowed-once' : 'rejected');
        return true;
    }
    /** 走 QQ 通道：发审批消息 + 挂起 Promise，等待用户决策 */
    async park(record, request) {
        const key = record.sessionKey;
        const previous = this.pending.get(key);
        if (previous)
            this.settle(previous, 'cancelled');
        // 会话回收/取消可能在发送前发生：signal 已 abort 则直接失败
        if (request.signal?.aborted)
            return 'cancelled';
        const command = commandOf(request);
        const nonce = randomUUID().slice(0, 8);
        return new Promise((resolve) => {
            const entry = { record, request, resolve, nonce };
            this.pending.set(key, entry);
            entry.timer = setTimeout(() => { this.settle(entry, 'unavailable'); }, this.config.askTimeoutMs ?? 300_000);
            if (request.signal) {
                const onAbort = () => { this.settle(entry, 'cancelled'); };
                entry.onAbort = onAbort;
                request.signal.addEventListener('abort', onAbort, { once: true });
            }
            if (request.signal?.aborted) {
                this.settle(entry, 'cancelled');
                return;
            }
            // 在发送前登记审批：发送期间的取消、回收和按钮回调均可完成该请求。
            void (async () => {
                try {
                    await this.sender.sendMarkdown(record.replyTarget, buildApprovalText(request, command), { keyboard: buildApprovalKeyboard(nonce) });
                    if (this.pending.get(key) === entry) {
                        this.logger.info(`im-qqbot: approval sent to QQ, waiting for decision key=${key}`);
                    }
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    this.logger.error(`im-qqbot: approval send failed key=${key}: ${msg}`);
                    this.settle(entry, 'unavailable');
                }
            })();
        });
    }
    settle(entry, outcome) {
        if (this.pending.get(entry.record.sessionKey) !== entry)
            return;
        this.pending.delete(entry.record.sessionKey);
        if (entry.timer)
            clearTimeout(entry.timer);
        if (entry.onAbort && entry.request.signal) {
            entry.request.signal.removeEventListener('abort', entry.onAbort);
        }
        entry.resolve(outcome);
    }
}
//# sourceMappingURL=approval-channel.js.map