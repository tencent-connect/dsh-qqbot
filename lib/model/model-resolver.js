import { PrefsStore } from "./prefs-store.js";
import { SettingsReader } from "./settings-reader.js";
function selectionWithEffort(route, current, defaultEffort) {
    const sameRoute = current?.provider === route.provider && current.model === route.model;
    const reasoningEffort = route.reasoningEffort ?? (sameRoute ? current.reasoningEffort : undefined) ?? defaultEffort;
    return { ...route, ...reasoningEffort === undefined ? {} : { reasoningEffort } };
}
export class ModelResolver {
    prefs;
    settings;
    ctx;
    config;
    logger;
    constructor(ctx, config, logger) {
        this.ctx = ctx;
        this.config = config;
        this.logger = logger;
        this.prefs = new PrefsStore(config.debug ? (msg) => this.logger?.debug(msg) : undefined, { onError: (msg) => this.logger?.warn(`im-qqbot: ${msg}`) });
        this.settings = new SettingsReader();
    }
    /**
     * 获取指定 sessionKey 的有效模型路由（create 用）
     *
     * 优先级：per-peer 偏好 > QQ 配置 > 宿主实时默认。
     */
    getEffectiveRoute(sessionKey) {
        return this.prefs.getOverride(sessionKey) ?? this.resolveDefault();
    }
    /**
     * 获取 resume 时覆盖 session 的模型路由
     *
     * 优先级与 create 相同，不覆盖为其它 Host 的静态设置。
     *
     * 这里不返回 undefined，因为未装 installModelSelection，system-prompt 的
     * {{model}} 变量直接读 agent.options.model——若无值会抛
     * "prompt variable {{model}} has no value for this assembly"。
     * 因此兜底到默认链，确保 agent.options.model 始终有值。
     */
    getResumeRoute(sessionKey) {
        return this.getEffectiveRoute(sessionKey);
    }
    getOverride(sessionKey) {
        return this.prefs.getOverride(sessionKey);
    }
    /**
     * 设置 per-peer 模型偏好并持久化到隔离文件
     */
    setOverride(sessionKey, route) {
        this.prefs.setOverride(sessionKey, route);
    }
    /**
     * 清除 per-peer 模型偏好并持久化
     */
    clearOverride(sessionKey) {
        this.prefs.clearOverride(sessionKey);
    }
    /**
     * 是否存在指定 session 的模型偏好
     */
    hasOverride(sessionKey) {
        return this.prefs.hasOverride(sessionKey);
    }
    /**
     * 获取指定 sessionKey 的最新 sessionId（fork 后记录，重启恢复用）
     */
    getSessionId(sessionKey) {
        return this.prefs.getSessionId(sessionKey);
    }
    /**
     * 记录指定 sessionKey 的最新 sessionId（fork 后调用）并持久化
     */
    setSessionId(sessionKey, sessionId) {
        this.prefs.setSessionId(sessionKey, sessionId);
    }
    /**
     * 清除指定 sessionKey 的 sessionId 记录
     */
    clearSessionId(sessionKey) {
        this.prefs.clearSessionId(sessionKey);
    }
    /**
     * 获取指定 sessionKey 的 per-peer preset 覆盖
     */
    getPreset(sessionKey) {
        return this.prefs.getPreset(sessionKey);
    }
    /**
     * 设置 per-peer preset 覆盖并持久化
     */
    setPreset(sessionKey, presetId) {
        this.prefs.setPreset(sessionKey, presetId);
    }
    /**
     * 清除 per-peer preset 覆盖并持久化
     */
    clearPreset(sessionKey) {
        return this.prefs.clearPreset(sessionKey);
    }
    /**
     * 解析默认模型路由（不含 per-peer 偏好）
     *
     * 优先级：QQ 配置 > 宿主实时默认。旧版文件只在服务缺失时兜底。
     */
    resolveDefault() {
        if (this.config.provider && this.config.model) {
            return { provider: this.config.provider, model: this.config.model };
        }
        return this.resolveHostDefault();
    }
    resolveHostDefault() {
        const host = this.getService('agentDefaultModel');
        if (host !== undefined) {
            const selected = host.currentSelection();
            if (selected?.provider && selected.model)
                return { ...selected };
            throw new Error('DSH 尚未配置默认模型，请先在模型设置中选择模型。');
        }
        const fromSettings = this.settings.readDefaultRoute();
        if (fromSettings)
            return fromSettings;
        throw new Error('未配置默认模型，请先在 DSH 或 QQ 网页设置中选择模型。');
    }
    /** Validate a Web-advertised selection, retaining effort only for the same model. */
    async validateRoute(route, current) {
        const llm = this.getLlmService();
        if (llm === undefined) {
            if (this.settings.readModels().some((model) => model.provider === route.provider && model.id === route.model)) {
                return selectionWithEffort(route, current);
            }
            throw new Error(`模型不可用：${route.provider}/${route.model}，请使用 /model 查看可用模型。`);
        }
        const knownProvider = llm.listProviders().some((provider) => (typeof provider === 'string' ? provider : provider.id) === route.provider);
        if (!knownProvider)
            throw new Error(`未知模型提供方：${route.provider}`);
        const models = await llm.listModels(route.provider);
        if (!models.some((model) => model.id === route.model)) {
            throw new Error(`模型不可用：${route.provider}/${route.model}，请使用 /model 查看可用模型。`);
        }
        const info = await llm.resolveModelInfo?.(route.provider, route.model);
        const selected = selectionWithEffort(route, current, info?.reasoning?.defaultEffort);
        await llm.resolveCallConfig?.(selected);
        return selected;
    }
    /**
     * 列出所有可用模型
     *
     * 使用与网页相同的 live registry；服务缺失时才读取旧版静态配置。
     */
    async listModels() {
        const llm = this.getLlmService();
        if (!llm)
            return this.settings.readModels();
        const groups = await Promise.all(llm.listProviders().map(async (provider) => {
            const providerId = typeof provider === 'string' ? provider : provider.id;
            try {
                const models = await llm.listModels(providerId);
                return await Promise.all(models.map(async (model) => {
                    await llm.resolveModelInfo?.(providerId, model.id);
                    return { provider: providerId, id: model.id, name: model.name };
                }));
            }
            catch (err) {
                this.logger?.debug(`ModelResolver: provider ${providerId} 模型列表获取失败: ${err instanceof Error ? err.message : String(err)}`);
                return [];
            }
        }));
        return groups.flat();
    }
    /**
     * 列出可用 provider 名称
     */
    listProviders() {
        const llm = this.getLlmService();
        if (llm) {
            const providers = llm.listProviders();
            return providers.map((provider) => typeof provider === 'string' ? provider : provider.id);
        }
        return this.settings.readProviders();
    }
    // ── 私有方法 ──
    /** 统一的 Cordis 服务访问（可选获取：服务未注入时静默返回 undefined，避免 Proxy 抛错） */
    getService(name) {
        try {
            const ctxAny = this.ctx;
            return typeof ctxAny.get === 'function' ? ctxAny.get(name) : undefined;
        }
        catch {
            return undefined;
        }
    }
    /** 获取 ctx.llm 服务（最小接口收窄，不可用时返回 undefined） */
    getLlmService() {
        const llm = this.getService('llm');
        if (llm === undefined)
            return undefined;
        if (typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') {
            throw new Error('宿主模型目录服务不兼容，请检查 DSH 版本。');
        }
        return llm;
    }
}
//# sourceMappingURL=model-resolver.js.map