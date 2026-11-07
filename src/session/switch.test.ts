/**
 * /sessions 会话导航的 SessionManager 用例
 *
 * - switchSession：账目准入校验、prefs 映射切换、工作区偏好同步、当前 agent 释放
 * - startNewInWorkspace：工作区准入校验、偏好 + 铸新 id、旧 agent 释放
 * - listSessionGroups / resolveSessionTarget：当前组置顶、isCurrent 标记、截断、序号/前缀解析
 * - resolveWorkspacePref：未登记偏好回退默认
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { ConfigSchema, type ImQQBotConfig } from '../config.ts';
import type { Logger, ReplyTarget } from '../types.ts';
import type { DshAgent, DshAgentHandle, DshAgentRegistry } from './types.ts';

const env = vi.hoisted(() => ({ home: '' }));

vi.mock('../shared/dirs.ts', () => ({
  get PLUGIN_HOME() { return env.home; },
  resolveAgentCwd: (cwd: string | undefined) => cwd || `${env.home}/workspace`,
}));

const { SessionManager } = await import('./session-manager.ts');
const { PrefsStore } = await import('../model/prefs-store.ts');

const APP_ID = 'app1';
const PEER = 'user1';
const KEY = `qqbot:${APP_ID}:c2c:${PEER}`;
const WS_A = '/tmp/ws-a';
const WS_B = '/tmp/ws-b';
const MINTED = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REPLY: ReplyTarget = { scope: 'c2c', targetId: PEER, msgId: 'm1' };

/** 工作区账目替身：workspaceRegistry.list + sessionPersistence.stat */
function workspaceCtx(
  workspaces: Array<{ path: string; title: string; sessionIds: string[] }>,
  headers: Record<string, { cwd?: string; agentPreset?: string; createdAt?: number }> = {},
): Context {
  return {
    get: (name: string) => {
      if (name === 'workspaceRegistry') {
        return { create: vi.fn(), list: () => workspaces };
      }
      if (name === 'sessionPersistence') {
        return { stat: async (id: string) => (headers[id] ? { header: headers[id] } : undefined) };
      }
      return undefined;
    },
    on: vi.fn(),
  } as unknown as Context;
}

function fakeAgent(id: string): DshAgent {
  return {
    id,
    ctx: {} as Context,
    status: 'idle',
    session: { id, snapshotEvents: () => [] },
    cancel: vi.fn(),
    followup: vi.fn(),
    whenIdle: vi.fn(async () => {}),
    runMaintenance: vi.fn(async (task: (signal: AbortSignal) => Promise<unknown>) => task(new AbortController().signal)),
  } as unknown as DshAgent;
}

function fakeHandle(id: string): DshAgentHandle {
  return { agent: fakeAgent(id), dispose: vi.fn(async () => {}) };
}

const managers: Array<InstanceType<typeof SessionManager>> = [];

function createManager(ctx: Context) {
  const registry = {
    get: vi.fn(() => undefined),
    resume: vi.fn(async ({ resumeSessionId }: { resumeSessionId: string }) => {
      throw Object.assign(new Error(`session "${resumeSessionId}" not found`), { name: 'SessionPersistenceNotFoundError' });
    }),
    create: vi.fn(async (options: { sessionId: string }) => fakeHandle(options.sessionId)),
  } as unknown as DshAgentRegistry;
  const config = ConfigSchema({
    appId: APP_ID,
    appSecret: 'secret',
    provider: 'p',
    model: 'm',
    cwd: join(env.home, 'workspace'),
    sessionIdleTimeout: 0,
  } as ImQQBotConfig);
  const logger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
  const manager = new SessionManager(ctx, registry, config, logger);
  managers.push(manager);
  return { manager, registry, logger };
}

beforeEach(() => {
  env.home = mkdtempSync(join(tmpdir(), 'im-qqbot-switch-'));
  mkdirSync(join(env.home, 'workspace'), { recursive: true });
});

afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.disposeAll()));
  rmSync(env.home, { recursive: true, force: true });
});

const prefs = (): PrefsStore => new PrefsStore();

