/**
 * QuestionChannel — 把 dsh 的 ask_user_question 桥接到 QQ 通道。
 *
 * 按 request.agent.id 路由公开的提问事件，旧宿主兼容 userQuestions.ask。
 * 非 QQ 会话委托宿主默认答复通道。
 *
 * 每个会话最多保留一个请求。发送时可取消，收到成功回执后才接受作答。
 * 多题逐题发送，取消、超时或会话回收使当前题失效。
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { InteractionEvent } from '@tencent-connect/qqbot-nodejs';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';
import { parseAnswer } from './answer-parser.ts';
import { buildKeyboard, formatQuestion } from './question-renderer.ts';
import { decodeButtonData } from './button-utils.ts';
import type { DeliveryTargetResolver } from '../transport/turn-tracker.ts';
import { continueDelivery, deliveryPart } from '../transport/delivery-context.ts';
import { deliveryKey } from '../transport/delivery-ledger.ts';
import type { QQBotSender } from '../transport/outbound-buffer.ts';

// ── 最小契约（对齐 dsh-user-questions，避免硬依赖） ──

export interface UserQuestionOption {
  label: string;
  description?: string;
}

export interface UserQuestion {
  id: string;
  header?: string;
  question: string;
  options?: UserQuestionOption[];
  multiSelect?: boolean;
  intent?: unknown;
}

export interface UserQuestionAnswer {
  id: string;
  selected: string[];
  custom?: string;
}

export interface UserQuestionRequest {
  questions: UserQuestion[];
  agent?: { id?: string };
  signal?: AbortSignal;
  wait?: { callId: string };
}

export interface UserQuestionResult {
  answers: UserQuestionAnswer[];
}

export interface UserQuestionsServiceLike {
  ask: (request: UserQuestionRequest) => Promise<UserQuestionResult>;
}

const QQ_QUESTION_ROUTES = Symbol.for('dsh-im-qqbot.question-routes');
type QuestionRoutes = { channels: Set<QuestionChannel>; restore: () => void };
type PatchedUserQuestions = UserQuestionsServiceLike & { [QQ_QUESTION_ROUTES]?: QuestionRoutes };

// ── 依赖接口（结构化，便于单测） ──

export interface QuestionSessionRecordLike {
  sessionKey: string;
  scope: ChatScope;
  replyTarget: ReplyTarget;
}

export interface QuestionChannelManagerLike {
  findBySessionId(sessionId: string): QuestionSessionRecordLike | undefined;
  getSessionRecord(scope: ChatScope, peerId: string): QuestionSessionRecordLike | undefined;
}

export type QuestionChannelSenderLike = Pick<QQBotSender, 'sendMarkdown'>;

export interface QuestionChannelConfigLike {
  requireMention: boolean;
  askTimeoutMs: number;
}

// ── 错误语义（对齐 dsh-user-questions 的 UserQuestionError code 约定） ──

/** 问答中断错误码：上层（如 plan-mode）按 code 区分「用户未作答」与普通发送/网络错误 */
const ASK_ABORTED = 'ASK_ABORTED';

class QuestionChannelError extends Error {
  public readonly code: string;

  public constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'QuestionChannelError';
  }
}

// ── 每会话状态机 ──

interface PendingEntry {
  record: QuestionSessionRecordLike;
  /** 提问时本回合的投递目标（首题与超时提示用；用户作答后的后续题被动回复其作答） */
  target: ReplyTarget;
  request: UserQuestionRequest;
  requestId: string;
  answerToken?: string;
  resolve: (result: UserQuestionResult) => void;
  reject: (err: Error) => void;
  onAbort?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  /** 当前正在问的问题在 request.questions 的下标 */
  index: number;
  /** 已收集的答案 */
  collected: UserQuestionAnswer[];
}

export class QuestionChannel {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly requestIds = new WeakMap<UserQuestionRequest, string>();
  private detach?: () => void;
  private readonly manager: QuestionChannelManagerLike;
  private readonly sender: QuestionChannelSenderLike;
  private readonly config: QuestionChannelConfigLike;
  private readonly logger: Logger;
  private readonly targets: DeliveryTargetResolver | undefined;

  /**
   * @param targets 回合投递目标解析（与出站共享）。缺省时按会话 replyTarget 被动回复。
   */
  public constructor(
    manager: QuestionChannelManagerLike,
    sender: QuestionChannelSenderLike,
    config: QuestionChannelConfigLike,
    logger: Logger,
    targets?: DeliveryTargetResolver,
  ) {
    this.manager = manager;
    this.sender = sender;
    this.config = config;
    this.logger = logger;
    this.targets = targets;
  }

  /**
   * 多个机器人共享宿主提问服务，每个会话仅由归属机器人的通道处理。
   */
  public install(ctx: { get(name: string): unknown }): void {
    if (this.detach) return;
    const uq = ctx.get('userQuestions') as PatchedUserQuestions | undefined;
    if (!uq) return;
    if (typeof uq.ask !== 'function') {
      this.logger.warn('im-qqbot: userQuestions service lacks ask() — QQ question channel disabled');
      return;
    }

    const routes = uq[QQ_QUESTION_ROUTES] ?? this.wrapHostQuestions(uq);
    routes.channels.add(this);
    this.detach = () => {
      routes.channels.delete(this);
      if (routes.channels.size === 0) routes.restore();
    };
    this.logger.info('im-qqbot: QQ question channel installed');
  }

