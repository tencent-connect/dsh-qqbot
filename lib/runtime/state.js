/** Public error hints contain no SDK error text, credentials, or message content. */
export const RUNTIME_ERROR_HINTS = {
    connection: 'QQ 连接发生错误，请检查机器人凭据或网络。',
    disconnected: 'QQ 连接已断开，正在尝试重新连接。',
    terminal: 'QQ 连接无法恢复，请检查机器人状态和宿主日志。',
    send: '最近一次消息发送失败，请查看宿主日志。',
};
/** One plugin instance owns one in-memory runtime snapshot. */
export class RuntimeState {
    now;
    value;
    constructor(now = Date.now) {
        this.now = now;
        this.value = {
            phase: 'unbound',
            updatedAt: now(),
            lastReceivedAt: null,
            lastSentAt: null,
            lastError: null,
        };
    }
    /** Return a detached snapshot so callers cannot mutate the live state. */
    snapshot() {
        return { ...this.value };
    }
    /** Ignore late gateway callbacks after this plugin instance has stopped. */
    setPhase(phase, error = null) {
        if (this.value.phase === 'stopped')
            return;
        this.value = { ...this.value, phase, lastError: error, updatedAt: this.now() };
    }
    /** Record an incoming message before access and mention filtering. */
    received() {
        if (this.value.phase === 'stopped')
            return;
        const at = this.now();
        this.value = { ...this.value, lastReceivedAt: at, updatedAt: at };
    }
    /** Record only a completed send; queuing a stream update does not count. */
    sent() {
        if (this.value.phase === 'stopped')
            return;
        const at = this.now();
        const lastError = this.value.lastError === RUNTIME_ERROR_HINTS.send ? null : this.value.lastError;
        this.value = { ...this.value, lastSentAt: at, lastError, updatedAt: at };
    }
    /** Keep transport phase separate from a failed outbound operation. */
    sendFailed() {
        if (this.value.phase === 'stopped')
            return;
        this.value = { ...this.value, lastError: RUNTIME_ERROR_HINTS.send, updatedAt: this.now() };
    }
}
//# sourceMappingURL=state.js.map