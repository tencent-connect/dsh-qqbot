import { parseAnswer } from "./answer-parser.js";
import { buildKeyboard, formatQuestion } from "./question-renderer.js";
import { decodeButtonData } from "./button-utils.js";
// ── 错误语义（对齐 dsh-user-questions 的 UserQuestionError code 约定） ──
/** 问答中断错误码：上层（如 plan-mode）按 code 区分「用户未作答」与普通发送/网络错误 */
const ASK_ABORTED = 'ASK_ABORTED';
class QuestionChannelError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = 'QuestionChannelError';
    }
}
export class QuestionChannel {
    pending = new Map();
    uq;
    origAsk;
    manager;
    sender;
    config;
    logger;
    targets;
    /**
     * @param targets 回合投递目标解析（与出站共享）。缺省时按会话 replyTarget 被动回复。
     */
    constructor(manager, sender, config, logger, targets) {
        this.manager = manager;
        this.sender = sender;
        this.config = config;
        this.logger = logger;
        this.targets = targets;
    }
    /**
     * 包装 userQuestions.ask：QQ 会话走 QQ 通道，其余委托原实现。
     * 幂等（已 patch 则跳过）；服务缺失或 ask 非函数时优雅禁用。
     */
    install(ctx) {
        const uq = ctx.get('userQuestions');
        if (!uq || uq.__qqQuestionPatched)
            return;
        if (typeof uq.ask !== 'function') {
            this.logger.warn('im-qqbot: userQuestions service lacks ask() — QQ question channel disabled');
            return;
        }
        const self = this;
        this.origAsk = uq.ask.bind(uq);
        uq.ask = async function qqRoutedAsk(request) {
            const sessionId = request?.agent?.id;
            const record = sessionId ? self.manager.findBySessionId(sessionId) : undefined;
            // 本回合按策略不投递到 QQ（如桌面发起的群会话回合）→ 交回宿主默认界面
            const target = record && sessionId ? self.resolveTarget(sessionId, record) : undefined;
            if (record && target)
                return self.askViaQQ(record, target, request);
            return self.origAsk(request);
        };
        Object.defineProperty(uq, '__qqQuestionPatched', { value: true, configurable: true, enumerable: false });
        this.uq = uq;
        this.logger.info('im-qqbot: QQ question channel installed');
    }
    uninstall() {
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
    cancelPending(sessionKey) {
        const entry = this.pending.get(sessionKey);
        if (!entry)
            return;
        this.pending.delete(sessionKey);
        this.clearTimer(entry);
        this.removeAbort(entry);
        entry.reject(new QuestionChannelError('ask_user_question was cancelled before the user answered', ASK_ABORTED));
    }
    /** 入站文本作答：该会话若有待答问题且本条消息有文本，解析为答案并推进 */
    tryAnswer(scope, peerId, text) {
        const record = this.manager.getSessionRecord(scope, peerId);
        if (!record)
            return false;
        const key = record.sessionKey;
        const entry = this.pending.get(key);
        if (!entry)
            return false;
        if (!text)
            return false; // 纯图片/表情等：继续等待，消息走常规流程
        const current = entry.request.questions[entry.index];
        if (!current)
            return false;
        const answer = parseAnswer(current, text);
        this.advance(entry, key, answer);
        return true;
    }
    /** 按钮点击作答：解码 button_data 选项下标，推进状态机 */
    handleInteraction(event) {
        const peerId = event.group_openid ?? event.user_openid;
        if (!peerId)
            return false;
        const scope = event.group_openid ? 'group' : 'c2c';
        const record = this.manager.getSessionRecord(scope, peerId);
        if (!record)
            return false;
        const entry = this.pending.get(record.sessionKey);
        if (!entry)
            return false;
        const data = event.data?.resolved?.button_data;
        if (!data)
            return false;
        const button = decodeButtonData(data);
        if (!button || button.t !== 'question')
            return false;
        const current = entry.request.questions[entry.index];
        if (!current)
            return false;
        // 校验按钮归属题：旧题按钮在新题推进后被点击（误点/延迟事件），
        // 其 q 不等于当前题 id，直接忽略，避免错位映射到当前题选项。
        if (button.q !== current.id)
            return false;
        const idx = button.i;
        const opts = current.options ?? [];
        if (idx < 0 || idx >= opts.length)
            return false;
        this.advance(entry, record.sessionKey, { id: current.id, selected: [opts[idx].label] });
        return true;
    }
    /** 走 QQ 通道：发送首题 + 挂起 Promise，等待逐题作答 */
    async askViaQQ(record, target, request) {
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
        if (!first)
            throw new Error('ask_user_question with empty questions');
        await this.sendQuestion(record, target, first);
        return new Promise((resolve, reject) => {
            const entry = { record, target, request, resolve, reject, index: 0, collected: [] };
            if (request.signal) {
                const onAbort = () => {
                    if (this.pending.get(key) !== entry)
                        return;
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
    advance(entry, key, answer) {
        entry.collected.push(answer);
        entry.index += 1;
        if (entry.index < entry.request.questions.length) {
            const next = entry.request.questions[entry.index];
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
    async sendQuestion(record, target, question) {
        const hint = record.scope === 'group' && this.config.requireMention === true;
        const keyboard = buildKeyboard(question);
        try {
            if (keyboard) {
                try {
                    await this.sender.sendMarkdown(target, formatQuestion(question, hint, true), { keyboard });
                    return;
                }
                catch (err) {
                    this.logger.warn(`im-qqbot: keyboard send failed, fallback to text: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            await this.sender.sendMarkdown(target, formatQuestion(question, hint, false));
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`im-qqbot: question send failed key=${record.sessionKey}: ${msg}`);
            throw new Error(`failed to deliver question to QQ: ${msg}`);
        }
    }
    onTimeout(key) {
        const entry = this.pending.get(key);
        if (!entry)
            return;
        this.pending.delete(key);
        this.removeAbort(entry);
        entry.timer = undefined;
        void this.sender.sendMarkdown(entry.target, '⚠️ 提问已超时，未收到回答。').catch(() => { });
        entry.reject(new QuestionChannelError('ask_user_question timed out before the user answered', ASK_ABORTED));
    }
    /** 本回合的投递目标；未注入解析器时沿用会话 replyTarget */
    resolveTarget(sessionId, record) {
        return this.targets ? this.targets.targetFor(sessionId) : record.replyTarget;
    }
    resetTimer(entry, key) {
        if (entry.timer)
            clearTimeout(entry.timer);
        entry.timer = setTimeout(() => this.onTimeout(key), this.config.askTimeoutMs);
    }
    clearTimer(entry) {
        if (entry.timer)
            clearTimeout(entry.timer);
        entry.timer = undefined;
    }
    removeAbort(entry) {
        if (entry.onAbort && entry.request.signal) {
            entry.request.signal.removeEventListener('abort', entry.onAbort);
        }
    }
}
//# sourceMappingURL=question-channel.js.map