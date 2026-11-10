/**
 * PrefsStore — per-peer 会话偏好持久化（模型 + preset）
 *
 * 隔离文件 I/O 操作，便于单元测试时 mock。
 * 存储路径：~/.dsh-qqbot/model-prefs.json（全局共享，多实例/多进程共存）。
 *
 * 写前重读磁盘，只合并本实例待保存的修改与删除。原子替换后清除待写键。
 * 同进程的同步写入不会交错。原子替换不提供跨进程读改写互斥。
 */
import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { PLUGIN_HOME } from '../shared/dirs.ts';
import type { ModelRoute } from './types.ts';

/** 日志回调（可选） */
type DebugFn = (msg: string) => void;
/** 持久化异常回调（可选，应接 warn 级日志——映射丢失影响会话连续性，需可见） */
type ErrorFn = (msg: string) => void;

/** 隔离偏好文件结构 */
interface PrefsFile {
  overrides: Record<string, ModelRoute>;
  /** sessionKey → 最新 sessionId（fork 后更新，用于重启后恢复到 fork 后的会话） */
  sessionIds: Record<string, string>;
  /** Previously current native sessions, grouped by the same peer key. */
  sessionHistory?: Record<string, string[]>;
  /** sessionKey → preset id（per-peer preset 覆盖） */
  presets: Record<string, string>;
}

export class PrefsStore {
  /** per-peer 模型偏好（内存态） */
  private overrides = new Map<string, ModelRoute>();
  /** per-peer 最新 sessionId（fork 后更新，内存态） */
  private sessionIds = new Map<string, string>();
  /** sessionIds 的反向索引（sessionId → sessionKey），与 sessionIds 同步维护 */
  private sessionKeys = new Map<string, string>();
  private readonly sessionHistory = new Map<string, string[]>();
  /** per-peer preset 偏好（内存态） */
  private presets = new Map<string, string>();
  private readonly pending: Record<Exclude<keyof PrefsFile, 'sessionHistory'>, Set<string>> = {
    overrides: new Set(),
    sessionIds: new Set(),
    presets: new Set(),
  };
  /** 隔离偏好文件路径 */
  private readonly prefsPath: string;
  private readonly debugLog?: DebugFn;
  private readonly onError?: ErrorFn;

  constructor(debugLog?: DebugFn, options?: { path?: string; onError?: ErrorFn }) {
    this.prefsPath = options?.path ?? resolve(PLUGIN_HOME, 'model-prefs.json');
    this.debugLog = debugLog;
    this.onError = options?.onError;
    this.load();
  }

  // ── Override 操作 ──

  getOverride(sessionKey: string): ModelRoute | undefined {
    return this.overrides.get(sessionKey);
  }

  setOverride(sessionKey: string, route: ModelRoute): void {
    this.overrides.set(sessionKey, route);
    this.write('overrides', sessionKey);
  }

  clearOverride(sessionKey: string): boolean {
    const deleted = this.overrides.delete(sessionKey);
    if (deleted) this.write('overrides', sessionKey);
    return deleted;
  }

  hasOverride(sessionKey: string): boolean {
    return this.overrides.has(sessionKey);
  }

  // ── SessionId 操作 ──

  getSessionId(sessionKey: string): string | undefined {
    return this.sessionIds.get(sessionKey);
  }

  /**
   * sessionId → sessionKey（O(1) 反向索引）。出站只拿到会话 id 时，用来找回 QQ 对端。
   * 只反映本进程内存视角；其他写者后写入的映射在下次 load 前不可见。
   */
  findSessionKey(sessionId: string): string | undefined {
    return this.sessionKeys.get(sessionId);
  }

  findUniqueCurrentSessionKey(sessionId: string): string | undefined {
    const indexed = this.findSessionKey(sessionId);
    if (!indexed) return undefined;
    for (const [key, id] of this.sessionIds) {
      if (id === sessionId && key !== indexed) return undefined;
    }
    return indexed;
  }

  findKnownSessionKey(sessionId: string): string | undefined {
    const current = this.findSessionKey(sessionId);
    if (current !== undefined) return current;
    for (const [key, ids] of this.sessionHistory) {
      if (ids.includes(sessionId)) return key;
    }
    return undefined;
  }

