/**
 * 出站处理器 — dsh session/event → QQ 消息发送
 *
 * 采用路由器模式：OutboundRouter 持有会话级状态（文本缓冲、工具调用记录），
 * 事件解析归一化在 events.ts，路由按事件类型分发到私有方法。
 */
import type { SessionManager, SessionRecord, DshAgent } from '../session/index.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger, ReplyTarget } from '../types.ts';
import type { InlineKeyboard } from '@tencent-connect/qqbot-nodejs';
import { chunkMarkdownText } from './chunker.ts';
import { OutboundBuffer, type QQBotSender } from './outbound-buffer.ts';
import { formatToolResult, type ToolsRegistryLike, type ToolResultData } from './tool-presenter.ts';
import {
  parseEvent,
  extractTurnError,
  type ChunkEvent,
  type MessageEvent,
  type ToolCallEvent,
  type ToolResultEvent,
  type TurnEndEvent,
  type UserMessageEvent,
  type RawSessionEvent,
} from './events.ts';

export type { QQBotSender } from './outbound-buffer.ts';
export type { ToolsRegistryLike } from './tool-presenter.ts';

/** 出站处理器签名（注册到 ctx.on('session/event')） */
export type OutboundHandler = (session: SessionLike, event: RawSessionEvent) => void;

/** dsh Session 简化类型 */
export interface SessionLike {
  header: { id: string };
}

/** 工具调用记录（tool/call 建立，tool/result 消费） */
interface ToolCallRecord {
  name: string;
  args: string;
}

/** 快捷按钮来源（QuestionChannel 结构化满足；避免循环依赖只取最小接口） */
export interface QuickReplySourceLike {
  prepareQuickReply(key: string, text: string): { keyboard: InlineKeyboard; labels: string[] } | undefined;
}

/** 快捷按钮附加消息的引导文案（流式消息挂不了键盘，按钮放附加短消息上） */
const QUICK_REPLY_PROMPT = '🔘 快速选择（或直接回复编号）';

/** 不展示给用户的轮次错误码（底层传输/网络错误，对用户无意义，且常被重试兜住） */
const SILENT_TURN_ERROR_CODES = new Set(['STREAM_CLOSED']);

/**
 * 出站路由器：持有会话级状态，按事件类型分发到处理器
 */
class OutboundRouter {
  private readonly buffers = new Map<string, OutboundBuffer>();
  private readonly toolCalls = new Map<string, ToolCallRecord>();
  private readonly manager: SessionManager;
  private readonly bot: QQBotSender;
  private readonly config: ImQQBotConfig;
  private readonly logger: Logger;
  private readonly toolsRegistry: ToolsRegistryLike | undefined;
  private readonly quickReplySource: QuickReplySourceLike | undefined;

  public constructor(
    manager: SessionManager,
    bot: QQBotSender,
    config: ImQQBotConfig,
    logger: Logger,
    toolsRegistry: ToolsRegistryLike | undefined,
    quickReplySource?: QuickReplySourceLike,
  ) {
    this.manager = manager;
    this.bot = bot;
    this.config = config;
    this.logger = logger;
    this.toolsRegistry = toolsRegistry;
    this.quickReplySource = quickReplySource;
  }

  /** 事件分发入口 */
  public route(session: SessionLike, raw: RawSessionEvent): void {
    const event = parseEvent(raw);
    if (event === undefined) return;

    const sessionId = session.header.id;

    // Web 镜像：用户消息单独处理（QQ 发起的回合按标记跳过）
    if (event.type === 'user/message') {
      this.onUserMessage(sessionId, event);
      return;
    }

    // 无活记录（Web 发起 / 已回收 / 宿主重启）时按持久化映射构造桥接记录
    const record = this.manager.findBySessionId(sessionId)
      ?? (this.config.mirrorWeb ? this.bridgeRecord(sessionId) : undefined);
    if (record === undefined) return;

    switch (event.type) {
      case 'assistant/chunk':
        this.onChunk(session.header.id, record, event);
        break;
      case 'assistant/message':
        this.onMessage(session.header.id, record, event);
        break;
      case 'tool/call':
        this.onToolCall(event);
        break;
      case 'tool/result':
        this.onToolResult(record, event);
        break;
      case 'turn/end':
        this.onTurnEnd(session.header.id, record, event);
        break;
    }
  }

