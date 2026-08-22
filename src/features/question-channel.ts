/**
 * QuestionChannel — ask_user_question 的 QQ 交互通道
 *
 * 背景：`ask_user_question` 工具通过 `ctx.userQuestions` 的单一 provider 等待
 * 人类回答；宿主默认 provider（dsh-host-apiproxy）把问题推给 Web 客户端渲染成
 * 弹出框。QQ 是纯文本通道，QQ 用户原本看不到问题、也无法作答。
 *
 * 本通道包装 `ctx.userQuestions` 服务的 `ask` 方法（不动 provider 注册机制）：
 *   - 提问会话属于 QQ bot（SessionManager 能按 sessionId 找到记录）→
 *     将问题渲染为编号选项文本发到 QQ（单选带选项时附带可点击的内联按钮），
 *     并把该会话的下一条入站文本消息或按钮点击解析为答案；
 *   - 其他会话 → 原样委托给原 `ask`（Web 弹出框行为不变）。
 *
 * 按钮链路：`sendMarkdown(..., { keyboard })` 附带 `action.type=1`（回调）按钮；
 * 用户点击触发 `interaction` 事件，由 bootstrap 的监听器转给 `handleInteraction`，
 * 按 `button_data` 解析出所选选项并 ACK（平台要求 5 秒内）。按钮发送失败
 * （如机器人无按钮权限）自动回退为纯文本编号问答。
 *
 * 平台实测结论（与部分文档/示例不一致，见注释内标注）：
 *   - `action.type`：0=跳转链接，1=回调（点击即发 INTERACTION_CREATE），
 *     2=把 data 填入输入框（需用户手动发送）。要实现"点击即确认"必须用 1。
 *   - `action.permission.type`：0 在部分机器人上点击报"无权限操作"；
 *     2（指定用户不可点，列表为空即全员可点）行为正常。
 *
 * 答案契约与宿主一致：`{ answers: [{ id, selected: string[], custom? }] }`，
 * selected 使用选项的原文 label。
 */
import type { InlineKeyboard, InteractionEvent } from '@tencent-connect/qqbot-nodejs';
import type { ChatScope, Logger, ReplyTarget } from '../types.js';

// ── user-questions 契约（结构化类型，避免硬依赖 dsh-user-questions） ──

export interface UserQuestionOption {
  label: string;
  description?: string;
}

export interface UserQuestion {
  id: string;
  question: string;
  header?: string;
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
  agent?: { id: string };
  signal?: AbortSignal;
}

export interface UserQuestionResult {
  answers: UserQuestionAnswer[];
}

export interface UserQuestionsServiceLike {
  ask(request: UserQuestionRequest): Promise<UserQuestionResult>;
}

// ── 依赖的最小结构（SessionManager / QQBotSender 均结构化满足） ──

export interface QuestionSessionRecordLike {
  sessionKey: string;
  scope: ChatScope;
  replyTarget: ReplyTarget;
}

export interface QuestionChannelManagerLike {
  findBySessionId(sessionId: string): QuestionSessionRecordLike | undefined;
  sessionKey(scope: ChatScope, peerId: string): string;
}

export interface QuestionChannelSenderLike {
  sendMarkdown(target: ReplyTarget, content: string, opts?: { keyboard?: InlineKeyboard }): Promise<unknown>;
}

export interface QuestionChannelConfigLike {
  requireMention: boolean;
}

interface PendingEntry {
  request: UserQuestionRequest;
  resolve: (result: UserQuestionResult) => void;
  reject: (err: Error) => void;
  onAbort?: () => void;
}

/** QQ 按钮 label 有长度限制，超长截断（正文保留完整文本） */
const BUTTON_LABEL_MAX = 18;

function buttonLabel(text: string | undefined): string {
  const s = String(text ?? '').trim();
  return s.length > BUTTON_LABEL_MAX ? s.slice(0, BUTTON_LABEL_MAX - 1) + '…' : s;
}

/**
 * 为"单题、单选、带选项"的问题构建内联键盘；不适用时返回 undefined。
 * button_data 编码 `{"i":<选项下标>}`，由 handleInteraction 解码。
 */
export function buildKeyboard(questions: readonly UserQuestion[]): InlineKeyboard | undefined {
  if (questions.length !== 1) return undefined;
  const q = questions[0];
  if (!q) return undefined;
  const opts = q.options ?? [];
  if (opts.length === 0 || q.multiSelect) return undefined;
  return {
    content: {
      rows: opts.map((o, i) => ({
        buttons: [{
          id: `q-opt-${i}`,
          render_data: {
            label: buttonLabel(o.label),
            visited_label: buttonLabel(o.label),
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
            data: JSON.stringify({ i }),
          },
        }],
      })),
    },
  };
}

