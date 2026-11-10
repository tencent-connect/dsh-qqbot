import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHostAdapter, _resetAdapterCache } from './adapter.ts';
import { TITLE_SCAN_EVENT_CAP } from '../shared/session-title.ts';

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

  // ── listWorkspaces ──

  it('listWorkspaces：映射 path/title/sessionIds；缺 title 回退 path，非法条目跳过', () => {
    const registry = {
      list: () => [
        { path: '/proj-a', title: 'A 项目', sessionIds: ['session-1', 'session-2'] },
        { path: '/proj-b', sessionIds: [123, 'session-3'] },        // 无 title + 混入非字符串 id
        { title: '无路径' },                                          // 无 path → 跳过
        null,
      ],
    };
    const adapter = createHostAdapter(makeCtx({ workspaceRegistry: registry }));
    expect(adapter.listWorkspaces()).toEqual([
      { path: '/proj-a', title: 'A 项目', sessionIds: ['session-1', 'session-2'] },
      { path: '/proj-b', title: '/proj-b', sessionIds: ['session-3'] },
    ]);
  });

  it('listWorkspaces：注册表未挂载 / 无 list / 抛错均返回空数组（不抛）', () => {
    const none = createHostAdapter(makeCtx({}));
    expect(none.listWorkspaces()).toEqual([]);

    const noList = createHostAdapter(makeCtx({ workspaceRegistry: { create: vi.fn() } }));
    expect(noList.listWorkspaces()).toEqual([]);

    const failing = createHostAdapter(makeCtx({ workspaceRegistry: { list: () => { throw new Error('EIO'); } } }));
    expect(failing.listWorkspaces()).toEqual([]);
  });

  // ── readPermissionKnobs ──

  it('readPermissionKnobs：取最后一条 sandbox/mode 与 approval/policy（最后者胜）', () => {
    const adapter = createHostAdapter(makeCtx({}));
    const session = {
      snapshotEvents: () => [
        { type: 'sandbox/mode', data: { mode: 'read-only' } },
        { type: 'approval/policy', data: { policy: 'ask' } },
        { type: 'assistant/message', data: {} },
        { type: 'sandbox/mode', data: { mode: 'workspace-write' } },
        { type: 'approval/policy', data: { policy: 'never' } },
      ],
    };
    expect(adapter.readPermissionKnobs(session)).toEqual({ sandbox: 'workspace-write', approval: 'never' });
  });

  it('readPermissionKnobs：仅一类事件 → 另一侧为空串；无事件 → undefined', () => {
    const adapter = createHostAdapter(makeCtx({}));
    const onlySandbox = { snapshotEvents: () => [{ type: 'sandbox/mode', data: { mode: 'read-only' } }] };
    expect(adapter.readPermissionKnobs(onlySandbox)).toEqual({ sandbox: 'read-only', approval: '' });

    expect(adapter.readPermissionKnobs({ snapshotEvents: () => [] })).toBeUndefined();
    expect(adapter.readPermissionKnobs({})).toBeUndefined();
  });

  // ── sessionTitle ──

  it('sessionTitle：经只读句柄前缀读取，折叠最后一条 session/title', async () => {
    const events = [
      { type: 'user/message', data: { content: [{ type: 'text', text: '帮我写个脚本' }] } },
      { type: 'session/title', data: { title: '旧标题' } },
      { type: 'session/title', data: { title: '脚本助手' } },
    ];
    const open = vi.fn().mockResolvedValue({
      read: vi.fn().mockResolvedValue({ events }),
      close: vi.fn().mockResolvedValue(undefined),
    });
    const adapter = createHostAdapter(makeCtx({ sessionPersistence: { stat: async () => undefined, open } }));

    await expect(adapter.sessionTitle('session-1')).resolves.toBe('脚本助手');
    expect(open).toHaveBeenCalledWith('session-1', 'read');
  });

  it('sessionTitle：无标题事件时回退首条用户消息文本（空白折叠）', async () => {
    const events = [
      { type: 'turn/start' },
      { type: 'user/message', data: { content: [{ type: 'text', text: '  优化 ' }, { type: 'text', text: '登录页\n样式' }] } },
    ];
    const open = vi.fn().mockResolvedValue({
      read: vi.fn().mockResolvedValue({ events }),
      close: vi.fn().mockResolvedValue(undefined),
    });
    const adapter = createHostAdapter(makeCtx({ sessionPersistence: { stat: async () => undefined, open } }));

    await expect(adapter.sessionTitle('session-1')).resolves.toBe('优化 登录页 样式');
  });

  it('sessionTitle：open 失败 / 无 open 能力 / 空事件 均返回 undefined（不抛）', async () => {
    const failing = createHostAdapter(makeCtx({
      sessionPersistence: { stat: async () => undefined, open: async () => { throw new Error('writer-held'); } },
    }));
    await expect(failing.sessionTitle('session-1')).resolves.toBeUndefined();

    const noOpen = createHostAdapter(makeCtx({ sessionPersistence: { stat: async () => undefined } }));
    await expect(noOpen.sessionTitle('session-1')).resolves.toBeUndefined();

    const empty = createHostAdapter(makeCtx({
      sessionPersistence: { stat: async () => undefined, open: async () => ({ read: async () => ({ events: [] }), close: async () => {} }) },
    }));
    await expect(empty.sessionTitle('session-1')).resolves.toBeUndefined();
  });

  it('sessionTitle：read 读取的前缀事件数受 TITLE_SCAN_EVENT_CAP 约束', async () => {
    const read = vi.fn().mockResolvedValue({ events: [] });
    const adapter = createHostAdapter(makeCtx({
      sessionPersistence: { stat: async () => undefined, open: async () => ({ read, close: async () => {} }) },
    }));
    await adapter.sessionTitle('session-1');
    expect(read).toHaveBeenCalledWith(0, TITLE_SCAN_EVENT_CAP);
  });

  // ── sessionDigest ──

  it('sessionDigest：全量读取（无长度上限），一次返回标题 + 尾部摘要 + 总数', async () => {
    const events = [
      { type: 'user/message', data: { content: [{ type: 'text', text: '首条' }] } },
      { type: 'session/title', data: { title: '标题A' } },
      { type: 'user/message', data: { content: [{ type: 'text', text: '第二问' }] } },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '第二答' }] } } },
    ];
    const read = vi.fn().mockResolvedValue({ events });
    const open = vi.fn().mockResolvedValue({ read, close: vi.fn().mockResolvedValue(undefined) });
    const adapter = createHostAdapter(makeCtx({ sessionPersistence: { stat: async () => undefined, open } }));

    await expect(adapter.sessionDigest('session-1')).resolves.toEqual({
      title: '标题A',
      recent: [
        { role: 'user', text: '首条' },
        { role: 'user', text: '第二问' },
        { role: 'assistant', text: '第二答' },
      ],
      totalMessages: 3,
    });
    expect(read).toHaveBeenCalledWith(0); // 无长度上限
    expect(open).toHaveBeenCalledWith('session-1', 'read');
  });

  it('sessionDigest：open 失败 / 无 open 能力 / 空日志 均返回 undefined（不抛）', async () => {
    const failing = createHostAdapter(makeCtx({
      sessionPersistence: { stat: async () => undefined, open: async () => { throw new Error('writer-held'); } },
    }));
    await expect(failing.sessionDigest('session-1')).resolves.toBeUndefined();

    const noOpen = createHostAdapter(makeCtx({ sessionPersistence: { stat: async () => undefined } }));
    await expect(noOpen.sessionDigest('session-1')).resolves.toBeUndefined();

    const empty = createHostAdapter(makeCtx({
      sessionPersistence: { stat: async () => undefined, open: async () => ({ read: async () => ({ events: [] }), close: async () => {} }) },
    }));
    const digest = await empty.sessionDigest('session-1');
    expect(digest).toEqual({ title: undefined, recent: [], totalMessages: 0 });
  });

  // ── applyPermissionKnobs ──

  it('applyPermissionKnobs：策略模块不可解析返回 false（fail-soft）', async () => {
    vi.doMock('@deepseek-ai/dsh-sandbox-policy', () => { throw new Error('module unavailable'); });
    _resetAdapterCache();
    const adapter = createHostAdapter(makeCtx({ sandboxPolicy: {}, approval: {} }));
    const session = { append: vi.fn() };
    await expect(adapter.applyPermissionKnobs(session, { sandbox: 'read-only', approval: 'ask' })).resolves.toBe(false);
  });

  it('applyPermissionKnobs：无 append 的会话返回 false（warn 不抛，不触模块导入）', async () => {
    const logger = makeLogger();
    const adapter = createHostAdapter(makeCtx({}), logger);
    await expect(adapter.applyPermissionKnobs({}, { sandbox: 'read-only', approval: 'ask' })).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });
});