  listSessionBindings(appId: string): { key: string; current?: string; history: readonly string[] }[] {
    const prefix = `qqbot:${appId}:`;
    return [...new Set([...this.sessionIds.keys(), ...this.sessionHistory.keys(), ...this.overrides.keys(), ...this.presets.keys()])]
      .filter(key => key.startsWith(prefix))
      .map(key => ({
        key, current: this.sessionIds.get(key), history: [...(this.sessionHistory.get(key) ?? [])],
      }));
  }

  setSessionId(sessionKey: string, sessionId: string, options?: { durable: true; previous?: string }): void {
    const previous = this.sessionIds.get(sessionKey);
    const history = this.sessionHistory.get(sessionKey);
    const alreadyPending = this.pending.sessionIds.has(sessionKey);
    this.rememberSession(sessionKey, sessionId, options?.previous ?? previous);
    this.unindexSessionId(sessionKey);
    this.sessionIds.set(sessionKey, sessionId);
    this.sessionKeys.set(sessionId, sessionKey);
    try {
      this.write('sessionIds', sessionKey, options?.durable);
    } catch (error) {
      this.unindexSessionId(sessionKey);
      if (previous === undefined) this.sessionIds.delete(sessionKey);
      else {
        this.sessionIds.set(sessionKey, previous);
        this.sessionKeys.set(previous, sessionKey);
      }
      if (history === undefined) this.sessionHistory.delete(sessionKey);
      else this.sessionHistory.set(sessionKey, history);
      if (!alreadyPending) this.pending.sessionIds.delete(sessionKey);
      throw error;
    }
  }

  clearSessionId(sessionKey: string): boolean {
    this.rememberSession(sessionKey);
    this.unindexSessionId(sessionKey);
    const deleted = this.sessionIds.delete(sessionKey);
    if (deleted) this.write('sessionIds', sessionKey);
    return deleted;
  }

  // ── Preset 操作 ──

  getPreset(sessionKey: string): string | undefined {
    return this.presets.get(sessionKey);
  }

  setPreset(sessionKey: string, presetId: string): void {
    this.presets.set(sessionKey, presetId);
    this.write('presets', sessionKey);
  }

  clearPreset(sessionKey: string): boolean {
    const deleted = this.presets.delete(sessionKey);
    if (deleted) this.write('presets', sessionKey);
    return deleted;
  }

  // ── 私有方法 ──

  private rememberSession(key: string, next?: string, previous = this.sessionIds.get(key)): void {
    if (previous === undefined || previous === next) return;
    const history = new Set(this.sessionHistory.get(key));
    history.add(previous);
    if (next !== undefined) history.delete(next);
    this.sessionHistory.set(key, [...history]);
  }

  /** 移除 sessionKey 当前指向的反向索引（仅当索引仍归属该 key） */
  private unindexSessionId(sessionKey: string): void {
    const previous = this.sessionIds.get(sessionKey);
    if (previous !== undefined && this.sessionKeys.get(previous) === sessionKey) {
      this.sessionKeys.delete(previous);
    }
  }

