var __addDisposableResource = (this && this.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose, inner;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
            if (async) inner = dispose;
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        if (inner) dispose = function() { try { inner.call(this); } catch (e) { return Promise.reject(e); } };
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources = (this && this.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        var r, s = 0;
        function next() {
            while (r = env.stack.pop()) {
                try {
                    if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
                    if (r.dispose) {
                        var result = r.dispose.call(r.value);
                        if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                    }
                    else s |= 1;
                }
                catch (e) {
                    fail(e);
                }
            }
            if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import { WORKBENCH_BASE_PERMISSIONS } from "../shared/workbench-agent-settings.js";
const nativeModule = '@deepseek-ai/dsh-tool-executor-native';
function loadNative() {
    return import(__rewriteRelativeImportExtension(nativeModule)).then(module => {
        if (typeof module.NativeToolExecutor !== 'function')
            throw new Error('当前 DSH 缺少原生工具执行器。');
        return module.NativeToolExecutor;
    }, () => { throw new Error('当前 DSH 缺少原生工具执行器。'); });
}
// Delegation can outlive the calling Agent or use a different provider. The
// PTC transport is not a capability that can appear in a custom tool list.
const excluded = new Set(['run_code', 'subagent', 'spawn_agent', 'send_message', 'interrupt_agent', 'workflow', 'plugin_manager']);
const usable = (name) => !excluded.has(name) && !name.startsWith('subagent_') && !name.startsWith('schedule_');
const nativePermissionEvents = new Set(['permission/preset', 'sandbox/mode', 'approval/policy']);
const definitions = (ctx) => ctx.get('tools');
const unavailable = '当前 DSH 无法安全恢复原生工具执行器。请更新 DSH，或将此 QQ 会话切回原生工具设置。';
function canRestoreTools(tools) {
    return typeof tools?.guard === 'function' && typeof tools.overrideExecutor === 'function';
}
export async function workbenchToolChoices(ctx, preset) {
    const env_1 = { stack: [], error: void 0, hasError: false };
    try {
        const tools = definitions(ctx);
        if (!canRestoreTools(tools))
            throw new Error(unavailable);
        const presets = ctx.get('agentPresets');
        if (!presets)
            throw new Error('无法读取 DSH Agent 预设。');
        const id = preset || presets.defaultId;
        await loadNative();
        const lease = __addDisposableResource(env_1, await presets.acquireScope(id), true);
        return tools.definitions(lease.key).filter(tool => usable(tool.name)).map(({ name, description }) => ({
            name, ...(description ? { description: description.slice(0, 500) } : {}),
        })).sort((a, b) => a.name.localeCompare(b.name));
    }
    catch (e_1) {
        env_1.error = e_1;
        env_1.hasError = true;
    }
    finally {
        const result_1 = __disposeResources(env_1);
        if (result_1)
            await result_1;
    }
}
function rank(permission) {
    return WORKBENCH_BASE_PERMISSIONS.findIndex(value => value === permission);
}
function expands(from, to) {
    if (from?.tools === undefined)
        return false;
    const tools = from.tools;
    return to?.tools === undefined || to.tools.some(name => !tools.includes(name))
        || rank(to.permission) > rank(from.permission);
}
export class WorkbenchToolPolicies {
    ctx;
    agents;
    read;
    owner;
    logger;
    discardPending;
    installed = new Map();
    owners = new Map();
    disabled = new Set();
    generations = new Map();
    closed = false;
    constructor(ctx, agents, read, owner, logger, discardPending) {
        this.ctx = ctx;
        this.agents = agents;
        this.read = read;
        this.owner = owner;
        this.logger = logger;
        this.discardPending = discardPending;
        const lifecycle = ctx;
        lifecycle.on('agent/created', async ({ agent }) => {
            const key = await this.resolveOwner(agent);
            if (key && this.active(key))
                await this.restore(agent, key);
        }, { global: true });
        lifecycle.on('agent/disposed', ({ agent }) => {
            this.release(agent);
            this.owners.delete(agent);
        }, { global: true });
        lifecycle.on('session/event', (session, event) => {
            if (!nativePermissionEvents.has(event.type))
                return;
            const agent = this.agents.get(session.id);
            if (agent?.session !== session || agent.status !== 'running')
                return;
            if (this.installed.get(agent)?.withinNativeCap() === false) {
                // Cancel synchronously so work already past the guard cannot start.
                agent.cancel({ kind: 'user' }, { keepInbox: true });
            }
        }, { global: true });
    }
    active(key) {
        return !this.closed && !this.disabled.has(accountFor(key));
    }
    enableAccount(appId) {
        return !this.closed && this.disabled.delete(appId);
    }
    detachAccount(appId) {
        this.disabled.add(appId);
        this.generations.set(appId, (this.generations.get(appId) ?? 0) + 1);
        for (const [agent, key] of this.owners) {
            if (accountFor(key) === appId)
                this.detach(agent, key);
        }
    }
    close() {
        this.closed = true;
        for (const [agent, key] of this.owners)
            this.detach(agent, key);
    }
    blocked(key) {
        if (this.read(key)?.tools === undefined)
            return undefined;
        if (!canRestoreTools(definitions(this.ctx)))
            return unavailable;
        for (const [agent, owner] of this.owners) {
            const failure = this.installed.get(agent)?.failure;
            if (owner === key && failure !== undefined)
                return failure;
        }
        return undefined;
    }
    release(agent) {
        const current = this.installed.get(agent);
        this.installed.delete(agent);
        current?.release();
    }
    detach(agent, key) {
        try {
            this.discardPending?.(agent, key);
        }
        catch {
            this.logger?.warn('QQBot could not retire queued work for a detached Session.');
        }
        try {
            if (this.installed.has(agent) && agent.status === 'running') {
                agent.cancel({ kind: 'user' }, { keepInbox: true });
            }
        }
        catch {
            this.logger?.warn('QQBot could not cancel the turn for a detached Session.');
        }
        finally {
            this.owners.delete(agent);
            this.release(agent);
        }
    }
    async restore(agent, key) {
        try {
            await this.attach(agent, key);
        }
        catch (error) {
            if (!this.active(key) || this.owners.get(agent) !== key || this.installed.has(agent))
                return;
            const failure = error instanceof Error ? error.message : unavailable;
            const tools = definitions(agent.ctx);
            const release = tools?.guard?.(() => failure) ?? (() => { });
            this.installed.set(agent, { failure, release, withinNativeCap: () => false });
            if (agent.status === 'running')
                agent.cancel({ kind: 'user' }, { keepInbox: true });
            this.logger?.warn('QQBot paused a Session whose saved tool policy could not be restored.');
        }
    }
    knownOwner(agent) {
        return this.owners.get(agent) ?? this.owner(agent.id);
    }
    async resolveOwner(agent) {
        const direct = this.knownOwner(agent);
        if (direct !== undefined)
            return direct;
        const seen = new Set([agent.id]);
        let parent = agent.session.header?.parentSession;
        while (parent !== undefined && !seen.has(parent)) {
            seen.add(parent);
            const live = this.agents.get(parent);
            const key = live ? this.knownOwner(live) : this.owner(parent);
            if (key !== undefined)
                return key;
            const lineage = this.ctx.get('sessionPersistence');
            parent = live ? live.session.header?.parentSession : (await lineage?.stat?.(parent))?.header.parentSession;
        }
        return undefined;
    }
    async restoreLive(onlyKey, strict = false) {
        for (const agent of this.agents.list?.() ?? []) {
            const key = await this.resolveOwner(agent);
            if (!key || !this.active(key) || (onlyKey !== undefined && onlyKey !== key) || this.agents.get(agent.id) !== agent)
                continue;
            if (strict)
                await this.attach(agent, key);
            else
                await this.restore(agent, key);
        }
    }
    async attach(agent, key, force = false) {
        if (!this.active(key))
            throw new Error('QQ 会话关联已停用。');
        const generation = this.generations.get(accountFor(key));
        this.owners.set(agent, key);
        const existing = this.installed.get(agent);
        if (existing?.failure !== undefined)
            throw new Error(existing.failure);
        if (existing || (!force && this.read(key)?.tools === undefined))
            return;
        const tools = definitions(agent.ctx);
        const permission = agent.ctx.get('permissionPresets');
        if (!canRestoreTools(tools) || !permission?.current)
            throw new Error(unavailable);
        const Native = await loadNative();
        if (!this.active(key) || this.owners.get(agent) !== key || this.generations.get(accountFor(key)) !== generation) {
            throw new Error('QQ 会话关联已变化，请重试。');
        }
        if (this.installed.has(agent))
            return;
        const executor = new Native(agent.ctx);
        const withinCap = (policy) => {
            const limit = rank(policy.permission);
            const actual = rank(permission.current(agent.session));
            return actual >= 0 && limit >= actual;
        };
        const allows = (policy, name) => policy?.tools === undefined || (usable(name) && policy.tools.includes(name) && withinCap(policy));
        const unguard = tools.guard(execution => {
            try {
                const policy = this.read(key);
                return (policy?.tools === undefined || (execution.agent === agent && allows(policy, execution.name))) ? undefined : '此 QQ 会话未允许该工具，或当前原生权限超出基础权限。';
            }
            catch {
                return '无法验证此 QQ 会话的工具权限。';
            }
        });
        try {
            const deselect = tools.overrideExecutor({
                describe: definitions => {
                    const policy = this.read(key);
                    return executor.describe(definitions.filter(tool => allows(policy, tool.name)));
                },
                execute: input => executor.execute(input),
            });
            this.installed.set(agent, {
                release: () => { try {
                    deselect();
                }
                finally {
                    unguard();
                } },
                withinNativeCap: () => {
                    try {
                        const policy = this.read(key);
                        return policy?.tools === undefined || withinCap(policy);
                    }
                    catch {
                        return false;
                    }
                },
            });
        }
        catch (error) {
            unguard();
            throw error;
        }
    }
    live(key, sessions) {
        const roots = new Set(sessions);
        return (this.agents.list?.() ?? sessions.flatMap(id => this.agents.get(id) ?? []))
            .filter(agent => roots.has(agent.id) || this.knownOwner(agent) === key);
    }
    async beforeSave(key, sessions, next) {
        const previous = this.read(key);
        if (next.tools === undefined && previous?.tools === undefined)
            return () => () => { };
        if (!this.agents.list)
            throw new Error('当前 DSH 无法验证运行中的子 Agent 工具权限。');
        const widening = expands(previous, next);
        const narrowing = expands(next, previous);
        const checkIdle = (live) => {
            if (widening && live.some(agent => agent.status !== 'idle'))
                throw new Error('会话正在运行，请在空闲后扩大工具权限。');
        };
        if (next.tools !== undefined)
            await this.restoreLive(key, true);
        const live = this.live(key, sessions);
        checkIdle(live);
        if (next.tools !== undefined)
            for (const agent of live) {
                if (this.agents.get(agent.id) === agent)
                    await this.attach(agent, key, true);
            }
        return () => {
            const current = this.live(key, sessions);
            checkIdle(current);
            if (next.tools !== undefined && current.some(agent => !this.installed.has(agent) || this.installed.get(agent)?.failure !== undefined)) {
                throw new Error('会话已重新打开，请重试保存。');
            }
            // Host guards run before dispatch wrappers such as the async checkpoint.
            // Fence work already admitted by the old policy after the write succeeds.
            return () => {
                if (narrowing)
                    for (const agent of current) {
                        if (agent.status === 'running')
                            agent.cancel({ kind: 'user' }, { keepInbox: true });
                    }
            };
        };
    }
    reconcile(key, sessions) {
        if (this.read(key)?.tools !== undefined)
            return;
        for (const agent of this.live(key, sessions))
            this.release(agent);
    }
}
function accountFor(key) {
    return key.split(':', 2)[1] ?? '';
}
//# sourceMappingURL=workbench-tools.js.map