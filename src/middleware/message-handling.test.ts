import { describe, expect, it } from 'vitest';
import { createMessageHandlingMiddleware } from './message-handling.ts';
import type { ImQQBotConfig } from '../config.ts';

function config(mode: 'queue' | 'interrupt'): ImQQBotConfig {
  return { messageHandlingMode: mode, maxQueue: 20, processingTimeoutMs: 0 } as ImQQBotConfig;
}

describe('createMessageHandlingMiddleware', () => {
  it('queue 模式返回并发守卫（同 peer 串行 + 忙时缓冲合并）', () => {
    expect(createMessageHandlingMiddleware(config('queue'))).toBeTypeOf('function');
  });

  it('interrupt 模式不挂守卫，忙时消息直通 handleInbound 由 steer 补充', () => {
    expect(createMessageHandlingMiddleware(config('interrupt'))).toBeUndefined();
  });
});
