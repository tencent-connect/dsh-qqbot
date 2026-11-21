/**
 * 客户端 RPC 层测试 —— 结果解包、错误归类（code/gone）、超时与取消传播。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RPC_CHANNEL, RPC_ERROR_CODES } from '../shared/rpc-protocol.ts';
import { RpcError, rpcCall, setClientConnection } from './rpc.ts';

interface FakeConnection {
  calls: Array<{ channel: string; endpoint: string; payload: unknown; signal?: AbortSignal }>;
  respond: (payload: unknown, signal?: AbortSignal) => Promise<unknown>;
}

function fakeConnection(respond: FakeConnection['respond']): FakeConnection {
  const connection: FakeConnection = {
    calls: [],
    respond,
  };
  setClientConnection({
    rpc: {
      async call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) {
        connection.calls.push({ channel, endpoint, payload, signal });
        return respond(payload, signal);
      },
    },
  });
  return connection;
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  setClientConnection(undefined);
});

describe('client rpc', () => {
  it('unwraps ok results and passes the envelope payload through the host connection', async () => {
    const connection = fakeConnection(async () => ({ ok: true, value: { phase: 'bound', appId: 'bot' } }));

    const value = await rpcCall('dsh-qqbot/bind', 'bind.state');
    expect(value).toEqual({ phase: 'bound', appId: 'bot' });
    expect(connection.calls).toEqual([
      { channel: RPC_CHANNEL, endpoint: 'dsh-qqbot/bind', payload: { method: 'bind.state', payload: {} }, signal: expect.any(AbortSignal) },
    ]);
  });

  it('throws RpcError with the server code and message on failure results', async () => {
    fakeConnection(async () => ({ ok: false, error: { code: RPC_ERROR_CODES.configConflict, message: '配置已被其他会话修改' } }));

    await expect(rpcCall('dsh-qqbot/bind', 'config.set', { x: 1 })).rejects.toMatchObject({
      code: RPC_ERROR_CODES.configConflict,
      message: '配置已被其他会话修改',
      gone: false,
    });
  });

  it('maps transport HTTP 404 to a gone RpcError (plugin not enabled)', async () => {
    fakeConnection(async () => { throw new Error('transport failure for /api/dsh-qqbot/bind: HTTP 404'); });

    await expect(rpcCall('dsh-qqbot/bind', 'bind.state')).rejects.toMatchObject({
      code: RPC_ERROR_CODES.routeMissing,
      gone: true,
    });
  });

  it('surfaces network failures as transport errors', async () => {
    fakeConnection(async () => { throw new Error('boom'); });

    await expect(rpcCall('dsh-qqbot/bind', 'bind.state')).rejects.toMatchObject({ code: 'transport/network' });
  });

  it('times out and reports a transport timeout', async () => {
    vi.useFakeTimers();
    fakeConnection((_payload, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));

    const pending = rpcCall('dsh-qqbot/bind', 'bind.state');
    vi.advanceTimersByTime(10_000);
    await expect(pending).rejects.toMatchObject({ code: 'transport/timeout' });
  });

  it('propagates caller cancellation as AbortError', async () => {
    fakeConnection((_payload, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const controller = new AbortController();

    const pending = rpcCall('dsh-qqbot/bind', 'bind.state', {}, 10_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('throws a client error before any transport when the connection is unset', async () => {
    setClientConnection(undefined);
    await expect(rpcCall('dsh-qqbot/bind', 'bind.state')).rejects.toMatchObject({ code: 'client/no-connection' });
  });

  it('keeps RpcError instances intact when the transport rethrows them', async () => {
    fakeConnection(async () => { throw new RpcError('qqbot/internal', 'inner'); });
    await expect(rpcCall('dsh-qqbot/bind', 'bind.state')).rejects.toMatchObject({ code: 'qqbot/internal' });
  });
});
