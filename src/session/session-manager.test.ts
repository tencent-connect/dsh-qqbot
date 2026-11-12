/**
 * SessionManager.getOrCreate 会话 id 迁移/铸造路径的回归用例
 *
 * - E1：resume 失败只在确认「会话不存在」时才首次创建，其余故障 warn 后向上抛
 * - E2：0.5.x 确定性 id 不进入新建路径；同 key 并发 getOrCreate 合并为一次
 * - E3 连带：prefs 损坏导致映射丢失时必须留下可见日志
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { ConfigSchema, type ImQQBotConfig } from '../config.ts';
import type { Logger, ReplyTarget } from '../types.ts';
import type { DshAgent, DshAgentHandle, DshAgentRegistry } from './types.ts';
import type { WorkbenchAgentSettings } from '../shared/workbench-agent-settings.ts';
import { ApprovalChannel, type ApprovalRequest } from '../features/approval-channel.ts';
import { QuestionChannel } from '../features/question-channel.ts';

const env = vi.hoisted(() => ({ home: '' }));

vi.mock('../shared/dirs.ts', () => ({
  get PLUGIN_HOME() { return env.home; },
  resolveAgentCwd: (cwd: string | undefined) => cwd || `${env.home}/workspace`,
}));

const { SessionManager } = await import('./session-manager.ts');
const { PrefsStore } = await import('../model/prefs-store.ts');
const { legacyDerivedSessionId } = await import('./session-id.ts');

const APP_ID = 'app1';
const PEER = 'user1';
const KEY = `qqbot:${APP_ID}:c2c:${PEER}`;
const LEGACY_ID = legacyDerivedSessionId(KEY);
const MINTED = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REPLY: ReplyTarget = { scope: 'c2c', targetId: PEER, msgId: 'm1' };
const WORKBENCH_SETTINGS: WorkbenchAgentSettings = {
  model: { provider: 'p', model: 'm' }, reasoningEffort: '', preset: '', cwd: '', permission: '',
  groupPrompt: '', directPrompt: '', streaming: false, showToolResults: false,
};

/** agents.resume 对不存在会话的报错 */
const notFound = (id: string): Error =>
  Object.assign(new Error(`session "${id}" not found`), { name: 'SessionPersistenceNotFoundError' });
/** 非「不存在」类失败：日志损坏 / 后端 IO / 同 id 未释放等 */
const corrupt = (id: string): Error => new Error(`EIO: corrupt session log for "${id}"`);

/**
 * 宿主 persistence 替身。
 *
 * 签名对齐宿主 `SessionPersistence.stat`：会话不存在返回 `undefined`（不抛），
 * 存在则返回快照。替身必须跟真实契约一致——此前替身带了宿主根本没有的
 * `load()`，用例全绿但线上直接 TypeError。
 */
