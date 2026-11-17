/**
 * 客户端 RPC 层 —— 经宿主浏览器 Connection 服务调用插件端点。
 *
 * 所有端内数据/动作走宿主 `/api` 共享通道（来源围栏与认证由宿主施加，
 * Desktop 下由壳的 IPC 桥透明转发）：connection.rpc.call 组装
 * client-request 信封 POST 到 `/api/<endpoint>`，本模块负责结果解包、
 * 错误归类（RpcError.code）与传输 404 的 gone 语义（插件未启用）。
 * 超时/取消语义沿用旧 fetchJson：默认 10s，调用方 signal 传播。
 */
import { RPC_CHANNEL, RPC_ERROR_CODES } from '../shared/rpc-protocol.ts';

/** 连接服务返回的结果形态（宿主 ConnectionRpcResult 投影） */
export interface RpcResultLike {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: { readonly code?: string; readonly message?: string };
}

/** ctx.connection 的局部投影（浏览器壳提供，插件 inject 声明后读取） */
interface ConnectionLike {
  rpc: {
    call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcResultLike>;
  };
}

/** RPC 调用错误：code 区分语义（冲突/重载/传输失败），gone 表示端点未注册 */
export class RpcError extends Error {
  constructor(readonly code: string, message: string, readonly gone = false) {
    super(message);
  }
}

let connection: ConnectionLike | undefined;

/** apply 时注入宿主连接服务（HMR 重载会以新 handle 重设） */
export function setClientConnection(handle: unknown): void {
  connection = handle as ConnectionLike | undefined;
}

/**
 * 调用一个插件 RPC 方法。
 *
 * @param endpoint - 端点 id（shared/rpc-protocol.ts）
 * @param method - 方法名
 * @param payload - 调用参数
 * @param timeoutMs - 超时（默认 10s）
 * @param signal - 调用方取消信号
 * @throws RpcError code = 结果错误码 / 'transport/404'（端点未注册，gone）/
 *         'transport/timeout' / 'transport/network' / 'client/no-connection'
 */
export async function rpcCall<T>(
  endpoint: string,
  method: string,
  payload: Record<string, unknown> = {},
  timeoutMs = 10_000,
  signal?: AbortSignal,
): Promise<T> {
  const client = connection;
  if (client === undefined) throw new RpcError('client/no-connection', '宿主连接服务不可用，请刷新页面。');

  const controller = new AbortController();
  let timedOut = false;
  const onCancel = (): void => { controller.abort(signal?.reason); };
  if (signal?.aborted) onCancel();
  else signal?.addEventListener('abort', onCancel, { once: true });
  const timer = setTimeout(() => {
    if (controller.signal.aborted) return;
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    if (controller.signal.aborted) throw new DOMException('请求已取消', 'AbortError');
    const result = await client.rpc.call(RPC_CHANNEL, endpoint, { method, payload }, controller.signal);
    if (!result.ok) {
      throw new RpcError(result.error?.code ?? 'qqbot/internal', result.error?.message ?? '请求失败');
    }
    return result.value as T;
  } catch (cause) {
    if (cause instanceof RpcError) throw cause;
    if (controller.signal.aborted) {
      if (timedOut) throw new RpcError('transport/timeout', '请求超时，请重试');
      throw new DOMException('请求已取消', 'AbortError');
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    // 传输层 404 = 端点未注册（插件未启用 / 已卸载）
    if (message.includes('HTTP 404')) {
      throw new RpcError(RPC_ERROR_CODES.routeMissing, '插件未启用或当前版本不支持端内配置', true);
    }
    throw new RpcError('transport/network', message || '网络不可用');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCancel);
  }
}
