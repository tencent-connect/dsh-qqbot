/**
 * 端内绑定页路由 — /qqbot/im-qqbot/bind
 *
 * 注册在 dsh-host-webserver（ctx.webServer）的具名路由：
 * - Web 模式：页面同源直接访问
 * - Desktop：渲染进程的 fetch 经 IPC 桥自动附加 Host 认证转发
 *
 * 响应只含 task 级短时效数据（二维码 URL/SVG）与脱敏的 appId；
 * appSecret 绝不出现在任何响应中。manual 提交走与扫码一致的
 * persist 路径（写入 profile patch → HMR 重载生效）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from '../types.ts';
import type { BindingService } from './binding-service.ts';
import {
  persistCredentialsToProfile,
  removeCredentialsFromProfile,
  updateProfileConfig,
  type SetupCredentials,
} from './persist.ts';
import { getProfileDir } from '../shared/index.ts';
import { AccessControlSchema } from '../config.ts';
import { loadPromptFile } from '../prompt/prompt-file.ts';
import {
  BIND_CONFIG_PATH,
  BIND_PROMPT_FILE_PATH,
  BIND_MANUAL_PATH,
  BIND_REFRESH_PATH,
  BIND_STATE_PATH,
  BIND_UNBIND_PATH,
  type BindStateWire,
} from '../shared/bind-protocol.ts';

// 协议单一来源：shared/bind-protocol.ts（类型 + 路径常量，客户端共用）
export { BIND_CONFIG_PATH, BIND_PROMPT_FILE_PATH, BIND_MANUAL_PATH, BIND_REFRESH_PATH, BIND_STATE_PATH, BIND_UNBIND_PATH };
export type { BindStateWire };

/** dsh-host-webserver 的具名路由注册形状（局部投影，避免硬依赖） */
export interface WebRoute {
  kind: 'exact' | 'prefix';
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}

/** ctx.webServer 的局部投影（服务可用性由调用方探测） */
export interface WebServerLike {
  register(route: WebRoute): () => void;
}

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

/** 路由行为注入 */
export interface BindRoutesOptions {
  /**
   * 已绑定态：返回脱敏的 appId（可回显，非机密），null 表示未绑定。
   * 已绑定 fiber 注册路由时提供；待绑定流程不提供。
   */
  boundAppId?: () => string | null;
  /**
   * 手动凭据提交处理（默认：persist 到 profile patch）。
   * 待绑定流程会注入「先终止扫码轮询」的包装。
   */
  onManualCredentials?: (credentials: SetupCredentials) => ManualSubmitResult;
  /**
   * 解绑处理（默认：移除 profile patch 中的凭据字段）。
   * 未绑定态调用返回 409，不触达本回调。
   */
  onUnbind?: () => UnbindResult;
  /**
   * 当前生效配置（apply 时 loader 合并后的值，含默认值填充），
   * 用于 GET 回显（appSecret 剔除后返回）。
   */
  currentConfig?: () => Record<string, unknown>;
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
  'groupPromptMode', 'directPromptMode', 'groupPromptFile', 'directPromptFile',
  'access',
]);

/** 白名单键的子 Schema（服务端校验：客户端校验仅为体验，安全边界在宿主） */
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
  groupPromptMode: promptModeSchema,
  directPromptMode: promptModeSchema,
  groupPromptFile: stringSchema('groupPromptFile'),
  directPromptFile: stringSchema('directPromptFile'),
  access: (v) => AccessControlSchema(v as never),
};

