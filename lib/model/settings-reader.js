/**
 * SettingsReader — settings.yaml 只读解析
 *
 * 从当前 DSH_HOME 的 settings.yaml 中读取旧版模型配置信息。
 * 只读，不修改 settings.yaml。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import yaml from 'js-yaml';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
function record(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
export class SettingsReader {
    homeDir;
    constructor(homeDir) {
        this.homeDir = homeDir;
    }
    /**
     * 从 settings.yaml 的 agent-default-model 字段读取默认模型路由
     */
    readDefaultRoute() {
        const settings = this.loadSettings();
        if (!settings)
            return undefined;
        const defaultModel = record(settings['agent-default-model']);
        if (typeof defaultModel?.provider === 'string' && defaultModel.provider !== ''
            && typeof defaultModel.model === 'string' && defaultModel.model !== '') {
            return {
                provider: defaultModel.provider,
                model: defaultModel.model,
                ...typeof defaultModel.reasoningEffort === 'string' && defaultModel.reasoningEffort !== ''
                    ? { reasoningEffort: ReasoningEffortId(defaultModel.reasoningEffort) }
                    : {},
            };
        }
        return undefined;
    }
    /**
     * 列出 settings.yaml 中配置的所有模型
     */
    readModels() {
        const settings = this.loadSettings();
        if (!settings)
            return [];
        const models = [];
        const providers = record(record(settings['llm-pi-ai'])?.providers);
        if (providers) {
            for (const [providerName, providerConfig] of Object.entries(providers)) {
                const declared = record(providerConfig)?.models;
                if (Array.isArray(declared)) {
                    for (const entry of declared) {
                        const model = record(entry);
                        if (typeof model?.id === 'string' && model.id !== '') {
                            models.push({ provider: providerName, id: model.id, name: typeof model.name === 'string' ? model.name : undefined });
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
    readProviders() {
        const settings = this.loadSettings();
        const providers = record(record(settings?.['llm-pi-ai'])?.providers);
        return providers ? Object.keys(providers) : [];
    }
    loadSettings() {
        try {
            const home = this.homeDir ?? process.env.DSH_HOME ?? resolve(homedir(), '.dsh');
            const settingsPath = resolve(home, 'settings.yaml');
            if (!existsSync(settingsPath))
                return null;
            const content = readFileSync(settingsPath, 'utf8');
            const loaded = yaml.load(content);
            return record(loaded) ?? null;
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=settings-reader.js.map