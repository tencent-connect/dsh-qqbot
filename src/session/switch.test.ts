/**
 * /switch（免重启切换通道绑定会话）的回归用例
 *
 * - SessionManager.switchSession：绑定落盘、旧 agent 回收、目标校验、busy 拒绝
 * - SessionManager.listSwitchTargets：候选枚举（经 host adapter 读宿主持久化层）
 * - switchCommand：参数解析（无参列表 / 序号 / 前缀 / 歧义 / default）
 *
 * 绑定数据用真 PrefsStore + 临时 home，断言「落盘」而不只是「调用过 setSessionId」。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { SlashCommandHandlerContext } from '@tencent-connect/qqbot-nodejs';
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
const { legacyDerivedSessionId } = await import('./session-id.ts');
const { switchCommand } = await import('../commands/session.ts');

const APP_ID = 'app1';
const PEER = 'user1';
const KEY = `qqbot:${APP_ID}:c2c:${PEER}`;
const LEGACY_ID = legacyDerivedSessionId(KEY);
const REPLY: ReplyTarget = { scope: 'c2c', targetId: PEER, msgId: 'm1' };

/** 宿主持久化层替身的一项（0.5.5 形态：字段在 header 里） */
interface StoredSession {
  id: string;
  cwd?: string;
  createdAt?: number;
  origin?: 'subagent';
}

const STORED: StoredSession[] = [
  { id: 'session-bbbb', cwd: 'D:\\work\\beta', createdAt: 200 },
  { id: 'session-aaaa', cwd: 'D:\\work\\alpha', createdAt: 100 },
  { id: 'session-cccc', cwd: 'D:\\work\\gamma', createdAt: 300 },
  { id: 'session-dddd', cwd: 'D:\\sub\\x', createdAt: 400, origin: 'subagent' },
];

/**
 * 宿主 ctx 替身：`list()` 返回 `{ header }` 快照数组（0.5.5 形态），
 * `stat(id)` 命中返回快照、未命中返回 undefined（不抛）。
 */
function persistenceCtx(
  stored: StoredSession[] = STORED,
  override: { stat?: (id: string) => Promise<{ header?: unknown } | undefined> } = {},
): Context {
  return {
    get: (name: string) => {
      if (name !== 'sessionPersistence') return undefined;
      return {
        stat: override.stat
          ?? (async (id: string) => (stored.some((s) => s.id === id) ? { header: { id } } : undefined)),
        list: async () => stored.map((s) => ({ header: s, revision: 'r1' })),
      };
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

function createRegistry(resumeImpl: (options: { resumeSessionId: string }) => Promise<DshAgentHandle>) {
  const handles: DshAgentHandle[] = [];
  const registry = {
    get: vi.fn(() => undefined),
    resume: vi.fn(async (options: { resumeSessionId: string }) => {
      const handle = resumeImpl ? await resumeImpl(options) : fakeHandle(options.resumeSessionId);
      handles.push(handle);
      return handle;
    }),
    create: vi.fn(async (options: { sessionId: string }) => {
      const handle = fakeHandle(options.sessionId);
      handles.push(handle);
      return handle;
    }),
  };
  return { registry, handles };
}

function fakeHandle(id: string): DshAgentHandle {
  return { agent: fakeAgent(id), dispose: vi.fn(async () => {}) };
}

function createLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

function allLogText(logger: Logger): string {
  return (['info', 'warn', 'error', 'debug'] as const)
    .flatMap((level) => vi.mocked(logger[level]).mock.calls.flat())
    .map(String)
    .join('\n');
}

const managers: Array<InstanceType<typeof SessionManager>> = [];

function createManager(
  registry: Pick<DshAgentRegistry, 'get' | 'resume' | 'create'>,
  ctx: Context = persistenceCtx(),
  logger: Logger = createLogger(),
) {
  const config = ConfigSchema({
    appId: APP_ID,
    appSecret: 'secret',
    provider: 'p',
    model: 'm',
    cwd: join(env.home, 'workspace'),
    sessionIdleTimeout: 0,
  } as ImQQBotConfig);
  const manager = new SessionManager(ctx, registry as DshAgentRegistry, config, logger);
  managers.push(manager);
  return manager;
}

/** 模拟「下一条消息」：验证切换后 getOrCreate 会去 resume 新会话 */
function createManagerWithResume(): { manager: InstanceType<typeof SessionManager>; registry: ReturnType<typeof createRegistry>['registry'] } {
  const { registry } = createRegistry(async ({ resumeSessionId }) => fakeHandle(resumeSessionId));
  return { manager: createManager(registry), registry };
}

/** 从磁盘读回的绑定（模拟重启后仍生效） */
function persistedId(): string | undefined {
  return new PrefsStore().getSessionId(KEY);
}

beforeEach(() => {
  env.home = mkdtempSync(join(tmpdir(), 'im-qqbot-switch-'));
  mkdirSync(join(env.home, 'workspace'), { recursive: true });
});

afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.disposeAll()));
  rmSync(env.home, { recursive: true, force: true });
});

