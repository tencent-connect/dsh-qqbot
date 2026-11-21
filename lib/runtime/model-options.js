function safeGet(ctx, name) {
    try {
        return ctx.get?.(name);
    }
    catch {
        return undefined;
    }
}
function llmService(ctx) {
    const llm = safeGet(ctx, 'llm');
    return llm && typeof llm.listProviders === 'function' && typeof llm.listModels === 'function' ? llm : undefined;
}
function presetsService(ctx) {
    const presets = safeGet(ctx, 'agentPresets');
    return presets && typeof presets.list === 'function' ? presets : undefined;
}
/** 归一化 listProviders 的两种历史返回形态（string[] / {id,name}[]） */
function normalizeProviders(raw) {
    return raw.map((entry) => (typeof entry === 'string' ? { id: entry, name: entry } : entry));
}
export function createModelOptionsProvider(ctx, logger) {
    return {
        providers() {
            const llm = llmService(ctx);
            if (llm === undefined)
                return [];
            try {
                return normalizeProviders(llm.listProviders());
            }
            catch (err) {
                logger?.warn(`model options: listProviders failed: ${err instanceof Error ? err.message : String(err)}`);
                return [];
            }
        },
        async presets() {
            const presets = presetsService(ctx);
            if (presets === undefined)
                return [];
            try {
                return (await presets.list()).map(entry => ({
                    id: entry.id,
                    name: entry.name ?? entry.id,
                    ...(entry.description === undefined ? {} : { description: entry.description }),
                    ...(entry.broken === undefined ? {} : { broken: entry.broken }),
                }));
            }
            catch (err) {
                logger?.warn(`model options: preset list failed: ${err instanceof Error ? err.message : String(err)}`);
                return [];
            }
        },
        async models(provider) {
            const llm = llmService(ctx);
            if (llm === undefined || provider.trim() === '')
                return [];
            try {
                return (await llm.listModels(provider)).map(entry => ({
                    id: entry.id,
                    name: entry.name ?? entry.id,
                    ...(entry.description === undefined ? {} : { description: entry.description }),
                }));
            }
            catch (err) {
                logger?.warn(`model options: listModels(${provider}) failed: ${err instanceof Error ? err.message : String(err)}`);
                return [];
            }
        },
    };
}
//# sourceMappingURL=model-options.js.map