function persistenceCtx(stat: (id: string) => Promise<{ header?: { agentPreset?: string } } | undefined>): Context {
  return {
    get: (name: string) => (name === 'sessionPersistence' ? { stat } : undefined),
    on: vi.fn(),
  } as unknown as Context;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(err: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
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

type ResumeImpl = (options: { resumeSessionId: string }) => Promise<DshAgentHandle>;

function createRegistry(resumeImpl: ResumeImpl) {
  const handles: DshAgentHandle[] = [];
  const registry = {
    get: vi.fn(() => undefined),
    resume: vi.fn(resumeImpl),
    create: vi.fn(async (options: { sessionId: string }) => {
      const handle = fakeHandle(options.sessionId);
      handles.push(handle);
      return handle;
    }),
  };
  return { registry, handles };
}

function createLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

/** 所有日志调用参数拼接（断言某错误是否被记录） */
function allLogText(logger: Logger): string {
  return (['info', 'warn', 'error', 'debug'] as const)
    .flatMap((level) => vi.mocked(logger[level]).mock.calls.flat())
    .map(String)
    .join('\n');
}

const managers: Array<InstanceType<typeof SessionManager>> = [];

/** 无任何宿主服务的 ctx（无 sessionPersistence，存在性无法求证） */
function emptyCtx(): Context {
  return { get: () => undefined, on: vi.fn() } as unknown as Context;
}

/** 默认替身：磁盘上没有任何会话（stat 一律 undefined） */
function absentCtx(): Context {
  return persistenceCtx(async () => undefined);
}

/** 替身：指定 id 的会话在盘上 */
function onDiskCtx(...ids: string[]): Context {
  return persistenceCtx(async (id) => (ids.includes(id) ? { header: {} } : undefined));
}

function createManagerWithCtx(
  registry: Pick<DshAgentRegistry, 'get' | 'resume' | 'create'>,
  ctx: Context,
  logger: Logger = createLogger(),
  prefs?: InstanceType<typeof PrefsStore>,
) {
  const config = ConfigSchema({
    appId: APP_ID,
    appSecret: 'secret',
    provider: 'p',
    model: 'm',
    cwd: join(env.home, 'workspace'),
    sessionIdleTimeout: 0,
  } as ImQQBotConfig);
  const manager = new SessionManager(ctx, registry as DshAgentRegistry, config, logger, prefs);
  managers.push(manager);
  return manager;
}

function createManager(registry: Pick<DshAgentRegistry, 'get' | 'resume' | 'create'>, logger: Logger = createLogger()) {
  return createManagerWithCtx(registry, absentCtx(), logger);
}

/** 模拟重启后读盘：prefs 中记录的 sessionId */
function persistedId(): string | undefined {
  return new PrefsStore().getSessionId(KEY);
}

function createdIds(registry: { create: { mock: { calls: Array<[{ sessionId: string }]> } } }): string[] {
  return registry.create.mock.calls.map(([options]) => String(options.sessionId));
}

beforeEach(() => {
  env.home = mkdtempSync(join(tmpdir(), 'im-qqbot-session-'));
  mkdirSync(join(env.home, 'workspace'), { recursive: true });
});

it('applies staged model, effort, preset, workspace and native permission on new Session only', async () => {
  const workspace = join(env.home, 'project');
  mkdirSync(workspace);
  const settings: WorkbenchAgentSettings = {
    model: { provider: 'test-provider', model: 'new-model' }, reasoningEffort: 'medium',
    preset: 'selected', cwd: workspace, permission: 'read-only', groupPrompt: '', directPrompt: '',
    streaming: true, showToolResults: false,
  };
  const config = ConfigSchema({ appId: APP_ID, appSecret: 'secret', cwd: join(env.home, 'workspace'), sessionIdleTimeout: 0 } as ImQQBotConfig);
  const setPermission = vi.fn();
  const selectModel = vi.fn();
  const mount = vi.fn();
  const native = fakeHandle(LEGACY_ID);
  const ctx = { get: (name: string) => ({
    sessionPersistence: { stat: async (id: string) => id === LEGACY_ID ? { header: { cwd: config.cwd, agentPreset: 'legacy' } } : undefined },
    agentPresets: { resolve: async (id: string) => ({ id }), mount },
    permissionPresets: { catalog: () => ({ options: [{ value: 'read-only' }] }), set: setPermission },
  })[name as 'sessionPersistence'], on: vi.fn() } as unknown as Context;
  const registry: DshAgentRegistry = {
    get: () => undefined,
    resume: async ({ resumeSessionId, setup }) => {
      if (resumeSessionId !== LEGACY_ID) throw notFound(resumeSessionId);
      await setup?.(native.agent.ctx, native.agent);
      return native;
    },
    create: vi.fn(async ({ sessionId, setup }) => {
      const handle = fakeHandle(sessionId);
      const agent = { ...handle.agent, model: { select: selectModel } };
      await setup?.(agent.ctx, agent);
      return { ...handle, agent };
    }),
  };
  const manager = new SessionManager(ctx, registry, config, createLogger(), undefined, {
    read: () => settings, update: () => false, defaults: () => settings,
  });
  managers.push(manager);
  expect((await manager.getOrCreate('c2c', PEER, PEER, REPLY)).sessionId).toBe(LEGACY_ID);
  expect(mount).toHaveBeenLastCalledWith(expect.anything(), 'legacy');
  expect(setPermission).not.toHaveBeenCalled();
  expect(selectModel).not.toHaveBeenCalled();
  await manager.remove('c2c', PEER);
  const session = await manager.getOrCreate('c2c', PEER, PEER, REPLY);
  expect(session.sessionId).not.toBe(LEGACY_ID);
  expect(registry.create).toHaveBeenCalledWith(expect.objectContaining({ meta: { cwd: workspace, agentPreset: 'selected' } }));
  expect(selectModel).toHaveBeenCalledWith({ provider: 'test-provider', model: 'new-model', reasoningEffort: 'medium' });
  expect(setPermission).toHaveBeenCalledWith(session.agent.session, 'read-only');
});

afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.disposeAll()));
  rmSync(env.home, { recursive: true, force: true });
});

describe('deliveryAddress', () => {
  it('rejects a persisted Session shared by two robots at the same OpenID', async () => {
    const stored = 'session-shared-by-mistake';
    const prefs = new PrefsStore();
    prefs.setSessionId(KEY, stored);
    prefs.setSessionId(`qqbot:other-robot:c2c:${PEER}`, stored);
    const { registry } = createRegistry(async () => fakeHandle(stored));
    const manager = createManager(registry);
    expect(manager.deliveryAddress(stored)).toBeUndefined();
    await expect(manager.getOrCreate('c2c', PEER, PEER, REPLY)).rejects.toThrow('绑定存在冲突');
    expect(registry.get).not.toHaveBeenCalled();
    expect(registry.resume).not.toHaveBeenCalled();
  });

  it('does not reuse a cached Session after another robot acquires a conflicting binding', async () => {
    const prefs = new PrefsStore();
    const { registry } = createRegistry(async ({ resumeSessionId }) => fakeHandle(resumeSessionId));
    const manager = createManagerWithCtx(registry, onDiskCtx(LEGACY_ID), createLogger(), prefs);
    const original = await manager.getOrCreate('c2c', PEER, PEER, REPLY);
    prefs.setSessionId(`qqbot:other-robot:c2c:${PEER}`, original.sessionId);

    expect(manager.deliveryAddress(original.sessionId)).toBeUndefined();
    await expect(manager.getOrCreate('c2c', PEER, PEER, REPLY)).rejects.toThrow('绑定存在冲突');
  });

  it('does not probe a legacy Session ID that is already owned by another robot', async () => {
    const prefs = new PrefsStore();
    prefs.setSessionId(`qqbot:other-robot:c2c:${PEER}`, LEGACY_ID);
    const { registry } = createRegistry(async () => fakeHandle(LEGACY_ID));
    const manager = createManagerWithCtx(registry, onDiskCtx(LEGACY_ID), createLogger(), prefs);

    await expect(manager.getOrCreate('c2c', PEER, PEER, REPLY)).rejects.toThrow('绑定存在冲突');
    expect(registry.get).not.toHaveBeenCalled();
    expect(registry.resume).not.toHaveBeenCalled();
  });

  it('内存里没有会话时，只按 prefs 返回 QQ 地址，不唤醒 agent', () => {
    const sessionId = 'session-live';
    new PrefsStore().setSessionId(KEY, sessionId);
    const { registry } = createRegistry(async () => { throw new Error('should not resume'); });

    const address = createManager(registry).deliveryAddress(sessionId);

    expect(address).toEqual({ scope: 'c2c', targetId: PEER });
    expect(registry.resume).not.toHaveBeenCalled();
    expect(registry.create).not.toHaveBeenCalled();
    expect(registry.get).not.toHaveBeenCalled();
  });

  it('未知 session 返回 undefined', () => {
    const { registry } = createRegistry(async () => { throw new Error('should not resume'); });

    expect(createManager(registry).deliveryAddress('session-dead')).toBeUndefined();
    expect(registry.resume).not.toHaveBeenCalled();
    expect(registry.create).not.toHaveBeenCalled();
  });

  it('对端已经换成另一条活会话时，不为旧 id 返回地址', async () => {
    const { registry } = createRegistry(async ({ resumeSessionId }) => { throw notFound(resumeSessionId); });
    const manager = createManager(registry);
    const live = await manager.getOrCreate('c2c', PEER, PEER, REPLY);
    new PrefsStore().setSessionId(KEY, 'session-old');

    expect(manager.deliveryAddress('session-old')).toBeUndefined();
    expect(manager.deliveryAddress(live.sessionId)).toEqual(REPLY);
  });
});