describe('currentBoundSessionId', () => {
  it('无覆盖时回落到 0.5.x 派生候选（仅作展示/迁移定位）', () => {
    const { manager } = createManagerWithResume();
    expect(manager.currentBoundSessionId('c2c', PEER)).toBe(LEGACY_ID);
  });

  it('有 per-peer 覆盖时优先返回覆盖值', () => {
    new PrefsStore().setSessionId(KEY, 'session-aaaa');
    const { manager } = createManagerWithResume();
    expect(manager.currentBoundSessionId('c2c', PEER)).toBe('session-aaaa');
  });
});

describe('listSwitchTargets', () => {
  it('过滤 subagent 并按 createdAt 倒序', async () => {
    const { manager } = createManagerWithResume();
    const targets = await manager.listSwitchTargets();
    expect(targets?.map((t) => t.sessionId)).toEqual(['session-cccc', 'session-bbbb', 'session-aaaa']);
    expect(targets?.[0]?.cwd).toBe('D:\\work\\gamma');
  });

  it('宿主无 sessionPersistence.list → undefined（能力缺失 ≠ 没有会话）', async () => {
    const ctx = {
      get: (name: string) => (name === 'sessionPersistence' ? { stat: async () => undefined } : undefined),
      on: vi.fn(),
    } as unknown as Context;
    const manager = createManager(createRegistry(async ({ resumeSessionId }) => fakeHandle(resumeSessionId)).registry, ctx);
    await expect(manager.listSwitchTargets()).resolves.toBeUndefined();
  });

  it('列举失败（后端故障）→ undefined 且留痕 warn', async () => {
    const ctx = {
      get: (name: string) => (name === 'sessionPersistence'
        ? { stat: async () => undefined, list: async () => { throw new Error('EIO: backend unavailable'); } }
        : undefined),
      on: vi.fn(),
    } as unknown as Context;
    const logger = createLogger();
    const manager = createManager(createRegistry(async ({ resumeSessionId }) => fakeHandle(resumeSessionId)).registry, ctx, logger);

    await expect(manager.listSwitchTargets()).resolves.toBeUndefined();
    expect(allLogText(logger)).toContain('EIO');
  });
});

