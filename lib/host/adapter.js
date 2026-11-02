var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
/** 插件创建的工作区显示名；仅在该 cwd 尚无工作区时生效（幂等 create 不改既有 title） */
const WORKSPACE_TITLE = 'QQBot';
/**
 * 取出可用的持久化服务；形态不匹配返回 undefined。
 *
 * 宿主服务是版本漂移点，必须探测方法是否存在再调用：直接调用缺失的方法会抛
 * `TypeError`，与「后端故障」混在一起，让调用方误以为求证过了。
 */
function statCapablePersistence(ctx) {
    const persistence = safeGet(ctx, 'sessionPersistence');
    return typeof persistence?.stat === 'function' ? persistence : undefined;
}
/** 取出可用的 workspaceRegistry；形态不匹配返回 undefined（dsh-workspace 未挂载时无侧边栏） */
function workspaceRegistry(ctx) {
    const registry = safeGet(ctx, 'workspaceRegistry');
    return typeof registry?.create === 'function' ? registry : undefined;
}
/** 模块级函数的动态 import 结果缓存（spec 变量路径绕开本地依赖类型检查） */
const moduleCache = new Map();
async function importModule(spec, logger) {
    if (moduleCache.has(spec))
        return moduleCache.get(spec);
    let mod;
    try {
        mod = (await import(__rewriteRelativeImportExtension(spec)));
    }
    catch {
        mod = undefined;
        logger?.warn(`host adapter: module not resolvable: ${spec}`);
    }
    moduleCache.set(spec, mod);
    return mod;
}
export function createHostAdapter(ctx, logger) {
    const capabilities = [];
    // events 读取路径只有运行时才能确定，sessionEvents 内自适应
    capabilities.push('sessionEvents(s自适应)');
    // 可能在插件启动后才注册，sessionExists/sessionHeader 内每次重新探测；此处仅记录启动时形态
    capabilities.push(statCapablePersistence(ctx)
        ? 'sessionPersistence.stat(可用)'
        : 'sessionPersistence.stat(不可用，会话存在性判定降级)');
    capabilities.push(workspaceRegistry(ctx)
        ? 'workspaceRegistry.create(可用)'
        : 'workspaceRegistry.create(不可用，侧边栏工作区归属降级)');
    let resolveFn;
    const presets = safeGet(ctx, 'agentPresets');
    if (presets && typeof presets.serviceFor === 'function') {
        resolveFn = (agent, name) => presets.serviceFor(agent, name);
        capabilities.push('serviceFor(presets实例方法)');
    }
    else {
        capabilities.push('serviceFor(serviceForAgent动态)');
    }
    return {
        capabilities,
        sessionEvents(session) {
            if (typeof session.snapshotEvents === 'function')
                return session.snapshotEvents();
            const legacy = session.events;
            return Array.isArray(legacy) ? legacy : [];
        },
        async serviceFor(agent, name) {
            if (resolveFn) {
                try {
                    const found = resolveFn(agent, name);
                    if (found)
                        return found;
                }
                catch { /* 宿主实现差异，走模块函数 */ }
            }
            const mod = await importModule('@deepseek-ai/dsh-agent-presets', logger);
            const fn = mod?.serviceForAgent;
            if (typeof fn !== 'function')
                return undefined;
            try {
                return fn(ctx, agent, name);
            }
            catch {
                return undefined;
            }
        },
        globalService(name) {
            return safeGet(ctx, name);
        },
        async sessionHeader(sessionId) {
            const persistence = statCapablePersistence(ctx);
            if (!persistence)
                return undefined;
            try {
                return (await persistence.stat(sessionId))?.header;
            }
            catch {
                return undefined; // 读不到 preset 不该阻断会话打开，回落到当前 effective preset
            }
        },
        async sessionExists(sessionId) {
            const persistence = statCapablePersistence(ctx);
            if (!persistence)
                return undefined;
            return (await persistence.stat(sessionId)) !== undefined;
        },
        async attachSessionToWorkspace(sessionId, cwd) {
            const registry = workspaceRegistry(ctx);
            if (!registry) {
                // 未挂载 dsh-workspace（如 headless profile）→ 无侧边栏，属预期降级
                logger?.debug?.(`host adapter: workspaceRegistry 未挂载，跳过会话 ${sessionId} 的工作区归属`);
                return;
            }
            try {
                const workspace = await registry.create(cwd, WORKSPACE_TITLE);
                if (!workspace || typeof workspace.attachSession !== 'function') {
                    // 宿主接口演进：返回对象不含 attachSession → warn 避免静默失效
                    logger?.warn?.(`host adapter: workspaceRegistry.create 返回了无 attachSession 的对象，跳过会话 ${sessionId}`);
                    return;
                }
                await workspace.attachSession(sessionId);
                logger?.debug?.(`host adapter: attached session ${sessionId} to workspace ${workspace.path ?? cwd}`);
            }
            catch (err) {
                // 仅影响侧边栏展示，绝不打断消息处理；但属异常（cwd 不匹配/目录缺失等），warn 留痕
                logger?.warn?.(`host adapter: workspace attach failed for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
            }
        },
        async buildForkSeed(events, boundary) {
            const mod = await importModule('@deepseek-ai/dsh-session/fork', logger);
            const fn = mod?.buildForkSeed;
            if (typeof fn !== 'function')
                return undefined;
            try {
                return fn(events, boundary);
            }
            catch {
                return undefined;
            }
        },
    };
}
/** ctx.get 的非抛出版本 */
function safeGet(ctx, name) {
    try {
        return ctx.get(name);
    }
    catch {
        return undefined;
    }
}
/** 测试辅助：清空模块缓存 */
export function _resetAdapterCache() {
    moduleCache.clear();
}
//# sourceMappingURL=adapter.js.map