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

  it('uses the current Agent scoped service before a legacy or global service', async () => {
    const scoped = { compactNow: vi.fn() };
    const legacy = { compactNow: vi.fn() };
    const adapter = createHostAdapter(makeCtx({ compaction: legacy, agentPresets: { serviceFor: () => legacy } }));
    expect(await adapter.serviceFor({ ctx: makeCtx({ compaction: scoped }) }, 'compaction')).toBe(scoped);
  });

  it('supports modern preset compaction without a root preset registry resolver', async () => {
    const compaction = { compactNow: vi.fn() };
    const adapter = createHostAdapter(makeCtx({}));
    expect(await adapter.serviceFor({ ctx: makeCtx({ compaction }) }, 'compaction')).toBe(compaction);
    expect(adapter.capabilities).toContain('serviceFor(Agent作用域)');
  });

  it('serviceFor：无宿主解析能力时返回 undefined（不再依赖已移除的模块回退）', async () => {
    const adapter = createHostAdapter(makeCtx({}));
    expect(await adapter.serviceFor({ ctx: {} }, 'compaction')).toBeUndefined();
  });

  it('keeps a missing service scoped to the current preset', async () => {
    const adapter = createHostAdapter(makeCtx({ agentPresets: { serviceFor: () => undefined } }));
    expect(await adapter.serviceFor({ ctx: {} }, 'compaction')).toBeUndefined();
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

  it('uses the public controller Agent shared with the native Session page', async () => {
    const agent = { id: 'session-shared' };
    const resolveAgent = vi.fn(async () => ({ agent }));
    const adapter = createHostAdapter(makeCtx({ sessionController: { resolveAgent } }));
    expect(await adapter.resolveAgent('session-shared')).toBe(agent);
    expect(resolveAgent).toHaveBeenCalledExactlyOnceWith('session-shared');
  });

  it('allows new Session creation only for the native not-found result', async () => {
    const error = Object.assign(new Error('missing'), { code: 'session/not-found' });
    const adapter = createHostAdapter(makeCtx({ sessionController: { resolveAgent: async () => ({ error }) } }));
    expect(await adapter.resolveAgent('session-missing')).toBeUndefined();
  });

  it.each(['session/writer-held', 'gateway/internal'])('preserves native %s failures instead of creating a replacement', async code => {
    const error = Object.assign(new Error('native resolution failed'), { code });
    const adapter = createHostAdapter(makeCtx({ sessionController: { resolveAgent: async () => ({ error }) } }));
    await expect(adapter.resolveAgent('session-stored')).rejects.toBe(error);
  });

  it('fails without a public controller instead of resuming through a second registry path', async () => {
    const adapter = createHostAdapter(makeCtx({}));
    await expect(adapter.resolveAgent('session-stored')).rejects.toThrow('原生会话恢复接口');
  });

});
