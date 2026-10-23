/**
 * PrefsStore — per-peer 会话偏好持久化（模型 + preset）
 *
 * 隔离文件 I/O 操作，构造时可注入 filePath（单测/多实例命名空间）。
 * 默认存储路径：~/.dsh-qqbot/model-prefs.json
 *
 * 持久化保证：
 * - 写入原子（tmp + rename）：进程中断不再产生半截 JSON 覆盖旧数据；
 * - 读取容错但留痕：文件解析失败时改名为 `.corrupt-<ts>` 保留取证
 *   （旧实现只在 debug 模式打一行日志，损坏事故静默无迹），随后以空偏好继续。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { ModelRoute } from './types.ts';

/** 日志回调（可选） */
type DebugFn = (msg: string) => void;

/** 隔离偏好文件结构 */
interface PrefsFile {
  overrides: Record<string, ModelRoute>;
  /** sessionKey → 最新 sessionId（fork 后更新，用于重启后恢复到 fork 后的会话） */
  sessionIds: Record<string, string>;
  /** sessionKey → preset id（per-peer preset 覆盖） */
  presets: Record<string, string>;
}

export class PrefsStore {
  /** per-peer 模型偏好（内存态） */
  private overrides = new Map<string, ModelRoute>();
  /** per-peer 最新 sessionId（fork 后更新，内存态） */
  private sessionIds = new Map<string, string>();
  /** per-peer preset 偏好（内存态） */
  private presets = new Map<string, string>();
  /** 隔离偏好文件路径 */
  private readonly prefsPath: string;
  private readonly debugLog?: DebugFn;

  constructor(debugLog?: DebugFn, filePath?: string) {
    this.prefsPath = filePath ?? resolve(homedir(), '.dsh-qqbot', 'model-prefs.json');
    this.debugLog = debugLog;
    this.load();
  }

  // ── Override 操作 ──

  getOverride(sessionKey: string): ModelRoute | undefined {
    return this.overrides.get(sessionKey);
  }

  setOverride(sessionKey: string, route: ModelRoute): void {
    this.overrides.set(sessionKey, route);
    this.write();
  }

  clearOverride(sessionKey: string): boolean {
    const deleted = this.overrides.delete(sessionKey);
    if (deleted) this.write();
    return deleted;
  }

  hasOverride(sessionKey: string): boolean {
    return this.overrides.has(sessionKey);
  }

  // ── SessionId 操作 ──

  getSessionId(sessionKey: string): string | undefined {
    return this.sessionIds.get(sessionKey);
  }

  setSessionId(sessionKey: string, sessionId: string): void {
    this.sessionIds.set(sessionKey, sessionId);
    this.write();
  }

  clearSessionId(sessionKey: string): boolean {
    const deleted = this.sessionIds.delete(sessionKey);
    if (deleted) this.write();
    return deleted;
  }

  // ── Preset 操作 ──

  getPreset(sessionKey: string): string | undefined {
    return this.presets.get(sessionKey);
  }

  setPreset(sessionKey: string, presetId: string): void {
    this.presets.set(sessionKey, presetId);
    this.write();
  }

  clearPreset(sessionKey: string): boolean {
    const deleted = this.presets.delete(sessionKey);
    if (deleted) this.write();
    return deleted;
  }

  // ── 私有方法 ──

  private load(): void {
    try {
      if (!existsSync(this.prefsPath)) return;
      const content = readFileSync(this.prefsPath, 'utf8');
      const data = this.parseOrQuarantine(content);
      if (!data) return;
      if (data.overrides && typeof data.overrides === 'object') {
        for (const [key, route] of Object.entries(data.overrides)) {
          if (route.provider && route.model) {
            this.overrides.set(key, { provider: route.provider, model: route.model });
          }
        }
      }
      if (data.sessionIds && typeof data.sessionIds === 'object') {
        for (const [key, sessionId] of Object.entries(data.sessionIds)) {
          if (typeof sessionId === 'string' && sessionId) {
            this.sessionIds.set(key, sessionId);
          }
        }
      }
      if (data.presets && typeof data.presets === 'object') {
        for (const [key, presetId] of Object.entries(data.presets)) {
          if (typeof presetId === 'string' && presetId) {
            this.presets.set(key, presetId);
          }
        }
      }
    } catch (err) {
      this.debugLog?.(`loadPrefs failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** JSON 解析失败 → 损坏文件改名隔离保留取证，返回 undefined（调用方以空偏好继续）。 */
  private parseOrQuarantine(content: string): PrefsFile | undefined {
    try {
      return JSON.parse(content) as PrefsFile;
    } catch (err) {
      const quarantine = `${this.prefsPath}.corrupt-${Date.now()}`;
      try {
        renameSync(this.prefsPath, quarantine);
        this.debugLog?.(`loadPrefs: 文件损坏已隔离到 ${quarantine}（原因：${err instanceof Error ? err.message : String(err)}）`);
      } catch {
        this.debugLog?.(`loadPrefs failed（隔离亦失败）: ${err instanceof Error ? err.message : String(err)}`);
      }
      return undefined;
    }
  }

  private write(): void {
    const tmp = `${this.prefsPath}.tmp`;
    try {
      mkdirSync(dirname(this.prefsPath), { recursive: true });
      const data: PrefsFile = {
        overrides: Object.fromEntries(this.overrides.entries()),
        sessionIds: Object.fromEntries(this.sessionIds.entries()),
        presets: Object.fromEntries(this.presets.entries()),
      };
      // 原子写：先落 tmp 再 rename 覆盖目标，rename 在同卷上是原子的，
      // 任何时刻目标路径上的文件要么是完整旧版本、要么是完整新版本。
      writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      renameSync(tmp, this.prefsPath);
    } catch (err) {
      try {
        unlinkSync(tmp);
      } catch { /* tmp 可能不存在，忽略 */ }
      this.debugLog?.(`writePrefs failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
