/**
 * QQ Bot 凭据与配置持久化 — 写入 dsh profile 的 cordis.patch.yml
 *
 * 该文件是宿主的组合覆盖层，存在多个写者（宿主设置流程、本插件、用户手工编辑）。
 * 写入遵循四条约束：
 *
 * 1. 文档保真：用 eemeli/yaml 的 Document API 原地编辑，注释、锚点、
 *    `!!js` 表达式、insert 行等所有本插件不拥有的内容一律原样保留；
 * 2. fail-closed：非法 YAML、非数组文档或非映射配置拒绝写入。共享锚点
 *    允许追加独立的 QQBot 设置覆盖，凭据操作仍拒绝原地改动共享配置；
 * 3. 原子写：同目录临时文件 + rename，崩溃不会留下截断的半份文件；
 * 4. 乐观校验：写入前重读比对（外部并发改动则重试合并），写入后读回
 *    验证本插件条目正确、其他条目集合不变，失败则回滚原内容。
 */
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fchmodSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import yaml from 'js-yaml';
import { parseDocument, isAlias, isMap, isNode, isSeq, isScalar, visit, Alias, YAMLMap, type Document, type YAMLSeq } from 'yaml';
import type { Logger } from '../types.ts';
import { AccessControlSchema, type AccessControlConfig } from '../config.ts';

export class AccessConfigConflict extends Error {
  constructor() { super('机器人账号、访问设置或白名单已更新，请刷新配置后确认并保存。'); }
}

export function accessRevision(access: AccessControlConfig, appId = ''): string {
  return createHash('sha256').update(JSON.stringify([
    appId, access.c2cMode, access.c2cAllow, access.groupMode, access.groupAllow, access.commandMode,
  ])).digest('hex');
}

export interface HostAccessSource {
  readonly appId?: unknown;
  readonly access?: unknown;
}