  /**
   * Web 发起回合的用户消息 → 带标记镜像到 QQ。
   * QQ 发起的回合（handleInbound 已递增 qqPendingTurns）消费标记并跳过，
   * 避免把 QQ 端已有的消息重复推回去。
   */
  private onUserMessage(sessionId: string, event: UserMessageEvent): void {
    if (!this.config.mirrorWeb) return;

    const live = this.manager.findBySessionId(sessionId);
    if (live !== undefined && (live.qqPendingTurns ?? 0) > 0) {
      live.qqPendingTurns = (live.qqPendingTurns ?? 0) - 1;
      return;
    }

    const record = live ?? this.bridgeRecord(sessionId);
    if (record === undefined) return;

    const text = event.text.trim();
    if (!text) return; // 仅附件等非文本消息暂不镜像

    void this.send(record, `🌐 来自 Web：\n${text}`, 'mirrorWebUserMessage');
  }

  /**
   * 桥接记录：会话无活记录时（Web 发起/闲置回收/宿主重启后），
   * 凭持久化映射解析 QQ 目标。回复目标不带 msgId → 走主动消息投递。
   */
  private bridgeRecord(sessionId: string): SessionRecord | undefined {
    const peer = this.manager.resolvePeer(sessionId);
    if (peer === undefined) return undefined;

    const agent = (this.manager.liveAgent(sessionId) ?? {}) as DshAgent;
    return {
      sessionKey: `bridge:${sessionId}`,
      sessionId,
      agent,
      handle: { agent, dispose: async () => {} },
      replyTarget: { scope: peer.scope, targetId: peer.peerId },
      scope: peer.scope,
      peerId: peer.peerId,
      senderId: peer.peerId,
      lastActivity: Date.now(),
    };
  }

  /** 流式文本增量：累积到会话 buffer */
  private onChunk(sessionId: string, record: SessionRecord, event: ChunkEvent): void {
    let buffer = this.buffers.get(sessionId);
    if (buffer === undefined) {
      buffer = new OutboundBuffer(record, this.bot, this.config.textChunkLimit, this.logger, this.shouldStream(record));
      this.buffers.set(sessionId, buffer);
    }
    buffer.append(event.text);
  }

  /** 是否启用流式：配置开启 + c2c + 有 msgId（群聊不支持流式） */
  private shouldStream(record: SessionRecord): boolean {
    return this.config.streaming
      && record.replyTarget.scope === 'c2c'
      && !!record.replyTarget.msgId;
  }

  /** 完整 assistant 消息：有流式 buffer 则 flush，否则直接发送文本块；尾部编号选项补挂快捷按钮 */
  private onMessage(sessionId: string, record: SessionRecord, event: MessageEvent): void {
    const buffer = this.buffers.get(sessionId);
    if (buffer !== undefined && buffer.text.trim()) {
      this.buffers.delete(sessionId);
      void this.flushWithQuickReply(record, buffer);
      return;
    }

    const textParts: string[] = [];
    for (const block of event.content) {
      if (block.type === 'text' && block.text) textParts.push(block.text);
    }
    const fullText = textParts.join('\n');
    if (!fullText.trim()) return;

    const quick = this.prepareQuickReply(record, fullText);
    void this.send(record, fullText, 'sendMarkdown').then(() => this.sendQuickReply(record, quick));
    this.buffers.delete(sessionId);
  }

  /** flush 流式缓冲，完成后按需追加快捷按钮消息 */
  private async flushWithQuickReply(record: SessionRecord, buffer: OutboundBuffer): Promise<void> {
    const quick = this.prepareQuickReply(record, buffer.text);
    await buffer.flush();
    await this.sendQuickReply(record, quick);
  }

