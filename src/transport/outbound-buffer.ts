/**
 * OutboundBuffer — 出站文本缓冲
 *
 * 收集流式 chunk，流式优先投递（StreamingWriter），降级为静态发送。
 * 增量推送（pushPos）+ 未闭合 [[FILE:]] 标记拦截，避免标记被流式打碎。
 * 独立文件便于单测。
 */
import type { SessionRecord } from '../session/index.js';
import type { Logger, ReplyTarget } from '../types.js';
import { chunkMarkdownText } from './chunker.js';
import { StreamingWriter } from './streaming-writer.js';
import { FILE_TAG_RE, FILE_TAG_MAX_HOLD, processFileMarkers, sendMarkerFile } from './file-sender.js';

/** 流式输出节流间隔(ms)：连续 chunk 累积后停顿该间隔才推送 */
const STREAM_THROTTLE_MS = 200;

/** 未闭合文件标记的开头 */
const FILE_TAG_OPEN = '[[FILE:';

/** 流式会话（openStream 返回） */
export interface StreamSessionLike {
  update(content: string): Promise<unknown>;
  complete(): Promise<unknown>;
}

/** QQ Bot 发送接口 */
export interface QQBotSender {
  sendMarkdown(target: ReplyTarget, content: string): Promise<unknown>;
  openStream(target: ReplyTarget): StreamSessionLike;
}

/** QQ Bot 文件发送接口（SDK sendFile；插件内可选依赖，便于测试与旧版 SDK） */
export interface QQBotFileSender {
  sendMarkdown?(target: ReplyTarget, content: string): Promise<unknown>;
  openStream?(target: ReplyTarget): StreamSessionLike;
  sendFile?(target: ReplyTarget, source: { url?: string; buffer?: Buffer; localPath?: string }, opts?: {
    fileName?: string;
    content?: string;
    onProgress?: (uploaded: number, total: number) => void;
  }): Promise<{ message: unknown }>;
}

export class OutboundBuffer {
  private buffer = '';
  /** 已推送位置：buffer 中 [0, pushPos) 已处理过，[pushPos, end) 待处理 */
  private pushPos = 0;
  private flushing = false;
  private readonly writer: StreamingWriter | null;

  public constructor(
    private readonly record: SessionRecord,
    private readonly bot: QQBotSender & QQBotFileSender,
    private readonly limit: number,
    private readonly logger: Logger,
    streamingEnabled: boolean,
  ) {
    this.writer = streamingEnabled
      ? new StreamingWriter({ bot, target: record.replyTarget, logger, throttleMs: STREAM_THROTTLE_MS })
      : null;
  }

  /**
   * 追加文本增量（只推送增量，不重推历史）。
   * 流式下拦截未闭合的 [[FILE: 标记（避免标记被流式打碎推送），
   * 闭合后提取触发发送，剩余文本继续流式推送。
   */
  public append(text: string): void {
    this.buffer += text;
    if (!this.writer) return;

    // 待推送区出现未闭合标记 → 拦截等待闭合（超长则放弃按文本推送）
    const openIdx = this.buffer.indexOf(FILE_TAG_OPEN, this.pushPos);
    if (openIdx !== -1) {
      const runaway = this.buffer.length - openIdx > FILE_TAG_MAX_HOLD;
      const hasClose = this.buffer.indexOf(']]', openIdx) !== -1;
      if (!hasClose && !runaway) return;
    }
    const pending = this.consumePending();
    if (pending) this.writer.append(pending);
  }

  /** 获取当前累积文本 */
  public get text(): string {
    return this.buffer;
  }

  /**
   * 处理 [pushPos, end) 区间的文本：提取已闭合文件标记触发发送，
   * 返回可推送的剩余文本；未闭合残留降级提示。推进 pushPos。
   */
  private consumePending(): string {
    const pending = this.buffer.slice(this.pushPos);
    let out = '';
    let last = 0;
    FILE_TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FILE_TAG_RE.exec(pending)) !== null) {
      const expr = (m[1] ?? '').trim();
      if (!expr) {
        out += pending.slice(last, m.index) + '⚠️ 文件标记为空';
        last = m.index + m[0].length;
        continue;
      }
      void sendMarkerFile(this.bot, this.record.replyTarget, expr, this.logger);
      out += pending.slice(last, m.index);
      last = m.index + m[0].length;
    }
    out += pending.slice(last);
    // 残留未闭合标记 → 降级提示（正常流程不应出现）
    out = out.replace(/\[\[FILE:[^\]]*$/g, (mm) => `⚠️ 文件标记未闭合: \`${mm.slice(7)}\``);
    this.pushPos = this.buffer.length;
    return out;
  }

  /** 发送所有累积文本：流式优先，降级静态（静态发送前处理文件标记） */
  public async flush(): Promise<void> {
    if (this.flushing || !this.buffer.trim()) return;
    this.flushing = true;

    try {
      if (this.writer) {
        const pending = this.consumePending();
        if (pending) this.writer.append(pending);
        await this.writer.finish();
        // 流式成功（未降级）→ 直接返回
        if (!this.writer.shouldFallback) return;
      }

      // 降级/非流式：处理文件标记后静态发送
      const text = this.writer ? this.writer.text : this.buffer;
      const cleaned = processFileMarkers(this.bot, this.record.replyTarget, text, this.logger);
      const chunks = chunkMarkdownText(cleaned, this.limit);
      for (const chunk of chunks) {
        await this.bot.sendMarkdown(this.record.replyTarget, chunk);
      }
    } catch (err) {
      this.logger.error(`im-qqbot: flush failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.buffer = '';
      this.pushPos = 0;
      this.flushing = false;
    }
  }

  /** 取消（异常/丢弃），中止流式并清空缓冲 */
  public cancel(): void {
    this.writer?.abort();
    this.buffer = '';
    this.pushPos = 0;
  }
}