describe('getOrCreate — 对照组（迁移主路径行为正确）', () => {
  it('全新用户：legacy 不存在 → 铸造 session- 前缀 id 创建并落盘', async () => {
    const { registry } = createRegistry(async ({ resumeSessionId }) => { throw notFound(resumeSessionId); });

    const record = await createManager(registry).getOrCreate('c2c', PEER, PEER, REPLY);

    expect(registry.resume).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: LEGACY_ID }));
    expect(record.sessionId).toMatch(MINTED);
    expect(createdIds(registry)).toEqual([record.sessionId]);
    expect(persistedId()).toBe(record.sessionId);
  });

  it('0.5.x 老用户：legacy 会话 resume 成功 → 沿用并落盘，不创建', async () => {
    const { registry } = createRegistry(async ({ resumeSessionId }) => fakeHandle(resumeSessionId));

    const record = await createManager(registry).getOrCreate('c2c', PEER, PEER, REPLY);

    expect(record.sessionId).toBe(LEGACY_ID);
    expect(registry.create).not.toHaveBeenCalled();
    expect(persistedId()).toBe(LEGACY_ID);
  });

  it('prefs 已记录：resume 该 id 成功 → 不再探测 legacy', async () => {
    new PrefsStore().setSessionId(KEY, 'session-current');
    const { registry } = createRegistry(async ({ resumeSessionId }) => fakeHandle(resumeSessionId));

    const record = await createManager(registry).getOrCreate('c2c', PEER, PEER, REPLY);

    expect(record.sessionId).toBe('session-current');
    expect(registry.resume).toHaveBeenCalledTimes(1);
    expect(registry.create).not.toHaveBeenCalled();
  });

  it('session 当初的 preset 锁定：优先 header.agentPreset，而非当前 effective preset', async () => {
    const prefs = new PrefsStore();
    prefs.setSessionId(KEY, 'session-current');
    prefs.setPreset(KEY, 'current-preset'); // 当前 effective 已被 /preset 换过
    const { registry } = createRegistry(async ({ resumeSessionId }) => fakeHandle(resumeSessionId));
    const presets = {
      resolve: vi.fn(async (id?: string) => ({ id: id ?? 'default' })),
      mount: vi.fn(async () => {}),
      list: vi.fn(async () => []),
    };
    const ctx = {
      get: (name: string) => {
        if (name === 'sessionPersistence') {
          return { stat: async (id: string) => (id === 'session-current' ? { header: { agentPreset: 'locked-preset' } } : undefined) };
        }
        return name === 'agentPresets' ? presets : undefined;
      },
      on: vi.fn(),
    } as unknown as Context;

    const record = await createManagerWithCtx(registry, ctx).getOrCreate('c2c', PEER, PEER, REPLY);

    // 此前 header 读取一直失败（调用了宿主没有的 load），preset 锁定语义实际失效
    expect(presets.resolve).toHaveBeenCalledWith('locked-preset');
    expect(record.agentPreset).toBe('locked-preset');
  });
});