  /** 检测尾部编号选项并登记快捷按钮（配置关闭或无来源时跳过） */
  private prepareQuickReply(record: SessionRecord, text: string): InlineKeyboard | undefined {
    if (this.quickReplySource === undefined) return undefined;
    try {
      // 规范会话键：桥接记录的 sessionKey 是 bridge:*，与点击事件的键不一致
      const key = this.manager.sessionKey(record.scope, record.peerId);
      return this.quickReplySource.prepareQuickReply(key, text)?.keyboard;
    } catch (err) {
      this.logger.debug(`im-qqbot: quick-reply prepare failed: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  /** 发送快捷按钮附加消息（键盘挂不上流式消息，单独一条短消息承载按钮） */
  private async sendQuickReply(record: SessionRecord, keyboard: InlineKeyboard | undefined): Promise<void> {
    if (keyboard === undefined) return;
    await this.sendResilient(record.replyTarget, QUICK_REPLY_PROMPT, 'sendQuickReply', keyboard);
  }

  /** 工具调用：仅记录，不发送（避免刷屏，等待结果） */
  private onToolCall(event: ToolCallEvent): void {
    this.toolCalls.set(event.callId, { name: event.name, args: event.arguments });
  }

  /** 工具结果：错误始终发送，成功结果按开关 */
  private onToolResult(record: SessionRecord, event: ToolResultEvent): void {
    const call = this.toolCalls.get(event.callId);
    this.toolCalls.delete(event.callId);
    if (call === undefined) return;

    if (event.error === undefined && !this.config.showToolResults) return;

    let text: string | null | undefined;
    try {
      text = formatToolResult(
        call.name,
        call.args,
        event.raw as unknown as ToolResultData,
        this.toolsRegistry,
        record.agent,
      );
    } catch {
      return; // 桥接记录无真实 agent 时展示层可能不可用，静默跳过
    }
    if (!text) return;

    void this.send(record, text, 'sendToolResult');
  }

  /** 轮次结束：清理 buffer，异常结束时告知用户 */
  private onTurnEnd(sessionId: string, record: SessionRecord, event: TurnEndEvent): void {
    const buffer = this.buffers.get(sessionId);
    if (buffer !== undefined) {
      if (buffer.text.trim()) {
        void this.flushWithQuickReply(record, buffer);
      } else {
        buffer.cancel();
      }
      this.buffers.delete(sessionId);
    }

    const failure = extractTurnError(event.reason);
    if (failure !== undefined && !SILENT_TURN_ERROR_CODES.has(failure.code)) {
      void this.send(record, `⚠️ 本轮异常结束\n\`${failure.code}\`: ${failure.message}`, 'sendTurnEndError');
    }

    this.logger.debug(`im-qqbot: turn/end sessionId=${sessionId}`);
  }

  /** 统一发送：切分 + 逐 chunk 三级容错投递 + 错误记录 */
  private async send(record: SessionRecord, text: string, tag: string): Promise<void> {
    const chunks = chunkMarkdownText(text, this.config.textChunkLimit);
    for (const chunk of chunks) {
      await this.sendResilient(record.replyTarget, chunk, tag);
    }
  }

  /**
   * 三级容错投递（全部 fail-soft，不影响会话处理）：
   *   1. 原目标发送（有 msgId 时为被动回复——QQ 回合的正常路径）
   *   2. 失败且带 msgId → 去掉 msgId 按主动消息重试（Web 回合的 msgId 通常已过期）
   *   3. 仍失败且为 c2c → 唤醒消息（30 天会话窗口内的主动投递；不支持键盘）
   * 附带键盘时前两级均携带键盘；唤醒不带键盘（附加引导文案单独发出意义不大，
   * 键盘发送彻底失败仅记日志——正文已在上一轮送达）。
   */
  private async sendResilient(target: ReplyTarget, content: string, tag: string, keyboard?: InlineKeyboard): Promise<void> {
    const opts = keyboard !== undefined ? { keyboard } : undefined;
    try {
      await this.bot.sendMarkdown(target, content, opts);
      return;
    } catch (err) {
      this.logger.debug(`im-qqbot: ${tag} send failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (target.msgId !== undefined) {
      try {
        await this.bot.sendMarkdown({ scope: target.scope, targetId: target.targetId }, content, opts);
        return;
      } catch (err) {
        this.logger.debug(`im-qqbot: ${tag} active retry failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (keyboard === undefined && target.scope === 'c2c' && this.bot.sendWakeup !== undefined) {
      try {
        await this.bot.sendWakeup({ scope: target.scope, targetId: target.targetId }, content);
        return;
      } catch (err) {
        this.logger.debug(`im-qqbot: ${tag} wakeup retry failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.logger.error(`im-qqbot: ${tag} failed after all fallbacks`);
  }
}

/**
 * 创建出站事件处理器
 *
 * 返回一个 handler 函数，应注册到 ctx.on('session/event', handler)。
 * toolsRegistry 用于工具结果的结构化展示；
 * quickReplySource 用于尾部编号选项的快捷按钮兜底（可选）。
 */
export function createOutboundHandler(
  manager: SessionManager,
  bot: QQBotSender,
  config: ImQQBotConfig,
  logger: Logger,
  toolsRegistry?: ToolsRegistryLike,
  quickReplySource?: QuickReplySourceLike,
): OutboundHandler {
  const router = new OutboundRouter(manager, bot, config, logger, toolsRegistry, quickReplySource);
  return (session, event) => router.route(session, event);
}
