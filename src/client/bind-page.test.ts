import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitManualCredentials } from './bind-page.ts';
import { BIND_MANUAL_PATH } from '../shared/bind-protocol.ts';

afterEach(() => { vi.unstubAllGlobals(); });

describe('manual credential submission', () => {
  it('submits only the entered credentials and returns the saved-state feedback', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ok: true, message: '凭据已保存，插件将自动重载' }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetch);

    await expect(submitManualCredentials('test-app', 'test-secret'))
      .resolves.toEqual({ ok: true, message: '凭据已保存，插件将自动重载' });
    expect(fetch).toHaveBeenCalledWith(BIND_MANUAL_PATH, expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId: 'test-app', appSecret: 'test-secret' }),
    }));
  });

  it('returns the server failure without claiming that credentials were saved', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ok: false, error: '配置文件无法写入' }),
      { status: 500 },
    )));

    await expect(submitManualCredentials('test-app', 'test-secret'))
      .resolves.toEqual({ ok: false, error: '配置文件无法写入' });
  });

  it('handles an explicit failure response even when HTTP succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ok: false }),
      { status: 200 },
    )));

    await expect(submitManualCredentials('test-app', 'test-secret'))
      .resolves.toEqual({ ok: false, error: '保存失败，请重试' });
  });

  it('returns a network failure so the form can remain available for retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('网络不可用')));

    await expect(submitManualCredentials('test-app', 'test-secret'))
      .resolves.toEqual({ ok: false, error: '网络不可用' });
  });
});