describe('getOrCreate — E1 resume 失败按会话是否存在分流', () => {
  it('E1-1 会话在盘上但 resume 失败 → 不创建，错误记录后向上抛', async () => {
    new PrefsStore().setSessionId(KEY, 'session-current');
    const { registry } = createRegistry(async ({ resumeSessionId }) => { throw corrupt(resumeSessionId); });
    const logger = createLogger();
    // 宿主自身（agent-loop restoreOrCreateConfigured）只在确认磁盘不存在时才 create
    const manager = createManagerWithCtx(registry, onDiskCtx('session-current'), logger);

    await expect(manager.getOrCreate('c2c', PEER, PEER, REPLY)).rejects.toThrow(/EIO/);

    expect(registry.create).not.toHaveBeenCalled();
    expect(persistedId()).toBe('session-current'); // 映射不被改写，故障恢复后仍指向原会话
    expect(allLogText(logger)).toContain('EIO');
  });

  it('E1-2 0.5.x 老会话在盘上但 resume 遇瞬时错误 → 不弃用，故障恢复后仍能恢复', async () => {
    const first = createRegistry(async ({ resumeSessionId }) => { throw corrupt(resumeSessionId); });

    await expect(
      createManagerWithCtx(first.registry, onDiskCtx(LEGACY_ID)).getOrCreate('c2c', PEER, PEER, REPLY),
    ).rejects.toThrow(/EIO/);
    expect(first.registry.create).not.toHaveBeenCalled();
    expect(persistedId()).toBeUndefined();

    // 重启：瞬时故障已恢复，legacy 会话正常 resume
    const second = createRegistry(async ({ resumeSessionId }) => {
      if (resumeSessionId === LEGACY_ID) return fakeHandle(resumeSessionId);
      throw notFound(resumeSessionId);
    });
    const record = await createManager(second.registry).getOrCreate('c2c', PEER, PEER, REPLY);

    expect(record.sessionId).toBe(LEGACY_ID); // 老会话历史仍可恢复
    expect(persistedId()).toBe(LEGACY_ID);
  });

  it('E1-3 存在性求证本身失败（持久化后端故障）→ 按存在处理，不重建', async () => {
    new PrefsStore().setSessionId(KEY, 'session-current');
    const { registry } = createRegistry(async ({ resumeSessionId }) => { throw notFound(resumeSessionId); });
    const logger = createLogger();
    const flaky = persistenceCtx(async () => { throw new Error('EIO: persistence backend unavailable'); });

    await expect(
      createManagerWithCtx(registry, flaky, logger).getOrCreate('c2c', PEER, PEER, REPLY),
    ).rejects.toThrow(/not found/); // 向上抛原 resume 错误，而非求证错误
    expect(registry.create).not.toHaveBeenCalled();
    expect(allLogText(logger)).toContain('existence unknown');
  });

  it('E1-4 确认磁盘无此会话 → 即使 resume 报的是 IO 错误也允许首次创建', async () => {
    const { registry } = createRegistry(async ({ resumeSessionId }) => { throw corrupt(resumeSessionId); });

    const record = await createManager(registry).getOrCreate('c2c', PEER, PEER, REPLY);

    expect(record.sessionId).toMatch(MINTED);
    expect(createdIds(registry)).toEqual([record.sessionId]);
  });

  it('E1-5 宿主无 sessionPersistence.stat → 无求证手段，按 resume 结果创建并留痕', async () => {
    const { registry } = createRegistry(async ({ resumeSessionId }) => { throw notFound(resumeSessionId); });
    const logger = createLogger();

    const record = await createManagerWithCtx(registry, emptyCtx(), logger).getOrCreate('c2c', PEER, PEER, REPLY);

    expect(record.sessionId).toMatch(MINTED);
    expect(createdIds(registry)).toEqual([record.sessionId]);
    expect(allLogText(logger)).toContain('host lacks sessionPersistence.stat');
  });

  it('E1-6 宿主 persistence 形态不含 stat → 不卡住全新会话的创建', async () => {
    // 回归：此前按不存在的 load() 求证，TypeError 被当成「后端故障」→ 拒绝创建，
    // 全新用户的第一条消息直接收到「处理消息时出现异常」
    const { registry } = createRegistry(async ({ resumeSessionId }) => { throw notFound(resumeSessionId); });
    const legacyShape = {
      get: (name: string) => (name === 'sessionPersistence' ? { open: async () => ({}) } : undefined),
      on: vi.fn(),
    } as unknown as Context;

    const record = await createManagerWithCtx(registry, legacyShape).getOrCreate('c2c', PEER, PEER, REPLY);

    expect(record.sessionId).toMatch(MINTED);
    expect(createdIds(registry)).toEqual([record.sessionId]);
  });
});

