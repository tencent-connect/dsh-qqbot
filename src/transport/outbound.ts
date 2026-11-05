/**
 * 出站处理器 — dsh session/event → QQ 消息发送
 *
 * 采用路由器模式：OutboundRouter 持有会话级状态（文本缓冲、工具调用记录），
 * 事件解析归一化在 events.ts，路由按事件类型分发到私有方法。
 */
import type { SessionManager, SessionRecord } from '../session/index.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger, ReplyTarget } from '../types.ts';
import { chunkMarkdownText } from './chunker.ts';
import { OutboundBuffer, type QQBotSender } from './outbound-buffer.ts';
import { formatToolResult, type ToolsRegistryLike, type ToolResultData } from './tool-presenter.ts';
import type { DeliverablesDelivererLike } from './deliverables.ts';
import { QqInputRegistry } from './qq-input-origin.ts';
import { TurnTracker, type DeliveryPlan } from './turn-tracker.ts';
import { extractUserMessageText, formatMirrorWebText, isMirrorableOrigin } from './mirror-web.ts';
import type { MessageOrigin } from './turn-origin.ts';
import {
  parseEvent,
  extractTurnError,
  type MessageEvent,
  type ToolCallEvent,
  type ToolResultEvent,
  type TurnEndEvent,
  type DeliverablesPresentedEvent,
  type PresentedFileRef,
  type RawSessionEvent,
  type StreamDelta,
} from './events.ts';

export type { QQBotSender } from './outbound-buffer.ts';
export type { ToolsRegistryLike } from './tool-presenter.ts';
export { parseStreamFrame } from './events.ts';

/** 出站处理器签名（注册到 ctx.on('session/event')） */
export type OutboundHandler = (session: SessionLike, event: RawSessionEvent) => void;

/** 出站事件入口集合：durable 事件 + 实时流式帧 */
export interface OutboundHandlers {
  /** durable session 事件入口（注册到 ctx.on('session/event')） */
  routeSessionEvent(session: SessionLike, event: RawSessionEvent): void;
  /**
   * 实时流式帧入口（注册到 ctx.on('agent/assistant-stream', ..., { global: true })）。
   */
  routeStreamFrame(agentId: string, delta: StreamDelta): void;
}

/** dsh Session 简化类型 */
export interface SessionLike {
  header: { id: string };
}

/** 工具调用记录（tool/call 建立，tool/result 消费） */
interface ToolCallRecord {
  name: string;
  args: string;
}

/** 不展示给用户的轮次错误码（底层传输/网络错误，对用户无意义，且常被重试兜住） */
const SILENT_TURN_ERROR_CODES = new Set(['STREAM_CLOSED']);

/**
 * 出站路由器：持有会话级状态，按事件类型分发到处理器。
 * 回合归属与投递目标委托给 TurnTracker（与提问/审批/发文件共享）。
 */
class OutboundRouter {
  private readonly buffers = new Map<string, OutboundBuffer>();
  private readonly toolCalls = new Map<string, ToolCallRecord>();
  private readonly streamAttempts = new Map<string, string>();
  /** 每会话本轮已声明的交付文件（deliverables/presented，轮末清空） */
  private readonly presentedFiles = new Map<string, PresentedFileRef[]>();
  /** 每会话已见过的 present callId（轮内去重，防事件重放导致重复投递） */
  private readonly presentedCalls = new Map<string, Set<string>>();
  /**
   * 每会话最后一笔在途文本发送（assistant/message 的 flush 是 fire-and-forget，
   * turn/end 时需等待其完成再投递交付文件，保证回复文本先于文件到达用户）。
   */
  private readonly pendingText = new Map<string, Promise<void>>();
  private readonly manager: SessionManager;
  private readonly bot: QQBotSender;
  private readonly config: ImQQBotConfig;
  private readonly logger: Logger;
  private readonly toolsRegistry: ToolsRegistryLike | undefined;
  private readonly deliverer: DeliverablesDelivererLike | undefined;
  private readonly tracker: TurnTracker;

  public constructor(
    manager: SessionManager,
    bot: QQBotSender,
    config: ImQQBotConfig,
    logger: Logger,
    tracker: TurnTracker,
    toolsRegistry: ToolsRegistryLike | undefined,
    deliverer?: DeliverablesDelivererLike,
  ) {
    this.manager = manager;
    this.bot = bot;
    this.config = config;
    this.logger = logger;
    this.tracker = tracker;
    this.toolsRegistry = toolsRegistry;
    this.deliverer = deliverer;
  }