describe('switchSession', () => {
  it('切换到已存在会话：新绑定落盘，下一条消息 resume 该会话', async () => {
    const { manager, registry } = createManagerWithResume();
    // 先建立当前绑定（老派生会话）
    const before = await manager.getOrCreate('c2c', PEER, PEER, REPLY);
    expect(before.sessionId).toBe(LEGACY_ID);

    const result = await manager.switchSession('c2c', PEER, 'session-aaaa');

    expect(result).toEqual({ ok: true, previous: LEGACY_ID, target: 'session-aaaa' });
    expect(persistedId()).toBe('session-aaaa'); // 真落盘，重启后仍生效
    expect(manager.currentBoundSessionId('c2c', PEER)).toBe('session-aaaa');

    const next = await manager.getOrCreate('c2c', PEER, PEER, REPLY);
    expect(next.sessionId).toBe('session-aaaa');
    expect(registry.resume).toHaveBeenLastCalledWith(expect.objectContaining({ resumeSessionId: 'session-aaaa' }));
  });

  it('旧记录被释放：cancel → dispose 有序执行，且不再留在会话表', async () => {
    const { manager } = createManagerWithResume();
    const old = await manager.getOrCreate('c2c', PEER, PEER, REPLY);

    await manager.switchSession('c2c', PEER, 'session-bbbb');

    expect(old.agent.cancel).toHaveBeenCalledWith({ kind: 'user' });
    expect(old.handle.dispose).toHaveBeenCalled();
    // prompt 注册项必须在 agent 销毁前摘掉，否则 prompt 泄漏
    expect(vi.mocked(old.agent.cancel).mock.invocationCallOrder[0]!)
      .toBeLessThan(vi.mocked(old.handle.dispose).mock.invocationCallOrder[0]!);
    expect(manager.getSessionRecord('c2c', PEER)).toBeUndefined();
    expect(manager.size).toBe(0);
  });

  it('目标不存在 → not-found 且不写绑定', async () => {
    const { manager } = createManagerWithResume();

    const result = await manager.switchSession('c2c', PEER, 'session-nope');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
    expect(persistedId()).toBeUndefined();
  });

  it('目标与当前一致 → unchanged，不回收记录', async () => {
    const { manager } = createManagerWithResume();
    const record = await manager.getOrCreate('c2c', PEER, PEER, REPLY);

    const result = await manager.switchSession('c2c', PEER, LEGACY_ID);

    expect(result.ok && result.unchanged).toBe(true);
    expect(record.handle.dispose).not.toHaveBeenCalled();
    expect(manager.getSessionRecord('c2c', PEER)).toBe(record);
  });

  it('当前会话生成中 → busy 拒绝，绑定不变', async () => {
    const { manager } = createManagerWithResume();
    const record = await manager.getOrCreate('c2c', PEER, PEER, REPLY);
    (record.agent as unknown as { status: string }).status = 'running';

    const result = await manager.switchSession('c2c', PEER, 'session-aaaa');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('busy');
    expect(persistedId()).toBe(LEGACY_ID); // getOrCreate 已把老派生 id 落盘
    expect(manager.getSessionRecord('c2c', PEER)).toBe(record);
  });

  it('宿主无 stat 能力 → unavailable，不静默绑定', async () => {
    const ctx = { get: () => undefined, on: vi.fn() } as unknown as Context;
    const manager = createManager(createRegistry(async ({ resumeSessionId }) => fakeHandle(resumeSessionId)).registry, ctx);

    const result = await manager.switchSession('c2c', PEER, 'session-aaaa');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unavailable');
    expect(persistedId()).toBeUndefined();
  });

  it('stat 报错 → failed（求证失败不等于不存在），不写绑定', async () => {
    const ctx = persistenceCtx(STORED, { stat: async () => { throw new Error('EIO: backend unavailable'); } });
    const manager = createManager(createRegistry(async ({ resumeSessionId }) => fakeHandle(resumeSessionId)).registry, ctx);

    const result = await manager.switchSession('c2c', PEER, 'session-aaaa');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('failed');
    expect(persistedId()).toBeUndefined();
  });

  it('不带目标 → 清除覆盖，回到通道默认路由', async () => {
    new PrefsStore().setSessionId(KEY, 'session-aaaa');
    const { manager } = createManagerWithResume();

    const result = await manager.switchSession('c2c', PEER);

    expect(result.ok && result.target).toBe(LEGACY_ID);
    expect(persistedId()).toBeUndefined();
  });

  it('目标已被别的通道持有 → 仍可切换（搬桥接），但留痕 warn', async () => {
    new PrefsStore().setSessionId('qqbot:app1:group:g1', 'session-aaaa');
    const logger = createLogger();
    const manager = createManager(createRegistry(async ({ resumeSessionId }) => fakeHandle(resumeSessionId)).registry, persistenceCtx(), logger);
    const other = await manager.getOrCreate('group', 'g1', 'g1', { scope: 'group', targetId: 'g1', msgId: 'm2' });

    await manager.switchSession('c2c', PEER, 'session-aaaa');

    expect(persistedId()).toBe('session-aaaa');
    expect(allLogText(logger)).toContain('already held by another channel');
    expect(other.sessionId).toBe('session-aaaa'); // 旧持有者不受影响（共享 agent 的风险仅留痕）
  });
});

// ── 命令层：参数解析与回复文案 ──

interface FakeManager {
  currentBoundSessionId: ReturnType<typeof vi.fn>;
  listSwitchTargets: ReturnType<typeof vi.fn>;
  switchSession: ReturnType<typeof vi.fn>;
}

function fakeManager(targets: Array<{ sessionId: string; cwd?: string }> | undefined): FakeManager {
  return {
    currentBoundSessionId: vi.fn(() => LEGACY_ID),
    listSwitchTargets: vi.fn(async () => targets),
    switchSession: vi.fn(async (_scope: string, _peer: string, target?: string) =>
      target === 'session-nope'
        ? { ok: false as const, reason: 'not-found' as const, message: '会话 session-nope 不存在或不可绑定' }
        : { ok: true as const, previous: 'prev-id', target: target ?? LEGACY_ID }),
  };
}

