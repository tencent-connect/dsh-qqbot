/**
 * RPC 载体测试 —— 宿主 Connection fetch 通道上的信封协议、方法分发、
 * 注册形状与生命周期（fiber 卸载后 plugin/reloading）。
 */
import { describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { registerPluginRpc, rpcOk, rpcFailure, type RpcMethodHandler } from './rpc-carrier.ts';

interface RegisteredRoute {
  path: string;
  methods: readonly string[];
  requestBody: string;
  fetch: (request: Request) => Promise<Response>;
}

/** 可控的 connection.fetch 注册表（记录路由、支持手动触发 effect 清理） */
function fakeConnectionContext(): { ctx: Context; routes: Map<string, RegisteredRoute> } {
  const ctx = new Context();
  const routes = new Map<string, RegisteredRoute>();
  ctx.provide('connection', {
    fetch: {
      register(route: RegisteredRoute) {
        routes.set(route.path, route);
        return async () => { routes.delete(route.path); };
      },
    },
  });
  return { ctx, routes };
}

function envelopeRequest(endpoint: string, method: string, payload: unknown, rpcId = 'rpc-1'): Request {
  return new Request(`http://localhost/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { method, payload } }),
  });
}

async function replyOf(response: Response): Promise<{ rpcId: string; result: { ok: boolean; value?: unknown; error?: { code: string; message: string } } }> {
  expect(response.headers.get('content-type')).toContain('application/json');
  const reply = await response.json();
  if (reply.result.ok === false) {
    expect(reply.result.error.details).toEqual({});
  }
  return reply;
}

describe('rpc carrier', () => {
  it('registers one POST buffered route below /api and dispatches by envelope method', async () => {
    const { ctx, routes } = fakeConnectionContext();
    const handler: RpcMethodHandler = async (method) => method === 'demo.echo'
      ? rpcOk({ echoed: true })
      : rpcFailure('qqbot/unknown-method', `未知方法: ${method}`);

    registerPluginRpc(ctx, 'dsh-qqbot/test', handler);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const route = routes.get('/api/dsh-qqbot/test');
    expect(route).toBeDefined();
    expect(route!.methods).toEqual(['POST']);
    expect(route!.requestBody).toBe('buffered');

    const response = await route!.fetch(envelopeRequest('dsh-qqbot/test', 'demo.echo', { x: 1 }));
    expect(response.status).toBe(200);
    expect(await replyOf(response)).toMatchObject({ type: 'server-response', rpcId: 'rpc-1', result: { ok: true, value: { echoed: true } } });

    const miss = await route!.fetch(envelopeRequest('dsh-qqbot/test', 'demo.nope', {}));
    expect((await replyOf(miss)).result).toMatchObject({ ok: false, error: { code: 'qqbot/unknown-method' } });
  });

  it('carries the call payload and signal through to the handler', async () => {
    const { ctx, routes } = fakeConnectionContext();
    const seen: Array<{ method: string; payload: Record<string, unknown> }> = [];
    registerPluginRpc(ctx, 'dsh-qqbot/test', async (method, payload, callSignal) => {
      seen.push({ method, payload });
      expect(callSignal).toBeInstanceOf(AbortSignal);
      return rpcOk(null);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    await routes.get('/api/dsh-qqbot/test')!.fetch(envelopeRequest('dsh-qqbot/test', 'pair.issue', { purpose: 'owner' }));
    expect(seen).toEqual([{ method: 'pair.issue', payload: { purpose: 'owner' } }]);
  });

  it('rejects non-POST methods and non-JSON content types', async () => {
    const { ctx, routes } = fakeConnectionContext();
    registerPluginRpc(ctx, 'dsh-qqbot/test', () => rpcOk(null));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const route = routes.get('/api/dsh-qqbot/test')!;

    expect((await route.fetch(new Request('http://localhost/api/dsh-qqbot/test'))).status).toBe(405);
    expect((await route.fetch(new Request('http://localhost/api/dsh-qqbot/test', {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x',
    }))).status).toBe(415);
  });

  it('rejects malformed envelopes and bodies without touching the handler', async () => {
    const { ctx, routes } = fakeConnectionContext();
    const handler = vi.fn(() => rpcOk(null));
    registerPluginRpc(ctx, 'dsh-qqbot/test', handler);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const route = routes.get('/api/dsh-qqbot/test')!;

    // 非 JSON body
    expect((await route.fetch(new Request('http://localhost/api/dsh-qqbot/test', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not-json{',
    }))).status).toBe(400);

    // 信封形态错误（type/method 不匹配）
    const wrongType = await route.fetch(new Request('http://localhost/api/dsh-qqbot/test', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'rpc-9', method: 'other-endpoint', payload: { method: 'x', payload: {} } }),
    }));
    expect(await replyOf(wrongType)).toMatchObject({ rpcId: 'rpc-9', result: { ok: false, error: { code: 'qqbot/bad-request' } } });

    // payload.call.method 非字符串
    const noMethod = await route.fetch(new Request('http://localhost/api/dsh-qqbot/test', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'rpc-8', method: 'dsh-qqbot/test', payload: { payload: {} } }),
    }));
    expect(await replyOf(noMethod)).toMatchObject({ rpcId: 'rpc-8', result: { ok: false, error: { code: 'qqbot/bad-request' } } });

    expect(handler).not.toHaveBeenCalled();
  });

  it('converges handler throws into an internal error result', async () => {
    const { ctx, routes } = fakeConnectionContext();
    registerPluginRpc(ctx, 'dsh-qqbot/test', async () => { throw new Error('boom'); });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const response = await routes.get('/api/dsh-qqbot/test')!.fetch(envelopeRequest('dsh-qqbot/test', 'demo.echo', {}));
    expect(await replyOf(response)).toMatchObject({ result: { ok: false, error: { code: 'qqbot/internal', message: 'boom' } } });
  });

  it('answers plugin/reloading after the fiber-scoped registration is disposed', async () => {
    const { ctx, routes } = fakeConnectionContext();
    let disposeEffects: Array<() => void> = [];
    // 捕获 scoped.effect 注册的清理（fiber 卸载语义）
    const originalEffect = ctx.effect.bind(ctx);
    vi.spyOn(ctx, 'effect').mockImplementation(((fn: () => (() => void) | void, label?: string) => {
      const cleanup = fn();
      if (typeof cleanup === 'function' && String(label).includes('im-qqbot.rpc')) disposeEffects.push(cleanup);
      return originalEffect(() => { void cleanup; }, label);
    }) as typeof ctx.effect);

    const handler = vi.fn(() => rpcOk(null));
    registerPluginRpc(ctx, 'dsh-qqbot/test', handler);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const route = routes.get('/api/dsh-qqbot/test')!;
    expect((await replyOf(await route.fetch(envelopeRequest('dsh-qqbot/test', 'demo.echo', {})))).result.ok).toBe(true);

    // fiber 卸载：disposed 标记生效 + 路由注销
    for (const dispose of disposeEffects) dispose();
    const response = await route.fetch(envelopeRequest('dsh-qqbot/test', 'demo.echo', {}));
    expect(await replyOf(response)).toMatchObject({ result: { ok: false, error: { code: 'plugin/reloading' } } });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('stays silent when the connection service is absent (older hosts)', async () => {
    const ctx = new Context();
    expect(() => registerPluginRpc(ctx, 'dsh-qqbot/test', () => rpcOk(null))).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
});
