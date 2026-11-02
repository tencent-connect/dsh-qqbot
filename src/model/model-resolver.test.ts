import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema } from '../config.ts';
import type { ModelRoute } from './types.ts';
import { ModelResolver } from './model-resolver.ts';

vi.mock('./prefs-store.ts', () => ({
  PrefsStore: class {
    private values = new Map<string, ModelRoute>();
    getOverride(key: string) { return this.values.get(key); }
    setOverride(key: string, route: ModelRoute) { this.values.set(key, route); }
    clearOverride(key: string) { this.values.delete(key); }
    hasOverride(key: string) { return this.values.has(key); }
  },
}));

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'qq-model-resolver-'));
  vi.stubEnv('DSH_HOME', home);
  writeFileSync(join(home, 'settings.yaml'), 'agent-default-model:\n  provider: stale\n  model: old\nllm-pi-ai:\n  providers:\n    stale:\n      models:\n        - id: old\n');
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

function context(services: Record<string, unknown>): Context {
  return { get: (name: string) => services[name] } as unknown as Context;
}

function registry() {
  return {
    listProviders: vi.fn(() => [{ id: 'live', name: 'Live' }]),
    listModels: vi.fn(async (_provider: string) => [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }]),
    resolveModelInfo: vi.fn(async (_provider: string, _model: string) => ({})),
    resolveCallConfig: vi.fn(async (_route: ModelRoute) => ({})),
  };
}