  /** 事件分发入口 */
  public route(session: SessionLike, raw: RawSessionEvent): void {
    const sessionId = session.header.id;
    if (raw.type === 'turn/start') {
      if (this.tracker.begin(sessionId, eventTurn(raw.data))) this.resetTurnState(sessionId);
      return;
    }
    if (raw.type === 'user/message') {
      // 归属判定与 Web 镜像共用同一次分类结果
      const origin = this.tracker.note(sessionId, raw.data);
      this.mirrorUserMessage(sessionId, origin, raw.data);
      return;
    }
    if (!this.tracker.isCurrent(sessionId, raw.type, eventTurn(raw.data))) return;

    const event = parseEvent(raw);
    if (event === undefined) return;

    const plan = this.tracker.planFor(sessionId);
    if (event.type === 'turn/end') {
      this.tracker.end(sessionId);
      this.finishTurn(sessionId, event, plan);
      return;
    }
    if (plan === undefined) return;

    const record = this.manager.findBySessionId(sessionId);
    switch (event.type) {
      case 'assistant/chunk':
        this.appendChunk(sessionId, plan, event.text);
        break;
      case 'assistant/message':
        this.onMessage(sessionId, plan, event);
        break;
      case 'tool/call':
        if (record !== undefined) this.onToolCall(event);
        break;
      case 'tool/result':
        if (record !== undefined) this.onToolResult(record, plan, event);
        break;
      case 'deliverables/presented':
        this.onPresented(sessionId, event);
        break;
    }
  }

  /**
   * 实时流式帧入口（瞬态 agent/assistant-stream 事件）。
   *
   * attempt 语义：start 帧即新内容起点，无条件重置 buffer——清空旧 attempt 的
   * 累积文本但保留流式会话（QQ 流式 update 是全量替换，用户看到同一条消息被
   * 新内容重写）。不用 attemptId 对比判断"新 attempt"：agent replacement 后
   * attempt 计数重启、attemptId 可能与旧 agent 重叠（官方按 frame revision 的
   * gap 检测处理同一问题）。迟到帧（attemptId 不匹配）仍直接丢弃，防止旧
   * attempt 的尾巴混进新内容。
   */
  public routeStreamFrame(agentId: string, delta: StreamDelta): void {
    if (delta.kind === 'attempt-start') {
      this.streamAttempts.set(agentId, delta.attemptId);
      this.buffers.get(agentId)?.reset();
      return;
    }

    // text-delta：首帧未见 start 时自愈记录，迟到帧丢弃
    const current = this.streamAttempts.get(agentId);
    if (current === undefined) {
      this.streamAttempts.set(agentId, delta.attemptId);
    } else if (current !== delta.attemptId) {
      return;
    }

    // 已有 buffer：目标在创建时已拍下，直接追加，避免每帧重新解析
    const existing = this.buffers.get(agentId);
    if (existing !== undefined) {
      existing.append(delta.text);
      return;
    }
    const plan = this.tracker.planFor(agentId);
    if (plan === undefined) return;
    this.appendChunk(agentId, plan, delta.text);
  }

  /** 获取或创建会话 buffer 并追加增量。目标在创建时拍下，本回合内不再改。 */
  private appendChunk(sessionId: string, plan: DeliveryPlan, text: string): void {
    let buffer = this.buffers.get(sessionId);
    if (buffer === undefined) {
      buffer = new OutboundBuffer(
        plan.target,
        this.textSender(),
        this.config.textChunkLimit,
        this.logger,
        this.shouldStream(plan),
      );
      this.buffers.set(sessionId, buffer);
    }
    buffer.append(text);
  }

  /**
   * buffer 降级静态发送时用的发送器。
   *
   * wakeupFallback 关闭（默认）时原样返回适配器，行为与上游一致；
   * 开启时套一层，让流式降级后的静态分片也走同一套兜底（否则私聊开启流式时，
   * 真正的正文分片走了 buffer，兜底只会覆盖非流式文本）。
   */
  private textSender(): QQBotSender {
    if (this.config.wakeupFallback !== true) return this.bot;
    return {
      sendMarkdown: (target, content) => this.sendChunk(target, content, 'sendMarkdown'),
      openStream: (target) => this.bot.openStream(target),
    };
  }

  /** 被动回复且 c2c 有 msgId 才流式（群聊、主动推送均不流式） */
  private shouldStream(plan: DeliveryPlan): boolean {
    return !plan.proactive
      && this.config.streaming
      && plan.target.scope === 'c2c'
      && !!plan.target.msgId;
  }

  /** 新回合开始：丢弃上一轮残留的出站状态 */
  private resetTurnState(sessionId: string): void {
    this.buffers.get(sessionId)?.cancel();
    this.buffers.delete(sessionId);
    this.streamAttempts.delete(sessionId);
    this.presentedFiles.delete(sessionId);
    this.presentedCalls.delete(sessionId);
  }