/** 把请求中的问题渲染成 QQ 文本 */
export function formatQuestions(
  questions: readonly UserQuestion[],
  requireMentionHint: boolean,
  withButtons: boolean,
): string {
  const lines: string[] = [];
  for (const q of questions) {
    if (q.header) lines.push(`**${q.header}**`);
    lines.push(q.question);
    const opts = q.options ?? [];
    opts.forEach((o, i) => {
      lines.push(`${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ''}`);
    });
    if (q.multiSelect && opts.length > 0) lines.push('（可多选：回复多个编号，如 1,3）');
  }
  if ((questions[0]?.options?.length ?? 0) > 0) {
    lines.push('');
    const mention = requireMentionHint ? '（需 @机器人）' : '';
    if (withButtons) lines.push(`点击下方按钮选择${mention}，或直接输入文字作为自定义回答。`);
    else lines.push(`回复编号选择${mention}，或直接输入文字作为自定义回答。`);
  }
  return lines.join('\n');
}

/** 把用户的 QQ 文本回复解析为答案（单题精确解析；多题降级为整段文字） */
export function parseAnswers(questions: readonly UserQuestion[], text: string): UserQuestionAnswer[] {
  if (questions.length === 1) {
    const q = questions[0];
    if (!q) return [];
    const opts = q.options ?? [];
    if (opts.length > 0) {
      // 纯数字/分隔符 → 按编号选择
      if (/^[\d\s,，、;；./]+$/.test(text)) {
        const nums = [...text.matchAll(/\d+/g)]
          .map((m) => parseInt(m[0], 10))
          .filter((n) => n >= 1 && n <= opts.length);
        if (nums.length > 0) {
          const picked = q.multiSelect ? nums : nums.slice(0, 1);
          const selected = [...new Set(picked.map((n) => opts[n - 1]?.label).filter((l): l is string => typeof l === 'string'))];
          return [{ id: q.id, selected }];
        }
      }
      // 文本与某个选项 label 完全一致（忽略大小写）
      const exact = opts.find((o) => o.label.toLowerCase() === text.toLowerCase());
      if (exact) return [{ id: q.id, selected: [exact.label] }];
    }
    return [{ id: q.id, selected: [], custom: text }];
  }
  // 多问题：把整段回复作为每个问题的自定义回答（agent 自行解读）
  return questions.map((q) => ({ id: q.id, selected: [], custom: text }));
}

export class QuestionChannel {
  /** sessionKey → pending entry */
  private readonly pending = new Map<string, PendingEntry>();
  private uq: (UserQuestionsServiceLike & { __qqQuestionPatched?: boolean }) | undefined;
  private origAsk: ((request: UserQuestionRequest) => Promise<UserQuestionResult>) | undefined;

  public constructor(
    private readonly manager: QuestionChannelManagerLike,
    private readonly sender: QuestionChannelSenderLike,
    private readonly config: QuestionChannelConfigLike,
    private readonly logger: Logger,
  ) {}

  /**
   * 安装：包装 userQuestions 服务的 `ask` 方法。
   *
   * 选择包装 `ask` 而非替换 `provider`：
   *   - provider 注册在宿主的 effect 里延迟赋值且查重（DUPLICATE_PROVIDER），
   *     直接换 provider 会受插件加载顺序影响、甚至引发冲突；
   *   - `ask` 是服务实例方法，工具/计划模式都经 `ctx.userQuestions.ask(...)` 调用，
   *     在实例上覆写即可稳定拦截，且非 QQ 会话原样委托给原实现（Web 弹出框不受影响）。
   */
  install(ctx: { get(name: string): unknown }): void {
    let uq: (UserQuestionsServiceLike & { __qqQuestionPatched?: boolean }) | undefined;
    try {
      const svc = ctx.get('userQuestions') as UserQuestionsServiceLike | undefined;
      if (svc && typeof svc.ask === 'function') uq = svc as UserQuestionsServiceLike & { __qqQuestionPatched?: boolean };
    } catch {
      uq = undefined;
    }
    if (!uq) {
      this.logger.warn('im-qqbot: userQuestions service unavailable; QQ question channel disabled');
      return;
    }
    if (uq.__qqQuestionPatched) {
      this.logger.warn('im-qqbot: userQuestions already patched; skipping duplicate install');
      return;
    }
    const self = this;
    const origAsk = uq.ask.bind(uq);
    uq.ask = async function qqRoutedAsk(request: UserQuestionRequest): Promise<UserQuestionResult> {
      const sessionId = request?.agent?.id;
      const record = sessionId ? self.manager.findBySessionId(sessionId) : undefined;
      if (record) return self.askViaQQ(record, request);
      return origAsk(request);
    };
    uq.__qqQuestionPatched = true;
    this.uq = uq;
    this.origAsk = origAsk;
    this.logger.info('im-qqbot: QQ question channel installed (ask-wrap)');
  }

  /** 卸载：恢复原 `ask`，拒绝所有待答问题 */
  uninstall(): void {
    if (this.uq && this.origAsk) {
      this.uq.ask = this.origAsk;
      delete this.uq.__qqQuestionPatched;
      this.uq = undefined;
      this.origAsk = undefined;
    }
    for (const [, entry] of this.pending) {
      entry.reject(new Error('QQ question channel was unloaded before the user answered'));
    }
    this.pending.clear();
  }

