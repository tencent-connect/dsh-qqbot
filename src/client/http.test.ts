import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchJson } from './http.ts';

function stalledFetch() {
  return vi.fn((_path: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    signal?.addEventListener('abort', () => { reject(signal.reason); }, { once: true });
  }));
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('fetchJson', () => {
  it('returns JSON and removes the caller listener and timeout after success', async () => {
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    const fetch = vi.fn().mockResolvedValue(new Response('{"saved":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);

    await expect(fetchJson('/settings', { signal: caller.signal, cache: 'no-store' })).resolves.toEqual({ saved: true });
    expect(fetch).toHaveBeenCalledWith('/settings', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('forwards a caller cancellation and reports it separately from timeout', async () => {
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    const fetch = stalledFetch();
    vi.stubGlobal('fetch', fetch);
    const request = fetchJson('/settings', { signal: caller.signal });
    const result = expect(request).rejects.toMatchObject({ name: 'AbortError', message: '请求已取消' });

    caller.abort();
    await result;
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start a request whose caller has already cancelled', async () => {
    const caller = new AbortController();
    caller.abort();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);

    await expect(fetchJson('/settings', { signal: caller.signal }))
      .rejects.toMatchObject({ name: 'AbortError', message: '请求已取消' });
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a stalled request at its timeout and removes the caller listener', async () => {
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    const fetch = stalledFetch();
    vi.stubGlobal('fetch', fetch);
    const request = fetchJson('/settings', { signal: caller.signal }, 100);
    const result = expect(request).rejects.toMatchObject({ name: 'Error', message: '请求超时，请重试' });

    await vi.advanceTimersByTimeAsync(100);
    await result;
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves the first cancellation cause if fetch rejects after the timeout', async () => {
    const caller = new AbortController();
    let fail!: (error: Error) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((_resolve, reject) => { fail = reject; })));
    const request = fetchJson('/settings', { signal: caller.signal }, 100);
    const result = expect(request).rejects.toMatchObject({ name: 'AbortError', message: '请求已取消' });

    caller.abort();
    await vi.advanceTimersByTimeAsync(100);
    fail(new Error('cancelled transport'));
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps HTTP error details and cleans up after a failed response', async () => {
    const caller = new AbortController();
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"保存失败"}', { status: 500 })));

    await expect(fetchJson('/settings', { signal: caller.signal })).rejects.toThrow('保存失败');
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});