describe('getOrCreate — E2 确定性 id 不进入新建路径', () => {
  it('does not restore the old binding when resume finishes after /new', async () => {
    const old = fakeHandle('session-old');
    const pending = deferred<DshAgentHandle>();
    const { registry } = createRegistry(({ resumeSessionId }) =>
      resumeSessionId === old.agent.id ? pending.promise : Promise.reject(notFound(resumeSessionId)));
    new PrefsStore().setSessionId(KEY, old.agent.id);
    const manager = createManagerWithCtx(registry, onDiskCtx(old.agent.id));
    const incoming = manager.getOrCreate('c2c', PEER, PEER, REPLY);
    await vi.waitFor(() => expect(registry.resume).toHaveBeenCalledTimes(1));

    await manager.remove('c2c', PEER);
    const newBinding = persistedId();
    pending.resolve(old);

    expect((await incoming).sessionId).toBe(newBinding);
    expect(persistedId()).toBe(newBinding);
    expect(manager.getSessionRecord('c2c', PEER)?.sessionId).toBe(newBinding);
    expect(old.dispose).toHaveBeenCalledOnce();
  });

  it.each(['QQ', 'Web'] as const)('discards a retired manager candidate after the new manager binds through %s', async source => {
    const gate = deferred<void>();
    const { registry, handles } = createRegistry(async ({ resumeSessionId }) => { throw notFound(resumeSessionId); });
    const oldCreate = registry.create.getMockImplementation();
    if (!oldCreate) throw new Error('test registry has no create implementation');
    registry.create.mockImplementationOnce(async options => {
      await gate.promise;
      return oldCreate(options);
    });
    const oldManager = createManager(registry);
    const incoming = oldManager.getOrCreate('c2c', PEER, PEER, REPLY);
    await vi.waitFor(() => expect(registry.create).toHaveBeenCalledTimes(1));

    await oldManager.disposeAll();
    const reloaded = createManagerWithCtx(registry, persistenceCtx(async id =>
      handles.some(handle => handle.agent.id === id) ? { header: {} } : undefined));
    if (source === 'QQ') await reloaded.remove('c2c', PEER);
    else await reloaded.createAndBindSession('c2c', PEER, null, WORKBENCH_SETTINGS, () => {});
    const current = await reloaded.getOrCreate('c2c', PEER, PEER, REPLY);
    const rejected = expect(incoming).rejects.toThrow('已停用');
    gate.resolve();
    await rejected;

    expect(persistedId()).toBe(current.sessionId);
    expect(oldManager.getSessionRecord('c2c', PEER)).toBeUndefined();
    expect(handles[1]?.dispose).toHaveBeenCalledOnce();
  });

  it('E2-1 resume(legacy) 期间 /new 写入新 id → 采用 prefs 最新 id 新建，内存与 prefs 一致', async () => {
    const pending = deferred<DshAgentHandle>();
    const { registry } = createRegistry(() => pending.promise);
    const manager = createManager(registry);

    const creating = manager.getOrCreate('c2c', PEER, PEER, REPLY);
    await vi.waitFor(() => expect(registry.resume).toHaveBeenCalled());
    await manager.remove('c2c', PEER); // /new：同步把 prefs 写为新铸 id
    pending.reject(notFound(LEGACY_ID));
    const record = await creating;

    expect(record.sessionId).toMatch(MINTED);
    expect(record.sessionId).not.toBe(LEGACY_ID);
    expect(createdIds(registry)).toEqual([record.sessionId]);
    expect(persistedId()).toBe(record.sessionId); // 重启后仍是同一会话
  });

  it('E2-2 /compact 拉起与普通消息并发 getOrCreate → singleflight 合并为一次 resume/create，无 agent 泄漏', async () => {
    const resumes: Array<Deferred<DshAgentHandle>> = [];
    const { registry, handles } = createRegistry(() => {
      const d = deferred<DshAgentHandle>();
      resumes.push(d);
      return d.promise;
    });
    const manager = createManager(registry);

    // /compact 走 slashCommand（在 concurrencyGuard 之前），与普通消息不串行
    const compacting = manager.compact('c2c', PEER, { senderId: PEER, replyTarget: REPLY });
    const messaging = manager.getOrCreate('c2c', PEER, PEER, REPLY);
    await vi.waitFor(() => expect(resumes).toHaveLength(1));
    for (const d of resumes) d.reject(notFound(LEGACY_ID));
    const [, record] = await Promise.all([compacting, messaging]);

    expect(resumes).toHaveLength(1);
    expect(createdIds(registry)).toEqual([record.sessionId]);
    expect(record.sessionId).toMatch(MINTED);
    expect(handles).toHaveLength(1); // 不再产生无人回收的多余 agent
    expect(manager.getSessionRecord('c2c', PEER)?.handle).toBe(handles[0]);
  });

  it('E2-3 singleflight 失败时两个调用方都收到同一错误，且不残留在途记录', async () => {
    new PrefsStore().setSessionId(KEY, 'session-current');
    const { registry } = createRegistry(async ({ resumeSessionId }) => { throw corrupt(resumeSessionId); });
    // 会话在盘上 → resume 失败不重建，整次调用以失败告终
    const manager = createManagerWithCtx(registry, onDiskCtx('session-current'));

    const first = manager.getOrCreate('c2c', PEER, PEER, REPLY);
    const second = manager.getOrCreate('c2c', PEER, PEER, REPLY);

    await expect(first).rejects.toThrow(/EIO/);
    await expect(second).rejects.toThrow(/EIO/);
    expect(registry.resume).toHaveBeenCalledTimes(1);

    // 在途记录已清理：下一次调用重新发起 resume
    await expect(manager.getOrCreate('c2c', PEER, PEER, REPLY)).rejects.toThrow(/EIO/);
    expect(registry.resume).toHaveBeenCalledTimes(2);
  });
});

describe('getOrCreate — E3 连带（prefs 损坏导致映射丢失）', () => {
  it('E3-4 prefs 文件损坏 → 回落 legacy 探测，且映射丢失留下可见日志', async () => {
    writeFileSync(join(env.home, 'model-prefs.json'), `{"overrides":{},"sessionIds":{"${KEY}":"session-cur`, 'utf8');
    const { registry } = createRegistry(async ({ resumeSessionId }) => fakeHandle(resumeSessionId));
    const logger = createLogger();

    const record = await createManager(registry, logger).getOrCreate('c2c', PEER, PEER, REPLY);

    expect(registry.resume).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: LEGACY_ID }));
    expect(record.sessionId).toBe(LEGACY_ID);
    expect(allLogText(logger)).toMatch(/model-prefs\.json/); // 不再静默
  });
});

