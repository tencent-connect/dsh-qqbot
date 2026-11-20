/**
 * 宿主侧 RPC 载体 —— 把方法处理器挂到宿主 Connection 共享通道。
 *
 * 与 dsh-im 的 registerManagementRpc 同款方案：在 ctx.connection.fetch 上
 * 注册一条 POST 精确路由，实现 client-request / server-response 信封协议，
 * 以 payload.method 分发到插件方法处理器。来源围栏（Host/Origin trust）
 * 与浏览器认证由宿主在 fetch handler 之前施加——插件不再自建围栏。
 *
 * 处理器返回 { ok, value | error:{code, message, details} }；抛错收敛为
 * qqbot/internal。注册随 ctx.inject(['connection']) 子 fiber 生命周期
 * 自动清理（宿主注册表按 fiber 记账），disposer 仅作提前卸载用。
 */
import type { Context } from '@deepseek-ai/cordis';
/** 宿主 Connection RPC 结果的局部投影。 */
export type RpcResult = { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } };

/** 一个端点内的方法处理器：按 method 分发，payload 为调用参数 */
export type RpcMethodHandler = (
  method: string,
  payload: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<RpcResult> | RpcResult;

/** ctx.connection.fetch 的局部投影（宿主服务，inject 声明后读取） */
interface ConnectionFetchLike {
  fetch: {
    register(route: {
      path: string;
      methods: readonly string[];
      requestBody: 'buffered';
      fetch: (request: Request) => Promise<Response>;
    }): () => Promise<void>;
  };
}

function ok(value: unknown): RpcResult {
  return { ok: true, value };
}

function failure(code: string, message: string): RpcResult {
  return { ok: false, error: { code, message, details: {} } };
}

function rpcResponse(rpcId: string, result: RpcResult): Response {
  return Response.json({ type: 'server-response', rpcId, result }, { headers: { 'cache-control': 'no-store' } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 解析客户端信封 {type:'client-request', rpcId, method, payload:{method,payload}} */
function parseEnvelope(message: unknown, endpoint: string): { rpcId: string; method: string; payload: Record<string, unknown> } | undefined {
  if (!isRecord(message)) return undefined;
  if (message.type !== 'client-request') return undefined;
  if (message.method !== endpoint) return undefined;
  const rpcId = message.rpcId;
  if (typeof rpcId !== 'string') return undefined;
  const call = message.payload;
  if (!isRecord(call) || typeof call.method !== 'string' || !Object.hasOwn(call, 'payload')) return undefined;
  if (!isRecord(call.payload)) return undefined;
  return { rpcId, method: call.method, payload: call.payload };
}

/**
 * 注册一个插件 RPC 端点。ctx.inject(['connection']) 子 fiber 内注册：
 * connection 服务缺席（极老宿主）时静默跳过；fiber 卸载时路由随之注销。
 *
 * @returns 注入子 fiber（thenable + dispose）：dispose 即注销该端点全部
 *          路由；HMR 时宿主随插件 fiber 卸载自动调用，调用方通常无需触碰。
 */
export function registerPluginRpc(ctx: Context, endpoint: string, handler: RpcMethodHandler): { dispose(): Promise<void> } {
  return ctx.inject(['connection'], (scoped: Context) => {
    const registry = (scoped.get('connection') as { fetch?: { register?: unknown } } | undefined)?.fetch;
    if (typeof registry?.register !== 'function') return;
    const connection = registry as ConnectionFetchLike['fetch'];
    let disposed = false;
    const stop = connection.register({
      path: `/api/${endpoint}`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request): Promise<Response> => {
        if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
        const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
        if (contentType !== 'application/json') {
          return new Response('content type must be application/json', { status: 415 });
        }
        let message: unknown;
        try {
          const body = await request.text();
          if (Buffer.byteLength(body) > 512 * 1024) return new Response('body is too large', { status: 413 });
          message = JSON.parse(body);
        } catch {
          return new Response('body is not JSON', { status: 400 });
        }
        const call = parseEnvelope(message, endpoint);
        if (call === undefined) {
          const rpcId = isRecord(message) && typeof message.rpcId === 'string' ? message.rpcId : 'invalid-request';
          return rpcResponse(rpcId, failure('qqbot/bad-request', '无效的请求信封'));
        }
        if (disposed) {
          return rpcResponse(call.rpcId, failure('plugin/reloading', 'QQ 插件已重载，请刷新后重试。'));
        }
        if (request.signal.aborted) {
          return rpcResponse(call.rpcId, failure('qqbot/cancelled', '请求已取消'));
        }
        let result: RpcResult;
        try {
          result = await handler(call.method, call.payload, request.signal);
        } catch (error) {
          result = failure('qqbot/internal', error instanceof Error ? error.message : String(error));
        }
        return rpcResponse(call.rpcId, result);
      },
    });
    // 宿主注册表按 fiber 记账自动清理；disposer 兜底（幂等）
    scoped.effect(() => () => {
      disposed = true;
      void Promise.resolve().then(stop).catch(() => undefined);
    }, `im-qqbot.rpc.${endpoint}`);
  });
}

export { ok as rpcOk, failure as rpcFailure };
