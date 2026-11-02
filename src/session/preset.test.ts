import type { Context } from '@deepseek-ai/cordis';
import { describe, expect, it, vi } from 'vitest';
import { ConfigSchema } from '../config.ts';
import type { Logger, ReplyTarget } from '../types.ts';
import { SessionManager } from './session-manager.ts';
import type { AgentPresetsLike, DshAgent, DshAgentRegistry } from './types.ts';

// Keep lifecycle tests in memory: no preference files or workspace directories.
vi.mock('../model/model-resolver.ts', () => ({
  ModelResolver: class {
    getPreset() { return undefined; }
    getSessionId() { return undefined; }
    getEffectiveRoute() { return undefined; }
    getResumeRoute() { return undefined; }
    setSessionId() {}
  },
}));
vi.mock('node:fs', () => ({ mkdirSync: vi.fn() }));

function makePresets() {
  return {
    defaultId: 'standard',
    resolve: vi.fn<AgentPresetsLike['resolve']>(async (id) => ({ id: id ?? 'standard' })),
    mount: vi.fn<AgentPresetsLike['mount']>(async () => undefined),
    list: vi.fn<AgentPresetsLike['list']>(async () => []),
  } satisfies AgentPresetsLike;
}

function makeHarness(preset: string | undefined, presets?: AgentPresetsLike) {
  // Cordis is the external boundary; only service lookup and hook registration are used here.
  const ctx = {
    get(name: string) { return name === 'agentPresets' ? presets : name === 'sessionController' ? { resolveAgent: async () => ({ error: Object.assign(new Error('not found'), { code: 'session/not-found' }) }) } : undefined; },
    on: vi.fn(),
  } as unknown as Context;
  const agent: DshAgent = {
    id: 'test-agent',
    ctx,
    status: 'idle',
    session: { id: 'test-session', snapshotEvents: () => [] },
    cancel: vi.fn(),
    followup: vi.fn(),
    whenIdle: async () => {},
    runMaintenance: async (task) => task(new AbortController().signal),
  };
  const handle = { agent, dispose: vi.fn(async () => {}) };
  const agents = {
    get: vi.fn<DshAgentRegistry['get']>(() => undefined),
    resume: vi.fn<DshAgentRegistry['resume']>(async () => { throw new Error('session not found'); }),
    create: vi.fn<DshAgentRegistry['create']>(async (options) => {
      await options.setup?.(ctx);
      return handle;
    }),
  } satisfies DshAgentRegistry;
  const logger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const config = ConfigSchema({ appId: 'test-app', preset, sessionIdleTimeout: 0 });
  const manager = new SessionManager(ctx, agents, config, logger);
  const target: ReplyTarget = { scope: 'c2c', targetId: 'test-peer' };
  return { manager, agents, ctx, create: () => manager.getOrCreate('c2c', 'test-peer', 'test-peer', target) };
}

describe('SessionManager preset composition', () => {
  it.each([undefined, '', ' \t '])('composes the host default for preset %j', async (preset) => {
    const presets = makePresets();
    const { create, agents, ctx } = makeHarness(preset, presets);

    const record = await create();

    expect(presets.resolve).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(presets.mount).toHaveBeenCalledExactlyOnceWith(ctx, 'standard');
    expect(agents.create).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({ agentPreset: 'standard' }),
      setup: expect.any(Function),
    }));
    expect(record.agentPreset).toBe('standard');
  });

  it('trims and mounts an explicit valid preset', async () => {
    const presets = makePresets();
    const { create, agents, ctx } = makeHarness(' coding ', presets);

    const record = await create();

    expect(presets.resolve).toHaveBeenCalledExactlyOnceWith('coding');
    expect(presets.mount).toHaveBeenCalledExactlyOnceWith(ctx, 'coding');
    expect(agents.create).toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({ agentPreset: 'coding' }),
    }));
    expect(record.agentPreset).toBe('coding');
  });

  it('stops before resume/create when the requested preset is unknown', async () => {
    const presets = makePresets();
    presets.resolve.mockRejectedValue(new Error('Unknown agent preset: missing'));
    const { create, agents, manager } = makeHarness('missing', presets);

    await expect(create()).rejects.toThrow('preset missing unavailable: Unknown agent preset: missing');

    expect(agents.resume).not.toHaveBeenCalled();
    expect(agents.create).not.toHaveBeenCalled();
    expect(presets.mount).not.toHaveBeenCalled();
    expect(manager.size).toBe(0);
  });

  it.each([undefined, 'broken'])('rejects a broken preset %j before creating a bare session', async (preset) => {
    const presets = makePresets();
    presets.resolve.mockResolvedValue({ id: preset ?? 'standard', broken: 'tool plugin failed to activate' });
    const { create, agents, manager } = makeHarness(preset, presets);

    await expect(create()).rejects.toThrow(`preset ${preset ?? 'standard'} is broken: tool plugin failed to activate`);

    expect(agents.resume).not.toHaveBeenCalled();
    expect(agents.create).not.toHaveBeenCalled();
    expect(presets.mount).not.toHaveBeenCalled();
    expect(manager.size).toBe(0);
  });

  it('rejects an explicit preset if the host has no preset service', async () => {
    const { create, agents } = makeHarness('coding');

    await expect(create()).rejects.toThrow('preset coding requires the agentPresets service');

    expect(agents.resume).not.toHaveBeenCalled();
    expect(agents.create).not.toHaveBeenCalled();
  });

  it.each([undefined, '', ' \t '])('allows a host without presets when preset is %j', async (preset) => {
    const { create, agents } = makeHarness(preset);

    const record = await create();
    const options = agents.create.mock.calls[0]?.[0];

    expect(options).toBeDefined();
    expect(options?.setup).toBeUndefined();
    expect(options?.meta?.agentPreset).toBeUndefined();
    expect(record.agentPreset).toBeUndefined();
  });
});
