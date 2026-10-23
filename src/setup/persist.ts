/**
 * QQ Bot 凭据持久化 — 写入 dsh profile 的 cordis.patch.yml
 *
 * 保留 YAML 文档节点，仅更新/追加 im-qqbot 配置，保留其他条目与注释，
 * 保证输出始终是合法 YAML。文件不存在或为空时安全重建；
 * 解析失败或结构异常时拒绝写入、保留原文件（避免覆盖用户其他配置）。
 */
import { resolve } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { isMap, isScalar, isSeq, parseDocument, type Document } from 'yaml';

/** 凭据结果 */
export interface SetupCredentials {
  appId: string;
  appSecret: string;
}

/**
 * 将凭据写入 dsh profile 的 cordis.patch.yml
 *
 * 保留 YAML 文档节点，仅更新/追加 im-qqbot 配置，保留其他条目与注释，
 * 保证输出始终是合法 YAML。文件不存在或为空时安全重建；
 * 解析失败或结构异常时拒绝写入、保留原文件（避免覆盖用户其他配置）。
 */
export function persistCredentialsToProfile(
  credentials: SetupCredentials,
  profileDir?: string,
  logger?: { info(msg: string, ...args: unknown[]): void; warn(msg: string, ...args: unknown[]): void },
): boolean {
  const log = logger ?? console;
  const dir = profileDir;
  if (!dir) {
    // 开发模式：插件从源码加载、不在 node_modules 下，无法定位 profile 目录
    printEnvInstructions(credentials);
    return false;
  }

  const patchPath = resolve(dir, 'cordis.patch.yml');

  try {
    const document = readPatchDocument(patchPath);
    const entry = findQQEntry(document);
    if (entry) {
      setConfigValues(document, entry, credentials);
    } else {
      document.add({ id: 'im-qqbot', config: credentials });
    }

    const output = document.toString();
    mkdirSync(dir, { recursive: true });
    writeFileSync(patchPath, output, 'utf8');
    log.info(`✔ 凭据已写入: ${patchPath}`);
    log.info(`  下次启动将自动使用保存的凭据`);
    return true;
  } catch (err) {
    log.warn(`写入配置失败: ${err instanceof Error ? err.message : String(err)}`);
    printYamlInstructions(credentials, patchPath);
    return false;
  }
}

/**
 * 从 dsh profile 的 cordis.patch.yml 中移除已保存的凭据（解绑）。
 *
 * 保留 im-qqbot 条目的其余 config（requireMention 等用户配置），
 * 仅删除 appId/appSecret 字段；条目或字段不存在时幂等成功。
 * 移除后写入触发 HMR 重载，插件回到未绑定态（绑定流程重新可用）。
 */
export function removeCredentialsFromProfile(
  profileDir?: string,
  logger?: { info(msg: string, ...args: unknown[]): void; warn(msg: string, ...args: unknown[]): void },
): boolean {
  const log = logger ?? console;
  if (!profileDir) {
    return false;
  }

  const patchPath = resolve(profileDir, 'cordis.patch.yml');

  try {
    if (!existsSync(patchPath)) return true; // 无 patch 文件 = 无凭据，幂等成功

    const document = readPatchDocument(patchPath);
    const entry = findQQEntry(document);
    const config = entry?.get('config');
    if (isMap(config)) {
      config.delete('appId');
      config.delete('appSecret');
    }

    // 无条件写回：幂等场景（凭据字段已不存在）也更新 mtime——
    // 宿主 HMR 靠文件变化触发重载，不写则 bound fiber 永不卸载，
    // 解绑后状态会一直停留在 bound
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(patchPath, document.toString(), 'utf8');
    log.info(`✔ 凭据已移除: ${patchPath}`);
    log.info(`  插件将重新进入绑定流程`);
    return true;
  } catch (err) {
    log.warn(`移除凭据失败: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
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
): boolean {
  const log = logger ?? console;
  if (!profileDir) {
    log.warn('未定位到 profile 目录，配置无法持久化');
    return false;
  }

  const patchPath = resolve(profileDir, 'cordis.patch.yml');

  try {
    const document = readPatchDocument(patchPath);
    const entry = findQQEntry(document);
    const { appId: _a, appSecret: _s, ...rest } = configPatch;
    if (entry) {
      setConfigValues(document, entry, rest);
    } else {
      document.add({ id: 'im-qqbot', config: rest });
    }

    mkdirSync(profileDir, { recursive: true });
    writeFileSync(patchPath, document.toString(), 'utf8');
    log.info(`✔ 配置已保存: ${patchPath}`);
    log.info(`  插件将自动重载`);
    return true;
  } catch (err) {
    log.warn(`保存配置失败: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** 保留所有 patch 节点；解析或结构错误时由调用者保留原文件。 */
function readPatchDocument(path: string) {
  const content = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const document: Document = parseDocument(content, {
    // 宿主的表达式标签只保留原文，不在凭据写入时求值。
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }],
  });
  if (document.errors.length) throw document.errors[0];
  if (document.warnings.length) throw document.warnings[0];
  if (document.contents === null) document.contents = document.createNode([]);
  if (!isSeq(document.contents)) {
    throw new Error('cordis.patch.yml 顶层必须是 YAML 数组');
  }
  if (document.contents.items.some((item) => !isMap(item))) {
    throw new Error('cordis.patch.yml 条目必须是 YAML 对象');
  }
  return document as typeof document & { contents: typeof document.contents };
}

function findQQEntry(document: ReturnType<typeof readPatchDocument>) {
  const entry = document.contents.items.find((item) => isMap(item) && item.get('id') === 'im-qqbot' && !item.has('insert'));
  if (!isMap(entry)) return undefined;
  const config = entry.get('config');
  if (config !== undefined && config !== null && !isMap(config)) {
    throw new Error('im-qqbot config 必须是 YAML 对象');
  }
  if (entry.anchor || (isMap(config) && (config.anchor || config.items.some((pair) => isScalar(pair.value) && pair.value.anchor)))) {
    throw new Error('im-qqbot 配置含锚点，拒绝修改以保留共享配置');
  }
  // 缺失或空 config 与原来的空对象行为一致。
  if (!isMap(config)) entry.set('config', document.createNode({}));
  return entry;
}

function setConfigValues(
  document: ReturnType<typeof readPatchDocument>,
  entry: NonNullable<ReturnType<typeof findQQEntry>>,
  values: Record<string, unknown> | SetupCredentials,
): void {
  const index = document.contents.items.indexOf(entry);
  for (const [key, value] of Object.entries(values)) {
    const path = [index, 'config', key];
    document.setIn(path, value);
    const node = document.getIn(path, true);
    // 提交的值是字面量，不能继承旧字段的 !!js 表达式标签。
    if (isScalar(node)) node.tag = undefined;
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
