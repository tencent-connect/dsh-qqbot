/**
 * 消息处理方式的行为测试（使用真实 SDK concurrencyGuard，不 mock 其内部状态）。
 *
 * 时序断言：
 * - 排队：第一条任务未收敛时，第二条消息不得进入下游；收敛后才处理。
 * - 插话：第一条任务未收敛时，第二条消息立即并行进入下游（followup 注入）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import { createMessageHandlingMiddleware } from './message-handling.ts';
import type { ImQQBotConfig, MessageHandlingMode } from '../config.ts';

function config(mode: MessageHandlingMode | undefined): ImQQBotConfig {
  return {
    maxQueue: 20,
    // 关闭超时看门狗，避免测试里的挂起任务被 abort 干扰断言
    processingTimeoutMs: 0,
    messageHandlingMode: mode,
  } as ImQQBotConfig;
}

function makeCtx(msgId: string): MiddlewareContext {
  const replyTarget = { scope: 'c2c', targetId: 'U1', msgId };
  const abortController = new AbortController();
  return {
    message: { messageId: msgId, content: msgId, kind: 'c2c', senderId: 'U1', replyTarget },
    replyTarget,
    state: {},
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    stop: vi.fn(),
    stopped: false,
    stopReason: undefined,
    signal: abortController.signal,
    abort: (reason?: string) => abortController.abort(reason),
    aborted: false,
    receivedAt: Date.now(),
  } as unknown as MiddlewareContext;
}

function pendingTask(): { task: Promise<void>; release: () => void } {
  let release!: () => void;
  const task = new Promise<void>((resolve) => { release = resolve; });
  return { task, release };
}

describe('createMessageHandlingMiddleware', () => {
  it.each([undefined, 'queue'] as const)(
    '排队（mode=%s）：当前任务结束后才处理新消息',
    async (mode) => {
      const middleware = createMessageHandlingMiddleware(config(mode));
      const { task, release } = pendingTask();
      const firstNext = vi.fn(async () => { await task; });
      const secondNext = vi.fn(async () => {});

      const first = middleware(makeCtx('m1'), firstNext);
      const second = middleware(makeCtx('m2'), secondNext);
      await vi.waitFor(() => expect(firstNext).toHaveBeenCalledTimes(1));

      // 当前任务仍在运行：新消息必须停在缓冲里，不能提前 followup
      expect(secondNext).not.toHaveBeenCalled();

      release();
      await Promise.all([first, second]);
      expect(secondNext).toHaveBeenCalledTimes(1);
    },
  );

  it('插话：当前任务未结束时，新消息立即并行进入下游', async () => {
    const middleware = createMessageHandlingMiddleware(config('interrupt'));
    const { task, release } = pendingTask();
    let firstDone = false;
    const firstNext = vi.fn(async () => { await task; firstDone = true; });
    const secondNext = vi.fn(async () => {});

    const first = middleware(makeCtx('m1'), firstNext);
    const second = middleware(makeCtx('m2'), secondNext);
    await vi.waitFor(() => expect(secondNext).toHaveBeenCalledTimes(1));

    // 第一条任务仍然挂着（未收敛），插话消息已经进入下游
    expect(firstNext).toHaveBeenCalledTimes(1);
    expect(firstDone).toBe(false);

    release();
    await Promise.all([first, second]);
    expect(secondNext).toHaveBeenCalledTimes(1);
  });

  it('插话：连续多条补充消息都不丢（urgent 通道不产生缓冲堆积）', async () => {
    const middleware = createMessageHandlingMiddleware(config('interrupt'));
    const { task, release } = pendingTask();
    const nexts = [vi.fn(async () => { await task; }), vi.fn(async () => {}), vi.fn(async () => {}), vi.fn(async () => {})];

    const runs = nexts.map((next, index) => middleware(makeCtx(`m${index}`), next));
    await vi.waitFor(() => expect(nexts.every(next => next.mock.calls.length === 1)).toBe(true));

    release();
    await Promise.all(runs);
    for (const next of nexts) expect(next).toHaveBeenCalledTimes(1);
  });
});
