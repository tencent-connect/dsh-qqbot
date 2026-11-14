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
let native;
function loadNative() {
    return native ??= import(__rewriteRelativeImportExtension(nativeModule)).then(module => {
        if (typeof module.NativeToolExecutor !== 'function')
            throw new Error('当前 DSH 缺少原生工具执行器。');
        return module.NativeToolExecutor;
    }, () => { throw new Error('当前 DSH 缺少原生工具执行器。'); });
}
// Delegation can outlive the calling Agent or use a different provider. The
// PTC transport is not a capability that can appear in a custom tool list.
const excluded = new Set(['run_code', 'subagent', 'spawn_agent', 'send_message', 'interrupt_agent', 'workflow', 'plugin_manager']);
const usable = (name) => !excluded.has(name) && !name.startsWith('subagent_') && !name.startsWith('schedule_');
const definitions = (ctx) => ctx.get('tools');
const presetOf = (agent) => agent.session.header?.agentPreset;
export async function workbenchToolChoices(ctx, preset) {
    const env_1 = { stack: [], error: void 0, hasError: false };
    try {
        const tools = definitions(ctx);
        if (!tools?.guard || !tools.setExecutor)
            throw new Error('当前 DSH 不支持会话级工具限制。');
        const presets = ctx.get('agentPresets');
        if (!presets)
            throw new Error('无法读取 DSH Agent 预设。');
        const id = preset || presets.defaultId;
        if (!tools.overrideExecutor && id !== 'standard')
            throw new Error('当前 DSH 仅支持标准模式使用自定义工具。');
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
    installed = new WeakMap();
    owners = new WeakMap();
    constructor(ctx, agents, read, owner) {
        this.ctx = ctx;
        this.agents = agents;
        this.read = read;
        this.owner = owner;
        const lifecycle = ctx;
        lifecycle.on('agent/created', async ({ agent }) => {
            const key = await this.resolveOwner(agent);
            if (key)
                await this.attach(agent, key);
        }, { global: true });
        lifecycle.on('agent/disposed', ({ agent }) => {
            this.owners.delete(agent);
            this.installed.delete(agent);
        }, { global: true });
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
            parent = live ? live.session.header?.parentSession : (await lineage?.stat(parent))?.header.parentSession;
        }
        return undefined;
    }
    async restoreLive(onlyKey) {
        for (const agent of this.agents.list?.() ?? []) {
            const key = await this.resolveOwner(agent);
            if (key && (onlyKey === undefined || onlyKey === key) && this.agents.get(agent.id) === agent)
                await this.attach(agent, key);
        }
    }
    async attach(agent, key, force = false) {
        this.owners.set(agent, key);
        if (this.installed.has(agent) || (!force && this.read(key)?.tools === undefined))
            return;
        const tools = definitions(agent.ctx);
        const permission = agent.ctx.get('permissionPresets');
        if (!tools?.guard || !permission?.current)
            throw new Error('当前 DSH 无法约束 QQ 会话的工具执行。');
        // Older Hosts can supply a scoped executor but cannot restore the previous
        // executor. Only keep a pass-through replacement for the standard preset.
        const replaceable = typeof tools.overrideExecutor === 'function';
        if (!replaceable && (!tools.setExecutor || presetOf(agent) !== 'standard')) {
            throw new Error('当前 DSH 无法为此 Agent 预设启用自定义工具。');
        }
        const Native = await loadNative();
        if (this.installed.has(agent))
            return;
        const executor = new Native(agent.ctx);
        const allows = (policy, name) => {
            if (policy?.tools === undefined)
                return true;
            if (!usable(name) || !policy.tools.includes(name))
                return false;
            const limit = rank(policy.permission);
            const actual = rank(permission.current(agent.session));
            return actual >= 0 && limit >= actual;
        };
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
            const select = replaceable ? tools.overrideExecutor : tools.setExecutor;
            const deselect = select.call(tools, {
                describe: definitions => {
                    const policy = this.read(key);
                    return executor.describe(definitions.filter(tool => allows(policy, tool.name)));
                },
                execute: input => executor.execute(input),
            });
            this.installed.set(agent, { replaceable, release: () => { deselect(); unguard(); } });
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
        await this.restoreLive(key);
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
            if (next.tools !== undefined && current.some(agent => !this.installed.has(agent))) {
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
        for (const agent of this.live(key, sessions)) {
            const installed = this.installed.get(agent);
            if (installed?.replaceable) {
                installed.release();
                this.installed.delete(agent);
            }
        }
    }
}
//# sourceMappingURL=workbench-tools.js.map