describe('switchSession', () => {
  it('目标不在任何工作区账目内 → 拒绝且不写 prefs', async () => {
    const { manager } = createManager(workspaceCtx([
      { path: WS_A, title: 'A', sessionIds: ['session-aaa'] },
    ]));

    const outcome = await manager.switchSession('c2c', PEER, 'session-unknown');

    expect(outcome).toEqual({ ok: false, reason: 'unknown-session' });
    expect(prefs().getSessionId(KEY)).toBeUndefined();
  });

  it('命中账目 → 写映射 + 同步工作区偏好 + 释放当前 agent', async () => {
    const ctx = workspaceCtx(
      [
        { path: WS_A, title: 'A', sessionIds: ['session-aaa', 'session-bbb'] },
        { path: WS_B, title: 'B', sessionIds: ['session-ccc'] },
      ],
      { 'session-bbb': { cwd: WS_A, agentPreset: 'code', createdAt: 1_700_000_000_000 } },
    );
    const { manager, registry } = createManager(ctx);
    const record = await manager.getOrCreate('c2c', PEER, PEER, REPLY); // 新建当前会话
    const oldHandle = record.handle;

    const outcome = await manager.switchSession('c2c', PEER, 'session-bbb');

    expect(outcome.ok).toBe(true);
    expect(prefs().getSessionId(KEY)).toBe('session-bbb');
    expect(prefs().getWorkspace(KEY)).toBe(WS_A); // 同步到目标会话的 cwd
    expect(oldHandle.dispose).toHaveBeenCalled();
    expect(manager.getSessionRecord('c2c', PEER)).toBeUndefined();
    expect(registry.get).not.toHaveBeenCalledWith('session-bbb'); // 未立即拉起，等下一条消息
  });

  it('目标即当前会话 → 幂等成功，不释放', async () => {
    const { manager } = createManager(workspaceCtx([
      { path: WS_A, title: 'A', sessionIds: ['session-aaa'] },
    ]));
    const record = await manager.getOrCreate('c2c', PEER, PEER, REPLY);
    prefs().setSessionId(KEY, record.sessionId);
    // 当前会话须在账目内才可达 alreadyCurrent 分支
    const ctxWithRecord = workspaceCtx([
      { path: join(env.home, 'workspace'), title: 'W', sessionIds: [record.sessionId] },
    ]);
    const second = createManager(ctxWithRecord);
    const rec2 = await second.manager.getOrCreate('c2c', PEER, PEER, REPLY);

    const outcome = await second.manager.switchSession('c2c', PEER, rec2.sessionId);

    expect(outcome).toEqual({ ok: true, alreadyCurrent: true });
    expect(rec2.handle.dispose).not.toHaveBeenCalled();
  });
});

describe('startNewInWorkspace', () => {
  it('未知工作区（路径/标题都不匹配）→ 拒绝', async () => {
    const { manager } = createManager(workspaceCtx([
      { path: WS_A, title: 'A', sessionIds: [] },
    ]));

    const outcome = await manager.startNewInWorkspace('c2c', PEER, '/no/such/ws');

    expect(outcome).toEqual({ ok: false, reason: 'unknown-workspace' });
    expect(prefs().getWorkspace(KEY)).toBeUndefined();
  });

  it('按标题命中 → 写偏好 + 铸新 id + 释放当前 agent', async () => {
    const ctx = workspaceCtx([{ path: WS_A, title: 'My Project', sessionIds: [] }]);
    const { manager } = createManager(ctx);
    const record = await manager.getOrCreate('c2c', PEER, PEER, REPLY);

    const outcome = await manager.startNewInWorkspace('c2c', PEER, 'My Project');

    expect(outcome).toEqual({ ok: true, path: WS_A });
    expect(prefs().getWorkspace(KEY)).toBe(WS_A);
    expect(prefs().getSessionId(KEY)).toMatch(MINTED); // /new 语义：铸新 id
    expect(record.handle.dispose).toHaveBeenCalled();
  });
});

