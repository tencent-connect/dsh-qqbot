import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHostAdapter, _resetAdapterCache } from './adapter.ts';

/** 最小 ctx：可控的 get() */
function makeCtx(services: Record<string, unknown>) {
  return {
    get: (name: string) => {
      if (!(name in services)) throw new Error(`cannot get property "${name}" without inject`);
      return services[name];
    },
  } as never;
}

describe('host adapter', () => {
  beforeEach(() => {
    _resetAdapterCache();
    vi.unstubAllGlobals();
  });

  it('sessionEvents：新宿主 snapshotEvents() 优先', () => {
    const adapter = createHostAdapter(makeCtx({}));
    const events = [{ type: 'a', seq: 0 }];
    expect(adapter.sessionEvents({ snapshotEvents: () => events })).toBe(events);
  });

  it('sessionEvents：旧宿主 events getter 兜底', () => {
    const adapter = createHostAdapter(makeCtx({}));
    const events = [{ type: 'a', seq: 0 }];
    expect(adapter.sessionEvents({ events })).toEqual(events);
  });

  it('sessionEvents：两者皆无返回空数组（不抛）', () => {
    const adapter = createHostAdapter(makeCtx({}));
    expect(adapter.sessionEvents({})).toEqual([]);
  });

  it('serviceFor：旧宿主 presets 实例方法直接命中', async () => {
    const compaction = { compactNow: () => {} };
    const presets = { serviceFor: (agent: unknown, name: string) => (name === 'compaction' ? compaction : undefined) };
    const adapter = createHostAdapter(makeCtx({ agentPresets: presets }));
    expect(await adapter.serviceFor({ ctx: {} }, 'compaction')).toBe(compaction);
    expect(adapter.capabilities).toContain('serviceFor(presets实例方法)');
  });

  it('serviceFor：无实例方法时走动态模块函数', async () => {
    const compaction = { compactNow: () => {} };
    vi.doMock('@deepseek-ai/dsh-agent-presets', () => ({
      serviceForAgent: (_ctx: unknown, agent: unknown, name: string) =>
        name === 'compaction' ? compaction : undefined,
    }));
    const adapter = createHostAdapter(makeCtx({}));
    expect(await adapter.serviceFor({ ctx: {} }, 'compaction')).toBe(compaction);
  });

  it('globalService：未注册返回 undefined（不抛）', () => {
    const adapter = createHostAdapter(makeCtx({}));
    expect(adapter.globalService('compaction')).toBeUndefined();
  });

  it('globalService：已注册返回服务', () => {
    const compaction = { compactNow: () => {} };
    const adapter = createHostAdapter(makeCtx({ compaction }));
    expect(adapter.globalService('compaction')).toBe(compaction);
  });

  it('buildForkSeed：模块不可解析时返回 undefined（不抛）', async () => {
    vi.doMock('@deepseek-ai/dsh-session/fork', () => { throw new Error('module unavailable'); });
    const adapter = createHostAdapter(makeCtx({}));
    expect(await adapter.buildForkSeed([{ seq: 0 }], 0)).toBeUndefined();
  });

  it('sessionHeader：取 stat().header（agentPreset 在 header 顶层）', async () => {
    const header = { id: 's1', agentPreset: 'coder' };
    const adapter = createHostAdapter(makeCtx({ sessionPersistence: { stat: async () => ({ header }) } }));
    expect(await adapter.sessionHeader('s1')).toBe(header);
  });

  it('sessionHeader：会话不存在（stat → undefined）或读取失败均返回 undefined（不抛）', async () => {
    const absent = createHostAdapter(makeCtx({ sessionPersistence: { stat: async () => undefined } }));
    expect(await absent.sessionHeader('s1')).toBeUndefined();

    const failing = createHostAdapter(makeCtx({
      sessionPersistence: { stat: async () => { throw new Error('EIO'); } },
    }));
    expect(await failing.sessionHeader('s1')).toBeUndefined();
  });

  it('sessionExists：stat 返回快照 → true，返回 undefined → false', async () => {
    const present = createHostAdapter(makeCtx({ sessionPersistence: { stat: async () => ({ header: { id: 's1' } }) } }));
    expect(await present.sessionExists('s1')).toBe(true);

    const absent = createHostAdapter(makeCtx({ sessionPersistence: { stat: async () => undefined } }));
    expect(await absent.sessionExists('s1')).toBe(false);
  });

  it('sessionExists：后端故障照常抛出（求证失败 ≠ 不存在）', async () => {
    const adapter = createHostAdapter(makeCtx({
      sessionPersistence: { stat: async () => { throw new Error('EIO: backend unavailable'); } },
    }));
    await expect(adapter.sessionExists('s1')).rejects.toThrow(/EIO/);
  });

  it('sessionExists：服务未注册 → undefined', async () => {
    const adapter = createHostAdapter(makeCtx({}));
    expect(await adapter.sessionExists('s1')).toBeUndefined();
    expect(adapter.capabilities).toContain('sessionPersistence.stat(不可用，会话存在性判定降级)');
  });

  it('sessionExists：服务形态不含 stat → undefined，不让 TypeError 冒出', async () => {
    // 回归：此前按不存在的 load() 调用，TypeError 被当成「后端故障」，
    // 全新会话被误判为「可能存在」而拒绝创建，用户侧表现为处理消息异常
    const adapter = createHostAdapter(makeCtx({ sessionPersistence: { open: async () => ({}) } }));
    expect(await adapter.sessionExists('s1')).toBeUndefined();
    expect(await adapter.sessionHeader('s1')).toBeUndefined();
  });
});