function booleanSchema(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${name} 必须是布尔值`);
  return value;
}

function promptModeSchema(value: unknown): 'text' | 'file' {
  if (value !== 'text' && value !== 'file') throw new TypeError('提示词来源必须是 text 或 file');
  return value;
}

function stringSchema(name: string): (value: unknown) => unknown {
  return (value) => {
    if (typeof value !== 'string') throw new TypeError(`${name} 必须是字符串`);
    if (value.length > 20000) throw new TypeError(`${name} 过长`);
    return value;
  };
}

/** manual 请求体大小上限（appId + appSecret 远小于此值） */
const MAX_MANUAL_BODY_BYTES = 4096;

/**
 * config 请求体大小上限：对齐 Schema 的业务边界——白名单字符串字段单个
 * 允许 20000 字符（全中文 UTF-8 约 60KB），allowlist 不设条目上限（openid
 * 短标识，512KB 约容纳 1.4 万条）。上限只是反滥用闸门，语义校验在 Schema。
 */
const MAX_CONFIG_BODY_BYTES = 512 * 1024;

/**
 * 注册绑定路由（状态查询 / 刷新二维码 / 手动凭据）。
 *
 * @param webServer - ctx.webServer
 * @param service - 绑定状态机；已绑定 fiber 传 null（无扫码流程）
 * @param logger - 日志
 * @param options - 行为注入（bound 态回显、manual 处理）
 * @returns 注销函数（与插件 fiber 生命周期绑定）
 */
export function registerBindRoutes(
  webServer: WebServerLike,
  service: BindingService | null,
  logger: Logger,
  options: BindRoutesOptions = {},
): () => void {
  const defaultManual = (credentials: SetupCredentials): ManualSubmitResult => {
    const persisted = persistCredentialsToProfile(credentials, getProfileDir() ?? undefined, logger);
    return persisted ? { persisted: true } : { persisted: false, error: '无法定位 profile 目录或写入失败，请改用环境变量配置' };
  };
  const handleManualSubmit = options.onManualCredentials ?? defaultManual;

  const disposers = [
    webServer.register({
      kind: 'exact',
      path: BIND_STATE_PATH,
      handler: (req, res) => { handleState(req, res, service, options); },
    }),
    webServer.register({
      kind: 'exact',
      path: BIND_REFRESH_PATH,
      handler: (req, res) => { handleRefresh(req, res, service); },
    }),
    webServer.register({
      kind: 'exact',
      path: BIND_MANUAL_PATH,
      handler: (req, res) => handleManual(req, res, handleManualSubmit),
    }),
    webServer.register({
      kind: 'exact',
      path: BIND_UNBIND_PATH,
      handler: (req, res) => handleUnbind(req, res, options),
    }),
    webServer.register({
      kind: 'exact',
      path: BIND_CONFIG_PATH,
      handler: (req, res) => handleConfig(req, res, options),
    }),
    webServer.register({
      kind: 'exact',
      path: BIND_PROMPT_FILE_PATH,
      handler: (req, res) => handlePromptFile(req, res),
    }),
  ];
  logger.info(`im-qqbot: 端内绑定页已就绪: ${BIND_STATE_PATH}`);
  return () => { for (const dispose of disposers) dispose(); };
}

/**
 * 请求来源校验（最小 CSRF 防护）。
 *
 * 带 Origin 的请求必须与 Host 同源；同源 fetch 与 Desktop IPC 桥
 * （后者会删除 origin 头）均放行。路由仍由宿主统一执行 Host 认证，
 * 本地文件接口只返回元信息，不返回文件正文。
 */
function trusted(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function handleState(
  req: IncomingMessage,
  res: ServerResponse,
  service: BindingService | null,
  options: BindRoutesOptions,
): void {
  if (!trusted(req)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }
  // 已绑定优先（appSecret 不回传，appId 非机密可回显）
  const boundAppId = options.boundAppId?.() ?? null;
  if (boundAppId !== null) {
    sendJson(res, 200, { phase: 'bound', appId: boundAppId });
    return;
  }
  sendJson(res, 200, service === null ? { phase: 'starting' } : service.wireState());
}

function handleRefresh(req: IncomingMessage, res: ServerResponse, service: BindingService | null): void {
  if (!trusted(req)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }
  // 丢弃可能的请求体（refresh 无参数）
  req.resume();
  service?.refresh();
  // 新二维码异步生成，统一由状态轮询收敛
  sendJson(res, 200, { phase: 'starting' });
}

/** 读取并解析 JSON 请求体（带大小上限） */
async function readJsonBody(req: IncomingMessage, maxBytes: number = MAX_MANUAL_BODY_BYTES): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > maxBytes) throw new Error('request body too large');
    chunks.push(buffer);
  }
  if (size === 0) throw new Error('empty request body');
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** 校验手动提交的凭据形态（不打印内容） */
function parseCredentials(body: unknown): SetupCredentials | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  const appId = typeof record.appId === 'string' ? record.appId.trim() : '';
  const appSecret = typeof record.appSecret === 'string' ? record.appSecret.trim() : '';
  if (appId.length === 0 || appSecret.length === 0) return null;
  if (appId.length > 128 || appSecret.length > 256) return null;
  return { appId, appSecret };
}

async function handleManual(
  req: IncomingMessage,
  res: ServerResponse,
  submit: (credentials: SetupCredentials) => ManualSubmitResult,
): Promise<void> {
  if (!trusted(req)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { ok: false, error: `invalid request body: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }
  const credentials = parseCredentials(body);
  if (credentials === null) {
    sendJson(res, 400, { ok: false, error: 'appId 与 appSecret 不能为空' });
    return;
  }
  const result = submit(credentials);
  if (!result.persisted) {
    sendJson(res, 500, { ok: false, error: result.error ?? '保存失败' });
    return;
  }
  // 写入 profile patch 触发 HMR 重载，新 fiber 以新凭据启动网关
  sendJson(res, 200, { ok: true, message: '凭据已保存，插件将自动重载' });
}

