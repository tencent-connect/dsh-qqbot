/**
 * 全链路宿主回归 —— 真实 cordis + 真实 @deepseek-ai/dsh-client-connection
 * (devDependency 锁定 0.2.2-rc.3，与类型基线同源) 之上装配 registerPluginRpc：
 * 1. 信封协议与宿主共享通道互洽（客户端 wire 组装 → 宿主路由 → 我们的 handler）
 * 2. 未注册端点返回真实 404（gone 语义的宿主侧证据）
 * 3. owner 门控（非 owner peer 被宿主拒绝）
 * 4. fiber 卸载后路由注销
 *
 * 宿主升级时抬升 devDependency 版本并重跑本文件——这是宿主互洽性的第一道报警线。
 */
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { createRequire } from 'node:module';
import { createWebConnectionRpc } from '@deepseek-ai/dsh-client-connection/src/client/rpc.ts';
import { registerPluginRpc, rpcOk, rpcFailure } from './rpc-carrier.ts';
import { rpcCall, setClientConnection } from './client/rpc.ts';

// 真实宿主实现（ESM 包，经 Node 解析；与本仓库 cordis 同版本基线）
const require = createRequire(import.meta.url);
const connection = require('@deepseek-ai/dsh-client-connection') as {
  HostConnectionService: new (ctx: Context, trustedHosts: readonly string[]) => {
    createSharedFetchHandler(channel: '/api'): { fetch: (request: Request, peer: unknown) => Promise<Response> };
  };
};

/** 宿主认证层替身：connection 服务的 inject 面未在本测试展开，直接用 createPeer 拿 owner peer 太深——
 *  改为从宿主服务的 browserPeer 取（owner principal，与浏览器真实路径一致） */
type ConnectionService = Awaited<ReturnType<typeof bootConnection>>;
let service: ConnectionService;

async function bootConnection() {
  const ctx = new Context();
  // HostConnectionService 是 cordis Service：构造即挂载（其 ctx.effect 随
  // fiber 记账），无需 ctx.plugin
  const svc = new connection.HostConnectionService(ctx, []);
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  return svc as unknown as {
    browserPeer: { principal: { kind: string }; peer: unknown };
    createSharedFetchHandler(channel: '/api'): { fetch: (request: Request, peer: unknown) => Promise<Response> };
  };
}

beforeAll(async () => {
  service = await bootConnection();
});

/** 组装真实客户端 wire：与宿主 client rpc.call 相同的信封形状 */
function clientEnvelope(endpoint: string, method: string, payload: unknown, rpcId = 'e2e-1'): Request {
  return new Request(`http://127.0.0.1:3080/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { method, payload } }),
  });
}

describe('host e2e: registerPluginRpc on the real connection carrier (0.2.2-rc.3)', () => {
  /** 宿主环境里 connection 服务由宿主提供（dsh-im 生产同款可见性）；
   *  测试里把真实 service provide 到插件 ctx，模拟宿主装配 */
  function pluginContext(): Context {
    const ctx = new Context();
    ctx.provide('connection', service);
    return ctx;
  }

  it('round-trips the envelope through the real shared /api handler', async () => {
    const ctx = pluginContext();
    const seen: Array<{ method: string; payload: Record<string, unknown> }> = [];
    registerPluginRpc(ctx, 'dsh-qqbot/bind', async (method, payload) => {
      seen.push({ method, payload });
      return rpcOk({ phase: 'bound', appId: 'bot' });
    });
    await new Promise((resolve) => { setTimeout(resolve, 20); });

    const handler = service.createSharedFetchHandler('/api');
    const browserPeer = service.browserPeer as unknown as { peer: { principal: { kind: string } } };
    // owner peer：本地部署浏览器请求的真实身份
    const response = await handler.fetch(
      clientEnvelope('dsh-qqbot/bind', 'bind.state', {}),
      { principal: { kind: 'owner' } },
    );

    expect(response.status).toBe(200);
    const reply = await response.json() as { type: string; rpcId: string; result: { ok: boolean; value: unknown } };
    expect(reply.type).toBe('server-response');
    expect(reply.rpcId).toBe('e2e-1');
    expect(reply.result).toEqual({ ok: true, value: { phase: 'bound', appId: 'bot' } });
    expect(seen).toEqual([{ method: 'bind.state', payload: {} }]);
  });

  it.each([
    { code: 'config/conflict', message: '配置已被其他会话修改', throws: false },
    { code: 'plugin/reloading', message: '插件正在重载', throws: false },
    { code: 'bind/invalid-credentials', message: '凭据无效', throws: false },
    { code: 'qqbot/unknown-method', message: '未知方法', throws: false },
    { code: 'qqbot/internal', message: '处理器异常', throws: true },
  ])('preserves $code through the real browser caller and shared carrier', async ({ code, message, throws }) => {
    const ctx = pluginContext();
    const endpoint = `dsh-qqbot/failure-${code.replace('/', '-')}`;
    const registration = registerPluginRpc(ctx, endpoint, () => {
      if (throws) throw new Error(message);
      return rpcFailure(code, message);
    });
    try {
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      const handler = service.createSharedFetchHandler('/api');
      const rpc = createWebConnectionRpc(async (input, init) => handler.fetch(
        new Request(new URL(input, 'http://127.0.0.1:3080/'), init),
        { principal: { kind: 'owner' } },
      ));
      expect(await rpc.call('/api', endpoint, { method: 'demo.fail', payload: {} })).toEqual({
        ok: false, error: { code, message, details: {} },
      });
      setClientConnection({ rpc });
      await expect(rpcCall(endpoint, 'demo.fail')).rejects.toMatchObject({
        name: 'Error', code, message, gone: false,
      });
    } finally {
      setClientConnection(undefined);
      await registration.dispose();
    }
  });

  it('answers a real 404 for unregistered endpoints (gone semantics on the host side)', async () => {
    const handler = service.createSharedFetchHandler('/api');
    const response = await handler.fetch(
      clientEnvelope('dsh-qqbot/absent', 'bind.state', {}),
      { principal: { kind: 'owner' } },
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('not found');
  });

  it('refuses non-owner principals before reaching the plugin handler', async () => {
    const ctx = pluginContext();
    const handler0 = vi.fn(() => rpcOk(null));
    registerPluginRpc(ctx, 'dsh-qqbot/guard', handler0);
    await new Promise((resolve) => { setTimeout(resolve, 20); });

    const handler = service.createSharedFetchHandler('/api');
    const response = await handler.fetch(
      clientEnvelope('dsh-qqbot/guard', 'demo.echo', {}),
      { principal: { kind: 'anonymous' } },
    );
    expect(response.status).toBe(403);
    expect(handler0).not.toHaveBeenCalled();
  });

  it('deregisters the route when the plugin fiber unloads', async () => {
    const ctx = pluginContext();
    const registration = registerPluginRpc(ctx, 'dsh-qqbot/lifecycle', () => rpcOk(null));
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    const handler = service.createSharedFetchHandler('/api');

    const before = await handler.fetch(clientEnvelope('dsh-qqbot/lifecycle', 'demo.echo', {}), { principal: { kind: 'owner' } });
    expect(before.status).toBe(200);

    await registration.dispose();
    await new Promise((resolve) => { setTimeout(resolve, 20); });

    const after = await handler.fetch(clientEnvelope('dsh-qqbot/lifecycle', 'demo.echo', {}), { principal: { kind: 'owner' } });
    expect(after.status).toBe(404);
  });
});
