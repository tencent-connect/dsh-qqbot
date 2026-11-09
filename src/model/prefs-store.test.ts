import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrefsStore } from './prefs-store.ts';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-prefs-'));
  path = join(dir, 'model-prefs.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const store = (): PrefsStore => new PrefsStore(undefined, { path });

describe('PrefsStore 并发安全（E3）', () => {
  it('写前合并：后写实例保留磁盘上其他写者的条目（多实例共存）', () => {
    const a = store();
    a.setSessionId('botA:peer1', 'session-a1');

    const b = store(); // 另一实例：load 读到 botA 的条目
    b.setSessionId('botB:peer2', 'session-b1');

    const disk = JSON.parse(readFileSync(path, 'utf8'));
    expect(disk.sessionIds).toEqual({
      'botA:peer1': 'session-a1',
      'botB:peer2': 'session-b1',
    });
  });

  it('两个实例交错写入时保留另一账号的新会话、模型和预设', () => {
    const a = store();
    a.setSessionId('botA:peer', 'session-a1');
    a.setPreset('botA:peer', 'preset-a1');
    a.setOverride('botA:peer', { provider: 'provider', model: 'model-a1' });
    const b = store();

    a.setSessionId('botA:peer', 'session-a2');
    a.clearPreset('botA:peer');
    a.setOverride('botA:peer', { provider: 'provider', model: 'model-a2' });
    b.setSessionId('botB:peer', 'session-b1');

    const restored = store();
    expect(restored.getSessionId('botA:peer')).toBe('session-a2');
    expect(restored.findSessionKey('session-a1')).toBeUndefined();
    expect(restored.getPreset('botA:peer')).toBeUndefined();
    expect(restored.getOverride('botA:peer')).toEqual({ provider: 'provider', model: 'model-a2' });
    expect(restored.getSessionId('botB:peer')).toBe('session-b1');
  });

  it('保存失败后重试待写改动，保留期间已落盘的其他账号更新', () => {
    const onError = vi.fn();
    const a = new PrefsStore(undefined, { path, onError });
    a.setPreset('botA:peer', 'preset-a1');
    a.setSessionId('botB:peer', 'session-b1');
    const b = store();

    const saved = join(dir, 'saved-prefs.json');
    renameSync(path, saved);
    mkdirSync(path);
    a.clearPreset('botA:peer');
    a.setSessionId('botA:peer', 'session-a1');
    expect(onError).toHaveBeenCalledTimes(2);
    rmSync(path, { recursive: true });
    renameSync(saved, path);

    b.setSessionId('botB:peer', 'session-b2');
    a.setOverride('botA:peer', { provider: 'provider', model: 'model-a1' });
    const restored = store();
    expect(restored.getPreset('botA:peer')).toBeUndefined();
    expect(restored.getSessionId('botA:peer')).toBe('session-a1');
    expect(restored.getSessionId('botB:peer')).toBe('session-b2');
  });

  it('显式修改同一键时，新值覆盖磁盘旧值', () => {
    const a = store();
    a.setSessionId('k', 'old');

    const b = store();
    b.setSessionId('k', 'new');

    const disk = JSON.parse(readFileSync(path, 'utf8'));
    expect(disk.sessionIds.k).toBe('new');
    expect(b.getSessionId('k')).toBe('new');
  });

  it('写前重读合并：实例未重启时磁盘被外部写入的新 key 也不丢', () => {
    const a = store();
    a.setSessionId('k1', 'v1');

    // 外部进程（不经 a 的内存）直接写入了 k2
    const external = JSON.parse(readFileSync(path, 'utf8'));
    external.sessionIds.k2 = 'v2';
    writeFileSync(path, JSON.stringify(external), 'utf8');

    a.setSessionId('k1', 'v1-updated');

    const disk = JSON.parse(readFileSync(path, 'utf8'));
    expect(disk.sessionIds).toEqual({ k1: 'v1-updated', k2: 'v2' });
  });

  it('删除墓碑：clear 后并发写盘的旧值不复活', () => {
    const a = store();
    a.setPreset('k', 'p1');

    // 外部进程写入了 k 的旧值（模拟另一写者把条目落盘）
    const external = JSON.parse(readFileSync(path, 'utf8'));
    external.presets.k = 'p-external';
    writeFileSync(path, JSON.stringify(external), 'utf8');

    a.clearPreset('k'); // 本进程显式删除 → 墓碑

    const disk = JSON.parse(readFileSync(path, 'utf8'));
    expect('k' in disk.presets).toBe(false);

    // 墓碑解除：重新 set 后正常落盘
    a.setPreset('k', 'p2');
    expect(JSON.parse(readFileSync(path, 'utf8')).presets.k).toBe('p2');
  });

  it('原子写：崩溃不留半截 JSON（写入后文件始终可解析），tmp 带唯一后缀且已清理', () => {
    const a = store();
    for (let i = 0; i < 5; i += 1) {
      a.setSessionId(`k${i}`, `v${i}`);
      expect(() => JSON.parse(readFileSync(path, 'utf8'))).not.toThrow();
    }
    // 唯一后缀（pid+随机）：跨进程并发写互不覆盖对方的临时文件
    const leftovers = readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]); // rename 后临时文件已清理
  });

  it('半截 JSON：load 报错可见，覆盖前备份原文件（丢失的映射可人工恢复）', () => {
    const corrupted = '{"sessionIds":{"k1":"v1","k2":"v2"'; // 尾部截断，前面条目完好
    writeFileSync(path, corrupted, 'utf8');
    const onError = vi.fn();

    const a = new PrefsStore(undefined, { path, onError });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('loadPrefs failed'));
    expect(a.getSessionId('k1')).toBeUndefined(); // 解析失败，内存为空

    a.setSessionId('fresh', 'v'); // 触发写入：覆盖损坏文件前应先备份

    const backups = readdirSync(dir).filter((f) => f.includes('.corrupted.'));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(dir, backups[0]!), 'utf8')).toBe(corrupted); // 原文完整留证
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('已备份原文件'));
    expect(JSON.parse(readFileSync(path, 'utf8')).sessionIds.fresh).toBe('v');
  });

  it('损坏文件只备份一次（多次写入不堆积备份）', () => {
    writeFileSync(path, '{broken', 'utf8');
    const a = new PrefsStore(undefined, { path });
    a.setSessionId('a', '1');
    a.setSessionId('b', '2');
    a.setSessionId('c', '3');
    expect(readdirSync(dir).filter((f) => f.includes('.corrupted.'))).toHaveLength(1);
  });
});

describe('PrefsStore.findSessionKey 反向索引', () => {
  it('随 set/clear 同步维护：换新会话后旧 id 不再命中', () => {
    const s = store();
    s.setSessionId('k', 'session-1');
    expect(s.findSessionKey('session-1')).toBe('k');

    s.setSessionId('k', 'session-2');
    expect(s.findSessionKey('session-1')).toBeUndefined();
    expect(s.findSessionKey('session-2')).toBe('k');

    s.clearSessionId('k');
    expect(s.findSessionKey('session-2')).toBeUndefined();
  });

  it('load 时从磁盘重建索引', () => {
    store().setSessionId('k', 'session-1');

    expect(store().findSessionKey('session-1')).toBe('k');
  });
});
