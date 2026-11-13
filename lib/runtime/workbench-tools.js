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
const excluded = new Set(['run_code', 'subagent', 'subagent_fork', 'spawn_agent', 'send_message', 'workflow', 'plugin_manager']);
const usable = (name) => !excluded.has(name) && !name.startsWith('schedule_');
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
export class WorkbenchToolPolicies {
    agents;
    read;
    installed = new WeakMap();
    owners = new Map();
    constructor(ctx, agents, read, owner) {
        this.agents = agents;
        this.read = read;
        const lifecycle = ctx;
        lifecycle.on('agent/created', async ({ agent }) => {
            const parent = agent.session.header?.parentSession;
            const key = this.owners.get(agent.id) ?? owner(agent.id)
                ?? (parent && (this.owners.get(parent) ?? owner(parent)));
            if (key && read(key)?.tools !== undefined)
                await this.attach(agent, key);
        }, { global: true });
        lifecycle.on('agent/disposed', ({ agent }) => {
            this.owners.delete(agent.id);
            this.installed.delete(agent);
        }, { global: true });
    }
    async attach(agent, key, force = false) {
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
        const allows = (name) => {
            const policy = this.read(key);
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
                return (this.read(key)?.tools === undefined || (execution.agent === agent && allows(execution.name))) ? undefined : '此 QQ 会话未允许该工具，或当前原生权限超出基础权限。';
            }
            catch {
                return '无法验证此 QQ 会话的工具权限。';
            }
        });
        try {
            const select = replaceable ? tools.overrideExecutor : tools.setExecutor;
            const deselect = select.call(tools, {
                describe: definitions => executor.describe(definitions.filter(tool => allows(tool.name))),
                execute: input => executor.execute(input),
            });
            this.installed.set(agent, { replaceable, release: () => { deselect(); unguard(); } });
            this.owners.set(agent.id, key);
        }
        catch (error) {
            unguard();
            throw error;
        }
    }
    async beforeSave(key, sessions, next) {
        const live = () => sessions.flatMap(id => {
            const agent = this.agents.get(id);
            return agent ? [agent] : [];
        });
        const checkIdle = () => {
            const current = this.read(key);
            const previous = current?.tools;
            const widens = current && previous !== undefined && (next.tools === undefined
                || next.tools.some(name => !previous.includes(name)) || rank(next.permission) > rank(current.permission));
            if (widens && live().some(agent => agent.status !== 'idle'))
                throw new Error('会话正在运行，请在空闲后扩大工具权限。');
        };
        checkIdle();
        if (next.tools !== undefined)
            for (const agent of live())
                await this.attach(agent, key, true);
        return () => {
            checkIdle();
            if (next.tools !== undefined && live().some(agent => !this.installed.has(agent))) {
                throw new Error('会话已重新打开，请重试保存。');
            }
        };
    }
    reconcile(key, sessions) {
        if (this.read(key)?.tools !== undefined)
            return;
        for (const id of sessions) {
            const agent = this.agents.get(id);
            const installed = agent && this.installed.get(agent);
            if (agent && installed?.replaceable) {
                installed.release();
                this.installed.delete(agent);
            }
        }
    }
}
//# sourceMappingURL=workbench-tools.js.map