  /**
   * Web/桌面端输入的用户消息镜像到 QQ（mirrorWeb，默认关闭）。
   *
   * 只镜像 TurnTracker 判定为 external 的来源：qq 来源在 QQ 端本来就有这条消息，
   * internal 来源是宿主/插件自己注入的（schedule、notice、已回答的提问、每轮注入
   * 的上下文、快捷按钮注入的编号与答案回显），镜像它们会刷屏或自激。
   * 目标走 planFor：external 回合已置 forceProactive，不复用被动回复窗口；
   * externalTurns 策略不允许推送、或不是 QQ 会话时 planFor 返回 undefined，自然跳过。
   */
  private mirrorUserMessage(
    sessionId: string,
    origin: MessageOrigin | undefined,
    data: Record<string, unknown>,
  ): void {
    if (this.config.mirrorWeb !== true || !isMirrorableOrigin(origin)) return;
    const plan = this.tracker.planFor(sessionId);
    if (plan === undefined) return;
    const text = extractUserMessageText(data);
    if (text === undefined) return; // 仅附件等非文本消息不镜像

    const mirror = formatMirrorWebText(text);
    // 排在会话内前一笔在途文本之后：上一轮回复还在飞时，镜像不应抢在它前面
    const prev = this.pendingText.get(sessionId) ?? Promise.resolve();
    this.trackText(sessionId, prev.then(() => this.send(plan.target, mirror, 'sendMirrorWeb')));
  }

  /** 完整 assistant 消息：有流式 buffer 则 flush，否则直接发送文本块 */
  private onMessage(sessionId: string, plan: DeliveryPlan, event: MessageEvent): void {
    const buffer = this.buffers.get(sessionId);
    if (buffer !== undefined && buffer.text.trim()) {
      this.trackText(sessionId, buffer.flush());
      this.buffers.delete(sessionId);
      return;
    }

    const textParts: string[] = [];
    for (const block of event.content) {
      if (block.type === 'text' && block.text) textParts.push(block.text);
    }
    const fullText = textParts.join('\n');
    if (!fullText.trim()) return;

    this.trackText(sessionId, this.send(plan.target, fullText, 'sendMarkdown'));
    this.buffers.delete(sessionId);
  }

  /** 记录每会话最后一笔在途文本任务（自身吞错：错误已由 send/flush 内部记录） */
  private trackText(sessionId: string, task: Promise<void>): void {
    this.pendingText.set(sessionId, task.catch(() => {}));
  }

  /** 工具调用：仅记录，不发送（避免刷屏，等待结果） */
  private onToolCall(event: ToolCallEvent): void {
    this.toolCalls.set(event.callId, { name: event.name, args: event.arguments });
  }

  /** 工具结果：错误始终发送，成功结果按开关 */
  private onToolResult(record: SessionRecord, plan: DeliveryPlan, event: ToolResultEvent): void {
    const call = this.toolCalls.get(event.callId);
    this.toolCalls.delete(event.callId);
    if (call === undefined) return;

    if (event.error === undefined && !this.config.showToolResults) return;

    const text = formatToolResult(
      call.name,
      call.args,
      event.raw as unknown as ToolResultData,
      this.toolsRegistry,
      record.agent,
    );
    if (!text) return;

    void this.send(plan.target, text, 'sendToolResult');
  }

  /** 收集本轮声明的交付文件：事件总是先于 turn/end 到达，轮末统一投递 */
  private onPresented(sessionId: string, event: DeliverablesPresentedEvent): void {
    if (this.config.sendFile?.sendPresentedFiles === false) return;
    let calls = this.presentedCalls.get(sessionId);
    if (calls === undefined) {
      calls = new Set();
      this.presentedCalls.set(sessionId, calls);
    }
    if (calls.has(event.callId)) return;
    calls.add(event.callId);
    const files = this.presentedFiles.get(sessionId) ?? [];
    files.push(...event.files);
    this.presentedFiles.set(sessionId, files);
  }

  /**
   * 轮次结束：文本先送达、再投递交付文件、最后清理状态，异常结束时告知用户。
   * 外层轮次失败不撤销已完成的声明（宿主契约），故失败轮的文件仍投递。
   */
  private finishTurn(sessionId: string, event: TurnEndEvent, plan: DeliveryPlan | undefined): void {
    const buffer = this.buffers.get(sessionId);
    // 文本 flush 可等待，保证回复先于交付文件到达用户
    let flushTask: Promise<void> = Promise.resolve();
    if (buffer !== undefined) {
      if (buffer.text.trim()) {
        flushTask = buffer.flush();
      } else {
        buffer.cancel();
      }
      this.buffers.delete(sessionId);
    }
    this.streamAttempts.delete(sessionId);
    const files = this.presentedFiles.get(sessionId) ?? [];
    this.presentedFiles.delete(sessionId);
    this.presentedCalls.delete(sessionId);
    // assistant/message 已在轮内先行发送的文本可能仍在途：与 turn/end 自身的 flush 一起等待
    const pending = this.pendingText.get(sessionId) ?? Promise.resolve();
    this.pendingText.delete(sessionId);

    const failure = extractTurnError(event.reason);
    void (async () => {
      await Promise.all([flushTask, pending]);
      if (plan !== undefined && failure !== undefined && !SILENT_TURN_ERROR_CODES.has(failure.code)) {
        await this.send(plan.target, `⚠️ 本轮异常结束\n\`${failure.code}\`: ${failure.message}`, 'sendTurnEndError');
      }
      if (files.length > 0 && this.deliverer !== undefined && plan !== undefined) {
        await this.deliverer.deliver(plan.target, files);
      }
      this.logger.debug(`im-qqbot: turn/end sessionId=${sessionId}`);
    })();
  }

