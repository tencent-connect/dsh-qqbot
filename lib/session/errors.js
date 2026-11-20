/**
 * 会话层可分类错误的类型与统一分类入口。
 *
 * 之前用「往普通 Error 上挂 code 属性 + 字符串比对」识别归档错误，拼错即静默
 * 失配且无类型约束；现在收敛为错误类 + 分类函数，调用方不再各自读 `err.code`。
 *
 * ⚠️ 分类保留 duck-typing 兜底：插件热重载会让新旧两个模块实例并存，
 * 旧实例抛出的错误对新实例的 `instanceof` 不成立（同款问题见维护手册
 * 「disposer 存 WeakMap 不存模块级变量」那条），按 code 字段再认一次。
 */
/** 会话已归档：宿主的 archived-session-gate 会拒绝它的一切回合 */
export class SessionArchivedError extends Error {
    sessionId;
    code = 'session-archived';
    constructor(sessionId) {
        super(`Session ${sessionId} is archived and cannot process this message`);
        this.sessionId = sessionId;
        this.name = 'SessionArchivedError';
    }
}
/**
 * 把任意 thrown 值分类为会话错误种类。
 *
 * 只认归档一种具体种类；其余（损坏、占用、后端故障……）全部归 'other'，
 * 由调用方按各自语境给出通用提示，避免在这里维护一张不完全的错误表。
 */
export function classifySessionError(err) {
    if (err instanceof SessionArchivedError)
        return 'session-archived';
    if (err?.code === 'session-archived') {
        return 'session-archived';
    }
    return 'other';
}
//# sourceMappingURL=errors.js.map