/** 解绑：仅已绑定态可执行；移除 profile patch 中的凭据并触发 HMR 重载 */
function handleUnbind(req: IncomingMessage, res: ServerResponse, options: BindRoutesOptions): void {
  if (!trusted(req)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }
  req.resume();
  if ((options.boundAppId?.() ?? null) === null) {
    sendJson(res, 409, { ok: false, error: '当前未绑定' });
    return;
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
    sendJson(res, 500, { ok: false, error: result.error ?? '解绑失败' });
    return;
  }
  // 移除后写入触发 HMR 重载，插件回到未绑定态（绑定流程重新可用）
  sendJson(res, 200, { ok: true, message: '已解绑，插件将重载并重新进入绑定流程' });
}

/**
 * 配置读写：
 * - GET：回显当前生效配置（appSecret 剔除，cwd 等只读字段正常返回）
 * - POST：白名单 + 子 Schema 校验 → 最小写入 profile patch → HMR 重载
 */
async function handleConfig(req: IncomingMessage, res: ServerResponse, options: BindRoutesOptions): Promise<void> {
  if (!trusted(req)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }

  if (req.method === 'GET') {
    const current = options.currentConfig?.() ?? {};
    // appSecret 永不回传；其余（含只读 cwd）原样回显
    const { appSecret: _s, ...safe } = current;
    sendJson(res, 200, { config: safe });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req, MAX_CONFIG_BODY_BYTES);
  } catch (err) {
    sendJson(res, 400, { ok: false, error: `invalid request body: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }
  if (typeof body !== 'object' || body === null) {
    sendJson(res, 400, { ok: false, error: '请求体必须是 JSON 对象' });
    return;
  }
  const submitted = body as Record<string, unknown>;

  // 白名单与凭据/只读字段拦截
  for (const key of Object.keys(submitted)) {
    if (!EDITABLE_CONFIG_KEYS.has(key)) {
      const reason = key === 'appId' || key === 'appSecret'
        ? '凭据请使用绑定/更换/解绑功能'
        : key === 'cwd'
          ? 'cwd 为只读字段'
          : '不支持的字段';
      sendJson(res, 400, { ok: false, error: `${reason}: ${key}` });
      return;
    }
  }

  // 逐键 Schema 校验（非法值拒绝，返回首个错误）
  let validated: Record<string, unknown> = {};
  try {
    validated = Object.fromEntries(Object.entries(submitted).map(([key, value]) => {
      const check = EDITABLE_CONFIG_SCHEMAS[key];
      if (check === undefined) throw new TypeError(`不支持的字段: ${key}`);
      return [key, check(value)];
    }));
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err instanceof TypeError ? err.message : String(err) });
    return;
  }

  // 仅重新校验本次触及的提示词来源，失效的旧路径不影响其他设置保存。
  const merged = { ...options.currentConfig?.(), ...validated };
  try {
    for (const scope of ['group', 'direct'] as const) {
      const changed = [`${scope}Prompt`, `${scope}PromptMode`, `${scope}PromptFile`]
        .some((key) => Object.hasOwn(validated, key));
      if (changed && merged[`${scope}PromptMode`] === 'file') {
        const file = merged[`${scope}PromptFile`];
        if (typeof file !== 'string') throw new TypeError('请选择本地提示词文件');
        await loadPromptFile(file);
      }
    }
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
    return;
  }

  const persisted = options.onUpdateConfig === undefined
    ? updateProfileConfig(validated, getProfileDir() ?? undefined, undefined)
    : options.onUpdateConfig(validated);
  if (!persisted) {
    sendJson(res, 500, { ok: false, error: '无法定位 profile 目录或写入失败' });
    return;
  }
  sendJson(res, 200, { ok: true, message: '配置已保存，插件将自动重载（进行中的机器人会话将重置）' });
}

/** 在宿主本机验证文件；仅回传元信息，正文始终保留在插件运行时。 */
async function handlePromptFile(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!trusted(req)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }
  try {
    const body = await readJsonBody(req);
    if (typeof body !== 'object' || body === null || Array.isArray(body)
      || typeof (body as Record<string, unknown>).path !== 'string') {
      throw new TypeError('请提供本地提示词文件的绝对路径');
    }
    const { text: _text, ...metadata } = await loadPromptFile((body as { path: string }).path);
    sendJson(res, 200, { ok: true, ...metadata });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