  /**
   * 入站截获：该会话若有待答问题且本条消息有文本，解析为答案并提交。
   * @returns true 表示消息已被消费为答案（调用方应停止常规处理）
   */
  tryAnswer(sessionKey: string, text: string): boolean {
    const entry = this.pending.get(sessionKey);
    if (!entry) return false;
    if (!text) return false; // 纯图片/表情等：继续等待，消息走常规流程
    this.pending.delete(sessionKey);
    if (entry.onAbort && entry.request.signal) {
      entry.request.signal.removeEventListener('abort', entry.onAbort);
    }
    let answers: UserQuestionAnswer[];
    try {
      answers = parseAnswers(entry.request.questions, text);
    } catch (err) {
      entry.reject(err instanceof Error ? err : new Error(String(err)));
      return true;
    }
    this.logger.info(`im-qqbot: question answered via QQ key=${sessionKey} text="${text.slice(0, 80)}"`);
    entry.resolve({ answers });
    return true;
  }

  /** QQ 通道提问：发送编号选项文本（单选附带可点击按钮），等待回复或按钮点击 */
  async askViaQQ(record: QuestionSessionRecordLike, request: UserQuestionRequest): Promise<UserQuestionResult> {
    const key = record.sessionKey;
    // 同会话已有待答问题（理论上不会发生：回合阻塞在第一个问题上）→ 拒绝旧的
    const prev = this.pending.get(key);
    if (prev) {
      this.pending.delete(key);
      prev.reject(new Error('superseded by a new question'));
    }
    const hint = record.scope === 'group' && this.config.requireMention === true;
    const keyboard = buildKeyboard(request.questions);
    const text = formatQuestions(request.questions, hint, keyboard !== undefined);
    try {
      if (keyboard !== undefined) {
        try {
          await this.sender.sendMarkdown(record.replyTarget, text, { keyboard });
        } catch (kbErr) {
          // 按钮发送失败（常见：机器人无按钮权限）→ 回退纯文本编号问答（重排提示语）
          this.logger.warn(`im-qqbot: keyboard send failed, fallback to text: ${kbErr instanceof Error ? kbErr.message : String(kbErr)}`);
          await this.sender.sendMarkdown(record.replyTarget, formatQuestions(request.questions, hint, false));
        }
      } else {
        await this.sender.sendMarkdown(record.replyTarget, text);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`im-qqbot: question send failed key=${key}: ${msg}`);
      throw new Error(`failed to deliver question to QQ: ${msg}`);
    }
    return new Promise<UserQuestionResult>((resolve, reject) => {
      const entry: PendingEntry = { request, resolve, reject };
      if (request.signal) {
        const onAbort = (): void => {
          if (this.pending.get(key) !== entry) return;
          this.pending.delete(key);
          reject(new Error('ask_user_question was aborted before the user answered'));
        };
        entry.onAbort = onAbort;
        request.signal.addEventListener('abort', onAbort, { once: true });
      }
      this.pending.set(key, entry);
      this.logger.info(`im-qqbot: question sent to QQ (${keyboard !== undefined ? 'with buttons' : 'text only'}), waiting for answer key=${key}`);
    });
  }

  /**
   * 按钮点击回调：按事件来源定位会话，解码 button_data 提交答案。
   * @returns true 表示点击命中了一个待答问题（调用方据此选择 ACK 结果）
   */
  handleInteraction(event: InteractionEvent): boolean {
    const raw = event?.data?.resolved?.button_data;
    if (typeof raw !== 'string' || raw.length === 0) {
      this.logger.warn('im-qqbot: interaction without button_data ignored');
      return false;
    }
    const peerId = event.group_openid ?? event.user_openid;
    if (!peerId) {
      this.logger.warn('im-qqbot: interaction without peer openid ignored');
      return false;
    }
    const scope: ChatScope = event.group_openid ? 'group' : 'c2c';
    const key = this.manager.sessionKey(scope, peerId);
    const entry = this.pending.get(key);
    if (!entry) {
      this.logger.warn(`im-qqbot: button click with no pending question key=${key}`);
      return false;
    }
    let idx: unknown;
    try {
      idx = (JSON.parse(raw) as { i?: unknown }).i;
    } catch {
      this.logger.warn(`im-qqbot: unparseable button_data="${raw}"`);
      return false;
    }
    const q = entry.request.questions?.[0];
    const opts = q?.options ?? [];
    if (typeof idx !== 'number' || !opts[idx]) {
      this.logger.warn(`im-qqbot: button index out of range idx=${String(idx)} options=${opts.length}`);
      return false;
    }
    const option = opts[idx];
    if (!option || !q) return false;
    this.pending.delete(key);
    if (entry.onAbort && entry.request.signal) {
      entry.request.signal.removeEventListener('abort', entry.onAbort);
    }
    this.logger.info(`im-qqbot: question answered via QQ button key=${key} option=${option.label}`);
    entry.resolve({ answers: [{ id: q.id, selected: [option.label] }] });
    return true;
  }
}
