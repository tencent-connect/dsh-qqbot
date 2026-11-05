/**
 * 多 bot 的 prefs 状态命名空间回归
 *
 * 钉死的两个语义：
 * 1. 单 bot（未配置 bots[]）路径与历史一致：~/.dsh-qqbot/model-prefs.json；
 * 2. 多 bot 每个 appId 一份文件，互不可见——并且必须走 PrefsStore 的
 *    options 形态（`{ path }`）。传字符串会静默回落到共享文件（不报错），
 *    是这条 PR 最容易回归的坑，故单独钉一条用例。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { ConfigSchema, type ImQQBotConfig } from '../config.ts';

const env = vi.hoisted(() => ({ home: '' }));

// 注入临时 PLUGIN_HOME：真实目录留给真实 bot，测试不写 ~/.dsh-qqbot
vi.mock('../shared/dirs.ts', () => ({
  get PLUGIN_HOME() { return env.home; },
  resolveAgentCwd: (cwd?: string) => cwd || `${env.home}/workspace`,
  resolvePrefsPath: (appId: string, multiBot?: boolean) =>
    (multiBot === true && appId ? `${env.home}/bots/${appId}/model-prefs.json` : undefined),
}));

const { ModelResolver } = await import('./model-resolver.ts');
const { PrefsStore } = await import('./prefs-store.ts');

/** ModelResolver 只把 ctx 当服务查询入口（get），测试无需真实 fiber */
const CTX = { get: (): undefined => undefined } as unknown as Context;

const configFor = (appId: string, multiBot?: boolean): ImQQBotConfig => ({
  ...(ConfigSchema({ appId, appSecret: 'secret' }) as ImQQBotConfig),
  ...(multiBot === undefined ? {} : { multiBot }),
});

const KEY_A = 'qqbot:1001:c2c:peer-a';
const KEY_B = 'qqbot:1002:c2c:peer-b';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-botprefs-'));
  env.home = home;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  env.home = '';
});

describe('单 bot 回归（未配置 bots[]）', () => {
  it('prefs 仍落 legacy 共享文件，不产生 bots/ 目录', () => {
    const resolver = new ModelResolver(CTX, configFor('1001'));
    resolver.setSessionId(KEY_A, 'session-a');

    const legacy = join(home, 'model-prefs.json');
    expect(existsSync(legacy)).toBe(true);
    expect(JSON.parse(readFileSync(legacy, 'utf8')).sessionIds).toEqual({ [KEY_A]: 'session-a' });
    expect(existsSync(join(home, 'bots'))).toBe(false);
  });
});

describe('多 bot：per-appId prefs 隔离', () => {
  it('两个 appId 落盘到不同文件，各自只含自己的条目', () => {
    const resolverA = new ModelResolver(CTX, configFor('1001', true));
    const resolverB = new ModelResolver(CTX, configFor('1002', true));

    resolverA.setSessionId(KEY_A, 'session-a');
    resolverB.setSessionId(KEY_B, 'session-b');

    const pathA = join(home, 'bots', '1001', 'model-prefs.json');
    const pathB = join(home, 'bots', '1002', 'model-prefs.json');
    expect(pathA).not.toBe(pathB);
    expect(existsSync(pathA)).toBe(true);
    expect(existsSync(pathB)).toBe(true);

    expect(JSON.parse(readFileSync(pathA, 'utf8')).sessionIds).toEqual({ [KEY_A]: 'session-a' });
    expect(JSON.parse(readFileSync(pathB, 'utf8')).sessionIds).toEqual({ [KEY_B]: 'session-b' });

    // 共享文件不该被顺带写脏（否则单 bot 的存量映射会看到多 bot 的 key）
    expect(existsSync(join(home, 'model-prefs.json'))).toBe(false);
  });

  it('会话映射互不可见：A 记下的 sessionId 不会被 B 当成自己的', () => {
    const resolverA = new ModelResolver(CTX, configFor('1001', true));
    const resolverB = new ModelResolver(CTX, configFor('1002', true));

    resolverA.setSessionId(KEY_A, 'session-a');

    expect(resolverA.getSessionId(KEY_A)).toBe('session-a');
    expect(resolverB.getSessionId(KEY_A)).toBeUndefined();
  });

  it('显式传入的 prefsPath 优先（bootstrap 侧只算一次路径）', () => {
    const custom = join(home, 'custom', 'prefs.json');
    const resolver = new ModelResolver(CTX, configFor('1001', true), undefined, custom);
    resolver.setSessionId(KEY_A, 'session-a');

    expect(existsSync(custom)).toBe(true);
    expect(existsSync(join(home, 'bots', '1001', 'model-prefs.json'))).toBe(false);
  });
});

describe('陷阱回归：PrefsStore 第二参必须是 options 对象', () => {
  it('传路径字符串 → options.path 为 undefined，静默回落共享文件（隔离失效）', () => {
    const intended = join(home, 'bots', '1001', 'model-prefs.json');
    // 旧实现（0.5.2 分支）的调用形态：把路径当第二个位置参数
    const regressed = new PrefsStore(undefined, intended as unknown as { path?: string });
    regressed.setSessionId(KEY_A, 'session-a');

    expect(existsSync(intended)).toBe(false); // 目标 per-bot 文件根本没写
    expect(existsSync(join(home, 'model-prefs.json'))).toBe(true); // 共享文件被污染
  });

  it('传 { path } → 写到目标文件（ModelResolver 采用的就是这一形态）', () => {
    const intended = join(home, 'bots', '1001', 'model-prefs.json');
    const ok = new PrefsStore(undefined, { path: intended });
    ok.setSessionId(KEY_A, 'session-a');

    expect(existsSync(intended)).toBe(true);
    expect(existsSync(join(home, 'model-prefs.json'))).toBe(false);
  });
});