describe('getOrCreate — 会话创建/恢复后挂载到对应工作区', () => {
  /** 带 workspaceRegistry 的 ctx（sessionPersistence 缺省为「磁盘无会话」） */
  function workspaceCtx(workspaceRegistry: unknown): Context {
    return {
      get: (name: string) => {
        if (name === 'sessionPersistence') return { stat: async () => undefined };
        if (name === 'workspaceRegistry') return workspaceRegistry;
        return undefined;
      },
      on: vi.fn(),
    } as unknown as Context;
  }

  it('创建会话后用 workspaceDir() 挂载（cwd 与 meta.cwd 同源，避免 attachSession 校验失败）', async () => {
    const ws = { path: join(env.home, 'workspace'), attachSession: vi.fn().mockResolvedValue(undefined) };
    const workspaceRegistry = { create: vi.fn().mockResolvedValue(ws) };
    const { registry } = createRegistry(async ({ resumeSessionId }) => { throw notFound(resumeSessionId); });
    const manager = createManagerWithCtx(registry, workspaceCtx(workspaceRegistry));

    const record = await manager.getOrCreate('c2c', PEER, PEER, REPLY);

    // attach 是 fire-and-forget，等待其落到工作区
    await vi.waitFor(() => expect(ws.attachSession).toHaveBeenCalledWith(record.sessionId));
    // 关键回归：cwd 必须等于 meta.cwd（resolveAgentCwd(config.cwd)），而非 process.cwd()
    expect(workspaceRegistry.create).toHaveBeenCalledWith(join(env.home, 'workspace'), 'QQBot');
  });

  it('恢复会话时同样挂载（升级后老会话在下一次创建记录时补挂）', async () => {
    new PrefsStore().setSessionId(KEY, 'session-current');
    const ws = { path: join(env.home, 'workspace'), attachSession: vi.fn().mockResolvedValue(undefined) };
    const workspaceRegistry = { create: vi.fn().mockResolvedValue(ws) };
    const { registry } = createRegistry(async ({ resumeSessionId }) => fakeHandle(resumeSessionId));
    const manager = createManagerWithCtx(registry, workspaceCtx(workspaceRegistry));

    const record = await manager.getOrCreate('c2c', PEER, PEER, REPLY);

    expect(record.sessionId).toBe('session-current');
    await vi.waitFor(() => expect(ws.attachSession).toHaveBeenCalledWith('session-current'));
    expect(workspaceRegistry.create).toHaveBeenCalledWith(join(env.home, 'workspace'), 'QQBot');
  });
});

describe('QQ prompt 注册生命周期（per-agent 安装 / 释放 / live 复用重装）', () => {
  /**
   * 带 systemPrompt 替身的 agent：section/context 注册进 Map，disposer 从 Map 删除，
   * 用于观察 QQ prompt sections/contexts 的安装与释放。
   */
  function promptAgent(id: string, opts: { failSection?: boolean } = {}) {
    const sections = new Map<string, { name: string }>();
    const contexts = new Map<string, { name: string }>();
    const service = {
      section: (s: { name: string }) => {
        if (opts.failSection) throw new Error('boom: section registration rejected');
        sections.set(s.name, s);
        return () => { sections.delete(s.name); };
      },
      context: (c: { name: string }) => {
        contexts.set(c.name, c);
        return () => { contexts.delete(c.name); };
      },
    };
    const agent = {
      ...fakeAgent(id),
      ctx: { get: (name: string) => (name === 'systemPrompt' ? service : undefined) },
    } as unknown as DshAgent;
    return { agent, sections, contexts };
  }

  /** registry：create 产出带 prompt 替身的 agent，并让后续 get() 能复用它（live 路径） */
  function promptRegistry(opts: { failSection?: boolean } = {}) {
    let live: DshAgent | undefined;
    const created: Array<{ agent: DshAgent; sections: Map<string, unknown>; contexts: Map<string, unknown> }> = [];
    const registry = {
      get: vi.fn(() => live),
      resume: vi.fn(async ({ resumeSessionId }: { resumeSessionId: string }) => { throw notFound(resumeSessionId); }),
      create: vi.fn(async (options: { sessionId: string }) => {
        const { agent, sections, contexts } = promptAgent(options.sessionId, opts);
        created.push({ agent, sections, contexts });
        live = agent;
        return { agent, dispose: vi.fn(async () => {}) } as DshAgentHandle;
      }),
    };
    return { registry, created };
  }

  it('会话建立即注册 4 个 section + 2 个 context；remove() 全部释放', async () => {
    const { registry, created } = promptRegistry();
    const manager = createManager(registry);

    await manager.getOrCreate('c2c', PEER, PEER, REPLY);
    expect(created).toHaveLength(1);
    expect([...created[0].sections.keys()].sort()).toEqual(['qqbot:extra', 'qqbot:persona', 'qqbot:rules']);
    expect([...created[0].contexts.keys()].sort()).toEqual(['qqbot:background', 'qqbot:turn-meta']);

    await manager.remove('c2c', PEER);
    expect(created[0].sections.size).toBe(0);
    expect(created[0].contexts.size).toBe(0);
  });

  it('extra section 惰性读取 config：改 directPrompt 即时生效，无需重装', async () => {
    const { registry, created } = promptRegistry();
    const config = ConfigSchema({
      appId: APP_ID, appSecret: 'secret', provider: 'p', model: 'm',
      cwd: join(env.home, 'workspace'), sessionIdleTimeout: 0,
      groupPrompt: 'OLD_GROUP', directPrompt: 'OLD_DIRECT',
    } as ImQQBotConfig);
    const manager = new SessionManager(absentCtx(), registry as unknown as DshAgentRegistry, config, createLogger());
    managers.push(manager);

    await manager.getOrCreate('c2c', PEER, PEER, REPLY);
    const extra = created[0].sections.get('qqbot:extra') as { text: () => string };
    expect(extra.text()).toBe('OLD_DIRECT'); // c2c 会话读 directPrompt

    config.directPrompt = 'NEW_DIRECT'; // 热更新配置（Schema 代理可写）
    expect(extra.text()).toBe('NEW_DIRECT');
  });

  it('live 复用：释放后的 agent 再次被 get() 命中时重新安装 prompt（WeakSet 实现下会永久丢失）', async () => {
    const { registry, created } = promptRegistry();
    const manager = createManager(registry);

    // 第一次建立：create 产出 agent A 并注册 prompt
    await manager.getOrCreate('c2c', PEER, PEER, REPLY);
    const agent = created[0].agent;

    // 回收（releasePrompt 释放注册，但 registry 中 agent A 仍存活——宿主未必同步销毁）
    await manager.remove('c2c', PEER);
    expect(created[0].sections.size).toBe(0);

    // 第二次 getOrCreate：prefs 指向 remove 时铸造的新 id，registry.get 命中 A → live 复用
    const record = await manager.getOrCreate('c2c', PEER, PEER, REPLY);
    expect(record.agent).toBe(agent);
    expect(registry.create).toHaveBeenCalledTimes(1); // 未重建 agent，纯复用
    // 关键回归：prompt 必须重新注册，而不是因"已安装"标记被跳过
    expect(created[0].sections.size).toBe(3);
    expect(created[0].contexts.size).toBe(2);
  });

  it('disposeAll 同样释放 prompt 注册项', async () => {
    const { registry, created } = promptRegistry();
    const manager = createManager(registry);
    await manager.getOrCreate('c2c', PEER, PEER, REPLY);

    await manager.disposeAll();
    expect(created[0].sections.size).toBe(0);
    expect(created[0].contexts.size).toBe(0);
  });

  it('注册失败 fail-soft：会话仍可用，warn 留痕，下次同 agent 重试', async () => {
    const { registry, created } = promptRegistry({ failSection: true });
    const logger = createLogger();
    const manager = createManagerWithCtx(registry, absentCtx(), logger);

    const record = await manager.getOrCreate('c2c', PEER, PEER, REPLY);
    expect(record.agent).toBeDefined(); // 安装失败不阻断会话建立
    expect(allLogText(logger)).toContain('qq prompt install failed');

    // 失败不入表：同 agent 再次触发安装时重试（此处模拟再次 remove→复用）
    expect(manager.remove('c2c', PEER)).resolves.toBeUndefined();
    expect(created[0].sections.size).toBe(0);
  });
});

