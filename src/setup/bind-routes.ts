/**
 * 端内绑定 RPC 处理器 — /api/dsh-qqbot/bind
 *
 * 经宿主 Connection 共享通道调用（rpc-carrier.ts 注册）：来源围栏与浏览器
 * 认证由宿主在 handler 之前施加；本模块只做授权后的业务校验。
 *
 * - bind.state / bind.refresh：扫码状态机相位
 * - bind.manual / bind.unbind：凭据提交与移除（persist → HMR 重载生效）
 * - config.get / config.set：配置回显（appSecret 剔除）与白名单写入
 */
import type { Logger } from '../types.ts';
import type { BindingService } from './binding-service.ts';
import type { RpcMethodHandler, RpcResult } from '../rpc-carrier.ts';
import { rpcFailure, rpcOk } from '../rpc-carrier.ts';
import {
  persistCredentialsToProfile,
  unbindProfileCredentials,
  updateProfileConfig,
  readProfileAccessSnapshot,
  AccessConfigConflict,
  type SetupCredentials,
  type HostAccessSource,
} from './persist.ts';
import { getProfileDir } from '../shared/index.ts';
import { AccessControlSchema } from '../config.ts';
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
  /**
   * 当前生效配置（apply 时 loader 合并后的值，含默认值填充），
   * 用于 config.get 回显（appSecret 剔除后返回）。
   */
  currentConfig?: () => Record<string, unknown>;
  hostAccess?: HostAccessSource;
  /**
   * 配置写入处理（默认：最小合并写入 profile patch）。
   */
  onUpdateConfig?: (config: Record<string, unknown>) => boolean;
}

/** 可经 UI 编辑的配置键（白名单：只收用户必要的字段，其余走 patch/env） */
const EDITABLE_CONFIG_KEYS = new Set([
  'requireMention', 'streaming', 'showToolResults', 'debug',
  'provider', 'model', 'preset',
  'groupPrompt', 'directPrompt',
  'access',
]);

/** 白名单键的子 Schema（服务端校验：客户端校验仅为体验） */
const EDITABLE_CONFIG_SCHEMAS: Record<string, (value: unknown) => unknown> = {
  requireMention: (v) => booleanSchema(v, 'requireMention'),
  streaming: (v) => booleanSchema(v, 'streaming'),
  showToolResults: (v) => booleanSchema(v, 'showToolResults'),
  debug: (v) => booleanSchema(v, 'debug'),
  provider: stringSchema('provider'),
  model: stringSchema('model'),
  preset: stringSchema('preset'),
  groupPrompt: stringSchema('groupPrompt'),
  directPrompt: stringSchema('directPrompt'),
  access: (v) => AccessControlSchema(v as never),
};

