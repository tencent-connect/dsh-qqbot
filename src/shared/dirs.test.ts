import { describe, it, expect } from 'vitest';
import { dirname, join, resolve, sep } from 'node:path';
import { resolvePrefsPath } from './dirs.ts';

/** 与 resolvePrefsPath 内部一致地构造绝对路径（Windows 下 resolve 会补盘符） */
const HOME = resolve(sep, 'fake-home');
const BOTS = join(HOME, 'bots');

describe('resolvePrefsPath（per-bot prefs 命名空间派生）', () => {
  it('单 bot（multiBot 未开/为 false）→ undefined：沿用 legacy 共享 model-prefs.json', () => {
    expect(resolvePrefsPath('1001', undefined, HOME)).toBeUndefined();
    expect(resolvePrefsPath('1001', false, HOME)).toBeUndefined();
  });

  it('多 bot → per-appId 目录，两个 appId 拿到不同文件', () => {
    const a = resolvePrefsPath('1001', true, HOME);
    const b = resolvePrefsPath('1002', true, HOME);
    expect(a).toBe(join(BOTS, '1001', 'model-prefs.json'));
    expect(b).toBe(join(BOTS, '1002', 'model-prefs.json'));
    expect(a).not.toBe(b);
  });

  it('多 bot 路径不在 legacy 共享文件上（否则隔离失效且不报错）', () => {
    const legacy = join(HOME, 'model-prefs.json');
    expect(resolvePrefsPath('1001', true, HOME)).not.toBe(legacy);
  });

  it('appId 含路径分隔符/穿越片段 → 要么收敛到 bots 目录内，要么拒绝（绝不逃逸）', () => {
    for (const appId of ['../../etc', 'a/b', 'C:\\Windows', 'a/../b']) {
      const p = resolvePrefsPath(appId, true, HOME);
      expect(p).toBeDefined();
      // 父目录必须是 bots（即 appId 被规范化成单层目录名，无法上跳）
      expect(dirname(dirname(p!))).toBe(BOTS);
      expect(p!.endsWith('model-prefs.json')).toBe(true);
    }
    // 纯 . / .. 段没有安全等价物 → 拒绝派生（不猜落点）
    expect(resolvePrefsPath('..', true, HOME)).toBeUndefined();
    expect(resolvePrefsPath('.', true, HOME)).toBeUndefined();
  });

  it('空 appId → undefined（不产出 bots//model-prefs.json 这种共享落点）', () => {
    expect(resolvePrefsPath('', true, HOME)).toBeUndefined();
  });
});