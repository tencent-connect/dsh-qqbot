import type { RuntimePhase, RuntimeStateWire } from '../shared/runtime-protocol.ts';

/** Public error hints contain no SDK error text, credentials, or message content. */
export const RUNTIME_ERROR_HINTS = {
  connection: 'QQ 连接发生错误，请检查机器人凭据或网络。',
  disconnected: 'QQ 连接已断开，正在尝试重新连接。',
  terminal: 'QQ 连接无法恢复，请检查机器人状态和宿主日志。',
  send: '最近一次消息发送失败，请查看宿主日志。',
} as const;

/** One plugin instance owns one in-memory runtime snapshot. */
export class RuntimeState {
  private value: RuntimeStateWire;

  public constructor(private readonly now: () => number = Date.now) {
    this.value = {
      phase: 'unbound',
      updatedAt: now(),
      lastReceivedAt: null,
      lastSentAt: null,
      lastError: null,
    };
  }

  /** Return a detached snapshot so callers cannot mutate the live state. */
  public snapshot(): RuntimeStateWire {
    return { ...this.value };
  }

  /** Ignore late gateway callbacks after this plugin instance has stopped. */
  public setPhase(phase: RuntimePhase, error: string | null = null): void {
    if (this.value.phase === 'stopped') return;
    this.value = { ...this.value, phase, lastError: error, updatedAt: this.now() };
  }

  /** Record an incoming message before access and mention filtering. */
  public received(): void {
    if (this.value.phase === 'stopped') return;
    const at = this.now();
    this.value = { ...this.value, lastReceivedAt: at, updatedAt: at };
  }

  /** Record only a completed send; queuing a stream update does not count. */
  public sent(): void {
    if (this.value.phase === 'stopped') return;
    const at = this.now();
    const lastError = this.value.lastError === RUNTIME_ERROR_HINTS.send ? null : this.value.lastError;
    this.value = { ...this.value, lastSentAt: at, lastError, updatedAt: at };
  }

  /** Keep transport phase separate from a failed outbound operation. */
  public sendFailed(): void {
    if (this.value.phase === 'stopped') return;
    this.value = { ...this.value, lastError: RUNTIME_ERROR_HINTS.send, updatedAt: this.now() };
  }
}
