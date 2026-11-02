import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';

export interface QQMiddlewareContext extends MiddlewareContext {
  state: MiddlewareContext['state'] & {
    qqRecord?: { cursor: number; provenance: 'command' | 'interaction' | 'qq'; releaseTrigger?: () => void };
  };
}
