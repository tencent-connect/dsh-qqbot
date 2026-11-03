/**
 * OutboundBuffer — 出站文本缓冲
 *
 * 收集流式 chunk，流式优先投递（StreamingWriter），降级为静态发送。
 * 独立文件便于单测。
 */
import type { InlineKeyboard } from '@tencent-connect/qqbot-nodejs';
import type { Logger, ReplyTarget } from '../types.ts';
import { chunkMarkdownText } from './chunker.ts';
import { StreamingWriter } from './streaming-writer.ts';

/** 流式输出节流间隔(ms)：连续 chunk 累积后停顿该间隔才推送 */
const STREAM_THROTTLE_MS = 200;

/** QQ 流式会话（openStream 返回） */
export interface StreamSessionLike {
  update(content: string): Promise<unknown>;
  complete(): Promise<unknown>;
}

/** QQ Bot 发送接口 */
export interface QQBotSender {
  sendMarkdown(target: ReplyTarget, content: string, opts?: { keyboard?: InlineKeyboard }): Promise<unknown>;
  openStream(target: ReplyTarget): StreamSessionLike;
}

export class OutboundBuffer {
  private buffer = '';
  private flushing = false;
  private readonly writer: StreamingWriter | null;
  private readonly bot: QQBotSender;
  private readonly limit: number;
  private readonly logger: Logger;
  /** 构造时拍下的发送目标，本缓冲生命周期内不跟随会话 replyTarget 变化 */
  private readonly target: ReplyTarget;

  public constructor(
    target: ReplyTarget,
    bot: QQBotSender,
    limit: number,
    logger: Logger,
    streamingEnabled: boolean,
  ) {
    this.bot = bot;
    this.limit = limit;
    this.logger = logger;
    this.target = target;
    this.writer = streamingEnabled
      ? new StreamingWriter({ bot, target: this.target, logger, throttleMs: STREAM_THROTTLE_MS })
      : null;
  }

  /** 追加文本增量 */
  public append(text: string): void {
    this.buffer += text;
    this.writer?.append(text);
  }

  /** 获取当前累积文本 */
  public get text(): string {
    return this.buffer;
  }

  /** 重置累积文本（LLM 重试的新 attempt），流式会话保留由全量 update 重写 */
  public reset(): void {
    this.buffer = '';
    this.writer?.reset();
  }

  /** 发送所有累积文本：流式优先，降级静态 */
  public async flush(): Promise<void> {
    if (this.flushing || !this.buffer.trim()) return;
    this.flushing = true;

    try {
      if (this.writer) {
        await this.writer.finish();
        // 流式成功（未降级）→ 直接返回
        if (!this.writer.shouldFallback) return;
      }

      // 降级：静态发送（writer 不存在 or 流式失败）
      const chunks = chunkMarkdownText(this.buffer, this.limit);
      for (const chunk of chunks) {
        await this.bot.sendMarkdown(this.target, chunk);
      }
    } catch (err) {
      this.logger.error(`im-qqbot: flush failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.buffer = '';
      this.flushing = false;
    }
  }

  /** 取消（异常/丢弃），中止流式并清空缓冲 */
  public cancel(): void {
    this.writer?.abort();
    this.buffer = '';
  }
}