function makeCmd(raw: string): SlashCommandHandlerContext {
  return {
    message: { kind: 'c2c', senderId: PEER },
    command: { name: 'switch', args: raw ? raw.split(/\s+/) : [], raw },
  } as unknown as SlashCommandHandlerContext;
}

function makeCommand(manager: FakeManager) {
  return switchCommand({
    manager: manager as unknown as SessionManager,
    config: { access: { c2cMode: 'open', c2cAllow: [] } } as unknown as ImQQBotConfig,
    logger: createLogger(),
  });
}

const LISTABLE = [
  { sessionId: 'session-cccc', cwd: 'D:\\work\\gamma' },
  { sessionId: 'session-bbbb', cwd: 'D:\\work\\beta' },
  { sessionId: 'session-aaaa', cwd: 'D:\\work\\alpha' },
];

describe('switchCommand — 无参数（列表）', () => {
  it('返回纯文本列表（含序号、完整 id、当前桥接），不调用 switchSession', async () => {
    const manager = fakeManager(LISTABLE);

    const reply = String(await makeCommand(manager).handler(makeCmd('')));

    expect(reply).toContain('会话桥接切换');
    expect(reply).toContain('1. session-cccc');
    expect(reply).toContain('gamma');
    expect(reply).toContain('/switch default');
    expect(reply).not.toContain('<qqbot-cmd-input'); // 命令行内点击标签客户端不认，走纯文本
    expect(manager.switchSession).not.toHaveBeenCalled();
  });

  it('宿主没有列表能力时提示按完整 id 切换', async () => {
    const manager = fakeManager(undefined);

    const reply = String(await makeCommand(manager).handler(makeCmd('')));

    expect(reply).toContain('sessionPersistence.list 不可用');
    expect(manager.switchSession).not.toHaveBeenCalled();
  });

  it('列表为空时明确「没有可切换的会话」', async () => {
    const reply = String(await makeCommand(fakeManager([])).handler(makeCmd('')));
    expect(reply).toContain('没有可切换的会话');
  });
});

describe('switchCommand — 带参数', () => {
  it('序号选择：按列表顺序取目标并报告成功', async () => {
    const manager = fakeManager(LISTABLE);

    const reply = String(await makeCommand(manager).handler(makeCmd('2')));

    expect(manager.switchSession).toHaveBeenCalledWith('c2c', PEER, 'session-bbbb');
    expect(reply).toContain('已切换到 bbbb');
    expect(reply).toContain('下一条消息立即生效');
  });

  it('序号越界：提示范围，不切换', async () => {
    const manager = fakeManager(LISTABLE);

    const reply = String(await makeCommand(manager).handler(makeCmd('9')));

    expect(reply).toContain('超出范围');
    expect(manager.switchSession).not.toHaveBeenCalled();
  });

  it('id 前缀唯一命中 → 用完整 id 切换', async () => {
    const manager = fakeManager(LISTABLE);

    await makeCommand(manager).handler(makeCmd('session-aa'));

    expect(manager.switchSession).toHaveBeenCalledWith('c2c', PEER, 'session-aaaa');
  });

  it('前缀歧义 → 列出候选，不切换', async () => {
    const manager = fakeManager(LISTABLE);

    const reply = String(await makeCommand(manager).handler(makeCmd('session-')));

    expect(reply).toContain('匹配到 3 个会话');
    expect(manager.switchSession).not.toHaveBeenCalled();
  });

  it('列表外的完整 id 透传给 manager 校验，失败文案带原因', async () => {
    const manager = fakeManager(LISTABLE);

    const reply = String(await makeCommand(manager).handler(makeCmd('session-nope')));

    expect(manager.switchSession).toHaveBeenCalledWith('c2c', PEER, 'session-nope');
    expect(reply).toContain('不存在或不可绑定');
    expect(reply).toContain('/switch 查看可切换列表');
  });

  it('default 走清绑定分支（不传目标）', async () => {
    const manager = fakeManager(LISTABLE);

    const reply = String(await makeCommand(manager).handler(makeCmd('default')));

    expect(manager.switchSession).toHaveBeenCalledWith('c2c', PEER);
    expect(reply).toContain('已恢复通道默认路由');
  });
});

describe('switchCommand — 注册属性', () => {
  it('私聊/群聊均可用，且挂了白名单鉴权（改绑定属管理动作）', () => {
    const command = makeCommand(fakeManager(LISTABLE));
    expect(command.name).toBe('switch');
    expect(command.scope).toBe('all');
    expect(command.authorized).toBeTypeOf('function');
  });
});