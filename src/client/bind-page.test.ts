import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitManualCredentials } from './bind-page.ts';
import { BIND_METHODS, BIND_RPC_ENDPOINT, RPC_CHANNEL } from '../shared/rpc-protocol.ts';
import { setClientConnection } from './rpc.ts';

afterEach(() => { setClientConnection(undefined); });

describe('manual credential submission', () => {
  it('submits only the entered credentials and returns the saved-state feedback', async () => {
    const call = vi.fn().mockResolvedValue({ ok: true, value: { ok: true, message: '凭据已保存，插件将自动重载' } });
    setClientConnection({ rpc: { call } });

    await expect(submitManualCredentials('test-app', 'test-secret'))
      .resolves.toEqual({ ok: true, message: '凭据已保存，插件将自动重载' });
    expect(call).toHaveBeenCalledWith(RPC_CHANNEL, BIND_RPC_ENDPOINT, {
      method: BIND_METHODS.manual, payload: { appId: 'test-app', appSecret: 'test-secret' },
    }, expect.any(AbortSignal));
  });

  it('returns the server failure without claiming that credentials were saved', async () => {
    setClientConnection({ rpc: { call: vi.fn().mockResolvedValue({
      ok: false, error: { code: 'bind/persist-failed', message: '配置文件无法写入' },
    }) } });

    await expect(submitManualCredentials('test-app', 'test-secret'))
      .resolves.toEqual({ ok: false, error: '配置文件无法写入' });
  });

  it('handles an explicit failure in a successful RPC result', async () => {
    setClientConnection({ rpc: { call: vi.fn().mockResolvedValue({ ok: true, value: { ok: false } }) } });

    await expect(submitManualCredentials('test-app', 'test-secret'))
      .resolves.toEqual({ ok: false, error: '保存失败，请重试' });
  });

  it('returns a network failure so the form can remain available for retry', async () => {
    setClientConnection({ rpc: { call: vi.fn().mockRejectedValue(new Error('网络不可用')) } });

    await expect(submitManualCredentials('test-app', 'test-secret'))
      .resolves.toEqual({ ok: false, error: '网络不可用' });
  });
});
