import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrefsStore } from './prefs-store.ts';

const dirs: string[] = [];

function tmpPath(name = 'model-prefs.json'): string {
  const dir = mkdtempSync(join(tmpdir(), 'qqbot-prefs-'));
  dirs.push(dir);
  return join(dir, name);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('prefs-store 持久化', () => {
  it('写入-重载 round-trip（三类映射都恢复）', () => {
    const path = tmpPath();
    const a = new PrefsStore(undefined, path);
    a.setOverride('k1', { provider: 'pi-ai', model: 'm1' });
    a.setSessionId('k1', 'session-abc');
    a.setPreset('k1', 'preset-x');

    const b = new PrefsStore(undefined, path);
    expect(b.getOverride('k1')).toEqual({ provider: 'pi-ai', model: 'm1' });
    expect(b.getSessionId('k1')).toBe('session-abc');
    expect(b.getPreset('k1')).toBe('preset-x');
  });

  it('落盘文件是完整 JSON，且不留下 .tmp 残留', () => {
    const path = tmpPath();
    const store = new PrefsStore(undefined, path);
    store.setSessionId('k2', 'session-def');

    expect(() => JSON.parse(readFileSync(path, 'utf8'))).not.toThrow();
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it('损坏文件被隔离为 .corrupt-*，原路径释放，以空偏好继续', () => {
    const path = tmpPath();
    writeFileSync(path, '{"overrides": {"k1": ', 'utf8'); // 半截 JSON（模拟写中断产物）

    const store = new PrefsStore(undefined, path);
    expect(store.getOverride('k1')).toBeUndefined();

    const dir = path.slice(0, path.lastIndexOf('/') >= 0 ? path.lastIndexOf('/') : path.lastIndexOf('\\'));
    const quarantined = readdirSync(dir).filter((f) => f.includes('.corrupt-'));
    expect(quarantined).toHaveLength(1);
    // 取证：隔离文件保留原始坏内容
    expect(readFileSync(join(dir, quarantined[0]!), 'utf8')).toBe('{"overrides": {"k1": ');
  });

  it('隔离后再次写入能在新建文件上正常 round-trip', () => {
    const path = tmpPath();
    writeFileSync(path, 'not json at all', 'utf8');
    const store = new PrefsStore(undefined, path);
    store.setOverride('k9', { provider: 'p', model: 'm' });

    const reloaded = new PrefsStore(undefined, path);
    expect(reloaded.getOverride('k9')).toEqual({ provider: 'p', model: 'm' });
  });

  it('空文件（0 字节）同样走隔离路径而非抛错', () => {
    const path = tmpPath();
    writeFileSync(path, '', 'utf8');
    const store = new PrefsStore(undefined, path);
    expect(store.hasOverride('anything')).toBe(false);
    const dir = path.slice(0, path.lastIndexOf('/') >= 0 ? path.lastIndexOf('/') : path.lastIndexOf('\\'));
    expect(readdirSync(dir).some((f) => f.includes('.corrupt-'))).toBe(true);
  });
});
