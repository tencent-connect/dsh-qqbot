/**
 * 插件数据目录 — 单一事实源
 *
 * workspace / media / 模型偏好等子路径统一从 PLUGIN_HOME 派生，
 * 避免各模块各自 `resolve(homedir(), '.dsh-qqbot', ...)` 造成漂移。
 */
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

/** A dedicated data root isolates preferences and media between Host instances. */
export function resolvePluginHome(dataDir: string | undefined, userHome: string): string {
  if (dataDir === undefined || dataDir.trim() === '') return resolve(userHome, '.dsh-qqbot');
  if (!isAbsolute(dataDir)) throw new Error('QQBOT_DATA_DIR must be an absolute path');
  return resolve(dataDir);
}

/** 默认保持已有数据路径；隔离实例通过 QQBOT_DATA_DIR 指定独立目录。 */
export const PLUGIN_HOME = resolvePluginHome(process.env.QQBOT_DATA_DIR, homedir());

/**
 * agent 工作目录：显式配置优先（空串视为未配置），缺省 PLUGIN_HOME/workspace。
 *
 * session 创建、路径白名单（send-file 工具与交付物投递）共用此解析，
 * 保证「agent 在哪写文件」与「白名单允许哪个目录」不漂移。
 */
export function resolveAgentCwd(cwdConfig: string | undefined): string {
  return cwdConfig ? resolve(cwdConfig) : resolve(PLUGIN_HOME, 'workspace');
}