describe('attachSessionToWorkspace', () => {
  function makeLogger() {
    return { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  }

  it('把会话挂载到 cwd 对应的工作区（title=qqbot）', async () => {
    const ws = { path: '/proj', attachSession: vi.fn().mockResolvedValue(undefined) };
    const registry = { create: vi.fn().mockResolvedValue(ws) };
    const logger = makeLogger();
    const adapter = createHostAdapter(makeCtx({ workspaceRegistry: registry }), logger);

    await adapter.attachSessionToWorkspace('sess-1', '/proj');

    expect(registry.create).toHaveBeenCalledWith('/proj', 'QQBot');
    expect(ws.attachSession).toHaveBeenCalledWith('sess-1');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('workspaceRegistry 未挂载时静默降级（debug，不 warn）', async () => {
    const logger = makeLogger();
    const adapter = createHostAdapter(makeCtx({}), logger);

    await expect(adapter.attachSessionToWorkspace('sess-1', '/proj')).resolves.toBeUndefined();
    expect(logger.debug).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('registry 无可用 create() 时静默降级', async () => {
    const logger = makeLogger();
    const adapter = createHostAdapter(makeCtx({ workspaceRegistry: {} }), logger);

    await expect(adapter.attachSessionToWorkspace('sess-1', '/proj')).resolves.toBeUndefined();
    expect(logger.debug).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('create() 失败时吞掉异常并 warn', async () => {
    const logger = makeLogger();
    const registry = { create: vi.fn().mockRejectedValue(new Error('not a directory')) };
    const adapter = createHostAdapter(makeCtx({ workspaceRegistry: registry }), logger);

    await expect(adapter.attachSessionToWorkspace('sess-1', '/proj')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('attachSession() 失败时吞掉异常并 warn', async () => {
    const logger = makeLogger();
    const ws = { path: '/proj', attachSession: vi.fn().mockRejectedValue(new Error('cwd mismatch')) };
    const registry = { create: vi.fn().mockResolvedValue(ws) };
    const adapter = createHostAdapter(makeCtx({ workspaceRegistry: registry }), logger);

    await expect(adapter.attachSessionToWorkspace('sess-1', '/proj')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('create() 返回不含 attachSession 的对象时 warn（接口演进防护）', async () => {
    const logger = makeLogger();
    const registry = { create: vi.fn().mockResolvedValue({ path: '/proj' }) };
    const adapter = createHostAdapter(makeCtx({ workspaceRegistry: registry }), logger);

    await expect(adapter.attachSessionToWorkspace('sess-1', '/proj')).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('归档判定与恢复', () => {
  it('archivedSessionIds 命中 → isSessionArchived true；未命中 → false', () => {
    const registry = { create: vi.fn(), archivedSessionIds: ['sess-a'] };
    const adapter = createHostAdapter(makeCtx({ workspaceRegistry: registry }));

    expect(adapter.isSessionArchived('sess-a')).toBe(true);
    expect(adapter.isSessionArchived('sess-b')).toBe(false);
    expect(adapter.capabilities).toContain('workspaceRegistry.archivedSessionIds(可用)');
  });

  it('每次现读集合：宿主取消归档后立刻反映为未归档', () => {
    const archived: string[] = ['sess-a'];
    const registry = { create: vi.fn(), get archivedSessionIds() { return archived; } };
    const adapter = createHostAdapter(makeCtx({ workspaceRegistry: registry }));

    expect(adapter.isSessionArchived('sess-a')).toBe(true);
    archived.length = 0;
    expect(adapter.isSessionArchived('sess-a')).toBe(false);
  });

  it('未挂载 workspaceRegistry（headless）→ 按未归档处理', () => {
    const adapter = createHostAdapter(makeCtx({}));

    expect(adapter.isSessionArchived('sess-a')).toBe(false);
    expect(adapter.capabilities).toContain('workspaceRegistry.archivedSessionIds(不可用，无法判定会话归档)');
  });

  it('unarchiveSession：宿主提供则调用并返回 true', async () => {
    const unarchiveSession = vi.fn().mockResolvedValue(undefined);
    const registry = { create: vi.fn(), archivedSessionIds: [], unarchiveSession };
    const adapter = createHostAdapter(makeCtx({ workspaceRegistry: registry }));

    expect(await adapter.unarchiveSession('sess-a')).toBe(true);
    expect(unarchiveSession).toHaveBeenCalledWith('sess-a');
  });

  it('unarchiveSession：能力缺失返回 false（调用方据此提示用户）', async () => {
    const adapter = createHostAdapter(makeCtx({ workspaceRegistry: { create: vi.fn(), archivedSessionIds: [] } }));

    expect(await adapter.unarchiveSession('sess-a')).toBe(false);
    expect(adapter.capabilities).toContain('workspaceRegistry.unarchiveSession(不可用，归档只能提示用户手动取消)');
  });

  it('unarchiveSession：宿主抛错时返回 false 并 warn，不上抛', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const registry = {
      create: vi.fn(),
      archivedSessionIds: [],
      unarchiveSession: vi.fn().mockRejectedValue(new Error('EIO')),
    };
    const adapter = createHostAdapter(makeCtx({ workspaceRegistry: registry }), logger);

    expect(await adapter.unarchiveSession('sess-a')).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });
});
