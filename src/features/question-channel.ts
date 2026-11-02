import { AsyncLocalStorage } from 'node:async_hooks';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-tools';
import type { UserQuestionService } from '@deepseek-ai/dsh-user-questions';
import type { AskUserQuestionItem, AskUserQuestionOption, AskUserQuestionRequestEvent, AskUserQuestionAnswer, AskUserQuestionAnswerItem } from '@deepseek-ai/dsh-user-questions/types';
import { randomUUID } from 'node:crypto';
/**
 * QuestionChannel — 把 dsh 的 ask_user_question 桥接到 QQ 通道。
 *
 * 通过公开 `user-questions/request` waterfall 按原生轮次路由。
 * QQ 回答先持久化身份回执，其他来源交给宿主默认回答通道。
 *
 * 每会话一个显式状态机，三态语义：
 *   - 待答（pending 中）：等待当前题的回答
 *   - 逐题推进：多问题时一次问一题，答完一题再问下一题
 *   - 完成 / 中断（abort / 超时 / 会话回收）：reject(ASK_ABORTED)
 */
import type { InlineKeyboard, InteractionEvent } from '@tencent-connect/qqbot-nodejs';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';
import { parseAnswer } from './answer-parser.ts';
import { buildKeyboard, formatQuestion } from './question-renderer.ts';
import { decodeButtonData } from './button-utils.ts';

// ── 宿主公开问答协议 ──

export type UserQuestionOption = AskUserQuestionOption;
export type UserQuestion = AskUserQuestionItem;
export type UserQuestionAnswer = AskUserQuestionAnswerItem;
export type UserQuestionRequest = AskUserQuestionRequestEvent;
export type UserQuestionResult = AskUserQuestionAnswer;
export type QuestionChannelContext = Pick<Context, 'on' | 'get'>;

export interface HumanReplyReceiptInput {
  sessionId: string;
  turn: number;
  callId: string;
  nonce: string;
  actor: string;
  answer: UserQuestionResult;
}

interface QuestionIdentity {
  sessionId: string;
  turn: number;
  callId: string;
}

interface ToolQuestionContext {
  readonly agent: NonNullable<UserQuestionRequest['agent']>;
  readonly identity: QuestionIdentity;
  readonly signal: AbortSignal;
}

function turnOf(agent: NonNullable<UserQuestionRequest['agent']>): number | undefined {
  const events = agent.session.snapshotEvents();
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== 'turn/start') continue;
    const turn = event.data.turn;
    return Number.isSafeInteger(turn) && turn >= 0 ? turn : undefined;
  }
  return undefined;
}

function identityOf(request: UserQuestionRequest, execution?: ToolQuestionContext): QuestionIdentity | undefined {
  const agent = request.agent;
  if (!agent) return undefined;
  const turn = turnOf(agent);
  if (turn === undefined) return undefined;
  const callId = request.wait?.callId ?? (
    execution?.agent === agent && execution.identity.turn === turn && !execution.signal.aborted
      ? execution.identity.callId : undefined
  );
  return callId ? { sessionId: agent.id, callId, turn } : undefined;
}

// ── 依赖接口（结构化，便于单测） ──

export interface QuestionSessionRecordLike {
  sessionKey: string;
  scope: ChatScope;
  replyTarget: ReplyTarget;
}

export interface QuestionChannelManagerLike {
  canAnswer?(scope: ChatScope, peerId: string, actor?: string): boolean;
  interactionRecord(sessionId: string, turn?: number): QuestionSessionRecordLike | undefined;
  recordHumanReply(input: HumanReplyReceiptInput): Promise<void>;
  getSessionRecord(scope: ChatScope, peerId: string): QuestionSessionRecordLike | undefined;
}

