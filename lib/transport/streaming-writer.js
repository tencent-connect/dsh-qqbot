import { modelReplyText } from "./model-reply.js";
export class StreamingWriter {
    fullText = '';
    session = null;
    sentChunkCount = 0;
    failed = false;
    finished = false;
    aborted = false;
    throttleTimer = null;
    chain = Promise.resolve();
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    /** 是否应降级为静态发送：从未成功发送过任何分片 */
    get shouldFallback() {
        return this.sentChunkCount === 0;
    }
    /** 累积全文（降级静态发送时使用） */
    get text() {
        return modelReplyText(this.fullText, this.finished);
    }
    /**
     * 重置累积文本（LLM 重试的新 attempt）。
     *
     * 保留已打开的流式会话与 sentChunkCount：QQ 流式 update 是全量替换语义，
     * 新 attempt 的增量会把同一条消息整体重写，用户不会看到两条消息；
     * sentChunkCount 保留则防止重试后误判"从未发送"而降级静态造成重复。
     */
    reset() {
        if (this.finished)
            return;
        this.fullText = '';
    }
    /** 追加增量文本，节流（throttle）后 update 全量 */
    append(delta) {
        if (this.finished)
            return;
        this.fullText += delta;
        // throttle：仅在无 pending timer 时启动，固定间隔 flush。
        // 不用 debounce（否则 chunk 持续到达时永远憋着，流式退化成一次性全量发送）
        if (this.throttleTimer === null) {
            this.throttleTimer = setTimeout(() => {
                this.throttleTimer = null;
                this.enqueue();
            }, this.deps.throttleMs);
        }
    }
    /** 结束：flush 最终文本 + complete 收尾 */
    async finish() {
        if (this.finished)
            return;
        this.finished = true;
        if (this.throttleTimer) {
            clearTimeout(this.throttleTimer);
            this.throttleTimer = null;
        }
        // 立即把最终累积文本入队（覆盖节流未触发的场景）
        this.enqueue();
        await this.chain;
        // 只要 session 存在就 complete（关闭流式消息，无论是否降级）
        if (this.session) {
            try {
                await this.session.complete();
            }
            catch (err) {
                this.deps.logger.error(`im-qqbot: stream complete failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
    /** 中止（异常/取消）：关闭已打开的流式会话，避免悬挂 */
    abort() {
        if (this.finished)
            return;
        this.finished = true;
        this.aborted = true;
        if (this.throttleTimer) {
            clearTimeout(this.throttleTimer);
            this.throttleTimer = null;
        }
        // 串行 complete（排在 pending update 之后），关闭已打开的流式会话
        this.chain = this.chain.then(async () => {
            if (this.session) {
                try {
                    await this.session.complete();
                }
                catch (err) {
                    this.deps.logger.error(`im-qqbot: stream abort complete failed: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        });
    }
    /** 入队一次 update（串行，保证顺序） */
    enqueue() {
        this.chain = this.chain.then(() => this.pushUpdate());
    }
    /** 推送当前累积文本（首次 openStream + update 全量） */
    async pushUpdate() {
        const text = modelReplyText(this.fullText, this.finished);
        if (this.aborted || this.failed || !text)
            return;
        if (!this.session) {
            try {
                this.session = this.deps.bot.openStream(this.deps.target);
                this.deps.logger.debug(`im-qqbot: stream opened (chars=${text.length})`);
            }
            catch (err) {
                // openStream 失败：标记 failed 避免重复尝试，后续走降级静态
                this.failed = true;
                this.deps.logger.warn(`im-qqbot: openStream failed, fallback to static: ${err instanceof Error ? err.message : String(err)}`);
                return;
            }
        }
        try {
            await this.session.update(text);
            this.sentChunkCount++;
        }
        catch (err) {
            // update 失败：不标记 failed（session 已打开，finish 会 complete 关闭）
            this.deps.logger.warn(`im-qqbot: stream update failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
//# sourceMappingURL=streaming-writer.js.map