describe('listSessionGroups / resolveSessionTarget', () => {
  const HEADERS = {
    'session-aaa': { cwd: WS_A, agentPreset: 'standard', createdAt: 1_700_000_000_000 },
    'session-bbb': { cwd: WS_A, agentPreset: 'code', createdAt: 1_700_010_000_000 },
    'session-ccc': { cwd: WS_B, createdAt: 1_700_020_000_000 },
  };
  const WORKSPACES = [
    { path: WS_A, title: 'A', sessionIds: ['session-aaa', 'session-bbb'] },
    { path: WS_B, title: 'B', sessionIds: ['session-ccc'] },
  ];

  it('当前工作区置顶 + isCurrent 标记 + header 信息带回', async () => {
    // prefs 须在构造 manager 前写：ModelResolver 在构造时加载内存副本
    prefs().setSessionId(KEY, 'session-ccc');
    prefs().setWorkspace(KEY, WS_B);
    const { manager } = createManager(workspaceCtx(WORKSPACES, HEADERS));

    const groups = await manager.listSessionGroups('c2c', PEER);

    expect(groups.map((g) => g.path)).toEqual([WS_B, WS_A]); // 偏好命中 B → 置顶
    expect(groups[0]).toMatchObject({ isCurrentWorkspace: true, truncated: 0 });
    expect(groups[0]!.sessions[0]).toMatchObject({ sessionId: 'session-ccc', isCurrent: true, agentPreset: undefined });
    expect(groups[1]!.sessions.map((s) => s.sessionId)).toEqual(['session-aaa', 'session-bbb']);
    expect(groups[1]!.sessions.every((s) => !s.isCurrent)).toBe(true);
  });

  it('无工作区偏好时保持注册表顺序（当前组=config.cwd 不在账目内，不置顶）', async () => {
    prefs().setSessionId(KEY, 'session-ccc');
    const { manager } = createManager(workspaceCtx(WORKSPACES, HEADERS));

    const groups = await manager.listSessionGroups('c2c', PEER);

    expect(groups.map((g) => g.path)).toEqual([WS_A, WS_B]);
    expect(groups.every((g) => !g.isCurrentWorkspace)).toBe(true);
  });

  it('组内/组数上限截断并计数', async () => {
    const many = Array.from({ length: 10 }, (_, i) => `session-x${i}`);
    const workspaces = Array.from({ length: 7 }, (_, i) => ({
      path: `${WS_A}-${i}`, title: `W${i}`, sessionIds: many,
    }));
    const { manager } = createManager(workspaceCtx(workspaces));

    const groups = await manager.listSessionGroups('c2c', PEER);

    expect(groups).toHaveLength(5); // 组数上限
    expect(groups.every((g) => g.sessions.length === 8 && g.truncated === 2)).toBe(true); // 每组上限
  });

  it('序号对齐列表顺序；前缀唯一命中；多前缀歧义 → undefined', async () => {
    const { manager } = createManager(workspaceCtx(WORKSPACES, HEADERS));

    expect(await manager.resolveSessionTarget('c2c', PEER, '1')).toBe('session-aaa');
    expect(await manager.resolveSessionTarget('c2c', PEER, '3')).toBe('session-ccc');
    expect(await manager.resolveSessionTarget('c2c', PEER, '99')).toBeUndefined();
    expect(await manager.resolveSessionTarget('c2c', PEER, 'session-bb')).toBe('session-bbb');
    expect(await manager.resolveSessionTarget('c2c', PEER, 'session-x')).toBeUndefined(); // 多命中
    expect(await manager.resolveSessionTarget('c2c', PEER, '')).toBeUndefined();
  });

  it('宿主无 workspaceRegistry → 空列表，命令侧降级提示', async () => {
    const { manager } = createManager(workspaceCtx([]));
    expect(await manager.listSessionGroups('c2c', PEER)).toEqual([]);
  });
});

describe('resolveWorkspacePref（per-peer cwd）', () => {
  it('未登记的偏好路径 → 回退 config.cwd 并 warn 一次', async () => {
    prefs().setWorkspace(KEY, '/gone/away'); // 须在构造前写（见上：内存副本构造时加载）
    const { manager, logger } = createManager(workspaceCtx([
      { path: WS_A, title: 'A', sessionIds: [] },
    ]));

    expect(manager.effectiveWorkspacePath(KEY)).toBe(join(env.home, 'workspace'));

    const record = await manager.getOrCreate('c2c', PEER, PEER, REPLY);
    expect(record.sessionId).toMatch(MINTED); // 正常创建（默认 cwd）
    const warns = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.map(String);
    expect(warns.filter((w) => w.includes('not registered')).length).toBeGreaterThanOrEqual(1);
  });

  it('已登记的偏好路径 → 新会话 create 的 meta.cwd 使用该工作区', async () => {
    prefs().setWorkspace(KEY, WS_A); // 先写后构造
    const ctx = workspaceCtx([{ path: WS_A, title: 'A', sessionIds: [] }]);
    const { manager, registry } = createManager(ctx);

    await manager.getOrCreate('c2c', PEER, PEER, REPLY);

    const createCall = (registry.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { meta?: { cwd?: string } };
    expect(createCall?.meta?.cwd).toBe(WS_A);
  });
});