it.each([true, false])('preserves only a verified legacy Session on the first QQ /new (exists=%s)', async exists => {
  const { registry } = createRegistry(async () => { throw new Error('unexpected resume'); });
  const manager = createManagerWithCtx(registry, onDiskCtx(...(exists ? [LEGACY_ID] : [])));
  expect(persistedId()).toBeUndefined();
  await manager.remove('c2c', PEER);
  expect(new PrefsStore().listSessionBindings(APP_ID)).toEqual([
    { key: KEY, current: expect.stringMatching(MINTED), history: exists ? [LEGACY_ID] : [] },
  ]);
});

describe('web workbench session switching', () => {
  const settings = WORKBENCH_SETTINGS;

  it.each(['QQ /new', 'Web switch', 'gateway retirement'])('settles both in-flight cards immediately on %s', async change => {
    const old = fakeHandle('session-old');
    const { registry } = createRegistry(async () => old);
    new PrefsStore().setSessionId(KEY, old.agent.id);
    const manager = createManagerWithCtx(registry, persistenceCtx(async () => ({ header: {} })));
    await manager.getOrCreate('c2c', PEER, PEER, REPLY);
    const receipt = deferred<void>();
    const sender = { sendMarkdown: vi.fn(() => receipt.promise) };
    const logger = createLogger();
    manager.questionChannel = new QuestionChannel(manager, sender, { requireMention: false, askTimeoutMs: 60_000 }, logger);
    manager.approvalChannel = new ApprovalChannel(manager, sender, { access: { c2cMode: 'open', c2cAllow: [] } }, logger);

    const question = manager.questionChannel.routeRequest(
      { agent: { id: old.agent.id }, questions: [{ id: 'q', question: 'Continue?' }] },
      async () => { throw new Error('question unexpectedly delegated'); },
    ).catch((error: unknown) => error);
    let ask: ((request: ApprovalRequest) => unknown) | undefined;
    manager.approvalChannel.install({
      on(_event, handler) {
        ask = request => handler(request, () => { throw new Error('approval unexpectedly delegated'); });
        return () => true;
      },
    });
    const approval = ask?.({ agent: { id: old.agent.id }, toolName: 'bash' });
    expect(sender.sendMarkdown).toHaveBeenCalledTimes(2);

    try {
      if (change === 'QQ /new') await manager.remove('c2c', PEER);
      else if (change === 'Web switch') await manager.createAndBindSession('c2c', PEER, old.agent.id, settings, () => {});
      else manager.deactivate();
      const status = await Promise.race([
        Promise.all([approval, question]),
        new Promise<never>((_, reject) => setImmediate(() => reject(new Error('card request still pending')))),
      ]);
      expect(status).toEqual(['cancelled', expect.objectContaining({ code: 'ASK_ABORTED' })]);
    } finally {
      receipt.resolve();
      await new Promise<void>(resolve => setImmediate(resolve));
      manager.questionChannel.uninstall();
    }
  });

  it('waits for the new native session, keeps history, and sends waiting input to the new binding', async () => {
    const gate = deferred<void>();
    const old = fakeHandle('session-old');
    vi.mocked(old.dispose).mockRejectedValueOnce(new Error('cleanup failed'));
    const stored = new Set([old.agent.id]);
    const { registry } = createRegistry(async () => old);
    registry.create.mockImplementation(async ({ sessionId }) => {
      await gate.promise;
      stored.add(sessionId);
      return fakeHandle(sessionId);
    });
    new PrefsStore().setSessionId(KEY, old.agent.id);
    const manager = createManagerWithCtx(registry, persistenceCtx(async id => stored.has(id) ? { header: {} } : undefined));
    await manager.getOrCreate('c2c', PEER, PEER, REPLY);
    const start = manager.createAndBindSession('c2c', PEER, old.agent.id, settings, () => {});
    const incoming = manager.getOrCreate('c2c', PEER, PEER, REPLY);
    expect(persistedId()).toBe(old.agent.id);
    await expect(manager.remove('c2c', PEER)).rejects.toThrow('正在切换');
    await expect(manager.createAndBindSession('c2c', PEER, old.agent.id, settings, () => {})).rejects.toThrow('空闲后');
    gate.resolve();
    const id = await start;
    expect((await incoming).sessionId).toBe(id);
    expect(persistedId()).toBe(id);
    await vi.waitFor(() => expect(old.dispose).toHaveBeenCalledOnce());
    expect(new PrefsStore().listSessionBindings(APP_ID)[0]?.history).toEqual([old.agent.id]);
    await expect(manager.createAndBindSession('c2c', PEER, old.agent.id, settings, () => {})).rejects.toThrow('已变化');
    expect(registry.create).toHaveBeenCalledTimes(1);
  });

  it('leaves the old binding and releases the candidate when permission changes during creation', async () => {
    const old = fakeHandle('session-old');
    const { registry, handles } = createRegistry(async () => old);
    new PrefsStore().setSessionId(KEY, old.agent.id);
    const manager = createManagerWithCtx(registry, persistenceCtx(async () => ({ header: {} })));
    const record = await manager.getOrCreate('c2c', PEER, PEER, REPLY);
    let checks = 0;
    await expect(manager.createAndBindSession('c2c', PEER, record.sessionId, settings, () => {
      if (++checks === 2) throw new Error('QQ 会话已暂停');
    })).rejects.toThrow('已暂停');
    expect(persistedId()).toBe(record.sessionId);
    expect(await manager.getOrCreate('c2c', PEER, PEER, REPLY)).toBe(record);
    expect(handles[0]?.dispose).toHaveBeenCalledOnce();
  });

  it('keeps the current binding if saving either the Web or QQ switch fails', async () => {
    const old = fakeHandle('session-old');
    const { registry, handles } = createRegistry(async () => old);
    new PrefsStore().setSessionId(KEY, old.agent.id);
    const manager = createManagerWithCtx(registry, persistenceCtx(async () => ({ header: {} })));
    const current = await manager.getOrCreate('c2c', PEER, PEER, REPLY);
    const prefsPath = join(env.home, 'model-prefs.json');
    const backup = join(env.home, 'saved-prefs.json');
    let checks = 0;

    try {
      await expect(manager.createAndBindSession('c2c', PEER, current.sessionId, settings, () => {
        if (++checks !== 2) return;
        renameSync(prefsPath, backup);
        mkdirSync(prefsPath);
      })).rejects.toThrow();
      expect(checks).toBe(2);
      await expect(manager.remove('c2c', PEER)).rejects.toThrow('无法保存新 Session');
    } finally {
      if (checks === 2) {
        rmSync(prefsPath, { recursive: true, force: true });
        renameSync(backup, prefsPath);
      }
    }

    expect(persistedId()).toBe(current.sessionId);
    expect(await manager.getOrCreate('c2c', PEER, PEER, REPLY)).toBe(current);
    expect(handles[0]?.dispose).toHaveBeenCalledOnce();
    expect(old.dispose).not.toHaveBeenCalled();
  });

  it('stops archived ingress, resumes the same binding after restore, and allows an explicit new Session', async () => {
    const old = fakeHandle('session-old');
    const { registry } = createRegistry(async () => old);
    const workspace = { archivedSessionIds: [old.agent.id] };
    const ctx = {
      get: (name: string) => name === 'workspaceRegistry' ? workspace
        : name === 'sessionPersistence' ? { stat: async () => ({ header: {} }) } : undefined,
      on: vi.fn(),
    } as unknown as Context;
    new PrefsStore().setSessionId(KEY, old.agent.id);
    const manager = createManagerWithCtx(registry, ctx);

    await expect(manager.getOrCreate('c2c', PEER, PEER, REPLY)).rejects.toThrow('已归档');
    expect(registry.resume).not.toHaveBeenCalled();
    expect(registry.create).not.toHaveBeenCalled();
    workspace.archivedSessionIds = [];
    const original = await manager.getOrCreate('c2c', PEER, PEER, REPLY);
    expect(original.sessionId).toBe(old.agent.id);
    workspace.archivedSessionIds = [old.agent.id];
    await expect(manager.getOrCreate('c2c', PEER, PEER, REPLY)).rejects.toThrow('已归档');
    const next = await manager.createAndBindSession('c2c', PEER, old.agent.id, settings, () => {});
    expect((await manager.getOrCreate('c2c', PEER, PEER, REPLY)).sessionId).toBe(next);
    expect(new PrefsStore().listSessionBindings(APP_ID)[0]?.history).toEqual([old.agent.id]);
  });

  it('declines a new session when the current native agent is running', async () => {
    const old = fakeHandle('session-old');
    Object.defineProperty(old.agent, 'status', { value: 'running' });
    const { registry } = createRegistry(async () => old);
    new PrefsStore().setSessionId(KEY, old.agent.id);
    const manager = createManagerWithCtx(registry, persistenceCtx(async () => ({ header: {} })));
    await manager.getOrCreate('c2c', PEER, PEER, REPLY);
    await expect(manager.createAndBindSession('c2c', PEER, old.agent.id, settings, () => {})).rejects.toThrow('空闲后');
    expect(registry.create).not.toHaveBeenCalled();
    expect(persistedId()).toBe(old.agent.id);
  });
});
