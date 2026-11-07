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
/** 取出可 list 的 workspaceRegistry；形态不匹配返回 undefined */
function listCapableRegistry(ctx) {
    const registry = safeGet(ctx, 'workspaceRegistry');
    return typeof registry?.list === 'function' ? registry : undefined;
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
    capabilities.push(listCapableRegistry(ctx)
        ? 'workspaceRegistry.list(可用)'
        : 'workspaceRegistry.list(不可用，/sessions 分组列表降级)');
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
        listWorkspaces() {
            const registry = listCapableRegistry(ctx);
            if (!registry)
                return [];
            try {
                const list = registry.list?.() ?? [];
                const out = [];
                for (const raw of list) {
                    const workspace = raw;
                    if (!workspace || typeof workspace.path !== 'string' || !workspace.path)
                        continue;
                    out.push({
                        path: workspace.path,
                        title: typeof workspace.title === 'string' && workspace.title ? workspace.title : workspace.path,
                        sessionIds: Array.isArray(workspace.sessionIds)
                            ? workspace.sessionIds.filter((id) => typeof id === 'string')
                            : [],
                    });
                }
                return out;
            }
            catch (err) {
                logger?.warn?.(`host adapter: list workspaces failed: ${err instanceof Error ? err.message : String(err)}`);
                return [];
            }
        },
        async applyPermissionKnobs(session, knobs) {
            const appendable = session;
            if (typeof appendable?.append !== 'function') {
                logger?.warn?.('host adapter: session has no append, permission switch unavailable');
                return false;
            }
            const sandboxMod = await importModule('@deepseek-ai/dsh-sandbox-policy', logger);
            const approvalMod = await importModule('@deepseek-ai/dsh-user-approval', logger);
            const setSandboxMode = sandboxMod?.setSandboxMode;
            const setApprovalPolicy = approvalMod?.setApprovalPolicy;
            if (typeof setSandboxMode !== 'function' || typeof setApprovalPolicy !== 'function') {
                logger?.warn?.('host adapter: permission policy modules unavailable, switch declined');
                return false;
            }
            try {
                setSandboxMode(session, knobs.sandbox);
                setApprovalPolicy(session, knobs.approval);
                return true;
            }
            catch (err) {
                logger?.warn?.(`host adapter: apply permission knobs failed: ${err instanceof Error ? err.message : String(err)}`);
                return false;
            }
        },
        readPermissionKnobs(session) {
            const events = this.sessionEvents(session);
            let sandbox;
            let approval;
            for (const raw of events) {
                const event = raw;
                if (event?.type === 'sandbox/mode' && typeof event.data?.mode === 'string') {
                    sandbox = event.data.mode;
                }
                else if (event?.type === 'approval/policy' && typeof event.data?.policy === 'string') {
                    approval = event.data.policy;
                }
            }
            if (sandbox === undefined && approval === undefined)
                return undefined;
            return { sandbox: sandbox ?? '', approval: approval ?? '' };
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