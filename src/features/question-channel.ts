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
 */
import type { InlineKeyboard, InteractionEvent } from '@tencent-connect/qqbot-nodejs';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';
import { parseAnswer } from './answer-parser.ts';
import { buildKeyboard, formatQuestion } from './question-renderer.ts';
import { decodeButtonData, encodeButtonData } from './button-utils.ts';
import { detectTrailingOptions } from './quick-reply.ts';

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

export interface QuestionSessionRecordLike {
  sessionKey: string;
  scope: ChatScope;
  replyTarget: ReplyTarget;
}

export interface QuestionChannelManagerLike {
  findBySessionId(sessionId: string): QuestionSessionRecordLike | undefined;
  getSessionRecord(scope: ChatScope, peerId: string): QuestionSessionRecordLike | undefined;
  /** 规范会话键（快捷按钮登记/点击匹配用；测试桩可缺省） */
  sessionKey?(scope: ChatScope, peerId: string): string;
}

export interface QuestionChannelSenderLike {
  sendMarkdown(target: ReplyTarget, content: string, opts?: { keyboard?: InlineKeyboard }): Promise<unknown>;
}

export interface QuestionChannelConfigLike {
  requireMention: boolean;
  askTimeoutMs: number;
  /**
   * 快捷按钮：助手消息尾部编号选项自动补挂可点击按钮。
   * 未设置（如单测直接构造）→ 关闭；生产配置 schema 默认 true。
   */
  quickReplyButtons?: boolean;
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

/** 快捷按钮点击的解析结果（调用方把 text 作为用户消息注入会话） */
export interface QuickReplyClick {
  scope: ChatScope;
  peerId: string;
  senderId: string;
  /** 等同用户回复的文本（选项编号） */
  text: string;
}

/** QQ 按钮 label 有长度限制，超长截断（正文保留完整文本） */
const QUICK_BUTTON_LABEL_MAX = 18;

function quickButtonLabel(text: string | undefined): string {
  const s = String(text ?? '').trim();
  return s.length > QUICK_BUTTON_LABEL_MAX ? s.slice(0, QUICK_BUTTON_LABEL_MAX - 1) + '…' : s;
}

/**
 * 快捷按钮键盘（一行一按钮）：button_data 沿用官方统一编码，
 * `t` 判别字段取 `quick`（`{"t":"quick","i":<下标>}`）——
 * 与提问 `t:'question'`、审批 `t:'approval'` 并列；统一分发器
 * 不识别 `quick` 而放行，由 consumeQuickReply 兜底消费。
 */
export function keyboardFromLabels(labels: readonly string[]): InlineKeyboard {
  return {
    content: {
      rows: labels.map((label, i) => ({
        buttons: [{
          id: `qr-opt-${i}`,
          render_data: {
            label: quickButtonLabel(label),
            visited_label: quickButtonLabel(label),
            style: 1,
          },
          action: {
            // action.type：0=跳转链接，1=回调（点击即发 INTERACTION_CREATE，
            //   无需再发送），2=把 data 填入输入框（需用户手动发送）。
            //   这里必须用 1 才能"点击即确认"。
            type: 1,
            // permission.type 用 2（指定用户不可点、列表为空即全员可点）；
            // 实测 type 0 会导致点击报"无权限操作"。
            permission: { type: 2 },
            data: encodeButtonData({ t: 'quick', i }),
          },
        }],
      })),
    },
  };
}

interface PendingEntry {
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
  /** sessionKey → 最近一条"尾部编号选项"消息的选项标签（快捷按钮点击解析用） */
  private readonly quickReplies = new Map<string, string[]>();
  private uq?: UserQuestionsServiceLike;
  private origAsk?: UserQuestionsServiceLike['ask'];
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