function booleanSchema(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${name} 必须是布尔值`);
  return value;
}

function stringSchema(name: string): (value: unknown) => unknown {
  return (value) => {
    if (typeof value !== 'string') throw new TypeError(`${name} 必须是字符串`);
    if (value.length > 20000) throw new TypeError(`${name} 过长`);
    return value;
  };
}

/**
 * 创建绑定端点的方法处理器（setup/index.ts 经 registerPluginRpc 注册）。
 *
 * @param service - 绑定状态机；已绑定 fiber 传 null（无扫码流程）
 * @param logger - 日志
 * @param options - 行为注入（bound 态回显、manual 处理）
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
      case BIND_METHODS.configGet:
        return handleConfigGet(options);
      case BIND_METHODS.configSet:
        return handleConfigSet(payload, options);
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
        const removed = unbindProfileCredentials(getProfileDir() ?? undefined, undefined, options.boundAppId?.() ?? undefined);
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

/**
 * 配置回显：当前生效配置（appSecret 剔除，cwd 等只读字段正常返回）。
 */
function handleConfigGet(options: BindRpcOptions): RpcResult {
  const current = options.currentConfig?.() ?? {};
  // Never return secrets or configuration belonging to the retired memory backend.
  const { appSecret: _s, memory: _retired, ...safe } = current;
  try {
    const expectedAppId = options.boundAppId?.() ?? (typeof current.appId === 'string' ? current.appId : undefined);
    const { access, appId, revision } = readProfileAccessSnapshot(current.access, getProfileDir() ?? undefined, expectedAppId, options.hostAccess);
    return rpcOk({ config: { ...safe, ...(appId ? { appId } : {}), access, accessRevision: revision } });
  } catch (error) {
    return rpcFailure('config/unreadable', error instanceof AccessConfigConflict ? error.message : '无法读取访问设置，请检查 profile 配置文件。');
  }
}

/**
 * 配置写入：白名单 + 子 Schema 校验 → 最小写入 profile patch → HMR 重载。
 */
function handleConfigSet(payload: Record<string, unknown>, options: BindRpcOptions): RpcResult {
  if (payload.expectedAppId !== null && (
    typeof payload.expectedAppId !== 'string'
    || payload.expectedAppId.length === 0
    || payload.expectedAppId.length > 128
  )) {
    return rpcFailure('config/invalid', '配置保存必须携带预期账号，请刷新配置后重试。');
  }
  // 白名单与凭据/只读字段拦截
  for (const key of Object.keys(payload)) {
    if (key !== 'accessRevision' && key !== 'expectedAppId' && !EDITABLE_CONFIG_KEYS.has(key)) {
      const reason = key === 'appId' || key === 'appSecret'
        ? '凭据请使用绑定/更换/解绑功能'
        : key === 'cwd'
          ? 'cwd 为只读字段'
          : '不支持的字段';
      return rpcFailure('config/invalid', `${reason}: ${key}`);
    }
  }

  // 逐键 Schema 校验（非法值拒绝，返回首个错误）
  let validated: Record<string, unknown>;
  try {
    validated = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'accessRevision' && key !== 'expectedAppId').map(([key, value]) => {
      const check = EDITABLE_CONFIG_SCHEMAS[key];
      if (check === undefined) throw new TypeError(`不支持的字段: ${key}`);
      return [key, check(value)];
    }));
  } catch (err) {
    return rpcFailure('config/invalid', err instanceof TypeError ? err.message : String(err));
  }

  let persisted: boolean;
  try {
    const profileDir = getProfileDir() ?? undefined;
    const current = options.currentConfig?.() ?? {};
    const expectedAppId = options.boundAppId?.() ?? (typeof current.appId === 'string' ? current.appId : undefined);
    const { revision, appId } = readProfileAccessSnapshot(current.access, profileDir, expectedAppId, options.hostAccess);
    if (payload.expectedAppId !== (appId.length === 0 ? null : appId)) {
      return rpcFailure(RPC_ERROR_CODES.accountChanged, 'QQ 账号已变化，请刷新配置后重试。');
    }
    if (validated.access !== undefined && payload.accessRevision !== revision) {
      return rpcFailure(RPC_ERROR_CODES.configConflict, new AccessConfigConflict().message);
    }
    persisted = options.onUpdateConfig === undefined
      ? updateProfileConfig(validated, profileDir, undefined,
        validated.access === undefined ? undefined : { revision, fallback: current.access, appId: expectedAppId, hostAccess: options.hostAccess })
      : options.onUpdateConfig(validated);
  } catch (error) {
    if (error instanceof AccessConfigConflict) {
      return rpcFailure(RPC_ERROR_CODES.configConflict, error.message);
    }
    return rpcFailure('config/persist-failed', '无法读取或保存配置，请检查 profile 配置文件。');
  }
  if (!persisted) {
    return rpcFailure('config/persist-failed', '无法定位 profile 目录或写入失败');
  }
  return rpcOk({ ok: true, message: '配置已保存，插件将自动重载（进行中的机器人会话将重置）' });
}
