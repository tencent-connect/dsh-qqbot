/**
 * StreamingWriter — QQ 流式文本写入器
 *
 * 边界条件设计：
 *   - 节流（throttle）：固定间隔 flush，避免每 token 发 HTTP，同时保证长文本分多次推送
 *   - 串行队列（chain）：保证 update 顺序，finish 前最后一次文本必达
 *   - 降级（sentChunkCount === 0）：只有从未成功发送分片才降级静态，
 *     避免"已流式部分 + 静态全量"的重复内容
 *   - 终态幂等（finished）：finish/abort 后忽略 append，重复 finish 不重复 complete
 *   - 中止关闭（abort）：abort 时若 session 已打开，串行 complete 关闭，避免悬挂
 */
import type { Logger, ReplyTarget } from '../types.ts';
import type { QQBotSender, StreamSessionLike } from './outbound-buffer.ts';

export interface StreamingWriterDeps {
  bot: QQBotSender;
  target: ReplyTarget;
  logger: Logger;
  /** 节流间隔（ms）：连续 append 累积后，停顿该间隔才 update */
  throttleMs: number;
}

export class StreamingWriter {
  private fullText = '';
  private session: StreamSessionLike | null = null;
  private sentChunkCount = 0;
  private failed = false;
  private finished = false;
  private aborted = false;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();

  private readonly deps: StreamingWriterDeps;

  public constructor(deps: StreamingWriterDeps) {
    this.deps = deps;
  }

  /** 是否应降级为静态发送：从未成功发送过任何分片 */
  public get shouldFallback(): boolean {
    return this.sentChunkCount === 0;
  }

  /** 累积全文（降级静态发送时使用） */
  public get text(): string {
    return this.fullText;
  }

  /** 追加增量文本，节流（throttle）后 update 全量 */
  public append(delta: string): void {
    if (this.finished) return;
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
  public async finish(): Promise<void> {
    if (this.finished) return;
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
      } catch (err) {
        this.deps.logger.error(
          `im-qqbot: stream complete failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** 中止（异常/取消）：关闭已打开的流式会话，避免悬挂 */
  public abort(): void {
    if (this.finished) return;
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
        } catch (err) {
          this.deps.logger.error(
            `im-qqbot: stream abort complete failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    });
  }

  /** 入队一次 update（串行，保证顺序） */
  private enqueue(): void {
    this.chain = this.chain.then(() => this.pushUpdate());
  }

  /** 推送当前累积文本（首次 openStream + update 全量） */
  private async pushUpdate(): Promise<void> {
    if (this.aborted || this.failed || !this.fullText) return;

    if (!this.session) {
      try {
        this.session = this.deps.bot.openStream(this.deps.target);
        this.deps.logger.debug(`im-qqbot: stream opened (chars=${this.fullText.length})`);
      } catch (err) {
        // openStream 失败：标记 failed 避免重复尝试，后续走降级静态
        this.failed = true;
        this.deps.logger.warn(
          `im-qqbot: openStream failed, fallback to static: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
    }

    try {
      await this.session.update(this.fullText);
      this.sentChunkCount++;
    } catch (err) {
      // update 失败：不标记 failed（session 已打开，finish 会 complete 关闭）
      this.deps.logger.warn(
        `im-qqbot: stream update failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
