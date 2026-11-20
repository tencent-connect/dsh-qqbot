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
  readonly code = 'session-archived' as const;

  constructor(readonly sessionId: string) {
    super(`Session ${sessionId} is archived and cannot process this message`);
    this.name = 'SessionArchivedError';
  }
}

/** 会话正被其他活跃写句柄占用（桌面端打开中，或上一次重载还没释放完） */
export class SessionBusyError extends Error {
  readonly code = 'session-busy' as const;

  constructor(readonly sessionId: string, options?: ErrorOptions) {
    super(`Session ${sessionId} is held by another active write handle`, options);
    this.name = 'SessionBusyError';
  }
}

/** 会话错误的分类结果：未知错误一律 'other'，不做猜测 */
export type SessionErrorKind = 'session-archived' | 'session-busy' | 'other';

/**
 * 把任意 thrown 值分类为会话错误种类。
 *
 * 只认归档与写句柄占用两种具体种类；其余（损坏、后端故障……）全部归 'other'，
 * 由调用方按各自语境给出通用提示，避免在这里维护一张不完全的错误表。
 */
export function classifySessionError(err: unknown): SessionErrorKind {
  if (err instanceof SessionArchivedError) return 'session-archived';
  if (err instanceof SessionBusyError) return 'session-busy';
  const code = (err as { code?: unknown } | null | undefined)?.code;
  if (code === 'session-archived') return 'session-archived';
  if (code === 'session-busy') return 'session-busy';
  return 'other';
}

/**
 * 宿主写句柄冲突（`SessionAlreadyOwnedError`）。
 *
 * 该错误跨版本稳定的只有 message；name 可能被中间层包装或丢失，
 * 因此 name 与 message 双条件识别。
 */
export function isSessionOwnedError(err: unknown): boolean {
  if ((err as { name?: unknown } | null | undefined)?.name === 'SessionAlreadyOwnedError') return true;
  const message = err instanceof Error ? err.message : String(err ?? '');
  return message.includes('is already owned by an active write handle');
}
