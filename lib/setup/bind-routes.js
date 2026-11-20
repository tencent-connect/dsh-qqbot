import { rpcFailure, rpcOk } from "../rpc-carrier.js";
import { persistCredentialsToProfile, removeCredentialsFromProfile, updateProfileConfig, readProfileAccessSnapshot, AccessConfigConflict, } from "./persist.js";
import { getProfileDir } from "../shared/index.js";
import { AccessControlSchema } from "../config.js";
import { MESSAGE_HANDLING_MODES } from "../shared/message-handling-mode.js";
import { BIND_METHODS, RPC_ERROR_CODES } from "../shared/rpc-protocol.js";
/** 可经 UI 编辑的配置键（白名单：只收用户必要的字段，其余走 patch/env） */
const EDITABLE_CONFIG_KEYS = new Set([
    'requireMention', 'streaming', 'showToolResults', 'debug',
    'provider', 'model', 'preset',
    'groupPrompt', 'directPrompt',
    'messageHandlingMode',
    'access',
    'cwd',
]);
/** 白名单键的子 Schema（服务端校验：客户端校验仅为体验） */
const EDITABLE_CONFIG_SCHEMAS = {
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
    access: (v) => AccessControlSchema(v),
    cwd: (v) => cwdSchema(v),
};
function messageHandlingModeSchema(value) {
    if (typeof value !== 'string' || !MESSAGE_HANDLING_MODES.includes(value)) {
        throw new TypeError(`messageHandlingMode 必须是 ${MESSAGE_HANDLING_MODES.join(' 或 ')}`);
    }
    return value;
}
function booleanSchema(value, name) {
    if (typeof value !== 'boolean')
        throw new TypeError(`${name} 必须是布尔值`);
    return value;
}
function stringSchema(name) {
    return (value) => {
        if (typeof value !== 'string')
            throw new TypeError(`${name} 必须是字符串`);
        if (value.length > 20000)
            throw new TypeError(`${name} 过长`);
        return value;
    };
}
/** cwd 校验：允许空串（用默认目录）；其余必须是绝对路径或 ~ / ~/ 开头（~user 保持字面，运行时按字面解析）。 */
function cwdSchema(value) {
    if (typeof value !== 'string')
        throw new TypeError('cwd 必须是字符串');
    if (value.length === 0)
        return value;
    if (value.length > 20000)
        throw new TypeError('cwd 过长');
    if (value.startsWith('/') || value === '~' || value.startsWith('~/'))
        return value;
    throw new TypeError('cwd 必须是绝对路径或以 ~ 开头');
}
/**
 * 创建绑定端点的方法处理器（setup/index.ts 经 registerPluginRpc 注册）。
 *
 * @param service - 绑定状态机；已绑定 fiber 传 null（无扫码流程）
 * @param logger - 日志
 * @param options - 行为注入（bound 态回显、manual 处理）
 */
export function createBindRpcHandler(service, logger, options = {}) {
    const defaultManual = (credentials) => {
        const persisted = persistCredentialsToProfile(credentials, getProfileDir() ?? undefined, logger);
        return persisted ? { persisted: true } : { persisted: false, error: '无法定位 profile 目录或写入失败，请改用环境变量配置' };
    };
    const handleManualSubmit = options.onManualCredentials ?? defaultManual;
    return async (method, payload) => {
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
function handleState(service, options) {
    const boundAppId = options.boundAppId?.() ?? null;
    if (boundAppId !== null)
        return { phase: 'bound', appId: boundAppId };
    return service === null ? { phase: 'starting' } : service.wireState();
}
/** 校验手动提交的凭据形态（不打印内容） */
function parseCredentials(body) {
    const appId = typeof body.appId === 'string' ? body.appId.trim() : '';
    const appSecret = typeof body.appSecret === 'string' ? body.appSecret.trim() : '';
    if (appId.length === 0 || appSecret.length === 0)
        return null;
    if (appId.length > 128 || appSecret.length > 256)
        return null;
    return { appId, appSecret };
}
function handleManual(payload, submit) {
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
function handleUnbind(options) {
    if ((options.boundAppId?.() ?? null) === null) {
        return rpcFailure('bind/not-bound', '当前未绑定');
    }
    const result = options.onUnbind === undefined
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
/**
 * 配置回显：当前生效配置（appSecret 剔除）。
 */
function handleConfigGet(options) {
    const current = options.currentConfig?.() ?? {};
    // Never return secrets or configuration belonging to the retired memory backend.
    const { appSecret: _s, memory: _retired, ...safe } = current;
    try {
        const expectedAppId = options.boundAppId?.() ?? (typeof current.appId === 'string' ? current.appId : undefined);
        const { access, appId, revision } = readProfileAccessSnapshot(current.access, getProfileDir() ?? undefined, expectedAppId);
        return rpcOk({ config: { ...safe, ...(appId ? { appId } : {}), access, accessRevision: revision } });
    }
    catch (error) {
        return rpcFailure('config/unreadable', error instanceof AccessConfigConflict ? error.message : '无法读取访问设置，请检查 profile 配置文件。');
    }
}
/**
 * 配置写入：白名单 + 子 Schema 校验 → 最小写入 profile patch → HMR 重载。
 */
function handleConfigSet(payload, options) {
    if (payload.expectedAppId !== null && (typeof payload.expectedAppId !== 'string'
        || payload.expectedAppId.length === 0
        || payload.expectedAppId.length > 128)) {
        return rpcFailure('config/invalid', '配置保存必须携带预期账号，请刷新配置后重试。');
    }
    // 白名单与凭据字段拦截
    for (const key of Object.keys(payload)) {
        if (key !== 'accessRevision' && key !== 'expectedAppId' && !EDITABLE_CONFIG_KEYS.has(key)) {
            const reason = key === 'appId' || key === 'appSecret'
                ? '凭据请使用绑定/更换/解绑功能'
                : '不支持的字段';
            return rpcFailure('config/invalid', `${reason}: ${key}`);
        }
    }
    // 逐键 Schema 校验（非法值拒绝，返回首个错误）
    let validated;
    try {
        validated = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'accessRevision' && key !== 'expectedAppId').map(([key, value]) => {
            const check = EDITABLE_CONFIG_SCHEMAS[key];
            if (check === undefined)
                throw new TypeError(`不支持的字段: ${key}`);
            return [key, check(value)];
        }));
    }
    catch (err) {
        return rpcFailure('config/invalid', err instanceof TypeError ? err.message : String(err));
    }
    let persisted;
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
            ? updateProfileConfig(validated, profileDir, undefined, validated.access === undefined ? undefined : { revision, fallback: current.access, appId: expectedAppId })
            : options.onUpdateConfig(validated);
    }
    catch (error) {
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
//# sourceMappingURL=bind-routes.js.map