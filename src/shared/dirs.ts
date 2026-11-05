/**
 * 插件数据目录 — 单一事实源
 *
 * workspace / media / 模型偏好等子路径统一从 PLUGIN_HOME 派生，
 * 避免各模块各自 `resolve(homedir(), '.dsh-qqbot', ...)` 造成漂移。
 */
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/** 插件数据根目录（区别于宿主的 ~/.dsh） */
export const PLUGIN_HOME = resolve(homedir(), '.dsh-qqbot');

/**
 * agent 工作目录：显式配置优先（空串视为未配置），缺省 PLUGIN_HOME/workspace。
 *
 * session 创建、路径白名单（send-file 工具与交付物投递）共用此解析，
 * 保证「agent 在哪写文件」与「白名单允许哪个目录」不漂移。
 */
export function resolveAgentCwd(cwdConfig: string | undefined): string {
  return cwdConfig || resolve(PLUGIN_HOME, 'workspace');
}

/**
 * per-bot 模型偏好文件路径（多 bot 模式的 per-appId 状态命名空间）。
 *
 * 语义与迁移边界：
 * - 单 bot（含仅配 legacy appId/appSecret）→ undefined：沿用共享的
 *   PLUGIN_HOME/model-prefs.json，存量数据零迁移；
 * - 多 bot（multiBot 为 true）→ PLUGIN_HOME/bots/<appId>/model-prefs.json，
 *   每个实例一份，互不可见（sessionKey 本就含 appId，写入的是同一文件也
 *   不会串号，但 fork 后的 sessionId 映射与删除墓碑必须按 bot 隔离）。
 *
 * @param home 数据根目录（默认 PLUGIN_HOME，测试可注入）
 */
export function resolvePrefsPath(
  appId: string,
  multiBot: boolean | undefined,
  home: string = PLUGIN_HOME,
): string | undefined {
  if (multiBot !== true) return undefined;
  // appId 直接进路径段：只保留安全字符，防止配置笔误造成目录穿越
  const safe = appId.replace(/[^A-Za-z0-9._-]/g, '_');
  if (!safe || safe === '.' || safe === '..') return undefined;
  return resolve(home, 'bots', safe, 'model-prefs.json');
}
