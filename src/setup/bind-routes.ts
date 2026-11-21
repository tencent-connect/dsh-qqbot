/**
 * 绑定端点 RPC 处理器 — /api/dsh-qqbot/bind
 *
 * 只负责凭据生命周期：扫码状态机、手动提交、解绑。配置读写与配置页候选
 * 数据在 `/api/dsh-qqbot/config`（runtime/config-routes.ts）。
 *
 * 经宿主 Connection 共享通道调用（rpc-carrier.ts 注册）：来源围栏与浏览器
 * 认证由宿主在 handler 之前施加；本模块只做授权后的业务校验。
 */
import type { Logger } from '../types.ts';
import type { BindingService } from './binding-service.ts';
import type { RpcMethodHandler, RpcResult } from '../rpc-carrier.ts';
import { rpcFailure, rpcOk } from '../rpc-carrier.ts';
import {
  persistCredentialsToProfile,
  removeCredentialsFromProfile,
  type SetupCredentials,
} from './persist.ts';
import { getProfileDir } from '../shared/index.ts';
import { BIND_METHODS, RPC_ERROR_CODES } from '../shared/rpc-protocol.ts';
import type { BindStateWire } from '../shared/bind-protocol.ts';

/** 手动凭据提交的处理结果 */
export interface ManualSubmitResult {
  /** 是否已持久化（false = 落盘失败，需展示手动配置指引） */
  persisted: boolean;
  /** 失败原因（persisted=false 时回传给表单展示） */
  error?: string;
}

/** 解绑处理结果 */
export interface UnbindResult {
  persisted: boolean;
  error?: string;
}

/** 处理器行为注入 */
export interface BindRpcOptions {
  /**
   * 已绑定态：返回脱敏的 appId（可回显，非机密），null 表示未绑定。
   * 已绑定 fiber 注册处理器时提供；待绑定流程不提供。
   */
  boundAppId?: () => string | null;
  /**
   * 手动凭据提交处理（默认：persist 到 profile patch）。
   * 待绑定流程会注入「先终止扫码轮询」的包装。
   */
  onManualCredentials?: (credentials: SetupCredentials) => ManualSubmitResult;
  /**
   * 解绑处理（默认：移除 profile patch 中的凭据字段）。
   * 未绑定态调用返回 not-bound 错误，不触达本回调。
   */
  onUnbind?: () => UnbindResult;
}

/**
 * 创建绑定端点的方法处理器（setup/index.ts 经 registerPluginRpc 注册）。
 *
 * @param service - 绑定状态机；已绑定 fiber 传 null（无扫码流程）
 * @param logger - 日志
 * @param options - 行为注入（bound 态回显、manual/unbind 处理）
 */
export function createBindRpcHandler(
  service: BindingService | null,
  logger: Logger,
  options: BindRpcOptions = {},
): RpcMethodHandler {
  const defaultManual = (credentials: SetupCredentials): ManualSubmitResult => {
    const persisted = persistCredentialsToProfile(credentials, getProfileDir() ?? undefined, logger);
    return persisted ? { persisted: true } : { persisted: false, error: '无法定位 profile 目录或写入失败，请改用环境变量配置' };
  };
  const handleManualSubmit = options.onManualCredentials ?? defaultManual;

  return async (method, payload): Promise<RpcResult> => {
    switch (method) {
      case BIND_METHODS.state:
        return rpcOk(handleState(service, options));
      case BIND_METHODS.refresh:
        service?.refresh();
        return rpcOk({ phase: 'starting' });
      case BIND_METHODS.manual:
        return handleManual(payload, handleManualSubmit);
      case BIND_METHODS.unbind:
        return handleUnbind(options);
      default:
        return rpcFailure(RPC_ERROR_CODES.unknownMethod, `未知方法: ${method}`);
    }
  };
}

/** 状态查询：已绑定优先（appSecret 不回传，appId 非机密可回显） */
function handleState(service: BindingService | null, options: BindRpcOptions): BindStateWire {
  const boundAppId = options.boundAppId?.() ?? null;
  if (boundAppId !== null) return { phase: 'bound', appId: boundAppId };
  return service === null ? { phase: 'starting' } : service.wireState();
}

/** 校验手动提交的凭据形态（不打印内容） */
function parseCredentials(body: Record<string, unknown>): SetupCredentials | null {
  const appId = typeof body.appId === 'string' ? body.appId.trim() : '';
  const appSecret = typeof body.appSecret === 'string' ? body.appSecret.trim() : '';
  if (appId.length === 0 || appSecret.length === 0) return null;
  if (appId.length > 128 || appSecret.length > 256) return null;
  return { appId, appSecret };
}

function handleManual(
  payload: Record<string, unknown>,
  submit: (credentials: SetupCredentials) => ManualSubmitResult,
): RpcResult {
  const credentials = parseCredentials(payload);
  if (credentials === null) {
    return rpcFailure('bind/invalid-credentials', 'appId 与 appSecret 不能为空');
  }
  const result = submit(credentials);
  if (!result.persisted) {
    return rpcFailure('bind/persist-failed', result.error ?? '保存失败');
  }
  // 写入 profile patch 触发 HMR 重载，新 fiber 以新凭据启动网关
  return rpcOk({ ok: true, message: '凭据已保存，插件将自动重载' });
}

/** 解绑：仅已绑定态可执行；移除 profile patch 中的凭据并触发 HMR 重载 */
function handleUnbind(options: BindRpcOptions): RpcResult {
  if ((options.boundAppId?.() ?? null) === null) {
    return rpcFailure('bind/not-bound', '当前未绑定');
  }
  const result: UnbindResult = options.onUnbind === undefined
    ? (() => {
        const removed = removeCredentialsFromProfile(getProfileDir() ?? undefined, undefined);
        if (removed) {
          // 清除进程内凭据：扫码绑定成功时会写入 env（供热更新后的下次
          // apply 兜底读取）；不清则 HMR 重载后新 fiber 仍从 env 读到
          // 凭据，解绑不生效（状态一直停留在 bound）
          delete process.env.QQBOT_APPID;
          delete process.env.QQBOT_SECRET;
        }
        return removed
          ? { persisted: true }
          : { persisted: false, error: '无法定位 profile 目录或写入失败，请手动编辑 cordis.patch.yml' };
      })()
    : options.onUnbind();
  if (!result.persisted) {
    return rpcFailure('bind/persist-failed', result.error ?? '解绑失败');
  }
  // 移除后写入触发 HMR 重载，插件回到未绑定态（绑定流程重新可用）
  return rpcOk({ ok: true, message: '已解绑，插件将重载并重新进入绑定流程' });
}
