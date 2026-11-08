/**
 * /sessions 会话导航的 SessionManager 用例
 *
 * - switchSession：账目准入校验、prefs 映射切换、工作区偏好同步、当前 agent 释放
 * - startNewInWorkspace：工作区准入校验、偏好 + 铸新 id、旧 agent 释放
 * - listSessionGroups / resolveSessionTarget：当前组置顶、isCurrent 标记、截断、序号/前缀解析
 * - resolveWorkspacePref：未登记偏好回退默认
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
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

/** 工作区账目替身：workspaceRegistry.list + sessionPersistence.stat/open（标题前缀读取） */
function workspaceCtx(
  workspaces: Array<{ path: string; title: string; sessionIds: string[] }>,
  headers: Record<string, { cwd?: string; agentPreset?: string; createdAt?: number }> = {},
  eventsBySession: Record<string, unknown[]> = {},
): Context {
  return {
    get: (name: string) => {
      if (name === 'workspaceRegistry') {
        return { create: vi.fn(), list: () => workspaces };
      }
      if (name === 'sessionPersistence') {
        return {
          stat: async (id: string) => (headers[id] ? { header: headers[id] } : undefined),
          open: async (id: string) => ({
            read: async () => ({ events: eventsBySession[id] ?? [] }),
            close: async () => {},
          }),
        };
      }
      if (name === 'sandboxPolicy' || name === 'approval') return {};
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

function createManager(
  ctx: Context,
  events: unknown[] = [],
  overrides: {
    live?: DshAgent;
    resume?: (options: { resumeSessionId: string }) => Promise<DshAgentHandle>;
  } = {},
) {
  const registry = {
    get: vi.fn(() => overrides.live),
    resume: vi.fn(overrides.resume ?? (async ({ resumeSessionId }: { resumeSessionId: string }) => {
      throw Object.assign(new Error(`session "${resumeSessionId}" not found`), { name: 'SessionPersistenceNotFoundError' });
    })),
    create: vi.fn(async (options: { sessionId: string }) => {
      const agent = fakeAgent(options.sessionId);
      (agent as { session: unknown }).session = { id: options.sessionId, snapshotEvents: () => events };
      return { agent, dispose: vi.fn(async () => {}) };
    }),
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

  it('header.cwd 是符号链接时仍命中宿主 realpath 工作区并同步偏好', async () => {
    const alias = join(env.home, 'workspace-alias');
    symlinkSync(env.home, alias, 'dir');
    const { manager } = createManager(workspaceCtx([
      { path: env.home, title: 'Real', sessionIds: ['session-link'] },
    ], { 'session-link': { cwd: alias } }));

    const outcome = await manager.switchSession('c2c', PEER, 'session-link');

    expect(outcome.ok).toBe(true);
    expect(prefs().getWorkspace(KEY)).toBe(env.home);
    expect(manager.effectiveWorkspacePath(KEY)).toBe(env.home);
  });
});

describe('permission（/permission 会话内切换）', () => {
  const KNOBS = { sandbox: 'read-only', approval: 'ask' };
  const KNOB_EVENTS = [
    { type: 'sandbox/mode', data: { mode: 'danger-full-access' } },
    { type: 'approval/policy', data: { policy: 'never' } },
  ];
  const ctx = () => workspaceCtx([]);

  it('getPermissionStatus：无会话无偏好 → default', () => {
    const { manager } = createManager(ctx());
    expect(manager.getPermissionStatus('c2c', PEER)).toEqual({ source: 'default', active: false });
  });

  it('getPermissionStatus：无活跃会话 → per-peer 偏好', () => {
    prefs().setPermission(KEY, KNOBS); // 构造前写（内存副本构造时加载）
    const { manager } = createManager(ctx());
    expect(manager.getPermissionStatus('c2c', PEER)).toEqual({ knobs: KNOBS, source: 'pref', active: false });
  });

  it('getPermissionStatus：活跃会话事件优先于偏好', async () => {
    prefs().setPermission(KEY, KNOBS);
    const { manager } = createManager(ctx(), KNOB_EVENTS);
    await manager.getOrCreate('c2c', PEER, PEER, REPLY);

    expect(manager.getPermissionStatus('c2c', PEER)).toEqual({
      knobs: { sandbox: 'danger-full-access', approval: 'never' },
      source: 'session',
      active: true,
    });
  });

  it('setPermission：无活跃会话 → 写偏好，appliedLive=false', async () => {
    const { manager } = createManager(ctx());

    const outcome = await manager.setPermission('c2c', PEER, KNOBS);

    expect(outcome).toEqual({ ok: true, appliedLive: false });
    expect(prefs().getPermission(KEY)).toEqual(KNOBS);
  });

  it('setPermission：活跃会话无 append（最小组合）→ apply-failed，偏好仍保存', async () => {
    const { manager } = createManager(ctx());
    await manager.getOrCreate('c2c', PEER, PEER, REPLY); // fake session 无 append

    const outcome = await manager.setPermission('c2c', PEER, KNOBS);

    expect(outcome).toEqual({ ok: false, reason: 'apply-failed' });
    expect(prefs().getPermission(KEY)).toEqual(KNOBS); // 偏好已落盘
  });

  it('clearPermission：清除偏好；无偏好返回 false', async () => {
    prefs().setPermission(KEY, KNOBS);
    const { manager } = createManager(ctx());

    expect(manager.clearPermission('c2c', PEER)).toBe(true);
    expect(prefs().getPermission(KEY)).toBeUndefined();
    expect(manager.clearPermission('c2c', PEER)).toBe(false);
  });

  it('create 分支应用 per-peer 偏好：无 append 时 warn 但会话正常创建（fail-soft）', async () => {
    prefs().setPermission(KEY, KNOBS); // 构造前写
    const { manager, logger } = createManager(ctx());

    const record = await manager.getOrCreate('c2c', PEER, PEER, REPLY);

    expect(record.sessionId).toMatch(MINTED); // 会话照常创建
    const warns = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.map(String);
    expect(warns.some((w) => w.includes('permission pref apply failed'))).toBe(true);
  });
});

describe('审查回归：无活跃会话时 revive 切权限，普通 resume 保留会话权限', () => {
  const KNOBS = { sandbox: 'read-only', approval: 'ask' };
  const OLD_EVENTS = [
    { type: 'sandbox/mode', data: { mode: 'danger-full-access' } },
    { type: 'approval/policy', data: { policy: 'never' } },
  ];

  function appendableHandle(id: string, events: unknown[]) {
    const agent = fakeAgent(id);
    const append = vi.fn();
    (agent as { session: unknown }).session = { id, snapshotEvents: () => events, append };
    return { agent, dispose: vi.fn(async () => {}), append };
  }

  it('回收后执行 /permission：先 revive 旧会话，再立即覆盖旧 knob 事件', async () => {
    prefs().setSessionId(KEY, 'session-old');
    const handle = appendableHandle('session-old', OLD_EVENTS);
    const { manager } = createManager(workspaceCtx([], {
      'session-old': { cwd: WS_A },
    }), [], { resume: async () => handle });

    const outcome = await manager.setPermission('c2c', PEER, KNOBS, {
      senderId: PEER,
      replyTarget: REPLY,
    });

    expect(outcome).toEqual({ ok: true, appliedLive: true });
    expect(manager.getSessionRecord('c2c', PEER)?.sessionId).toBe('session-old');
    expect(handle.append).toHaveBeenCalledWith('sandbox/mode', { mode: 'read-only' });
    expect(handle.append).toHaveBeenCalledWith('approval/policy', { policy: 'ask' });
  });

  it('revive 后当前事件已与目标一致：不重复 append', async () => {
    prefs().setSessionId(KEY, 'session-old');
    const handle = appendableHandle('session-old', [
      { type: 'sandbox/mode', data: { mode: 'read-only' } },
      { type: 'approval/policy', data: { policy: 'ask' } },
    ]);
    const { manager } = createManager(workspaceCtx([], {
      'session-old': { cwd: WS_A },
    }), [], { resume: async () => handle });

    const outcome = await manager.setPermission('c2c', PEER, KNOBS, {
      senderId: PEER,
      replyTarget: REPLY,
    });

    expect(outcome.ok).toBe(true);
    expect(handle.append).not.toHaveBeenCalled();
  });

  it('普通 resume 不用旧 pref 覆盖桌面端后来修改的权限（pref 仅是 create 默认）', async () => {
    prefs().setSessionId(KEY, 'session-old');
    prefs().setPermission(KEY, KNOBS);
    const handle = appendableHandle('session-old', OLD_EVENTS);
    const { manager } = createManager(workspaceCtx([], {
      'session-old': { cwd: WS_A },
    }), [], { resume: async () => handle });

    await manager.getOrCreate('c2c', PEER, PEER, REPLY);

    expect(handle.append).not.toHaveBeenCalled();
  });
});

describe('审查回归：会话切换准入与占用保护', () => {
  it('账目内但磁盘记录不存在 → not-on-disk，不写映射', async () => {
    const { manager } = createManager(workspaceCtx([
      { path: WS_A, title: 'A', sessionIds: ['session-missing'] },
    ]));

    const outcome = await manager.switchSession('c2c', PEER, 'session-missing');

    expect(outcome).toEqual({ ok: false, reason: 'not-on-disk' });
    expect(prefs().getSessionId(KEY)).toBeUndefined();
  });

  it('其他 QQ peer 已绑定目标 → occupied；列表锁定但保持可见', async () => {
    const otherKey = 'qqbot:app1:c2c:another-user';
    prefs().setSessionId(otherKey, 'session-bbb');
    const { manager } = createManager(workspaceCtx([
      { path: WS_A, title: 'A', sessionIds: ['session-bbb'] },
    ], { 'session-bbb': { cwd: WS_A } }));

    const outcome = await manager.switchSession('c2c', PEER, 'session-bbb');
    expect(outcome).toEqual({ ok: false, reason: 'occupied' });
    expect(prefs().getSessionId(KEY)).toBeUndefined();

    const groups = await manager.listSessionGroups('c2c', PEER);
    expect(groups[0]!.sessions[0]).toMatchObject({
      sessionId: 'session-bbb',
      occupiedByOther: true,
    });
  });

  it('未归属其他 peer 的桌面会话仍可切入', async () => {
    const { manager } = createManager(workspaceCtx([
      { path: WS_A, title: 'A', sessionIds: ['session-desktop'] },
    ], { 'session-desktop': { cwd: WS_A } }));

    const outcome = await manager.switchSession('c2c', PEER, 'session-desktop');

    expect(outcome.ok).toBe(true);
    expect(prefs().getSessionId(KEY)).toBe('session-desktop');
  });

  it('两个 peer 并发抢同一会话：写映射前复查后只允许一个成功', async () => {
    let releaseFirstStat!: () => void;
    const firstStatGate = new Promise<void>((resolve) => { releaseFirstStat = resolve; });
    let statCalls = 0;
    const ctx = {
      get: (name: string) => {
        if (name === 'workspaceRegistry') {
          return { list: () => [{ path: WS_A, title: 'A', sessionIds: ['session-race'] }] };
        }
        if (name === 'sessionPersistence') {
          return {
            stat: async (id: string) => {
              statCalls += 1;
              if (id === 'session-race' && statCalls === 1) await firstStatGate;
              return id === 'session-race' ? { header: { cwd: WS_A } } : undefined;
            },
          };
        }
        return undefined;
      },
      on: vi.fn(),
    } as unknown as Context;
    const { manager } = createManager(ctx);

    const first = manager.switchSession('c2c', 'peer-1', 'session-race');
    await Promise.resolve();
    const second = manager.switchSession('c2c', 'peer-2', 'session-race');
    releaseFirstStat();
    const outcomes = await Promise.all([first, second]);

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.reason === 'occupied')).toHaveLength(1);
    expect(prefs().findSessionKeys('session-race')).toHaveLength(1);
  });

  it('/sessions new 支持组序号，无需把路径传给命令层', async () => {
    const { manager } = createManager(workspaceCtx([
      { path: WS_A, title: '含空格 项目', sessionIds: [] },
    ]));

    const outcome = await manager.startNewInWorkspace('c2c', PEER, '1');

    expect(outcome).toEqual({ ok: true, path: WS_A });
    expect(prefs().getWorkspace(KEY)).toBe(WS_A);
  });
});

describe('审查回归：切换与在途 openSession 串行', () => {
  it('切换等待在途打开；屏障后的消息最终恢复目标会话，不被旧 id 覆盖', async () => {
    let resolveOld!: (handle: DshAgentHandle) => void;
    const pendingOld = new Promise<DshAgentHandle>((resolve) => { resolveOld = resolve; });
    prefs().setSessionId(KEY, 'session-old');
    const { manager, registry } = createManager(workspaceCtx([
      { path: WS_A, title: 'A', sessionIds: ['session-old', 'session-bbb'] },
    ], {
      'session-old': { cwd: WS_A },
      'session-bbb': { cwd: WS_A },
    }), [], {
      resume: async ({ resumeSessionId }) => {
        if (resumeSessionId === 'session-old') return pendingOld;
        return fakeHandle(resumeSessionId);
      },
    });

    const opening = manager.getOrCreate('c2c', PEER, PEER, REPLY);
    await vi.waitFor(() => expect(registry.resume).toHaveBeenCalledTimes(1));
    const switching = manager.switchSession('c2c', PEER, 'session-bbb');
    await Promise.resolve(); // 让切换先登记 mutation 屏障
    const blockedMessage = manager.getOrCreate('c2c', PEER, PEER, REPLY);

    await Promise.resolve();
    expect(registry.resume).toHaveBeenCalledTimes(1); // 屏障后的消息没有提前打开旧会话

    resolveOld(fakeHandle('session-old'));
    const [opened, outcome, blocked] = await Promise.all([opening, switching, blockedMessage]);

    expect(opened.sessionId).toBe('session-old');
    expect(outcome.ok).toBe(true);
    expect(blocked.sessionId).toBe('session-bbb');
    expect(prefs().getSessionId(KEY)).toBe('session-bbb');
    expect(registry.resume).toHaveBeenCalledTimes(2);
  });

  it('同一 tick 先 switch 后发消息：同步屏障让消息等待，最终打开目标而非旧会话', async () => {
    prefs().setSessionId(KEY, 'session-old');
    const { manager, registry } = createManager(workspaceCtx([
      { path: WS_A, title: 'A', sessionIds: ['session-old', 'session-bbb'] },
    ], {
      'session-old': { cwd: WS_A },
      'session-bbb': { cwd: WS_A },
    }), [], {
      resume: async ({ resumeSessionId }) => fakeHandle(resumeSessionId),
    });

    // 关键交错：不在两次调用之间 await，复现屏障晚装导致的旧 id 覆盖
    const switching = manager.switchSession('c2c', PEER, 'session-bbb');
    const opening = manager.getOrCreate('c2c', PEER, PEER, REPLY);
    const [outcome, opened] = await Promise.all([switching, opening]);

    expect(outcome.ok).toBe(true);
    expect(opened.sessionId).toBe('session-bbb');
    expect(manager.getSessionRecord('c2c', PEER)?.sessionId).toBe('session-bbb');
    expect(prefs().getSessionId(KEY)).toBe('session-bbb');
    expect(registry.resume).toHaveBeenCalledTimes(1);
    expect(registry.resume).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: 'session-bbb' }));
  });
});