  private wrapHostQuestions(uq: PatchedUserQuestions): QuestionRoutes {
    const original = uq.ask;
    const originalDescriptor = Object.getOwnPropertyDescriptor(uq, 'ask');
    const channels = new Set<QuestionChannel>();
    const ask = async function qqRoutedAsk(this: UserQuestionsServiceLike, request: UserQuestionRequest) {
      const sessionId = request?.agent?.id;
      if (sessionId) {
        let owner: { channel: QuestionChannel; record: QuestionSessionRecordLike } | undefined;
        for (const channel of channels) {
          const record = channel.manager.findBySessionId(sessionId);
          if (!record) continue;
          if (owner) return original.call(this, request);
          owner = { channel, record };
        }
        const target = owner?.channel.resolveTarget(sessionId, owner.record);
        if (owner && target) return owner.channel.askViaQQ(owner.record, target, request);
      }
      return original.call(this, request);
    };
    const routes = {
      channels,
      restore: () => {
        if (Object.getOwnPropertyDescriptor(uq, 'ask')?.value === ask) {
          if (originalDescriptor) Object.defineProperty(uq, 'ask', originalDescriptor);
          else Reflect.deleteProperty(uq, 'ask');
        }
        Reflect.deleteProperty(uq, QQ_QUESTION_ROUTES);
      },
    };
    uq.ask = ask;
    Object.defineProperty(uq, QQ_QUESTION_ROUTES, { value: routes, configurable: true });
    return routes;
  }

  public uninstall(): void {
    for (const entry of this.pending.values()) {
      this.rejectPending(entry, new QuestionChannelError('QQ question channel was unloaded before the user answered', ASK_ABORTED));
    }
    const detach = this.detach;
    this.detach = undefined;
    detach?.();
  }

  /** Answer the Host's scoped question event only for a live, owned QQ turn. */
  public routeRequest(request: UserQuestionRequest, next: () => Promise<UserQuestionResult>): Promise<UserQuestionResult> {
    const sessionId = request.agent?.id;
    if (!sessionId || request.questions.some(question => question.intent !== undefined)) return next();
    const record = this.manager.findBySessionId(sessionId);
    const target = record && this.resolveTarget(sessionId, record);
    return record && target ? this.askViaQQ(record, target, request) : next();
  }

  /** 会话回收时清理其待答问题，避免 pending 悬挂导致 Promise 与闭包泄漏 */
  public cancelPending(sessionKey: string): void {
    const entry = this.pending.get(sessionKey);
    if (entry) {
      this.rejectPending(entry, new QuestionChannelError('ask_user_question was cancelled before the user answered', ASK_ABORTED));
    }
  }

  /** 入站文本作答：该会话若有待答问题且本条消息有文本，解析为答案并推进 */
  public tryAnswer(scope: ChatScope, peerId: string, text: string): boolean {
    const record = this.manager.getSessionRecord(scope, peerId);
    if (!record) return false;
    const key = record.sessionKey;
    const entry = this.pending.get(key);
    if (!entry?.answerToken) return false;
    if (!text) return false; // 纯图片/表情等：继续等待，消息走常规流程

    const current = entry.request.questions[entry.index];
    if (!current) return false;
    const answer = parseAnswer(current, text);
    this.advance(entry, answer);
    return true;
  }

  /** 按钮点击作答：解码 button_data 选项下标，推进状态机 */
  public handleInteraction(event: InteractionEvent): boolean {
    const peerId = event.group_openid ?? event.user_openid;
    if (!peerId) return false;
    const scope: ChatScope = event.group_openid ? 'group' : 'c2c';
    const record = this.manager.getSessionRecord(scope, peerId);
    if (!record) return false;
    const entry = this.pending.get(record.sessionKey);
    if (!entry?.answerToken) return false;

    const data = event.data?.resolved?.button_data;
    if (!data) return false;
    const button = decodeButtonData(data);
    if (!button || button.t !== 'question') return false;
    const current = entry.request.questions[entry.index];
    if (!current) return false;
    if (button.q !== entry.answerToken) return false;
    const idx = button.i;
    const opts = current.options ?? [];
    if (!Number.isInteger(idx) || idx < 0 || idx >= opts.length) return false;

    this.advance(entry, { id: current.id, selected: [opts[idx]!.label] });
    return true;
  }