  /** 统一发送：切分 + 逐 chunk 发送 + 错误记录 */
  private async send(target: ReplyTarget, text: string, tag: string): Promise<void> {
    const chunks = chunkMarkdownText(text, this.config.textChunkLimit);
    for (const chunk of chunks) {
      await this.sendChunk(target, chunk, tag);
    }
  }

  /**
   * 单条文本投递。
   *
   * wakeupFallback 关闭（默认）时与上游完全一致：只发一次，失败记 error 后放弃。
   * 开启时补两档失败路径兜底：
   *   1. 正常目标 —— 被动回复复用 msgId。注意上游 resolveReplyTarget 只在「发送
   *      之前」按限额/cache TTL 预判降级，发送阶段被平台拒绝时不会重试；
   *   2. 被动失败 → 置 forceProactive 去掉 msgId/eventId 主动重投一次；
   *   3. 仍失败且 c2c → sendWakeup（30 天唤醒窗口，平台限频，仅私聊支持）。
   */
  private async sendChunk(target: ReplyTarget, content: string, tag: string): Promise<void> {
    const fallback = this.config.wakeupFallback === true;
    try {
      await this.bot.sendMarkdown(target, content);
      return;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (!fallback) {
        this.logger.error(`im-qqbot: ${tag} failed: ${detail}`);
        return;
      }
      // 还有兜底档：先 warn，error 留到所有档都失败时记一次
      this.logger.warn(`im-qqbot: ${tag} failed: ${detail}`);
    }

    // 第二档：被动回复失败 → 主动投递（置 forceProactive，避免再粘上任何 msgId/eventId）
    if (target.msgId !== undefined || target.eventId !== undefined) {
      try {
        await this.bot.sendMarkdown({ scope: target.scope, targetId: target.targetId, forceProactive: true }, content);
        return;
      } catch (err) {
        this.logger.warn(`im-qqbot: ${tag} proactive retry failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 第三档：唤醒消息兜底（仅私聊）
    if (target.scope === 'c2c' && this.bot.sendWakeup !== undefined) {
      try {
        await this.bot.sendWakeup({ scope: target.scope, targetId: target.targetId }, content);
        return;
      } catch (err) {
        this.logger.warn(`im-qqbot: ${tag} wakeup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    this.logger.error(`im-qqbot: ${tag} failed after all fallbacks`);
  }
}

function eventTurn(data: Record<string, unknown>): number | undefined {
  return Number.isSafeInteger(data.turn) ? data.turn as number : undefined;
}

/** 按配置组装回合跟踪器（入站登记表需与 handleInbound 共享同一实例） */
export function createTurnTracker(
  manager: SessionManager,
  config: ImQQBotConfig,
  logger: Logger,
  inputs: QqInputRegistry = new QqInputRegistry(),
): TurnTracker {
  return new TurnTracker(
    manager,
    inputs,
    { externalTurns: config.proactiveDelivery?.externalTurns ?? 'c2c' },
    logger,
  );
}

/**
 * 创建出站事件处理器
 *
 * 返回 durable 事件与实时流式帧两个入口，分别注册到
 * ctx.on('session/event') 与 ctx.on('agent/assistant-stream', ..., { global: true })。
 * toolsRegistry 用于工具结果的结构化展示；deliverer 用于轮末投递 present 声明的交付文件；
 * tracker 为回合归属的单一事实源，需与提问/审批/发文件共享时由调用方注入。
 */
export function createOutboundHandler(
  manager: SessionManager,
  bot: QQBotSender,
  config: ImQQBotConfig,
  logger: Logger,
  toolsRegistry?: ToolsRegistryLike,
  deliverer?: DeliverablesDelivererLike,
  tracker?: TurnTracker,
): OutboundHandlers {
  const turns = tracker ?? createTurnTracker(manager, config, logger);
  const router = new OutboundRouter(manager, bot, config, logger, turns, toolsRegistry, deliverer);
  return {
    routeSessionEvent: (session, event) => router.route(session, event),
    routeStreamFrame: (agentId, delta) => router.routeStreamFrame(agentId, delta),
  };
}
