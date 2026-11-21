/**
 * 设置页的模型/预设候选来源 — 聚合宿主 `llm` 与 `agentPresets` 服务。
 *
 * 全部 fail-soft：服务未注入（headless 等）或读取失败时返回空列表，
 * 设置页据此降级为纯文本输入，不影响保存。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Logger } from '../types.ts';

/** 一个可选项（provider / model / preset 共用形态） */
export interface ModelOptionItem {
  id: string;
  name: string;
  description?: string;
  /** preset 不可加载时的原因（设置页置灰展示） */
  broken?: string;
}

/** 设置页候选数据源 */
export interface ModelOptionsProvider {
  providers(): ModelOptionItem[];
  presets(): Promise<ModelOptionItem[]>;
  models(provider: string): Promise<ModelOptionItem[]>;
}

/** 宿主 llm 服务的最小接口（listProviders 同步，listModels 异步） */
interface LlmServiceLike {
  listProviders(): Array<{ id: string; name: string } | string>;
  listModels(provider: string): Promise<readonly { id: string; name?: string; description?: string }[]>;
}

/** 宿主 agentPresets 服务的最小接口 */
interface PresetsServiceLike {
  list(): Promise<Array<{ id: string; name?: string; description?: string; broken?: string }>>;
}

function safeGet(ctx: Context, name: string): unknown {
  try {
    return (ctx as unknown as { get?: (key: string) => unknown }).get?.(name);
  } catch {
    return undefined;
  }
}

function llmService(ctx: Context): LlmServiceLike | undefined {
  const llm = safeGet(ctx, 'llm') as LlmServiceLike | undefined;
  return llm && typeof llm.listProviders === 'function' && typeof llm.listModels === 'function' ? llm : undefined;
}

function presetsService(ctx: Context): PresetsServiceLike | undefined {
  const presets = safeGet(ctx, 'agentPresets') as PresetsServiceLike | undefined;
  return presets && typeof presets.list === 'function' ? presets : undefined;
}

/** 归一化 listProviders 的两种历史返回形态（string[] / {id,name}[]） */
function normalizeProviders(raw: Array<{ id: string; name: string } | string>): ModelOptionItem[] {
  return raw.map((entry) => (typeof entry === 'string' ? { id: entry, name: entry } : entry));
}

export function createModelOptionsProvider(ctx: Context, logger?: Logger): ModelOptionsProvider {
  return {
    providers() {
      const llm = llmService(ctx);
      if (llm === undefined) return [];
      try {
        return normalizeProviders(llm.listProviders());
      } catch (err) {
        logger?.warn(`model options: listProviders failed: ${err instanceof Error ? err.message : String(err)}`);
        return [];
      }
    },

    async presets() {
      const presets = presetsService(ctx);
      if (presets === undefined) return [];
      try {
        return (await presets.list()).map(entry => ({
          id: entry.id,
          name: entry.name ?? entry.id,
          ...(entry.description === undefined ? {} : { description: entry.description }),
          ...(entry.broken === undefined ? {} : { broken: entry.broken }),
        }));
      } catch (err) {
        logger?.warn(`model options: preset list failed: ${err instanceof Error ? err.message : String(err)}`);
        return [];
      }
    },

    async models(provider) {
      const llm = llmService(ctx);
      if (llm === undefined || provider.trim() === '') return [];
      try {
        return (await llm.listModels(provider)).map(entry => ({
          id: entry.id,
          name: entry.name ?? entry.id,
          ...(entry.description === undefined ? {} : { description: entry.description }),
        }));
      } catch (err) {
        logger?.warn(`model options: listModels(${provider}) failed: ${err instanceof Error ? err.message : String(err)}`);
        return [];
      }
    },
  };
}
