/** Read-only runtime snapshot shared by the Host and the QQ sidebar. */
export const RUNTIME_STATE_PATH = '/qqbot/im-qqbot/runtime';

/** Gateway state; credential binding is reported separately by the binding endpoint. */
export type RuntimePhase = 'unbound' | 'connecting' | 'ready' | 'reconnecting' | 'failed' | 'stopped';

/** Activity times record gateway input and successfully completed message sends. */
export interface RuntimeStateWire {
  phase: RuntimePhase;
  updatedAt: number;
  lastReceivedAt: number | null;
  lastSentAt: number | null;
  lastError: string | null;
}
