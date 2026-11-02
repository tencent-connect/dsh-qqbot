import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { parseAnswer } from "./answer-parser.js";
import { buildKeyboard, formatQuestion } from "./question-renderer.js";
import { decodeButtonData } from "./button-utils.js";
function turnOf(agent) {
    const events = agent.session.snapshotEvents();
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event?.type !== 'turn/start')
            continue;
        const turn = event.data.turn;
        return Number.isSafeInteger(turn) && turn >= 0 ? turn : undefined;
    }
    return undefined;
}
function identityOf(request, execution) {
    const agent = request.agent;
    if (!agent)
        return undefined;
    const turn = turnOf(agent);
    if (turn === undefined)
        return undefined;
    const callId = request.wait?.callId ?? (execution?.agent === agent && execution.identity.turn === turn && !execution.signal.aborted
        ? execution.identity.callId : undefined);
    return callId ? { sessionId: agent.id, callId, turn } : undefined;
}
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
    toolCalls = new AsyncLocalStorage();
    removeListeners = [];
    manager;
    sender;
    config;
    logger;
    constructor(manager, sender, config, logger) {
        this.manager = manager;
        this.sender = sender;
        this.config = config;
        this.logger = logger;
    }
    install(ctx) {
        if (this.removeListeners.length)
            return;
        this.removeListeners.push(ctx.on('tools/execute', async (exec, next) => {
            if (exec.name !== 'ask_user_question' || !exec.agent)
                return next();
            const turn = turnOf(exec.agent);
            if (turn === undefined)
                return next();
            const lifetime = new AbortController();
            const execution = { agent: exec.agent,
                identity: { sessionId: exec.agent.id, callId: exec.callId, turn },
                signal: AbortSignal.any([exec.signal, lifetime.signal]) };
            try {
                return await this.toolCalls.run(execution, next);
            }
            finally {
                lifetime.abort();
            }
        }, { global: true, prepend: true }));
        this.removeListeners.push(ctx.on('user-questions/request', (request, nextAnswerer) => {
            const execution = this.toolCalls.getStore();
            const identity = identityOf(request, execution);
            const record = identity ? this.manager.interactionRecord(identity.sessionId, identity.turn) : undefined;
            if (!identity || !record)
                return nextAnswerer();
            const effective = execution && execution.agent === request.agent
                ? { ...request, signal: request.signal ? AbortSignal.any([request.signal, execution.signal]) : execution.signal }
                : request;
            return this.answerRequest(ctx, record, effective, identity, nextAnswerer);
        }, { global: true, prepend: true }));
        this.logger.info('im-qqbot: QQ question channel installed');
    }
    uninstall() {
        for (const remove of this.removeListeners.splice(0))
            remove();
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
    /** Classify admitted text before command/answer parsing without consuming it. */
    canAcceptText(scope, peerId, text, actor) {
        if (!text.trim() || !actor || this.manager.canAnswer && !this.manager.canAnswer(scope, peerId, actor))
            return false;
        const record = this.manager.getSessionRecord(scope, peerId);
        const entry = record ? this.pending.get(record.sessionKey) : undefined;
        return !!entry && entry.state === 'waiting' && !!entry.request.questions[entry.index];
    }
    /** 入站文本作答：该会话若有待答问题且本条消息有文本，解析为答案并推进 */
    tryAnswer(scope, peerId, text, actor) {
        if (this.manager.canAnswer && !this.manager.canAnswer(scope, peerId, actor))
            return false;
        const record = this.manager.getSessionRecord(scope, peerId);
        if (!record)
            return false;
        const key = record.sessionKey;
        const entry = this.pending.get(key);
        if (!entry || entry.state !== 'waiting')
            return false;
        if (!text || !actor)
            return false; // 纯图片/表情等：继续等待，消息走常规流程
        const current = entry.request.questions[entry.index];
        if (!current)
            return false;
        const answer = parseAnswer(current, text);
        this.advance(entry, key, answer, actor);
        return true;
    }
    /** 按钮点击作答：解码 button_data 选项下标，推进状态机 */
    handleInteraction(event) {
        const peerId = event.group_openid ?? event.user_openid;
        if (!peerId)
            return false;
        const scope = event.group_openid ? 'group' : 'c2c';
        const actor = event.group_member_openid ?? event.user_openid;
        if (!actor || this.manager.canAnswer && !this.manager.canAnswer(scope, peerId, actor))
            return false;
        const record = this.manager.getSessionRecord(scope, peerId);
        if (!record)
            return false;
        const entry = this.pending.get(record.sessionKey);
        if (!entry || entry.state !== 'waiting')
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
        if (button.q !== `${entry.nonce}:${current.id}`)
            return false;
        const idx = button.i;
        const opts = current.options ?? [];
        if (idx < 0 || idx >= opts.length)
            return false;
        const option = opts[idx];
        if (!option)
            return false;
        this.advance(entry, record.sessionKey, { id: current.id, selected: [option.label] }, actor);
        return true;
    }
    async answerRequest(ctx, record, request, identity, next) {
        if (!request.wait?.timed || !request.agent)
            return this.askViaQQ(record, request, identity);
        const service = ctx.get('userQuestions');
        if (!service?.attachWait)
            return next();
        const lifetime = new AbortController();
        const signal = request.signal ? AbortSignal.any([request.signal, lifetime.signal]) : lifetime.signal;
        const claim = service.attachWait(request.agent, request.wait.callId, signal)[Symbol.asyncIterator]();
        try {
            const first = await claim.next();
            if (first.done)
                return next();
            return await this.askViaQQ(record, { ...request, signal }, identity);
        }
        finally {
            lifetime.abort();
            await claim.return?.();
        }
    }
    /** 走 QQ 通道：发送首题 + 挂起 Promise，等待逐题作答 */
    async askViaQQ(record, request, identity) {
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
        const nonce = randomUUID().slice(0, 8);
        return new Promise((resolve, reject) => {
            const entry = { state: 'waiting', record, request, identity, resolve, reject, index: 0, collected: [], nonce };
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
            if (request.signal?.aborted) {
                this.cancelPending(key);
                return;
            }
            void this.sendQuestion(record, { ...first, id: `${nonce}:${first.id}` }).catch(error => {
                if (this.pending.get(key) !== entry)
                    return;
                this.pending.delete(key);
                this.clearTimer(entry);
                this.removeAbort(entry);
                entry.reject(error);
            });
            this.logger.info(`im-qqbot: question sent to QQ, waiting for answer key=${key}`);
        });
    }
    /** 推进状态机：收集答案 → 有下一题则发送，否则 resolve 全部答案 */
    advance(entry, key, answer, actor) {
        const current = this.manager.interactionRecord(entry.identity.sessionId, entry.identity.turn);
        if (!current || current.sessionKey !== key) {
            this.cancelPending(key);
            return;
        }
        entry.collected.push(answer);
        entry.index += 1;
        if (entry.index < entry.request.questions.length) {
            const next = entry.request.questions[entry.index];
            this.resetTimer(entry, key);
            void this.sendQuestion(entry.record, { ...next, id: `${entry.nonce}:${next.id}` }).catch((err) => {
                if (this.pending.get(key) !== entry)
                    return;
                this.pending.delete(key);
                this.clearTimer(entry);
                this.removeAbort(entry);
                entry.reject(err instanceof Error ? err : new Error(String(err)));
            });
            return;
        }
        entry.state = 'saving';
        this.clearTimer(entry);
        const result = { answers: entry.collected };
        void this.manager.recordHumanReply({ ...entry.identity, nonce: entry.nonce, actor, answer: result })
            .then(() => {
            if (this.pending.get(key) !== entry)
                return;
            if (entry.request.signal?.aborted)
                throw new QuestionChannelError('ask_user_question was aborted while saving the reply', ASK_ABORTED);
            this.pending.delete(key);
            this.removeAbort(entry);
            this.logger.info(`im-qqbot: question answered via QQ key=${key}`);
            entry.resolve(result);
        })
            .catch(error => {
            if (this.pending.get(key) !== entry)
                return;
            this.pending.delete(key);
            this.removeAbort(entry);
            entry.reject(error instanceof Error ? error : new Error(String(error)));
        });
    }
    /** 发送单个问题：优先带按钮，按钮发送失败降级纯文本 */
    async sendQuestion(record, question) {
        const hint = record.scope === 'group' && this.config.requireMention === true;
        const keyboard = buildKeyboard(question);
        try {
            if (keyboard) {
                try {
                    await this.sender.sendMarkdown(record.replyTarget, formatQuestion(question, hint, true), { keyboard });
                    return;
                }
                catch (err) {
                    this.logger.warn(`im-qqbot: keyboard send failed, fallback to text: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            await this.sender.sendMarkdown(record.replyTarget, formatQuestion(question, hint, false));
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
        void this.sender.sendMarkdown(entry.record.replyTarget, '⚠️ 提问已超时，未收到回答。').catch(() => { });
        entry.reject(new QuestionChannelError('ask_user_question timed out before the user answered', ASK_ABORTED));
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