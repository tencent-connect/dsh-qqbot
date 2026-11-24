import { chunkMarkdownText } from "./chunker.js";
import { StreamingWriter } from "./streaming-writer.js";
/** 流式输出节流间隔(ms)：连续 chunk 累积后停顿该间隔才推送 */
const STREAM_THROTTLE_MS = 200;
export class OutboundBuffer {
    buffer = '';
    /** 回复标题头：置于全部文本之前；reset 不清除（LLM 重试重写仍保留定位） */
    prefix = '';
    flushing = false;
    writer;
    bot;
    limit;
    logger;
    /** 构造时拍下的发送目标，本缓冲生命周期内不跟随会话 replyTarget 变化 */
    target;
    constructor(target, bot, limit, logger, streamingEnabled) {
        this.bot = bot;
        this.limit = limit;
        this.logger = logger;
        this.target = target;
        this.writer = streamingEnabled
            ? new StreamingWriter({ bot, target: this.target, logger, throttleMs: STREAM_THROTTLE_MS })
            : null;
    }
    /** 追加文本增量 */
    append(text) {
        this.buffer += text;
        this.writer?.append(text);
    }
    /** 设置标题头（须在首个增量 append 前调用；text 取值不含 prefix，空判语义不变） */
    setPrefix(prefix) {
        this.prefix = prefix;
        this.writer?.setPrefix(prefix);
    }
    /** 获取当前累积文本 */
    get text() {
        return this.buffer;
    }
    /** 重置累积文本（LLM 重试的新 attempt），流式会话保留由全量 update 重写 */
    reset() {
        this.buffer = '';
        this.writer?.reset();
    }
    /** 发送所有累积文本：流式优先，降级静态 */
    async flush() {
        if (this.flushing || !this.buffer.trim())
            return;
        this.flushing = true;
        try {
            if (this.writer) {
                await this.writer.finish();
                // 流式成功（未降级）→ 直接返回
                if (!this.writer.shouldFallback)
                    return;
            }
            // 降级：静态发送（writer 不存在 or 流式失败；标题头随首块带出）
            const text = this.prefix !== '' ? this.prefix + '\n\n' + this.buffer : this.buffer;
            const chunks = chunkMarkdownText(text, this.limit);
            for (const chunk of chunks) {
                await this.bot.sendMarkdown(this.target, chunk);
            }
        }
        catch (err) {
            this.logger.error(`im-qqbot: flush failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        finally {
            this.buffer = '';
            this.flushing = false;
        }
    }
    /** 取消（异常/丢弃），中止流式并清空缓冲 */
    cancel() {
        this.writer?.abort();
        this.buffer = '';
    }
}
//# sourceMappingURL=outbound-buffer.js.map