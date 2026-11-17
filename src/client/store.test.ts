/**
 * 绑定状态存储的行为锚点 —— 引用计数轮询（多表面单一计时器）、
 * gone 双语义（首次端点缺失 = 插件未启用；HMR 窗口 = 保留快照）、
 * recheck 快速收敛窗口、在途请求取消。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getBindSnapshot, recheckBindState, subscribeBindStore } from './store.ts';
import { BIND_METHODS, BIND_RPC_ENDPOINT, RPC_ERROR_CODES } from '../shared/rpc-protocol.ts';
import { RpcError, type RpcResultLike } from './rpc.ts';

// 断言失败也保证退订：store 是模块级单例，监听器泄漏会级联污染后续用例
const stops: Array<() => void> = [];
const track = (listener: () => void): (() => void) => {
  const stop = subscribeBindStore(listener);
  stops.push(stop);
  return stop;
};

/** rpcCall 的可控替身：按当前 implementation 应答 */
const rpc = vi.hoisted(() => ({ impl: null as null | ((signal?: AbortSignal) => Promise<RpcResultLike>) }));
vi.mock('./rpc.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./rpc.ts')>();
  return {
    ...actual,
    // 与真实 rpcCall 同语义：ok → 解包 value；!ok → 抛 RpcError
    rpcCall: vi.fn(async (_endpoint: string, _method: string, _payload: unknown, _timeout?: number, signal?: AbortSignal) => {
      const result = rpc.impl === null
        ? { ok: true as const, value: { phase: 'starting' as const } }
        : await rpc.impl(signal);
      if (!result.ok) {
        throw new RpcError(result.error?.code ?? 'qqbot/internal', result.error?.message ?? '请求失败');
      }
      return result.value;
    }),
  };
});
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: () => null, Input: () => null, Modal: () => null,
  Switch: () => null, SegmentedControl: () => null, DisclosureRow: () => null,
}));

const bound = { ok: true, value: { phase: 'bound' as const, appId: 'bot' } };
const notFound = (): Promise<RpcResultLike> =>
  Promise.reject(new RpcError(RPC_ERROR_CODES.routeMissing, '插件未启用或当前版本不支持端内配置', true));

