/**
 * QuestionChannel — 把 dsh 的 ask_user_question 桥接到 QQ 通道。
 *
 * 接入方式：包装 `userQuestions.ask`（而非 registerProvider），按 `request.agent.id`
 * 路由到 QQ 会话；非 QQ 会话委托宿主默认 provider（如 Web 弹出框），多通道共存。
 *
 * 每会话一个显式状态机，三态语义：
 *   - 待答（pending 中）：等待当前题的回答
 *   - 逐题推进：多问题时一次问一题，答完一题再问下一题
 *   - 完成 / 中断（abort / 超时 / 会话回收）：reject(ASK_ABORTED)
 *
 * 双端同步（questionSync，生产默认开启）：
 *   - QQ 会话（含无活跃记录、仍能按会话解析出 QQ 地址的——如网页端继续的
 *     QQ 会话、回收或宿主重启后的会话）提问时**双端出现**：QQ 逐题发文本/按钮，
 *     Web 照常弹卡片；整个请求粒度竞速，先完成全部题的一端定案
 *     （QQ 先答 → 中止 signal 撤下 Web 卡片；Web 先答 → 释放 QQ 待答登记，
 *     QQ 端输入回归常规消息流）。
 *   - QQ 投递失败/超时不影响 Web 作答；Web provider 失败不影响 QQ 作答；
 *     两端都失败才整体拒绝。
 *   - 答案回显：定案答案作为用户消息写回会话日志（不改工具结果语义）。
 *   - 关闭时（单测直构默认关闭）保持 QQ 单端行为。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { InlineKeyboard, InteractionEvent } from '@tencent-connect/qqbot-nodejs';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';
import { parseAnswer } from './answer-parser.ts';
import { buildKeyboard, formatQuestion } from './question-renderer.ts';
import { decodeButtonData } from './button-utils.ts';
import type { DeliveryTargetResolver } from '../transport/turn-tracker.ts';

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
}

export interface UserQuestionResult {
  answers: UserQuestionAnswer[];
}

export interface UserQuestionsServiceLike {
  ask: (request: UserQuestionRequest) => Promise<UserQuestionResult>;
  __qqQuestionPatched?: boolean;
}

// ── 依赖接口（结构化，便于单测） ──

/**
 * 能把消息写回会话日志的 agent：只用到 `inject`（记录进当前回合的下一 step，
 * 不唤起新回合）。宿主 DshAgent 未在类型上声明该能力，故按可选结构化接口判空。
 */
export interface InjectableAgent {
  inject?(message: unknown): unknown;
}

export interface QuestionSessionRecordLike {
  sessionKey: string;
  scope: ChatScope;
  replyTarget: ReplyTarget;
  /** 会话 id（答案回显定位活跃记录用；活跃 SessionRecord 天然携带） */
  sessionId?: string;
  /** 活跃记录的宿主 agent（答案回显写日志用；运行时才判定是否支持 inject） */
  agent?: unknown;
}

export interface QuestionChannelManagerLike {
  findBySessionId(sessionId: string): QuestionSessionRecordLike | undefined;
  getSessionRecord(scope: ChatScope, peerId: string): QuestionSessionRecordLike | undefined;
  /**
   * 按会话解析 QQ 投递地址（prefs 的 sessionId 反向索引）。
   * 桥接会话（无活跃记录）用；缺省时不做桥接。
   */
  deliveryAddress?(sessionId: string): ReplyTarget | undefined;
}

/** 入站登记（QqInputRegistry 的最小契约）：注入的用户消息必须登记，出站才认领回合归属 */
export interface QuestionChannelInputsLike {
  register(messageId: string): void;
}

export interface QuestionChannelSenderLike {
  sendMarkdown(target: ReplyTarget, content: string, opts?: { keyboard?: InlineKeyboard }): Promise<unknown>;
}