  /**
   * 包装 userQuestions.ask：QQ 会话走 QQ 通道，其余委托原实现。
   * 幂等（已 patch 则跳过）；服务缺失或 ask 非函数时优雅禁用。
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
      if (record) return self.askViaQQ(record, request);
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
    const record = this.manager.getSessionRecord(scope, peerId);
    if (!record) return false;
    const key = record.sessionKey;
    const entry = this.pending.get(key);
    if (!entry) return false;
    if (!text) return false; // 纯图片/表情等：继续等待，消息走常规流程

    const current = entry.request.questions[entry.index];
    if (!current) return false;
    const answer = parseAnswer(current, text);
    this.advance(entry, key, answer);
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
    if (!entry) return false;

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

    this.advance(entry, record.sessionKey, { id: current.id, selected: [opts[idx]!.label] });
    return true;
  }

  /**
   * 出站快捷按钮：检测助手消息尾部的编号选项块，登记选项并返回键盘。
   *
   * 模型不一定总走 ask_user_question（被中断后继续推进时常直接列编号文本），
   * 出站层对这类消息补挂按钮作确定性兜底：点击等同用户回复编号。
   * 流式消息本身挂不了键盘，调用方把键盘放在随后的附加短消息上。
   *
   * @param key 规范会话键（`manager.sessionKey(scope, peerId)`；出站桥接记录的
   *            `record.sessionKey` 可能是 `bridge:*`，不能直接用）
   * @returns 键盘与选项标签；配置关闭、无选项块或该会话已有待答问题时返回 undefined
   */
  prepareQuickReply(key: string, text: string): { keyboard: InlineKeyboard; labels: string[] } | undefined {
    if (this.config.quickReplyButtons !== true) return undefined;
    if (this.pending.has(key)) return undefined; // 正式提问在等待时不叠加快捷按钮
    const labels = detectTrailingOptions(text);
    if (labels === undefined) return undefined;
    this.quickReplies.set(key, labels);
    return { keyboard: keyboardFromLabels(labels), labels };
  }

  /**
   * 快捷按钮点击：与正式提问/审批按钮（统一分发器按 `t` 路由）互斥——
   * 快捷按钮的判别字段为 `t:'quick'`，分发器不识别而放行到这里。
   * 命中则返回注入载荷，调用方把编号文本作为用户消息注入会话
   *（点击等同回复编号）。
   */
  consumeQuickReply(event: InteractionEvent): QuickReplyClick | undefined {
    if (this.config.quickReplyButtons !== true) return undefined;
    const raw = event?.data?.resolved?.button_data;
    if (typeof raw !== 'string' || raw.length === 0) return undefined;
    const peerId = event.group_openid ?? event.user_openid;
    if (!peerId) return undefined;
    const scope: ChatScope = event.group_openid ? 'group' : 'c2c';

    const button = decodeButtonData(raw);
    if (!button || button.t !== 'quick') return undefined; // 提问/审批按钮归统一分发器
    const idx = button.i;
    if (!Number.isInteger(idx) || idx < 0) return undefined;

    const record = this.manager.getSessionRecord(scope, peerId);
    const key = record?.sessionKey ?? this.manager.sessionKey?.(scope, peerId);
    if (!key) return undefined;
    if (this.pending.has(key)) return undefined; // 正式提问在等待：点击归 handleInteraction
    const labels = this.quickReplies.get(key);
    const label = labels?.[idx];
    if (labels === undefined || label === undefined) return undefined;

    const senderId = scope === 'group'
      ? ((event.group_member_openid ?? event.user_openid ?? peerId) as string)
      : (event.user_openid ?? peerId);
    this.logger.info(`im-qqbot: quick-reply clicked key=${key} option=${idx + 1} ("${label}")`);
    return { scope, peerId, senderId, text: String(idx + 1) };
  }

  /** 走 QQ 通道：发送首题 + 挂起 Promise，等待逐题作答 */
  private async askViaQQ(record: QuestionSessionRecordLike, request: UserQuestionRequest): Promise<UserQuestionResult> {
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

    await this.sendQuestion(record, first);

    return new Promise<UserQuestionResult>((resolve, reject) => {
      const entry: PendingEntry = { record, request, resolve, reject, index: 0, collected: [] };
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
      void this.sendQuestion(entry.record, next).catch((err) => {
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