  /** 走 QQ 通道：发送首题 + 挂起 Promise，等待逐题作答 */
  private async askViaQQ(
    record: QuestionSessionRecordLike,
    target: ReplyTarget,
    request: UserQuestionRequest,
  ): Promise<UserQuestionResult> {
    const key = record.sessionKey;
    // 会话回收/取消可能在发送前发生：signal 已 abort 则直接失败，避免悬挂
    if (request.signal?.aborted) {
      throw new QuestionChannelError('ask_user_question was aborted before delivery', ASK_ABORTED);
    }
    if (!request.questions[0]) throw new Error('ask_user_question with empty questions');

    const requestId = this.requestId(request);
    const prev = this.pending.get(key);
    if (prev?.requestId === requestId) throw new Error('QQ question is already pending');
    if (prev) {
      this.rejectPending(prev, new QuestionChannelError('superseded by a new question', ASK_ABORTED));
    }

    return new Promise<UserQuestionResult>((resolve, reject) => {
      const entry: PendingEntry = { record, target, request, requestId, resolve, reject, index: 0, collected: [] };
      this.pending.set(key, entry);
      if (request.signal) {
        entry.onAbort = () => this.rejectPending(entry, new QuestionChannelError('ask_user_question was aborted before the user answered', ASK_ABORTED));
        request.signal.addEventListener('abort', entry.onAbort, { once: true });
      }
      void this.publish(entry, target);
    });
  }

  private async publish(entry: PendingEntry, target: ReplyTarget): Promise<void> {
    const key = entry.record.sessionKey;
    const answerToken = randomBytes(12).toString('hex');
    // Preserve the delivery key across retries and give each visible card its own token.
    const deliveryId = deliveryKey(entry.requestId, entry.index).slice(0, 24);
    try {
      await this.sendQuestion(entry.record, deliveryPart(target, 'question', deliveryId), entry.request.questions[entry.index]!, answerToken);
      if (this.pending.get(key) !== entry) return;
      entry.answerToken = answerToken;
      if (entry.timer === undefined) this.resetTimer(entry);
      this.logger.info(`im-qqbot: question sent to QQ, waiting for answer key=${key}`);
    } catch (error) {
      this.rejectPending(entry, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** 推进状态机：收集答案 → 有下一题则发送，否则 resolve 全部答案 */
  private advance(entry: PendingEntry, answer: UserQuestionAnswer): void {
    entry.collected.push(answer);
    entry.index += 1;

    if (entry.index < entry.request.questions.length) {
      entry.answerToken = undefined;
      this.resetTimer(entry);
      // 用户刚在 QQ 作答：后续题被动回复其作答（replyTarget 携带最新 msgId 候选）
      const sessionId = entry.request.agent?.id;
      const source = this.targets && sessionId ? this.targets.targetFor(sessionId) : entry.record.replyTarget;
      const target = source && continueDelivery(source, entry.record.replyTarget);
      if (target) void this.publish(entry, target);
      else this.rejectPending(entry, new Error('QQ question source is no longer authorized'));
      return;
    }

    if (this.take(entry)) {
      this.logger.info(`im-qqbot: question answered via QQ key=${entry.record.sessionKey}`);
      entry.resolve({ answers: entry.collected });
    }
  }

  private requestId(request: UserQuestionRequest): string {
    if (request.wait?.callId) return 'call:' + request.wait.callId;
    // Legacy Host requests have no call ID. Keep the identity for re-entry of the same request.
    const id = this.requestIds.get(request) ?? 'request:' + randomUUID();
    this.requestIds.set(request, id);
    return id;
  }

  /** 发送单个问题：优先带按钮，按钮发送失败降级纯文本 */
  private async sendQuestion(
    record: QuestionSessionRecordLike,
    target: ReplyTarget,
    question: UserQuestion,
    answerToken: string,
  ): Promise<void> {
    const hint = record.scope === 'group' && this.config.requireMention === true;
    const keyboard = buildKeyboard(question, answerToken);
    const plain = formatQuestion(question, hint, false);
    try {
      const submitted = await this.sender.sendMarkdown(
        target,
        keyboard ? formatQuestion(question, hint, true) : plain,
        keyboard ? { keyboard, fallbackText: plain } : undefined,
      );
      if (submitted === false) throw new Error('QQ question was not submitted again');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`im-qqbot: question send failed key=${record.sessionKey}: ${msg}`);
      throw new Error(`failed to deliver question to QQ: ${msg}`);
    }
  }

  private onTimeout(entry: PendingEntry): void {
    if (!this.take(entry)) return;
    entry.reject(new QuestionChannelError('ask_user_question timed out before the user answered', ASK_ABORTED));
    void this.sender.sendMarkdown(entry.target, '⚠️ 提问已超时，未收到回答。').catch(() => {});
  }

  /** 本回合的投递目标；未注入解析器时沿用会话 replyTarget */
  private resolveTarget(sessionId: string, record: QuestionSessionRecordLike): ReplyTarget | undefined {
    return this.targets ? this.targets.targetFor(sessionId) : record.replyTarget;
  }

  private resetTimer(entry: PendingEntry): void {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.onTimeout(entry), this.config.askTimeoutMs);
  }

  private rejectPending(entry: PendingEntry, error: Error): void {
    if (this.take(entry)) entry.reject(error);
  }

  private take(entry: PendingEntry): boolean {
    const key = entry.record.sessionKey;
    if (this.pending.get(key) !== entry) return false;
    this.pending.delete(key);
    clearTimeout(entry.timer);
    if (entry.onAbort) entry.request.signal?.removeEventListener('abort', entry.onAbort);
    return true;
  }
}
