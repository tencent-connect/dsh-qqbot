/**
 * 配置端点 RPC 处理器 — /api/dsh-qqbot/config
 *
 * 已绑定态的配置页数据面：
 * - config.get / config.set：配置回显与白名单写入（账号一致性 + 授权版本校验）
 * - commands.list：斜杠命令清单（供权限 UI 展示）
 * - model.options / model.list：模型提供方、模型、Agent 预设候选
 *
 * 经宿主 Connection 共享通道调用（rpc-carrier.ts 注册）：来源围栏与浏览器
 * 认证由宿主在 handler 之前施加，本模块只做授权后的业务校验。
 */
import type { Logger } from '../types.ts';
import type { RpcMethodHandler, RpcResult } from '../rpc-carrier.ts';
import { rpcFailure, rpcOk } from '../rpc-carrier.ts';
import {
  updateProfileConfig,
  readProfileAccessSnapshot,
  AccessConfigConflict,
} from '../setup/persist.ts';
import { getProfileDir } from '../shared/index.ts';
import { AccessControlSchema } from '../config.ts';
import { CONFIG_METHODS, RPC_ERROR_CODES } from '../shared/rpc-protocol.ts';
import { MESSAGE_HANDLING_MODES, type MessageHandlingMode } from '../shared/message-handling-mode.ts';
import type { ModelOptionsProvider } from './model-options.ts';

/** 配置端点的行为注入 */
export interface ConfigRpcOptions {
  /** 当前生效配置（apply 时 loader 合并值，含默认值填充），config.get 回显用 */
  currentConfig?: () => Record<string, unknown>;
  /** 已绑定账号的脱敏 appId；null 表示未绑定 */
  boundAppId?: () => string | null;
  /** 斜杠命令清单（未绑定态注入空数组） */
  commands?: () => unknown;
  /** 模型/预设候选；缺省时各方法返回空列表（设置页降级为文本输入） */
  modelOptions?: ModelOptionsProvider;
  /** 配置写入处理（默认：最小合并写入 profile patch） */
  onUpdateConfig?: (config: Record<string, unknown>) => boolean;
}

/** 可经 UI 编辑的配置键（白名单：只收用户必要的字段，其余走 patch/env） */
const EDITABLE_CONFIG_KEYS = new Set([
  'requireMention', 'streaming', 'showToolResults', 'debug',
  'provider', 'model', 'preset',
  'groupPrompt', 'directPrompt',
  'messageHandlingMode',
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
  messageHandlingMode: messageHandlingModeSchema,
  access: (v) => AccessControlSchema(v as never),
};

function messageHandlingModeSchema(value: unknown): MessageHandlingMode {
  if (typeof value !== 'string' || !MESSAGE_HANDLING_MODES.includes(value as MessageHandlingMode)) {
    throw new TypeError(`messageHandlingMode 必须是 ${MESSAGE_HANDLING_MODES.join(' 或 ')}`);
  }
  return value as MessageHandlingMode;
}

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
 * 创建配置端点的方法处理器（bootstrap / setup 经 registerPluginRpc 注册）。
 *
 * @param logger - 日志
 * @param options - 行为注入（配置回显/写入、命令清单、模型候选）
 */
export function createConfigRpcHandler(logger: Logger, options: ConfigRpcOptions = {}): RpcMethodHandler {
  return async (method, payload): Promise<RpcResult> => {
    switch (method) {
      case CONFIG_METHODS.configGet:
        return handleConfigGet(options);
      case CONFIG_METHODS.configSet:
        return handleConfigSet(payload, options, logger);
      case CONFIG_METHODS.commands:
        return rpcOk({ commands: options.commands?.() ?? [] });
      case CONFIG_METHODS.modelOptions:
        return rpcOk({
          providers: options.modelOptions?.providers() ?? [],
          presets: options.modelOptions === undefined ? [] : await options.modelOptions.presets(),
        });
      case CONFIG_METHODS.modelCatalog: {
        const modelOptions = options.modelOptions;
        if (modelOptions === undefined) return rpcOk({ providers: [] });
        // 一次 RPC 聚合全部提供方：逐组 fail-soft，单个失败只缺该组
        const providers = modelOptions.providers();
        const catalog = await Promise.all(providers.map(async provider => ({
          id: provider.id,
          name: provider.name,
          models: await modelOptions.models(provider.id).catch(() => []),
        })));
        return rpcOk({ providers: catalog });
      }
      default:
        return rpcFailure(RPC_ERROR_CODES.unknownMethod, `未知方法: ${method}`);
    }
  };
}

/**
 * 配置回显：当前生效配置（appSecret 剔除，cwd 等只读字段正常返回）。
 */
function handleConfigGet(options: ConfigRpcOptions): RpcResult {
  const current = options.currentConfig?.() ?? {};
  // Never return secrets or configuration belonging to the retired memory backend.
  const { appSecret: _s, memory: _retired, ...safe } = current;
  try {
    const expectedAppId = options.boundAppId?.() ?? (typeof current.appId === 'string' ? current.appId : undefined);
    const { access, appId, revision } = readProfileAccessSnapshot(current.access, getProfileDir() ?? undefined, expectedAppId);
    return rpcOk({ config: { ...safe, ...(appId ? { appId } : {}), access, accessRevision: revision } });
  } catch (error) {
    return rpcFailure('config/unreadable', error instanceof AccessConfigConflict ? error.message : '无法读取访问设置，请检查 profile 配置文件。');
  }
}

/**
 * 配置写入：白名单 + 子 Schema 校验 → 最小写入 profile patch → HMR 重载。
 */
function handleConfigSet(payload: Record<string, unknown>, options: ConfigRpcOptions, logger: Logger): RpcResult {
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
    const { revision, appId } = readProfileAccessSnapshot(current.access, profileDir, expectedAppId);
    if (payload.expectedAppId !== (appId.length === 0 ? null : appId)) {
      return rpcFailure(RPC_ERROR_CODES.accountChanged, 'QQ 账号已变化，请刷新配置后重试。');
    }
    if (validated.access !== undefined && payload.accessRevision !== revision) {
      return rpcFailure(RPC_ERROR_CODES.configConflict, new AccessConfigConflict().message);
    }
    persisted = options.onUpdateConfig === undefined
      ? updateProfileConfig(validated, profileDir, undefined,
        validated.access === undefined ? undefined : { revision, fallback: current.access, appId: expectedAppId })
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
  logger.info('配置已保存，插件将自动重载');
  return rpcOk({ ok: true, message: '配置已保存，插件将自动重载（进行中的机器人会话将重置）' });
}
