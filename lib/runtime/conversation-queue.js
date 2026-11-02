/** Bounds and serializes independent operations for each QQ conversation. */
export class ConversationQueue {
    onIdle;
    tails = new Map();
    counts = new Map();
    constructor(onIdle) {
        this.onIdle = onIdle;
    }
    pending(key) { return this.counts.get(key) ?? 0; }
    run(key, operation, maximum = 20) {
        const count = this.pending(key);
        if (count >= maximum)
            return Promise.reject(new Error('该对话等待处理的任务过多，请稍后重试'));
        this.counts.set(key, count + 1);
        const result = (this.tails.get(key) ?? Promise.resolve()).then(operation);
        const settled = result.then(() => { }, () => { }).finally(() => {
            const remaining = this.pending(key) - 1;
            if (remaining === 0)
                this.counts.delete(key);
            else
                this.counts.set(key, remaining);
            if (this.tails.get(key) === settled)
                this.tails.delete(key);
            if (remaining === 0)
                this.onIdle?.(key);
        });
        this.tails.set(key, settled);
        return result;
    }
}
/** Received input waits for a Session boundary; processing quotas must not reject its capture. */
export class ConversationIngressQueue extends ConversationQueue {
    run(key, operation) {
        return super.run(key, operation, Infinity);
    }
}
//# sourceMappingURL=conversation-queue.js.map