export interface QuestionChannelConfigLike {
  requireMention: boolean;
  askTimeoutMs: number;
  /**
   * 双端同步：QQ 会话的提问同时出现在 QQ 与 Web，先答先得。
   * 未设置（如单测直接构造）→ 关闭，保持 QQ 单端行为；生产配置 schema 默认 true。
   */
  questionSync?: boolean;
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

/** 问答中断错误（本通道自己的 code 语义，供竞速时区分「预期释放」与投递故障） */
function isAskAborted(err: unknown): boolean {
  return err instanceof QuestionChannelError && err.code === ASK_ABORTED;
}

/**
 * 桥接会话（无活跃 SessionRecord）的待答登记键：由 scope+peerId 派生。
 * 入站作答不需要 SessionRecord 也能反查（QQ 侧记录不存在时的桥接路径）。
 */
function bridgePendingKey(scope: ChatScope, peerId: string): string {
  return `bridge:${scope}:${peerId}`;
}

/** 取 agent 的 inject 能力（绑定后调用）；不支持时返回 undefined（fail-soft） */
function injectableOf(agent: unknown): ((message: unknown) => unknown) | undefined {
  if (agent === null || typeof agent !== 'object') return undefined;
  const inject = (agent as InjectableAgent).inject;
  return typeof inject === 'function' ? inject.bind(agent) : undefined;
}

/**
 * 把作答结果渲染成可读文本（答案回显用）：
 * 单题直接给答案值；多题时逐行「问题头: 答案」。空答案返回 undefined。
 */
export function renderAnswerText(
  questions: readonly UserQuestion[],
  result: UserQuestionResult,
): string | undefined {
  const lines: string[] = [];
  for (const ans of result.answers) {
    const parts: string[] = [];
    if (ans.selected.length > 0) parts.push(...ans.selected);
    if (ans.custom) parts.push(ans.custom);
    const value = parts.join('；');
    if (!value) continue;
    if (result.answers.length > 1) {
      const q = questions.find((x) => x.id === ans.id);
      lines.push(`${q?.header ?? q?.question ?? ans.id}: ${value}`);
    } else {
      lines.push(value);
    }
  }
  const text = lines.join('\n').trim();
  return text || undefined;
}

interface PendingEntry {
  record: QuestionSessionRecordLike;
  /** 提问时本回合的投递目标（首题与超时提示用；用户作答后的后续题被动回复其作答） */
  target: ReplyTarget;
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
  private uq?: UserQuestionsServiceLike;
  private origAsk?: UserQuestionsServiceLike['ask'];
  private readonly manager: QuestionChannelManagerLike;
  private readonly sender: QuestionChannelSenderLike;
  private readonly config: QuestionChannelConfigLike;
  private readonly logger: Logger;
  private readonly targets: DeliveryTargetResolver | undefined;
  private readonly inputs: QuestionChannelInputsLike | undefined;

  /**
   * @param targets 回合投递目标解析（与出站共享）。缺省时按会话 replyTarget 被动回复。
   * @param inputs 入站登记（与入站/出站共享）。答案回显注入的用户消息必须登记，
   *   出站才把它认领为本回合的 QQ 输入，不会误判成外部回合。缺省时跳过登记。
   */
  public constructor(
    manager: QuestionChannelManagerLike,
    sender: QuestionChannelSenderLike,
    config: QuestionChannelConfigLike,
    logger: Logger,
    targets?: DeliveryTargetResolver,
    inputs?: QuestionChannelInputsLike,
  ) {
    this.manager = manager;
    this.sender = sender;
    this.config = config;
    this.logger = logger;
    this.targets = targets;
    this.inputs = inputs;
  }

