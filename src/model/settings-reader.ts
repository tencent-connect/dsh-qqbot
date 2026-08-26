/**
 * SettingsReader — settings.yaml 只读解析
 *
 * 从 ~/.dsh/settings.yaml 中读取模型配置信息。
 * 只读，不修改 settings.yaml。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import yaml from 'js-yaml';
import type { ModelRoute, ModelEntry } from './types.ts';

/** settings.yaml 中的 provider 配置结构 */
interface SettingsProviderConfig {
  models?: Array<{ id?: string; name?: string }>;
  [key: string]: unknown;
}

/** settings.yaml 的 llm-pi-ai 段结构 */
interface LlmPiAiSettings {
  providers?: Record<string, SettingsProviderConfig>;
}

export class SettingsReader {
  /** settings.yaml 缓存 */
  private settingsCache: Record<string, unknown> | null | undefined;

  /**
   * 从 settings.yaml 的 agent-default-model 字段读取默认模型路由
   */
  readDefaultRoute(): ModelRoute | undefined {
    const settings = this.loadSettings();
    if (!settings) return undefined;

    const defaultModel = settings['agent-default-model'] as
      | { provider?: string; model?: string }
      | undefined;

    if (defaultModel?.provider && defaultModel?.model) {
      return { provider: defaultModel.provider, model: defaultModel.model };
    }
    return undefined;
  }

  /**
   * 列出 settings.yaml 中配置的所有模型
   */
  readModels(): ModelEntry[] {
    const settings = this.loadSettings();
    if (!settings) return [];

    const models: ModelEntry[] = [];
    const llmPiAi = settings['llm-pi-ai'] as LlmPiAiSettings | undefined;

    if (llmPiAi?.providers) {
      for (const [providerName, providerConfig] of Object.entries(llmPiAi.providers)) {
        if (Array.isArray(providerConfig?.models)) {
          for (const m of providerConfig.models) {
            if (m.id) {
              models.push({ provider: providerName, id: m.id, name: m.name || undefined });
            }
          }
        }
      }
    }

    return models;
  }

  /**
   * 列出 settings.yaml 中配置的 provider 名称
   */
  readProviders(): string[] {
    const settings = this.loadSettings();
    const llmPiAi = settings?.['llm-pi-ai'] as LlmPiAiSettings | undefined;
    return llmPiAi?.providers ? Object.keys(llmPiAi.providers) : [];
  }

  private loadSettings(): Record<string, unknown> | null {
    if (this.settingsCache !== undefined) return this.settingsCache;

    try {
      const settingsPath = resolve(homedir(), '.dsh', 'settings.yaml');
      if (!existsSync(settingsPath)) {
        this.settingsCache = null;
        return null;
      }
      const content = readFileSync(settingsPath, 'utf8');
      this.settingsCache = yaml.load(content) as Record<string, unknown> | null;
      return this.settingsCache;
    } catch {
      this.settingsCache = null;
      return null;
    }
  }
}
