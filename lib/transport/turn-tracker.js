import { bindDelivery } from "./delivery-context.js";
import { deliveryKey } from "./delivery-ledger.js";
import { classifyTurnInput, createTurnState, deliveryMode, noteTurnInput, } from "./turn-origin.js";
export class TurnTracker {
    get verifiesSources() { return this.inputs.ledger !== undefined; }
    turns = new Map();
    manager;
    inputs;
    options;
    logger;
    constructor(manager, inputs, options, logger) {
        this.manager = manager;
        this.inputs = inputs;
        this.options = options;
        this.logger = logger;
    }
    /**
     * turn/start：开启新回合。
     * @returns true 表示确实换了一轮（调用方据此清理上一轮的出站状态）
     */
    begin(sessionId, turn) {
        if (turn === undefined)
            return false;
        const current = this.turns.get(sessionId);
        if (current?.state.turn === turn)
            return false;
        if (this.addressOf(sessionId) === undefined)
            return false;
        if (current !== undefined)
            this.release(current);
        this.turns.set(sessionId, { state: createTurnState(turn), inputs: new Set(), target: { ...this.addressOf(sessionId) }, external: false, invalid: false });
        return true;
    }
    /** user/message：按这一条消息归类，不发送 */
    note(sessionId, data) {
        const tracked = this.turns.get(sessionId);
        if (tracked === undefined)
            return;
        const { messageId, source } = readUserMessage(data);
        const receipt = messageId ? this.inputs.claim(messageId, sessionId, data.content ?? data.message?.content, tracked.state.turn) : undefined;
        if (!receipt && messageId && this.inputs.ledger?.knowsInput(messageId))
            tracked.invalid = true;
        const qqOwned = this.inputs.ledger ? receipt !== undefined : this.inputs.has(messageId);
        if (receipt) {
            if (tracked.inputs.size > 0 && !tracked.inputs.has(receipt.messageId))
                tracked.invalid = true;
            tracked.target = { ...receipt.target };
        }
        if (classifyTurnInput(source, qqOwned) === 'external')
            tracked.external = true;
        if (qqOwned && messageId !== undefined)
            tracked.inputs.add(messageId);
        const before = deliveryMode(tracked.state);
        noteTurnInput(tracked.state, classifyTurnInput(source, qqOwned));
        if (before === 'proactive' || deliveryMode(tracked.state) !== 'proactive')
            return;
        const plan = this.planFor(sessionId);
        if (plan === undefined) {
            this.logger.info(`im-qqbot: turn not delivered to QQ (externalTurns=${this.options.externalTurns}): sessionId=${sessionId}`);
            return;
        }
        this.logger.info(`im-qqbot: turn will be pushed proactively: sessionId=${sessionId} peer=${plan.target.targetId}`);
    }
    /**
     * 事件是否属于当前回合。
     * - 没有回合状态时放行，兼容不带 turn 的旧事件；
     * - turn/end 没有回合号也算没对上，避免迟到的结束清掉新一轮。
     */
    isCurrent(sessionId, type, turn) {
        const tracked = this.turns.get(sessionId);
        if (tracked === undefined)
            return !this.inputs.ledger;
        if (type === 'turn/end')
            return turn === tracked.state.turn;
        return turn === undefined || turn === tracked.state.turn;
    }
    /** turn/end：结束回合并释放本回合认领的入站登记 */
    end(sessionId) {
        const tracked = this.turns.get(sessionId);
        if (tracked === undefined)
            return;
        this.turns.delete(sessionId);
        this.release(tracked);
    }
    /**
     * 本回合怎么发。
     * - 不是 QQ 会话 → undefined；
     * - 无回合状态或被动回合 → 沿用会话的 replyTarget（含 msgId）；
     * - 主动回合 → 只保留地址并打 forceProactive；external 回合按策略可能不投递。
     */
    planFor(sessionId) {
        const base = this.addressOf(sessionId);
        if (base === undefined)
            return undefined;
        const tracked = this.turns.get(sessionId);
        if (this.inputs.ledger) {
            if (!tracked || tracked.invalid)
                return undefined;
            if (tracked.inputs.size > 0 && tracked.external)
                return undefined;
            if (tracked.state.origin === null && !tracked.state.sawInternal)
                return undefined;
            const target = tracked.state.origin === 'qq' ? tracked.target
                : { scope: tracked.target.scope, targetId: tracked.target.targetId, forceProactive: true };
            if (tracked.external && !this.allowsExternal(target))
                return undefined;
            const allowed = () => !tracked.invalid && !(tracked.inputs.size > 0 && tracked.external)
                && (this.options.allowed?.(target) ?? true);
            if (!allowed())
                return undefined;
            return { target: bindDelivery(target, { key: deliveryKey(sessionId, tracked.state.turn), sessionId, allowed }), proactive: tracked.state.origin !== 'qq' };
        }
        if (tracked === undefined || deliveryMode(tracked.state) === 'passive') {
            return { target: base, proactive: false };
        }
        if (tracked.state.origin === 'external' && !this.allowsExternal(base))
            return undefined;
        return {
            target: { scope: base.scope, targetId: base.targetId, forceProactive: true },
            proactive: true,
        };
    }
    targetFor(sessionId) {
        return this.planFor(sessionId)?.target;
    }
    /** 当前跟踪中的回合数（可观测性/测试用） */
    get activeTurns() {
        return this.turns.size;
    }
    allowsExternal(target) {
        const policy = this.options.externalTurns;
        if (policy === 'all')
            return true;
        if (policy === 'c2c')
            return target.scope === 'c2c';
        return false;
    }
    addressOf(sessionId) {
        const record = this.manager.findBySessionId(sessionId);
        if (record !== undefined)
            return record.replyTarget;
        return this.manager.deliveryAddress?.(sessionId);
    }
    release(tracked) {
        for (const id of tracked.inputs)
            this.inputs.release(id);
    }
}
function readUserMessage(data) {
    const raw = data;
    const id = raw.id ?? raw.message?.id;
    return {
        messageId: typeof id === 'string' && id !== '' ? id : undefined,
        source: raw.source ?? raw.message?.source,
    };
}
//# sourceMappingURL=turn-tracker.js.map