  /**
   * 包装 userQuestions.ask：QQ 会话走 QQ 通道（questionSync 时双端同步），
   * 其余委托原实现。幂等（已 patch 则跳过）；服务缺失或 ask 非函数时优雅禁用。
   */
  public install(ctx: { get(name: string): unknown }): void {
    const uq = ctx.get('userQuestions') as UserQuestionsServiceLike | undefined;
    if (!uq || uq.__qqQuestionPatched) return;
    if (typeof uq.ask !== 'function') {
      this.logger.warn('im-qqbot: userQuestions service lacks ask() — QQ question channel disabled');
      return;
    }

    const self = this;
    this.origAsk = uq.ask.bind(uq);
    uq.ask = async function qqRoutedAsk(request: UserQuestionRequest): Promise<UserQuestionResult> {
      const sessionId = request?.agent?.id;
      const record = sessionId ? self.manager.findBySessionId(sessionId) : undefined;
      if (record && sessionId) {
        // 本回合按策略不投递到 QQ（如桌面发起的群会话回合）→ 交回宿主默认界面
        const target = self.resolveTarget(sessionId, record);
        if (!target) return self.origAsk!(request);
        return self.config.questionSync === true
          ? self.askDual(record, target, request, self.origAsk!)
          : self.askViaQQ(record, target, request);
      }
      // 桥接：无活跃记录，但按会话仍能解析出 QQ 投递地址（网页端继续的 QQ 会话、
      // 会话已回收或宿主重启）→ 问题同样双端出现
      if (self.config.questionSync === true && sessionId) {
        const bridged = self.bridgeTarget(sessionId);
        if (bridged) return self.askDual(bridged.record, bridged.target, request, self.origAsk!);
      }
      return self.origAsk!(request);
    };
    Object.defineProperty(uq, '__qqQuestionPatched', { value: true, configurable: true, enumerable: false });
    this.uq = uq;
    this.logger.info('im-qqbot: QQ question channel installed');
  }