afterEach(() => {
  while (stops.length > 0) stops.pop()!();
  rpc.impl = null;
  vi.clearAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('bind store', () => {
  it('shares one poller across subscribers and stops with the last unsubscribe', async () => {
    vi.useFakeTimers();
    rpc.impl = async () => bound;
    const { rpcCall } = await import('./rpc.ts');

    const first = track(() => {});
    const second = track(() => {});
    await vi.advanceTimersByTimeAsync(0);
    // 两个订阅者只有一个轮询器、一次调用
    expect(rpcCall).toHaveBeenCalledTimes(1);
    expect(rpcCall).toHaveBeenCalledWith(BIND_RPC_ENDPOINT, BIND_METHODS.state, {}, 10_000, expect.any(AbortSignal));

    first();
    await vi.advanceTimersByTimeAsync(30000);
    // bound 稳定态 30s 节拍，仍恰好一次
    expect(rpcCall).toHaveBeenCalledTimes(2);

    second();
    await vi.advanceTimersByTimeAsync(120000);
    // 最后一个退订后轮询器停止
    expect(rpcCall).toHaveBeenCalledTimes(2);
    expect(getBindSnapshot()).toEqual({ state: null, gone: false, error: null });
  });

  it('clears the old account before remount and does not restore it on a failed first read', async () => {
    vi.useFakeTimers();
    rpc.impl = async () => bound;
    const stop = track(() => {});
    await vi.advanceTimersByTimeAsync(0);
    stop();
    expect(getBindSnapshot()).toEqual({ state: null, gone: false, error: null });

    rpc.impl = async () => { throw new Error('network'); };
    track(() => {});
    expect(getBindSnapshot().state).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(getBindSnapshot()).toEqual({ state: null, gone: false, error: 'network' });

    rpc.impl = async () => ({ ok: true, value: { phase: 'bound', appId: 'new-bot' } });
    recheckBindState();
    await vi.advanceTimersByTimeAsync(0);
    expect(getBindSnapshot().state).toEqual({ phase: 'bound', appId: 'new-bot' });
  });

  it('ignores a late successful response after the last unsubscribe', async () => {
    vi.useFakeTimers();
    let resolve: ((result: RpcResultLike) => void) | undefined;
    rpc.impl = () => new Promise(done => { resolve = done; });
    const stop = track(() => {});
    stop();
    resolve!(bound);
    await vi.advanceTimersByTimeAsync(0);
    expect(getBindSnapshot()).toEqual({ state: null, gone: false, error: null });

    rpc.impl = () => notFound();
    track(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(getBindSnapshot().gone).toBe(true);
    expect(getBindSnapshot().state).toBeNull();
  });

  it('treats a first missing endpoint as plugin-not-enabled and a later one as a reload window', async () => {
    vi.useFakeTimers();
    rpc.impl = () => notFound();

    track(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(getBindSnapshot().gone).toBe(true);

    // 端点恢复：recheck 立即重轮询并清除 gone
    rpc.impl = async () => bound;
    recheckBindState();
    await vi.advanceTimersByTimeAsync(0);
    expect(getBindSnapshot().gone).toBe(false);
    expect(getBindSnapshot().state).toEqual({ phase: 'bound', appId: 'bot' });

    // HMR 重载窗口期的端点缺失：保留最后快照，不回退到「插件未启用」终态
    rpc.impl = () => notFound();
    await vi.advanceTimersByTimeAsync(2000);
    const snapshot = getBindSnapshot();
    expect(snapshot.gone).toBe(false);
    expect(snapshot.state).toEqual({ phase: 'bound', appId: 'bot' });
  });

  it('collapses the bound-phase cadence into an urgent window after recheck', async () => {
    vi.useFakeTimers();
    rpc.impl = async () => bound;
    const { rpcCall } = await import('./rpc.ts');

    track(() => {});
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30000);
    expect(rpcCall).toHaveBeenCalledTimes(2);

    // 解绑等动作后 recheck：立即重轮询，收敛窗口内按 2s 快节拍
    recheckBindState();
    await vi.advanceTimersByTimeAsync(1000);
    expect(rpcCall).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(rpcCall).toHaveBeenCalledTimes(4);
  });

  it('notifies subscribers on changes and keeps the snapshot identity between them', async () => {
    vi.useFakeTimers();
    let phase: 'starting' | 'bound' = 'starting';
    rpc.impl = async () => ({ ok: true, value: phase === 'starting' ? { phase: 'starting' } : { phase: 'bound', appId: 'bot' } });

    let notified = 0;
    track(() => { notified += 1; });
    await vi.advanceTimersByTimeAsync(0);
    expect(notified).toBe(1);
    const before = getBindSnapshot();
    await vi.advanceTimersByTimeAsync(2000);
    // 相同相位不重复通知，快照引用稳定
    expect(notified).toBe(1);
    expect(getBindSnapshot()).toBe(before);

    phase = 'bound';
    await vi.advanceTimersByTimeAsync(2000);
    expect(notified).toBe(2);
    expect(getBindSnapshot()).not.toBe(before);
    expect(getBindSnapshot().state).toEqual({ phase: 'bound', appId: 'bot' });
  });

  it('aborts the in-flight call on the last unsubscribe, so a remount reads immediately', async () => {
    vi.useFakeTimers();
    const { rpcCall } = await import('./rpc.ts');
    // 挂起型实现：仅当 store abort（signal 触发 rpcCall 内部 AbortError）时结束。
    // 替身直接观察 signal：abort 后以 AbortError reject，模拟真实通道取消。
    rpc.impl = (signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('请求已取消', 'AbortError')));
    });

    const first = track(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(rpcCall).toHaveBeenCalledTimes(1);

    // 最后退订：在途调用被取消（否则新挂载首读要等它落地，挂起时最长 10s）
    first();
    const second = track(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(rpcCall).toHaveBeenCalledTimes(2);
    // 被废弃调用的取消错误不得污染快照
    expect(getBindSnapshot().error).toBeNull();
    second();
  });

  it('aborts the in-flight call on recheck and starts the next poll immediately', async () => {
    vi.useFakeTimers();
    const { rpcCall } = await import('./rpc.ts');
    rpc.impl = (signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('请求已取消', 'AbortError')));
    });

    track(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(rpcCall).toHaveBeenCalledTimes(1);

    recheckBindState();
    await vi.advanceTimersByTimeAsync(0);
    // 旧调用废弃（快速 reject），新轮询立即发起而非等待
    expect(rpcCall).toHaveBeenCalledTimes(2);
    expect(getBindSnapshot().error).toBeNull();
  });
});