describe('live model defaults and catalogs', () => {
  it('inherits the current Host effort for default and reset without carrying it to another explicit route', () => {
    let hostRoute: ModelRoute = { provider: 'live', model: 'one', reasoningEffort: ReasoningEffortId('high') };
    const config = ConfigSchema({});
    const resolver = new ModelResolver(context({ agentDefaultModel: { currentSelection: () => hostRoute } }), config);
    expect(resolver.resolveDefault()).toEqual(hostRoute);
    expect(resolver.getResumeRoute('private-a')).toEqual(hostRoute);

    resolver.setOverride('private-a', { provider: 'phone', model: 'chosen' });
    expect(resolver.getEffectiveRoute('private-a')).toEqual({ provider: 'phone', model: 'chosen' });
    resolver.clearOverride('private-a');
    expect(resolver.getEffectiveRoute('private-a')).toEqual(hostRoute);
    hostRoute = { ...hostRoute, reasoningEffort: ReasoningEffortId('low') };
    expect(resolver.getResumeRoute('private-a')).toEqual(hostRoute);

    config.provider = 'live';
    config.model = 'two';
    expect(resolver.resolveDefault()).toEqual({ provider: 'live', model: 'two' });
  });

  it('keeps peer overrides above QQ defaults, then follows the current Host default after clearing', () => {
    let hostRoute = { provider: 'live', model: 'one' };
    const config = ConfigSchema({ provider: 'web', model: 'default' });
    const resolver = new ModelResolver(context({ agentDefaultModel: { currentSelection: () => hostRoute } }), config);
    resolver.setOverride('private-a', { provider: 'phone', model: 'chosen' });

    expect(resolver.getEffectiveRoute('private-a')).toEqual({ provider: 'phone', model: 'chosen' });
    expect(resolver.getEffectiveRoute('private-b')).toEqual({ provider: 'web', model: 'default' });
    resolver.clearOverride('private-a');
    expect(resolver.getResumeRoute('private-a')).toEqual({ provider: 'web', model: 'default' });
    config.provider = '';
    config.model = '';
    expect(resolver.resolveDefault()).toEqual(hostRoute);
    hostRoute = { provider: 'new-live', model: 'updated' };
    expect(resolver.getEffectiveRoute('private-a')).toEqual(hostRoute);
    expect(resolver.getOverride('private-a')).toBeUndefined();
  });

  it('uses a legacy settings file only when the Host default service is absent', () => {
    const resolver = new ModelResolver(context({}), ConfigSchema({}));
    expect(resolver.resolveDefault()).toEqual({ provider: 'stale', model: 'old' });
    writeFileSync(join(home, 'settings.yaml'), 'agent-default-model:\n  provider: isolated\n  model: updated\n');
    expect(resolver.resolveDefault()).toEqual({ provider: 'isolated', model: 'updated' });
  });

  it('does not hide a broken or missing live default behind the old settings file', () => {
    const unavailable = new ModelResolver(context({ agentDefaultModel: { currentSelection: () => { throw new Error('live default unavailable'); } } }), ConfigSchema({}));
    expect(() => unavailable.resolveDefault()).toThrow('live default unavailable');
    const empty = new ModelResolver(context({ agentDefaultModel: { currentSelection: () => ({}) } }), ConfigSchema({}));
    expect(() => empty.resolveDefault()).toThrow('尚未配置默认模型');
  });

  it('does not invent a provider/model when no default was configured', () => {
    writeFileSync(join(home, 'settings.yaml'), '{}');
    expect(() => new ModelResolver(context({}), ConfigSchema({})).resolveDefault()).toThrow('未配置默认模型');
  });

  it('validates the exact advertised pair and resolved call configuration before accepting a selection', async () => {
    const llm = registry();
    const resolver = new ModelResolver(context({ llm }), ConfigSchema({}));
    await resolver.validateRoute({ provider: 'live', model: 'two' });
    expect(llm.resolveModelInfo).toHaveBeenCalledWith('live', 'two');
    expect(llm.resolveCallConfig).toHaveBeenCalledWith({ provider: 'live', model: 'two' });
    await expect(resolver.validateRoute({ provider: 'missing', model: 'two' })).rejects.toThrow('未知模型提供方');
    await expect(resolver.validateRoute({ provider: 'live', model: 'missing' })).rejects.toThrow('模型不可用');
    expect(resolver.getOverride('private-a')).toBeUndefined();
    expect(llm.resolveCallConfig).toHaveBeenCalledTimes(1);
  });

  it('validates an inherited effort with the exact target model before accepting it', async () => {
    const llm = registry();
    const route: ModelRoute = { provider: 'live', model: 'one', reasoningEffort: ReasoningEffortId('high') };
    const resolver = new ModelResolver(context({ llm, agentDefaultModel: { currentSelection: () => route } }), ConfigSchema({}));
    await resolver.validateRoute(resolver.resolveDefault());
    expect(llm.resolveCallConfig).toHaveBeenCalledWith(route);
    llm.resolveCallConfig.mockRejectedValueOnce(new Error('unsupported reasoning effort'));
    await expect(resolver.validateRoute(route)).rejects.toThrow('unsupported reasoning effort');
    expect(resolver.getOverride('private-a')).toBeUndefined();
  });

  it('matches native effort selection for the same model and a different target model', async () => {
    const llm = registry();
    const medium = ReasoningEffortId('medium');
    llm.resolveModelInfo.mockResolvedValue({ reasoning: { defaultEffort: medium } });
    const resolver = new ModelResolver(context({ llm }), ConfigSchema({}));
    const current: ModelRoute = { provider: 'live', model: 'one', reasoningEffort: ReasoningEffortId('high') };

    expect(await resolver.validateRoute({ provider: 'live', model: 'one' })).toEqual({
      provider: 'live', model: 'one', reasoningEffort: medium,
    });
    expect(await resolver.validateRoute({ provider: 'live', model: 'one' }, current)).toEqual(current);
    expect(await resolver.validateRoute({ provider: 'live', model: 'one' }, { ...current, provider: 'other' })).toEqual({
      provider: 'live', model: 'one', reasoningEffort: medium,
    });
    expect(await resolver.validateRoute({ provider: 'live', model: 'two' }, current)).toEqual({
      provider: 'live', model: 'two', reasoningEffort: medium,
    });
    const explicit: ModelRoute = { provider: 'live', model: 'two', reasoningEffort: ReasoningEffortId('low') };
    expect(await resolver.validateRoute(explicit, current)).toEqual(explicit);

    llm.resolveModelInfo.mockResolvedValueOnce({});
    const plain = { provider: 'live', model: 'two' };
    expect(await resolver.validateRoute(plain, current)).toEqual(plain);
    expect(llm.resolveCallConfig).toHaveBeenLastCalledWith(plain);
  });

  it('rejects directory and call-config failures without using a stale model', async () => {
    const llm = registry();
    const resolver = new ModelResolver(context({ llm }), ConfigSchema({}));
    llm.listModels.mockRejectedValueOnce(new Error('catalog offline'));
    await expect(resolver.validateRoute({ provider: 'live', model: 'one' })).rejects.toThrow('catalog offline');
    llm.resolveCallConfig.mockRejectedValueOnce(new Error('route unavailable'));
    await expect(resolver.validateRoute({ provider: 'live', model: 'one' })).rejects.toThrow('route unavailable');
  });

  it('projects the same healthy provider groups as the Web catalog', async () => {
    const llm = registry();
    llm.listProviders.mockReturnValue([{ id: 'broken', name: 'Broken' }, { id: 'live', name: 'Live' }]);
    llm.resolveModelInfo.mockImplementation(async (provider, model) => {
      if (provider === 'broken' && model === 'two') throw new Error('broken model metadata');
      return {};
    });
    const resolver = new ModelResolver(context({ llm }), ConfigSchema({}));
    expect(await resolver.listModels()).toEqual([
      { provider: 'live', id: 'one', name: 'One' },
      { provider: 'live', id: 'two', name: 'Two' },
    ]);
  });

  it('keeps a live empty/failed catalog empty instead of returning a stale static model', async () => {
    const llm = registry();
    const resolver = new ModelResolver(context({ llm }), ConfigSchema({}));
    llm.listModels.mockResolvedValueOnce([]);
    expect(await resolver.listModels()).toEqual([]);
    llm.listModels.mockRejectedValueOnce(new Error('provider offline'));
    expect(await resolver.listModels()).toEqual([]);
    llm.listProviders.mockReturnValue([]);
    expect(resolver.listProviders()).toEqual([]);
    expect(await resolver.listModels()).toEqual([]);
  });

  it('propagates a registry-wide failure instead of reading another Host file', async () => {
    const llm = registry();
    llm.listProviders.mockImplementation(() => { throw new Error('registry unavailable'); });
    const resolver = new ModelResolver(context({ llm }), ConfigSchema({}));
    await expect(resolver.listModels()).rejects.toThrow('registry unavailable');
    expect(() => resolver.listProviders()).toThrow('registry unavailable');
  });

  it('can discover and validate a static model only for a Host without an LLM service', async () => {
    const resolver = new ModelResolver(context({}), ConfigSchema({}));
    expect(await resolver.listModels()).toEqual([{ provider: 'stale', id: 'old', name: undefined }]);
    await expect(resolver.validateRoute({ provider: 'stale', model: 'old' })).resolves.toEqual({ provider: 'stale', model: 'old' });
    await expect(resolver.validateRoute({ provider: 'other', model: 'old' })).rejects.toThrow('模型不可用');
  });
});
