import { describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { createModelOptionsProvider } from './model-options.ts';

function ctxWith(services: Record<string, unknown>): Context {
  return { get: (name: string) => services[name] } as unknown as Context;
}

describe('createModelOptionsProvider', () => {
  it('归一化 listProviders 的两种历史形态（string[] / {id,name}[]）', () => {
    const provider = createModelOptionsProvider(ctxWith({
      llm: {
        listProviders: () => ['plain', { id: 'named', name: 'Named' }],
        listModels: async () => [],
      },
    }));
    expect(provider.providers()).toEqual([
      { id: 'plain', name: 'plain' },
      { id: 'named', name: 'Named' },
    ]);
  });

  it('透传 preset 的 broken 标记（设置页据此置灰）', async () => {
    const provider = createModelOptionsProvider(ctxWith({
      agentPresets: {
        list: async () => [
          { id: 'base', name: 'Base', description: '默认' },
          { id: 'broken-one', broken: '工具不可用' },
        ],
      },
    }));
    expect(await provider.presets()).toEqual([
      { id: 'base', name: 'Base', description: '默认' },
      { id: 'broken-one', name: 'broken-one', broken: '工具不可用' },
    ]);
  });

  it('服务缺失或读取失败时 fail-soft 返回空列表', async () => {
    const provider = createModelOptionsProvider(ctxWith({
      llm: {
        listProviders: () => { throw new Error('boom'); },
        listModels: async () => { throw new Error('boom'); },
      },
      agentPresets: { list: async () => { throw new Error('boom'); } },
    }));
    expect(provider.providers()).toEqual([]);
    expect(await provider.presets()).toEqual([]);
    expect(await provider.models('any')).toEqual([]);

    const empty = createModelOptionsProvider(ctxWith({}));
    expect(empty.providers()).toEqual([]);
    expect(await empty.presets()).toEqual([]);
    expect(await empty.models('any')).toEqual([]);
  });

  it('提供方为空时不请求 listModels', async () => {
    const listModels = vi.fn(async () => []);
    const provider = createModelOptionsProvider(ctxWith({ llm: { listProviders: () => [], listModels } }));
    expect(await provider.models('   ')).toEqual([]);
    expect(listModels).not.toHaveBeenCalled();
  });

  it('模型条目保留 id / name 与可选的 description', async () => {
    const provider = createModelOptionsProvider(ctxWith({
      llm: {
        listProviders: () => [],
        listModels: async () => [{ id: 'm1', name: 'M1', description: 'fast' }, { id: 'm2' }],
      },
    }));
    expect(await provider.models('p')).toEqual([
      { id: 'm1', name: 'M1', description: 'fast' },
      { id: 'm2', name: 'm2' },
    ]);
  });
});