  private load(): void {
    try {
      if (!existsSync(this.prefsPath)) return;
      const content = readFileSync(this.prefsPath, 'utf8');
      const data = JSON.parse(content) as PrefsFile;
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
            this.sessionKeys.set(sessionId, key);
          }
        }
      }
      if (data.sessionHistory && typeof data.sessionHistory === 'object') {
        for (const [key, ids] of Object.entries(data.sessionHistory)) {
          if (!Array.isArray(ids)) continue;
          this.sessionHistory.set(key, [...new Set(ids.filter(id => typeof id === 'string' && id && id !== this.sessionIds.get(key)))]);
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
      const msg = `loadPrefs failed: ${err instanceof Error ? err.message : String(err)}`;
      // 解析失败（半截 JSON 等）意味着 sessionKey→sessionId 映射丢失，
      // 会话将回退固定 id——影响连续性，必须可见而非仅 debug
      this.onError?.(msg);
      this.debugLog?.(msg);
    }
  }

  /**
   * 读取磁盘当前状态用于合并。
   *
   * 不存在 → null（首次写）；损坏（半截 JSON 等）→ 先备份原文件再返回 null：
   * 损坏文件通常只是尾部截断，前面的映射条目往往完好，直接覆盖会把它们一并
   * 丢掉（用户表现为「QQ 里丢上下文」且无从恢复）。备份保留一份人工可救的证据。
   */
  private readDiskState(): PrefsFile | null {
    let raw: string;
    try {
      raw = readFileSync(this.prefsPath, 'utf8');
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return null;
      throw err;
    }
    try {
      const data = JSON.parse(raw) as PrefsFile;
      if (typeof data !== 'object' || data === null) throw new Error('not an object');
      return data;
    } catch {
      this.backupCorrupted(raw);
      return null;
    }
  }

  /** 损坏文件只备份一次（避免每次写入都产生新备份），失败不阻断写入 */
  private corruptedBackedUp = false;
  private backupCorrupted(raw: string): void {
    if (this.corruptedBackedUp) return;
    this.corruptedBackedUp = true;
    const backupPath = `${this.prefsPath}.corrupted.${Date.now()}`;
    try {
      writeFileSync(backupPath, raw, 'utf8');
      this.onError?.(`model-prefs.json 损坏，已备份原文件到 ${backupPath}（会话映射可能丢失，可从备份人工恢复）`);
    } catch (err) {
      this.onError?.(`model-prefs.json 损坏且备份失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private mergeDisk(disk: PrefsFile | null): PrefsFile {
    const merge = <T>(section: keyof typeof this.pending, mem: Map<string, T>, saved?: Record<string, T>): Record<string, T> => {
      if (disk === null) return Object.fromEntries(mem);
      const out = new Map(saved && typeof saved === 'object' ? Object.entries(saved) : []);
      for (const key of this.pending[section]) {
        const value = mem.get(key);
        if (value === undefined) out.delete(key);
        else out.set(key, value);
      }
      return Object.fromEntries(out);
    };
    const history = new Map(Object.entries(disk?.sessionHistory ?? Object.fromEntries(this.sessionHistory)));
    for (const key of this.pending.sessionIds) {
      const saved = history.get(key);
      const ids = new Set(Array.isArray(saved) ? saved.filter(id => typeof id === 'string' && id) : []);
      for (const id of this.sessionHistory.get(key) ?? []) ids.add(id);
      const previous = disk?.sessionIds?.[key];
      if (typeof previous === 'string' && previous) ids.add(previous);
      const current = this.sessionIds.get(key);
      if (current !== undefined) ids.delete(current);
      if (ids.size) history.set(key, [...ids]);
      else history.delete(key);
    }
    return {
      overrides: merge('overrides', this.overrides, disk?.overrides),
      sessionIds: merge('sessionIds', this.sessionIds, disk?.sessionIds),
      ...(history.size > 0 ? { sessionHistory: Object.fromEntries(history) } : {}),
      presets: merge('presets', this.presets, disk?.presets),
    };
  }

  private write(section: keyof typeof this.pending, key: string, durable = false): void {
    this.pending[section].add(key);
    try {
      mkdirSync(dirname(this.prefsPath), { recursive: true });
      const data = this.mergeDisk(this.readDiskState());
      // 原子写：同目录临时文件 + rename（同分区保证原子，崩溃不留半份文件）。
      // tmp 名带进程+随机后缀：跨进程并发写时各自的临时文件互不覆盖，
      // rename 只会带走自己写的那份（固定名会让 A 的 rename 落盘 B 的内容）
      const tmpPath = `${this.prefsPath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
      try {
        writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
        renameSync(tmpPath, this.prefsPath);
        for (const peer of this.pending.sessionIds) {
          const ids = data.sessionHistory?.[peer];
          if (ids?.length) this.sessionHistory.set(peer, ids);
          else this.sessionHistory.delete(peer);
        }
        for (const keys of Object.values(this.pending)) keys.clear();
      } catch (err) {
        try { unlinkSync(tmpPath); } catch { /* 临时文件可能不存在 */ }
        throw err;
      }
    } catch (err) {
      const msg = `writePrefs failed: ${err instanceof Error ? err.message : String(err)}`;
      this.onError?.(msg);
      this.debugLog?.(msg);
      if (durable) throw err;
    }
  }
}