export interface QuestionChannelSenderLike {
  sendMarkdown(target: ReplyTarget, content: string, opts?: { keyboard?: InlineKeyboard }): Promise<unknown>;
}

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
  state: 'waiting' | 'saving';
  nonce: string;
  identity: QuestionIdentity;
  record: QuestionSessionRecordLike;
  request: UserQuestionRequest;
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
  private readonly toolCalls = new AsyncLocalStorage<ToolQuestionContext>();
  private readonly removeListeners: Array<() => boolean> = [];
  private readonly manager: QuestionChannelManagerLike;
  private readonly sender: QuestionChannelSenderLike;
  private readonly config: QuestionChannelConfigLike;
  private readonly logger: Logger;

  public constructor(
    manager: QuestionChannelManagerLike,
    sender: QuestionChannelSenderLike,
    config: QuestionChannelConfigLike,
    logger: Logger,
  ) {
    this.manager = manager;
    this.sender = sender;
    this.config = config;
    this.logger = logger;
  }

  public install(ctx: QuestionChannelContext): void {
    if (this.removeListeners.length) return;
    this.removeListeners.push(ctx.on('tools/execute', async (exec, next) => {
      if (exec.name !== 'ask_user_question' || !exec.agent) return next();
      const turn = turnOf(exec.agent);
      if (turn === undefined) return next();
      const lifetime = new AbortController();
      const execution: ToolQuestionContext = { agent: exec.agent,
        identity: { sessionId: exec.agent.id, callId: exec.callId, turn },
        signal: AbortSignal.any([exec.signal, lifetime.signal]) };
      try { return await this.toolCalls.run(execution, next); }
      finally { lifetime.abort(); }
    }, { global: true, prepend: true }));
    this.removeListeners.push(ctx.on('user-questions/request', (request, nextAnswerer) => {
      const execution = this.toolCalls.getStore();
      const identity = identityOf(request, execution);
      const record = identity ? this.manager.interactionRecord(identity.sessionId, identity.turn) : undefined;
      if (!identity || !record) return nextAnswerer();
      const effective = execution && execution.agent === request.agent
        ? { ...request, signal: request.signal ? AbortSignal.any([request.signal, execution.signal]) : execution.signal }
        : request;
      return this.answerRequest(ctx, record, effective, identity, nextAnswerer);
    }, { global: true, prepend: true }));
    this.logger.info('im-qqbot: QQ question channel installed');
  }

  public uninstall(): void {
    for (const remove of this.removeListeners.splice(0)) remove();
    for (const [, entry] of this.pending) {
      this.clearTimer(entry);
      this.removeAbort(entry);
      entry.reject(new QuestionChannelError('QQ question channel was unloaded before the user answered', ASK_ABORTED));
    }
    this.pending.clear();
  }

  /** 会话回收时清理其待答问题，避免 pending 悬挂导致 Promise 与闭包泄漏 */
  public cancelPending(sessionKey: string): void {
    const entry = this.pending.get(sessionKey);
    if (!entry) return;
    this.pending.delete(sessionKey);
    this.clearTimer(entry);
    this.removeAbort(entry);
    entry.reject(new QuestionChannelError('ask_user_question was cancelled before the user answered', ASK_ABORTED));
  }

  /** Classify admitted text before command/answer parsing without consuming it. */
  public canAcceptText(scope: ChatScope, peerId: string, text: string, actor?: string): boolean {
    if (!text.trim() || !actor || this.manager.canAnswer && !this.manager.canAnswer(scope, peerId, actor)) return false;
    const record = this.manager.getSessionRecord(scope, peerId);
    const entry = record ? this.pending.get(record.sessionKey) : undefined;
    return !!entry && entry.state === 'waiting' && !!entry.request.questions[entry.index];
  }

  /** 入站文本作答：该会话若有待答问题且本条消息有文本，解析为答案并推进 */
  public tryAnswer(scope: ChatScope, peerId: string, text: string, actor?: string): boolean {
    if (this.manager.canAnswer && !this.manager.canAnswer(scope, peerId, actor)) return false;
    const record = this.manager.getSessionRecord(scope, peerId);
    if (!record) return false;
    const key = record.sessionKey;
    const entry = this.pending.get(key);
    if (!entry || entry.state !== 'waiting') return false;
    if (!text || !actor) return false; // 纯图片/表情等：继续等待，消息走常规流程

    const current = entry.request.questions[entry.index];
    if (!current) return false;
    const answer = parseAnswer(current, text);
    this.advance(entry, key, answer, actor);
    return true;
  }

  /** 按钮点击作答：解码 button_data 选项下标，推进状态机 */
  public handleInteraction(event: InteractionEvent): boolean {
    const peerId = event.group_openid ?? event.user_openid;
    if (!peerId) return false;
    const scope: ChatScope = event.group_openid ? 'group' : 'c2c';
    const actor = event.group_member_openid ?? event.user_openid;
    if (!actor || this.manager.canAnswer && !this.manager.canAnswer(scope, peerId, actor)) return false;
    const record = this.manager.getSessionRecord(scope, peerId);
    if (!record) return false;
    const entry = this.pending.get(record.sessionKey);
    if (!entry || entry.state !== 'waiting') return false;

    const data = event.data?.resolved?.button_data;
    if (!data) return false;
    const button = decodeButtonData(data);
    if (!button || button.t !== 'question') return false;
    const current = entry.request.questions[entry.index];
    if (!current) return false;
    // 校验按钮归属题：旧题按钮在新题推进后被点击（误点/延迟事件），
    // 其 q 不等于当前题 id，直接忽略，避免错位映射到当前题选项。
    if (button.q !== `${entry.nonce}:${current.id}`) return false;
    const idx = button.i;
    const opts = current.options ?? [];
    if (idx < 0 || idx >= opts.length) return false;

    const option = opts[idx];
    if (!option) return false;
    this.advance(entry, record.sessionKey, { id: current.id, selected: [option.label] }, actor);
    return true;
  }

  private async answerRequest(
    ctx: QuestionChannelContext,
    record: QuestionSessionRecordLike,
    request: UserQuestionRequest,
    identity: QuestionIdentity,
    next: () => Promise<UserQuestionResult>,
  ): Promise<UserQuestionResult> {
    if (!request.wait?.timed || !request.agent) return this.askViaQQ(record, request, identity);
    const service: UserQuestionService | undefined = ctx.get('userQuestions');
    if (!service?.attachWait) return next();
    const lifetime = new AbortController();
    const signal = request.signal ? AbortSignal.any([request.signal, lifetime.signal]) : lifetime.signal;
    const claim = service.attachWait(request.agent, request.wait.callId, signal)[Symbol.asyncIterator]();
    try {
      const first = await claim.next();
      if (first.done) return next();
      return await this.askViaQQ(record, { ...request, signal }, identity);
    } finally {
      lifetime.abort();
      await claim.return?.();
    }
  }

  /** 走 QQ 通道：发送首题 + 挂起 Promise，等待逐题作答 */
  private async askViaQQ(record: QuestionSessionRecordLike, request: UserQuestionRequest, identity: QuestionIdentity): Promise<UserQuestionResult> {
    const key = record.sessionKey;
    // 会话回收/取消可能在发送前发生：signal 已 abort 则直接失败，避免悬挂
    if (request.signal?.aborted) {
      throw new QuestionChannelError('ask_user_question was aborted before delivery', ASK_ABORTED);
    }
    // 同会话已有待答问题（理论上不会发生：回合阻塞在第一个问题上）→ 拒绝旧的
    const prev = this.pending.get(key);
    if (prev) {
      this.pending.delete(key);
      this.clearTimer(prev);
      this.removeAbort(prev);
      prev.reject(new QuestionChannelError('superseded by a new question', ASK_ABORTED));
    }

    const first = request.questions[0];
    if (!first) throw new Error('ask_user_question with empty questions');

    const nonce = randomUUID().slice(0, 8);
    return new Promise<UserQuestionResult>((resolve, reject) => {
      const entry: PendingEntry = { state: 'waiting', record, request, identity, resolve, reject, index: 0, collected: [], nonce };
      if (request.signal) {
        const onAbort = (): void => {
          if (this.pending.get(key) !== entry) return;
          this.pending.delete(key);
          this.clearTimer(entry);
          reject(new QuestionChannelError('ask_user_question was aborted before the user answered', ASK_ABORTED));
        };
        entry.onAbort = onAbort;
        request.signal.addEventListener('abort', onAbort, { once: true });
      }
      entry.timer = setTimeout(() => this.onTimeout(key), this.config.askTimeoutMs);
      this.pending.set(key, entry);
      if (request.signal?.aborted) { this.cancelPending(key); return; }
      void this.sendQuestion(record, { ...first, id: `${nonce}:${first.id}` }).catch(error => {
        if (this.pending.get(key) !== entry) return;
        this.pending.delete(key); this.clearTimer(entry); this.removeAbort(entry);
        entry.reject(error);
      });
      this.logger.info(`im-qqbot: question sent to QQ, waiting for answer key=${key}`);
    });
  }

  /** 推进状态机：收集答案 → 有下一题则发送，否则 resolve 全部答案 */
  private advance(entry: PendingEntry, key: string, answer: UserQuestionAnswer, actor: string): void {
    const current = this.manager.interactionRecord(entry.identity.sessionId, entry.identity.turn);
    if (!current || current.sessionKey !== key) {
      this.cancelPending(key);
      return;
    }
    entry.collected.push(answer);
    entry.index += 1;

    if (entry.index < entry.request.questions.length) {
      const next = entry.request.questions[entry.index]!;
      this.resetTimer(entry, key);
      void this.sendQuestion(entry.record, { ...next, id: `${entry.nonce}:${next.id}` }).catch((err) => {
        if (this.pending.get(key) !== entry) return;
        this.pending.delete(key);
        this.clearTimer(entry);
        this.removeAbort(entry);
        entry.reject(err instanceof Error ? err : new Error(String(err)));
      });
      return;
    }

    entry.state = 'saving';
    this.clearTimer(entry);
    const result: UserQuestionResult = { answers: entry.collected };
    void this.manager.recordHumanReply({ ...entry.identity, nonce: entry.nonce, actor, answer: result })
      .then(() => {
        if (this.pending.get(key) !== entry) return;
        if (entry.request.signal?.aborted) throw new QuestionChannelError('ask_user_question was aborted while saving the reply', ASK_ABORTED);
        this.pending.delete(key);
        this.removeAbort(entry);
        this.logger.info(`im-qqbot: question answered via QQ key=${key}`);
        entry.resolve(result);
      })
      .catch(error => {
        if (this.pending.get(key) !== entry) return;
        this.pending.delete(key);
        this.removeAbort(entry);
        entry.reject(error instanceof Error ? error : new Error(String(error)));
      });
  }

  /** 发送单个问题：优先带按钮，按钮发送失败降级纯文本 */
  private async sendQuestion(record: QuestionSessionRecordLike, question: UserQuestion): Promise<void> {
    const hint = record.scope === 'group' && this.config.requireMention === true;
    const keyboard = buildKeyboard(question);
    try {
      if (keyboard) {
        try {
          await this.sender.sendMarkdown(record.replyTarget, formatQuestion(question, hint, true), { keyboard });
          return;
        } catch (err) {
          this.logger.warn(`im-qqbot: keyboard send failed, fallback to text: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      await this.sender.sendMarkdown(record.replyTarget, formatQuestion(question, hint, false));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`im-qqbot: question send failed key=${record.sessionKey}: ${msg}`);
      throw new Error(`failed to deliver question to QQ: ${msg}`);
    }
  }

  private onTimeout(key: string): void {
    const entry = this.pending.get(key);
    if (!entry) return;
    this.pending.delete(key);
    this.removeAbort(entry);
    entry.timer = undefined;
    void this.sender.sendMarkdown(entry.record.replyTarget, '⚠️ 提问已超时，未收到回答。').catch(() => {});
    entry.reject(new QuestionChannelError('ask_user_question timed out before the user answered', ASK_ABORTED));
  }

  private resetTimer(entry: PendingEntry, key: string): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => this.onTimeout(key), this.config.askTimeoutMs);
  }

  private clearTimer(entry: PendingEntry): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
  }

  private removeAbort(entry: PendingEntry): void {
    if (entry.onAbort && entry.request.signal) {
      entry.request.signal.removeEventListener('abort', entry.onAbort);
    }
  }
}
