/**
 * 手动凭据提交（RPC 通道）测试 —— submitManualCredentials 经 rpc.ts 调用
 * bind.manual：结果解包、服务端失败与网络失败的错误回传。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitManualCredentials } from './bind-page.ts';
import { BIND_METHODS, BIND_RPC_ENDPOINT } from '../shared/rpc-protocol.ts';
import { RpcError, type RpcResultLike } from './rpc.ts';

const rpcState = vi.hoisted(() => ({ result: { ok: true, value: {} as unknown } as RpcResultLike }));
vi.mock('./rpc.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./rpc.ts')>();
  return {
    ...actual,
    // 与真实 rpcCall 同语义：ok → 解包 value；!ok → 抛 RpcError
    rpcCall: vi.fn(async () => {
      const result = rpcState.result;
      if (result.ok) return result.value;
      throw new RpcError(result.error?.code ?? 'qqbot/internal', result.error?.message ?? '请求失败');
    }),
  };
});
// bind-page 经 store/styles 间接依赖 react；stub 掉宿主组件即可纯逻辑测试
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  Button: () => null, Input: () => null, Modal: () => null,
  Switch: () => null, SegmentedControl: () => null, DisclosureRow: () => null,
}));

afterEach(() => { rpcState.result = { ok: true, value: {} }; });

describe('manual credential submission (rpc)', () => {
  it('submits only the entered credentials and returns the saved-state feedback', async () => {
    rpcState.result = { ok: true, value: { ok: true, message: '凭据已保存，插件将自动重载' } };

    await expect(submitManualCredentials('test-app', 'test-secret'))
      .resolves.toEqual({ ok: true, message: '凭据已保存，插件将自动重载' });
    const { rpcCall } = await import('./rpc.ts');
    expect(rpcCall).toHaveBeenCalledWith(BIND_RPC_ENDPOINT, BIND_METHODS.manual, { appId: 'test-app', appSecret: 'test-secret' });
  });

  it('returns the server failure without claiming that credentials were saved', async () => {
    rpcState.result = { ok: false, error: { code: 'bind/persist-failed', message: '配置文件无法写入' } };

    await expect(submitManualCredentials('test-app', 'test-secret'))
      .resolves.toEqual({ ok: false, error: '配置文件无法写入' });
  });

  it('returns a network failure so the form can remain available for retry', async () => {
    const { rpcCall } = await import('./rpc.ts');
    vi.mocked(rpcCall).mockRejectedValueOnce(new RpcError('transport/network', '网络不可用'));

    await expect(submitManualCredentials('test-app', 'test-secret'))
      .resolves.toEqual({ ok: false, error: '网络不可用' });
  });
});