export function readHostAccessSource(profileDir?: string): HostAccessSource {
  const path = profileDir && resolve(profileDir, 'cordis.patch.yml');
  return path && existsSync(path) ? readAccessSource(readFileSync(path, 'utf8')) : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function matchesEntry(id: unknown, name: unknown, hasInsert: boolean): boolean {
  return id === ENTRY_ID && !hasInsert && (name === undefined || name === PACKAGE_NAME);
}

function readAccessSource(text: string): HostAccessSource {
  // Use the same scalar and alias rules as the Host Include YAML loader.
  const rows: unknown = yaml.load(text, { schema: PROFILE_SCHEMA });
  if (rows === undefined) return {};
  if (!Array.isArray(rows)) throw new PatchFormatError('顶层必须是 YAML 数组（条目 / patch 行列表）');
  let config: unknown;
  for (const row of rows) {
    if (isRecord(row) && matchesEntry(row.id, row.name, Object.hasOwn(row, 'insert')) && Object.hasOwn(row, 'config')) {
      config = row.config;
    }
  }
  if (config === undefined || config === null) return {};
  if (!isRecord(config)) throw new PatchFormatError('im-qqbot 条目的 config 不是映射');
  return Object.hasOwn(config, '__jsExpr') ? { appId: config, access: config } : { appId: config.appId, access: config.access };
}

function needsHostAccess(value: unknown, visited = new Set<object>()): boolean {
  if (!value || typeof value !== 'object' || visited.has(value)) return false;
  visited.add(value);
  return Object.hasOwn(value, '__jsExpr') || Object.values(value).some(child => needsHostAccess(child, visited));
}

function savedAccess(source: HostAccessSource, fallback: unknown, hostAccess?: HostAccessSource): AccessControlConfig {
  const base = AccessControlSchema((fallback ?? {}) as never);
  if (hostAccess && isDeepStrictEqual(source.access, hostAccess.access)) return base;
  // A changed expression needs the Host to publish its next evaluation. Literal
  // changes are visible here immediately, including while an old send is queued.
  if (needsHostAccess(source.access)) throw new AccessConfigConflict();
  if (source.access === undefined) {
    if (hostAccess) throw new AccessConfigConflict();
    return base;
  }
  if (!isRecord(source.access)) throw new PatchFormatError('access 必须是映射');
  return AccessControlSchema({ ...base, ...source.access });
}

function explicitAppId(value: unknown): string | undefined {
  return typeof value === 'string' && value && value !== '__FROM_ENV__' && !value.startsWith('process.env')
    ? value : undefined;
}

function checkedAppId(config: YAMLMap | undefined, expectedAppId?: string): string {
  const node = config?.get('appId', true);
  const saved = isScalar(node) && (node.tag === undefined || node.tag === 'tag:yaml.org,2002:str')
    ? explicitAppId(node.value) : undefined;
  const expected = explicitAppId(expectedAppId);
  if (saved && expected && saved !== expected) throw new AccessConfigConflict();
  return saved ?? expected ?? '';
}

function accessSnapshot(source: HostAccessSource, fallback: unknown, expectedAppId?: string, hostAccess?: HostAccessSource) {
  const expected = explicitAppId(expectedAppId);
  const saved = explicitAppId(source.appId);
  const sameAccountSource = hostAccess && isDeepStrictEqual(source.appId, hostAccess.appId);
  if ((saved && expected && saved !== expected) || (hostAccess && !sameAccountSource && !saved)) {
    throw new AccessConfigConflict();
  }
  const appId = saved ?? expected ?? '';
  const access = savedAccess(source, fallback, hostAccess);
  return { access, appId, revision: accessRevision(access, appId) };
}

/** Read persisted membership even while the old plugin fiber is still serving requests. */
export function readProfileAccess(fallback: unknown, profileDir?: string, expectedAppId?: string): AccessControlConfig {
  return readProfileAccessSnapshot(fallback, profileDir, expectedAppId).access;
}

export function readProfileAccessSnapshot(fallback: unknown, profileDir?: string, expectedAppId?: string, hostAccess?: HostAccessSource) {
  return accessSnapshot(readHostAccessSource(profileDir), fallback, expectedAppId, hostAccess);
}

/** 凭据结果 */
export interface SetupCredentials {
  appId: string;
  appSecret: string;
  /** 扫码用户 OpenID，用于查找已缓存的昵称。 */
  userOpenid?: string;
}

/** 宿主 Include 方言：保留 !!js 等自定义标签为字面量字符串 */
const JS_TAG = 'tag:yaml.org,2002:js';
const PROFILE_SCHEMA = yaml.JSON_SCHEMA.extend(new yaml.Type(JS_TAG, {
  kind: 'scalar',
  construct: (expression: string) => ({ __jsExpr: expression }),
}));
const PARSE_OPTIONS: { customTags: Array<{ tag: string; resolve: (value: string) => string }> } = {
  customTags: [{ tag: JS_TAG, resolve: (value: string) => value }],
};

/** 剖析错误：fail-closed 语义（调用方拒绝写入、保留原文件） */
class PatchFormatError extends Error {}

/** 插件在 patch 文件中的条目 id */
const ENTRY_ID = 'im-qqbot';
const PACKAGE_NAME = '@tencent-connect/dsh-qqbot';

/** 乐观并发重试次数（外部进程在读写窗口内改动的兜底；同进程写者被同步执行天然串行） */
const WRITE_ATTEMPTS = 3;

type PersistLogger = Pick<Logger, 'info' | 'warn'>;

/** 编辑上下文：attached 表示 im-qqbot 条目已在文档中（false = 本次新追加） */
interface EditContext {
  config: YAMLMap;
  attached: boolean;
  original: string;
  /** 把（编辑后的）config 作为新的 im-qqbot 条目追加进文档 */
  appendEntry(): void;
}

/** 编辑结果：false = 文档无需变更（幂等，不写不触 mtime）；true = 变更或强制写回 */
type EditResult = boolean;

/** Restrict stale temporary files before writing any profile credentials. */
function writePrivateFile(path: string, content: string): void {
  const fd = openSync(path, 'w', 0o600);
  try {
    fchmodSync(fd, 0o600);
    writeFileSync(fd, content, 'utf8');
  } finally {
    closeSync(fd);
  }
}

/**
 * 对 cordis.patch.yml 做一次「读 → 原地编辑 → 原子写 → 验证」的事务。
 *
 * 同步执行（无 await）：JS 单线程保证读-改-写不会被同进程的其他写者
 * （宿主设置流程）交错；重试与读回校验兜底外部进程的并发改动。
 *
 * @param dir - profile 目录
 * @param edit - 编辑函数（必须可重入：乐观重试会在重新解析的文档上再次执行）
 * @param options.force - 无条件写回（解绑场景靠 mtime 触发宿主 HMR）
 * @param verify - 写入后读回校验：返回 false 则回滚
 * @param log - 日志
 */
function editProfilePatch(
  dir: string,
  edit: (ctx: EditContext) => EditResult,
  options: { force?: boolean; updatedKeys?: readonly string[] },
  verify: (config: YAMLMap | undefined) => boolean,
  log: PersistLogger,
): boolean {
  const patchPath = resolve(dir, 'cordis.patch.yml');
  mkdirSync(dir, { recursive: true });

  for (let attempt = 1; ; attempt++) {
    // 1. 读取 + 解析（非法内容抛 PatchFormatError → fail-closed）
    const before = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '';
    const doc = parseProfilePatch(before);
    const otherIdsBefore = collectEntryIds(doc);

    // 2. 原地编辑
    const changed = applyEdit(doc, before, edit, options.updatedKeys);
    if (!changed && !options.force) {
      chmodSync(patchPath, 0o600);
      return true;
    }

    const next = doc.toString({ lineWidth: 0 });

    // 3. 乐观校验：解析期间文件被外部改动 → 重读重试
    const current = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '';
    if (current !== before) {
      if (attempt < WRITE_ATTEMPTS) continue;
      log.warn('cordis.patch.yml 在写入窗口内被外部修改，放弃本次写入（原文件保留）');
      return false;
    }

    // 4. 原子写：同目录临时文件 + rename（同分区保证原子）
    const tmpPath = `${patchPath}.imqqbot.tmp`;
    try {
      writePrivateFile(tmpPath, next);
      renameSync(tmpPath, patchPath);
    } catch (err) {
      try { unlinkSync(tmpPath); } catch { /* 临时文件可能不存在 */ }
      throw err;
    }

    // 5. 读回验证：其他条目集合不变 + 本插件条目符合预期；失败回滚原内容
    try {
      const writtenDoc = parseProfilePatch(readFileSync(patchPath, 'utf8'));
      if (collectEntryIds(writtenDoc).join('\n') !== otherIdsBefore.join('\n')) {
        throw new Error('写入后其他条目集合发生变化');
      }
      if (!verify(findEntryConfig(writtenDoc))) {
        throw new Error('写入后 im-qqbot 条目校验失败');
      }
    } catch (err) {
      log.warn(`写入验证失败，回滚 cordis.patch.yml: ${err instanceof Error ? err.message : String(err)}`);
      const rollback = `${patchPath}.imqqbot.rollback`;
      try {
        writePrivateFile(rollback, before);
        renameSync(rollback, patchPath);
      } catch (rollbackError) {
        try { unlinkSync(rollback); } catch { /* 临时文件可能不存在 */ }
        throw rollbackError;
      }
      return false;
    }
    return true;
  }
}

/** 解析并校验顶层结构：空/仅注释 → 空列表文档；非数组 → fail-closed */
function parseProfilePatch(content: string): Document.Parsed {
  const doc = parseDocument(content, PARSE_OPTIONS);
  if (doc.errors[0]) throw new PatchFormatError(doc.errors[0].message);
  if (doc.contents === null) {
    // 空/仅注释：等价空列表，允许安全重建
    return parseDocument('[]', PARSE_OPTIONS);
  }
  if (!isSeq(doc.contents)) {
    throw new PatchFormatError('顶层必须是 YAML 数组（条目 / patch 行列表）');
  }
  return doc;
}

/** 收集顶层行的标识（id 条目 / 非 id 行），用于写前后不变性校验；排除本插件条目（编辑对象） */
function collectEntryIds(doc: Document.Parsed): string[] {
  const seq = doc.contents;
  if (!isSeq(seq)) return [];
  const ids: string[] = [];
  for (const item of seq.items) {
    if (isMap(item)) {
      const idNode = item.get('id', true);
      if (isScalar(idNode)) {
        if (String(idNode.value) === ENTRY_ID) continue;
        ids.push(`id:${String(idNode.value)}`);
        continue;
      }
    }
    ids.push(`row:${ids.length}`);
  }
  return ids;
}

function findEntryConfigNode(doc: Document.Parsed): unknown {
  const seq = doc.contents;
  if (!isSeq(seq)) return undefined;
  for (let index = seq.items.length - 1; index >= 0; index--) {
    const row = seq.items[index];
    if (isMap(row) && row.has('config') && matchesEntry(row.get('id'), row.get('name'), row.has('insert'))) {
      return row.get('config', true);
    }
  }
  return undefined;
}

function findEntryConfig(doc: Document.Parsed, allowShared = false): YAMLMap | undefined {
  const raw = findEntryConfigNode(doc);
  if (raw === undefined) return undefined;
  const config = isAlias(raw) && allowShared ? raw.resolve(doc) : raw;
  if (!allowShared && (isAlias(raw) || (isMap(config) && config.anchor))) {
    throw new PatchFormatError('im-qqbot 的 config 被锚点共享（其他条目引用同一份），原地修改会影响引用方');
  }
  if (!isMap(config) || config.has('__jsExpr')) throw new PatchFormatError('im-qqbot 条目的 config 必须是可编辑的映射');
  return config;
}

function definesAnchor(value: unknown): boolean {
  if (!isNode(value)) return false;
  let shared = false;
  visit(value, {
    Node(_key, node) {
      if ('anchor' in node && node.anchor) { shared = true; return visit.BREAK; }
    },
  });
  return shared;
}

function detachedConfig(original: YAMLMap): YAMLMap {
  const config = original.clone() as YAMLMap;
  delete config.anchor;
  // Leave shared definitions in the original row. The later QQBot row owns
  // only its edited values and still refers to the original anchors.
  visit(config, {
    Node(_key, node) { if ('anchor' in node && typeof node.anchor === 'string') return new Alias(node.anchor); },
  });
  return config;
}

/** 执行编辑并检测文档变更；fail-closed 错误向上抛给调用方拒绝写入 */
function applyEdit(doc: Document.Parsed, original: string, edit: (ctx: EditContext) => EditResult, updatedKeys?: readonly string[]): boolean {
  const existing = findEntryConfig(doc, updatedKeys !== undefined);
  const shared = existing && (existing.anchor || isAlias(findEntryConfigNode(doc))
    || updatedKeys?.some(key => definesAnchor(existing.get(key, true))));
  const config = existing ? shared ? detachedConfig(existing) : existing : new YAMLMap();
  const attached = existing !== undefined && !shared;
  const appendEntry = (): void => {
    const seq = doc.contents as YAMLSeq;
    // 空文件重建的文档是流式 `[]`，追加时重置为块式输出（与手写 patch 形态一致）
    seq.flow = false;
    const entry = new YAMLMap();
    entry.set('id', ENTRY_ID);
    entry.set('config', config);
    seq.add(entry);
  };
  const before = doc.toString({ lineWidth: 0 });
  edit({ config, attached, appendEntry, original });
  return doc.toString({ lineWidth: 0 }) !== before;
}

/** 写入字面量字符串（覆盖已有的 !!js 表达式等节点） */
function setPlainValue(config: YAMLMap, key: string, value: string): void {
  config.set(key, value);
}

/**
 * 将凭据写入 dsh profile 的 cordis.patch.yml。
 *
 * 更新或追加 im-qqbot 条目的 appId/appSecret，其余内容（其他插件条目、
 * insert 行、注释、锚点、`!!js` 表达式）原样保留。文件不存在时安全重建。
 */
export function persistCredentialsToProfile(
  credentials: SetupCredentials,
  profileDir?: string,
  logger?: { info(msg: string, ...args: unknown[]): void; warn(msg: string, ...args: unknown[]): void },
): boolean {
  const log = logger ?? console;
  if (!profileDir) {
    // 开发模式：插件从源码加载、不在 node_modules 下，无法定位 profile 目录
    printEnvInstructions(credentials);
    return false;
  }

  try {
    const ok = editProfilePatch(
      profileDir,
      ({ config, attached, appendEntry }) => {
        setPlainValue(config, 'appId', credentials.appId);
        setPlainValue(config, 'appSecret', credentials.appSecret);
        if (!attached) appendEntry();
        return true;
      },
      {},
      (config) => config !== undefined
        && config.get('appId') === credentials.appId
        && config.get('appSecret') === credentials.appSecret,
      log,
    );
    if (ok) {
      log.info(`✔ 凭据已写入: ${resolve(profileDir, 'cordis.patch.yml')}`);
      log.info(`  下次启动将自动使用保存的凭据`);
    }
    return ok;
  } catch (err) {
    if (err instanceof PatchFormatError) {
      log.warn(`拒绝写入 cordis.patch.yml: ${err.message}（原文件保留）`);
      return false;
    }
    log.warn(`写入配置失败: ${err instanceof Error ? err.message : String(err)}`);
    printYamlInstructions(credentials, resolve(profileDir, 'cordis.patch.yml'));
    return false;
  }
}

/**
 * 从 dsh profile 的 cordis.patch.yml 中移除已保存的凭据（解绑）。
 *
 * 保留 im-qqbot 条目的其余 config（requireMention 等用户配置）与其他所有
 * 条目。条目或字段不存在时仍强制写回一次——宿主 HMR 靠文件 mtime 触发
 * 重载，不写则 bound fiber 永不卸载，解绑后状态会停留在 bound。
 */
export function removeCredentialsFromProfile(
  profileDir?: string,
  logger?: { info(msg: string, ...args: unknown[]): void; warn(msg: string, ...args: unknown[]): void },
  expectedAppId?: string,
): boolean {
  const log = logger ?? console;
  if (!profileDir) return false;

  try {
    const ok = editProfilePatch(
      profileDir,
      ({ config }) => {
        checkedAppId(config, expectedAppId);
        if (config.has('appId')) config.delete('appId');
        if (config.has('appSecret')) config.delete('appSecret');
        return true;
      },
      { force: true },
      (config) => config === undefined
        || (config.get('appId') === undefined && config.get('appSecret') === undefined),
      log,
    );
    if (ok) {
      log.info(`✔ 凭据已移除: ${resolve(profileDir, 'cordis.patch.yml')}`);
      log.info(`  插件将重新进入绑定流程`);
    }
    return ok;
  } catch (err) {
    if (err instanceof PatchFormatError) {
      log.warn(`拒绝写入 cordis.patch.yml: ${err.message}（原文件保留）`);
      return false;
    }
    log.warn(`移除凭据失败: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export function unbindProfileCredentials(
  profileDir?: string,
  logger?: Logger,
  expectedAppId?: string,
): boolean {
  if (!removeCredentialsFromProfile(profileDir, logger, expectedAppId)) return false;
  delete process.env.QQBOT_APPID;
  delete process.env.QQBOT_SECRET;
  return true;
}

/**
 * 将配置更新合并进 dsh profile 的 cordis.patch.yml（im-qqbot 条目）。
 *
 * 最小写入原则：只把「本次提交的顶层键」合并进条目 config——
 * 不固化 bundle patch 的默认值（保持其版本演进的覆盖能力），
 * 不触碰已保存的凭据字段（appId/appSecret 由绑定/更换/解绑流程管理）。
 * 嵌套对象（如 access）按顶层键整体替换，避免部分合并出混合态。
 * 写入触发 HMR 重载，新 fiber 以新配置启动。
 */
export function updateProfileConfig(
  configPatch: Record<string, unknown>,
  profileDir?: string,
  logger?: { info(msg: string, ...args: unknown[]): void; warn(msg: string, ...args: unknown[]): void },
  accessCondition?: { revision: string; fallback: unknown; appId?: string; hostAccess?: HostAccessSource },
): boolean {
  const log = logger ?? console;
  if (!profileDir) {
    log.warn('未定位到 profile 目录（源码直载或非常规安装），配置未保存');
    log.warn('请手动编辑对应 profile 的 cordis.patch.yml（im-qqbot 条目的 config）后重启生效');
    return false;
  }

  try {
    const ok = editProfilePatch(
      profileDir,
      ({ config, attached, appendEntry, original }) => {
        if (accessCondition) {
          const current = accessSnapshot(readAccessSource(original), accessCondition.fallback, accessCondition.appId, accessCondition.hostAccess);
          if (current.revision !== accessCondition.revision) {
            throw new AccessConfigConflict();
          }
        }
        for (const [key, value] of Object.entries(configPatch)) {
          if (key === 'appId' || key === 'appSecret') continue;
          config.set(key, value);
        }
        if (!attached) appendEntry();
        return true;
      },
      { updatedKeys: Object.keys(configPatch) },
      (config) => config !== undefined,
      log,
    );
    if (ok) {
      log.info(`✔ 配置已保存: ${resolve(profileDir, 'cordis.patch.yml')}`);
      log.info(`  插件将自动重载`);
    }
    return ok;
  } catch (err) {
    if (err instanceof AccessConfigConflict) throw err;
    if (err instanceof PatchFormatError) {
      log.warn(`拒绝写入 cordis.patch.yml: ${err.message}（原文件保留）`);
      return false;
    }
    log.warn(`保存配置失败: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** 开发模式引导：未定位到 profile 目录，引导用环境变量配置（console.log 确保可见） */
function printEnvInstructions(credentials: SetupCredentials): void {
  console.log('未检测到 profile 目录（开发模式），请通过环境变量配置凭据:');
  if (process.platform === 'win32') {
    // Windows CMD 语法（PowerShell 请用 $env:QQBOT_APPID="xxx"）
    console.log(`  set QQBOT_APPID=${credentials.appId}`);
    console.log(`  set QQBOT_SECRET=${credentials.appSecret}`);
  } else {
    console.log(`  export QQBOT_APPID="${credentials.appId}"`);
    console.log(`  export QQBOT_SECRET="${credentials.appSecret}"`);
  }
}

/** 正式安装引导：自动写入失败，引导手动在 cordis.patch.yml 配置（console.log 确保可见） */
function printYamlInstructions(credentials: SetupCredentials, patchPath: string): void {
  console.log('无法自动保存凭据，请手动打开以下文件添加配置:');
  console.log(`  ${patchPath}`);
  console.log('');
  console.log('  - id: im-qqbot');
  console.log('    config:');
  console.log(`      appId: "${credentials.appId}"`);
  console.log(`      appSecret: "${credentials.appSecret}"`);
}