  public uninstall(): void {
    if (this.uq && this.origAsk) {
      this.uq.ask = this.origAsk;
      delete this.uq.__qqQuestionPatched;
      this.uq = undefined;
      this.origAsk = undefined;
    }
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

  /** 入站文本作答：该会话若有待答问题且本条消息有文本，解析为答案并推进 */
  public tryAnswer(scope: ChatScope, peerId: string, text: string): boolean {
    const found = this.findPending(scope, peerId);
    if (!found) return false;
    if (!text) return false; // 纯图片/表情等：继续等待，消息走常规流程

    const current = found.entry.request.questions[found.entry.index];
    if (!current) return false;
    const answer = parseAnswer(current, text);
    this.advance(found.entry, found.key, answer);
    return true;
  }

  /** 按钮点击作答：解码 button_data 选项下标，推进状态机 */
  public handleInteraction(event: InteractionEvent): boolean {
    const peerId = event.group_openid ?? event.user_openid;
    if (!peerId) return false;
    const scope: ChatScope = event.group_openid ? 'group' : 'c2c';
    const found = this.findPending(scope, peerId);
    if (!found) return false;
    const entry = found.entry;

    const data = event.data?.resolved?.button_data;
    if (!data) return false;
    const button = decodeButtonData(data);
    if (!button || button.t !== 'question') return false;
    const current = entry.request.questions[entry.index];
    if (!current) return false;
    // 校验按钮归属题：旧题按钮在新题推进后被点击（误点/延迟事件），
    // 其 q 不等于当前题 id，直接忽略，避免错位映射到当前题选项。
    if (button.q !== current.id) return false;
    const idx = button.i;
    const opts = current.options ?? [];
    if (idx < 0 || idx >= opts.length) return false;

    this.advance(entry, found.key, { id: current.id, selected: [opts[idx]!.label] });
    return true;
  }

  /**
   * 双端提问：同一提问同时投到 QQ（逐题文本/按钮）与 Web（宿主原 provider），
   * 整个请求粒度竞速，先完成全部题的一端定案，另一端随即撤下：
   *   - QQ 先答 → 中止传给 Web 的 signal（宿主 provider 收到 abort 即撤下卡片）；
   *   - Web 先答 → 释放 QQ 待答登记（之后的 QQ 文本/点击回归常规消息流）。
   * QQ 投递失败/超时不影响 Web 端作答；Web provider 失败不影响 QQ 端作答；
   * 两端都失败才整体拒绝。
   */
  public async askDual(
    record: QuestionSessionRecordLike,
    target: ReplyTarget,
    request: UserQuestionRequest,
    origAsk: UserQuestionsServiceLike['ask'],
  ): Promise<UserQuestionResult> {
    // 链接中止：回合中止 → 撤 Web 卡片；QQ 先答 → 撤 Web 卡片
    const linked = new AbortController();
    const forwardAbort = (): void => linked.abort();
    if (request.signal) {
      if (request.signal.aborted) linked.abort();
      else request.signal.addEventListener('abort', forwardAbort, { once: true });
    }
    const detachForward = (): void => {
      request.signal?.removeEventListener('abort', forwardAbort);
    };

    const webPromise = origAsk({ ...request, signal: linked.signal });
    const qqPromise = this.askViaQQ(record, target, request).catch((err: unknown) => {
      // 另一端已定案时 QQ 侧的 ASK_ABORTED 是预期释放，不是投递故障
      if (!isAskAborted(err)) {
        this.logger.warn(`im-qqbot: QQ question unavailable, web only: ${err instanceof Error ? err.message : String(err)}`);
      }
      return undefined;
    });

    return new Promise<UserQuestionResult>((resolve, reject) => {
      let settled = false;
      let qqAlive = true;
      let webAlive = true;
      let webError: unknown;

      const failIfBothDead = (): void => {
        if (settled || qqAlive || webAlive) return;
        settled = true;
        detachForward();
        reject(webError instanceof Error ? webError : new Error('failed to ask the user on both QQ and Web'));
      };

      void qqPromise.then((qqResult) => {
        if (qqResult === undefined) {
          qqAlive = false;
          failIfBothDead();
          return;
        }
        if (settled) return;
        settled = true;
        detachForward();
        linked.abort(); // 宿主 provider 广播 question/resolved(cancelled)，Web 卡片撤下
        webPromise.catch(() => undefined); // 吞掉随之而来的 ASK_ABORTED
        this.echoAnswer(record, request, qqResult, 'qq');
        resolve(qqResult);
      });

      void webPromise.then((webResult) => {
        if (settled) return;
        settled = true;
        detachForward();
        this.releaseQqPending(record.sessionKey);
        this.echoAnswer(record, request, webResult, 'web');
        resolve(webResult);
      }).catch((err: unknown) => {
        webAlive = false;
        webError = err;
        failIfBothDead();
      });
    });
  }

  /** Web 先作答后放弃 QQ 端等待：移除待答登记，QQ 文本/点击回归常规消息流 */
  private releaseQqPending(key: string): void {
    const entry = this.pending.get(key);
    if (!entry) return;
    this.pending.delete(key);
    this.clearTimer(entry);
    this.removeAbort(entry);
    entry.reject(new QuestionChannelError('ask_user_question was released: answered on the other side', ASK_ABORTED));
    this.logger.info(`im-qqbot: QQ pending question released (answered elsewhere) key=${key}`);
  }

  /**
   * 答案回显：把定案答案作为用户消息写回会话日志（`agent.inject`——记录进
   * 当前回合的下一 step，不唤起新回合）。答案此前只存在于工具结果里，两端
   * 转录都看不到「用户说了什么」；回显后 Web 转录出现这条答案气泡。
   *
   * 注入的消息按 Message.id 登记为本插件入站：出站据此认领回合归属，
   * 回复仍走常规（被动）路径，不会被判成外部回合再推回 QQ。
   * Fail-soft：agent 缺失或不支持 inject 时静默跳过，注入失败只记日志，
   * 绝不影响答案本身。
   */
  private echoAnswer(
    record: QuestionSessionRecordLike,
    request: UserQuestionRequest,
    result: UserQuestionResult,
    origin: 'qq' | 'web',
  ): void {
    try {
      const text = renderAnswerText(request.questions, result);
      if (!text) return;
      // 活跃记录优先；桥接会话没有 agent，跳过回显（答案仍照常定案）
      const live = record.sessionId ? this.manager.findBySessionId(record.sessionId) : undefined;
      const inject = injectableOf(live?.agent ?? record.agent);
      if (!inject) return;
      const message = createUserMessage({
        content: [{ type: 'text' as const, text }],
        source: { kind: 'user' as const },
      });
      this.inputs?.register(String(message.id));
      inject(message);
      this.logger.info(`im-qqbot: answer echoed into session log origin=${origin} text="${text.slice(0, 60)}"`);
    } catch (err) {
      this.logger.warn(`im-qqbot: answer echo failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * 桥接投递目标：会话没有活跃记录时，按会话解析 QQ 地址（prefs 的 sessionId
   * 反向索引）。有回合跟踪时再套一层策略判定——本回合按策略不投递到 QQ
   * （如 externalTurns=off），就不要把问题单边推到 QQ。
   */
  private bridgeTarget(sessionId: string): { record: QuestionSessionRecordLike; target: ReplyTarget } | undefined {
    const address = this.manager.deliveryAddress?.(sessionId);
    if (!address) return undefined;
    const target = this.targets ? this.targets.targetFor(sessionId) : address;
    if (!target) return undefined;
    const record: QuestionSessionRecordLike = {
      sessionKey: bridgePendingKey(address.scope, address.targetId),
      sessionId,
      scope: address.scope,
      replyTarget: target,
    };
    return { record, target };
  }

  /**
   * 该对端的待答登记：先按活跃记录的规范键，再退回桥接键
   * （桥接会话没有 SessionRecord，登记键只能由 scope+peerId 派生）。
   */
  private findPending(scope: ChatScope, peerId: string): { key: string; entry: PendingEntry } | undefined {
    const record = this.manager.getSessionRecord(scope, peerId);
    if (record) {
      const entry = this.pending.get(record.sessionKey);
      if (entry) return { key: record.sessionKey, entry };
    }
    const key = bridgePendingKey(scope, peerId);
    const entry = this.pending.get(key);
    return entry === undefined ? undefined : { key, entry };
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

    await this.sendQuestion(record, target, first);

    return new Promise<UserQuestionResult>((resolve, reject) => {
      const entry: PendingEntry = { record, target, request, resolve, reject, index: 0, collected: [] };
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
      this.logger.info(`im-qqbot: question sent to QQ, waiting for answer key=${key}`);
    });
  }

  /** 推进状态机：收集答案 → 有下一题则发送，否则 resolve 全部答案 */
  private advance(entry: PendingEntry, key: string, answer: UserQuestionAnswer): void {
    entry.collected.push(answer);
    entry.index += 1;

    if (entry.index < entry.request.questions.length) {
      const next = entry.request.questions[entry.index]!;
      this.resetTimer(entry, key);
      // 用户刚在 QQ 作答：后续题被动回复其作答（replyTarget 携带最新 msgId 候选）
      void this.sendQuestion(entry.record, entry.record.replyTarget, next).catch((err) => {
        this.pending.delete(key);
        this.clearTimer(entry);
        this.removeAbort(entry);
        entry.reject(err instanceof Error ? err : new Error(String(err)));
      });
      return;
    }

    this.pending.delete(key);
    this.clearTimer(entry);
    this.removeAbort(entry);
    this.logger.info(`im-qqbot: question answered via QQ key=${key}`);
    entry.resolve({ answers: entry.collected });
  }

  /** 发送单个问题：优先带按钮，按钮发送失败降级纯文本 */
  private async sendQuestion(
    record: QuestionSessionRecordLike,
    target: ReplyTarget,
    question: UserQuestion,
  ): Promise<void> {
    const hint = record.scope === 'group' && this.config.requireMention === true;
    const keyboard = buildKeyboard(question);
    try {
      if (keyboard) {
        try {
          await this.sender.sendMarkdown(target, formatQuestion(question, hint, true), { keyboard });
          return;
        } catch (err) {
          this.logger.warn(`im-qqbot: keyboard send failed, fallback to text: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      await this.sender.sendMarkdown(target, formatQuestion(question, hint, false));
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
    void this.sender.sendMarkdown(entry.target, '⚠️ 提问已超时，未收到回答。').catch(() => {});
    entry.reject(new QuestionChannelError('ask_user_question timed out before the user answered', ASK_ABORTED));
  }

  /** 本回合的投递目标；未注入解析器时沿用会话 replyTarget */
  private resolveTarget(sessionId: string, record: QuestionSessionRecordLike): ReplyTarget | undefined {
    return this.targets ? this.targets.targetFor(sessionId) : record.replyTarget;
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
