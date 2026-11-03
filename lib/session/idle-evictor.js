/** 回收检查周期(ms) */
const CHECK_INTERVAL_MS = 60_000;
export class IdleEvictor {
    timer = null;
    sessions;
    timeoutMs;
    onEvict;
    constructor(sessions, timeoutMs, onEvict) {
        this.sessions = sessions;
        this.timeoutMs = timeoutMs;
        this.onEvict = onEvict;
        if (timeoutMs > 0) {
            this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
        }
    }
    /** 执行一轮回收检查。未配置超时（<=0）时不回收任何会话。 */
    check() {
        if (this.timeoutMs <= 0)
            return;
        const now = Date.now();
        for (const [key, record] of this.sessions) {
            if (now - record.lastActivity > this.timeoutMs) {
                this.onEvict(key, record);
            }
        }
    }
    /** 停止回收定时器 */
    dispose() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}
//# sourceMappingURL=idle-evictor.js.map