describe('会话显示标题（/sessions 列表项）', () => {
  const EVENTS = [
    { type: 'user/message', data: { content: [{ type: 'text', text: '帮我优化登录页' }] } },
    { type: 'session/title', data: { title: '登录页优化' } },
  ];

  it('列表条目带标题：持久层前缀折叠 session/title', async () => {
    prefs().setSessionId(KEY, 'session-ccc');
    prefs().setWorkspace(KEY, WS_B);
    const { manager } = createManager(workspaceCtx([
      { path: WS_A, title: 'A', sessionIds: ['session-aaa'] },
      { path: WS_B, title: 'B', sessionIds: ['session-ccc'] },
    ], {
      'session-aaa': { cwd: WS_A },
      'session-ccc': { cwd: WS_B },
    }, {
      'session-aaa': [{ type: 'session/title', data: { title: '脚本助手' } }],
      'session-ccc': EVENTS,
    }));

    const groups = await manager.listSessionGroups('c2c', PEER);

    const flat = groups.flatMap((g) => g.sessions);
    expect(flat.find((s) => s.sessionId === 'session-aaa')).toMatchObject({ title: '脚本助手' });
    expect(flat.find((s) => s.sessionId === 'session-ccc')).toMatchObject({ title: '登录页优化' });
  });

  it('无标题事件时回退首条用户消息摘要', async () => {
    const { manager } = createManager(workspaceCtx(
      [{ path: WS_A, title: 'A', sessionIds: ['session-plain'] }],
      { 'session-plain': { cwd: WS_A } },
      { 'session-plain': [{ type: 'user/message', data: { content: [{ type: 'text', text: '查一下线上报错' }] } }] },
    ));

    const groups = await manager.listSessionGroups('c2c', PEER);

    expect(groups[0]!.sessions[0]).toMatchObject({ title: '查一下线上报错' });
  });

  it('当前活跃会话从内存事件折叠标题（零持久层 I/O）', async () => {
    prefs().setSessionId(KEY, 'session-live');
    prefs().setWorkspace(KEY, WS_A);
    const liveAgent = fakeAgent('session-live');
    (liveAgent as { session: unknown }).session = {
      id: 'session-live',
      snapshotEvents: () => [{ type: 'session/title', data: { title: '内存标题' } }],
    };
    const { manager } = createManager(workspaceCtx(
      [{ path: WS_A, title: 'A', sessionIds: ['session-live'] }],
      { 'session-live': { cwd: WS_A } },
      // 持久层事件故意为空：若误走持久读取将拿不到标题
    ), [], { live: liveAgent });
    await manager.getOrCreate('c2c', PEER, PEER, REPLY);

    const groups = await manager.listSessionGroups('c2c', PEER);

    expect(groups[0]!.sessions[0]).toMatchObject({ sessionId: 'session-live', isCurrent: true, title: '内存标题' });
  });

  it('switchSession 结果带目标标题，幂等分支带当前标题', async () => {
    prefs().setSessionId(KEY, 'session-bbb');
    const { manager } = createManager(workspaceCtx(
      [{ path: WS_A, title: 'A', sessionIds: ['session-bbb', 'session-aaa'] }],
      { 'session-bbb': { cwd: WS_A }, 'session-aaa': { cwd: WS_A } },
      { 'session-aaa': [{ type: 'session/title', data: { title: '目标会话' } }] },
    ));

    const switched = await manager.switchSession('c2c', PEER, 'session-aaa');
    expect(switched).toMatchObject({ ok: true, title: '目标会话' });

    const current = await manager.switchSession('c2c', PEER, 'session-aaa');
    expect(current).toMatchObject({ ok: true, alreadyCurrent: true });
  });
});
