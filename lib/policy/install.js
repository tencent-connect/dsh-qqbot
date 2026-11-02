import { scopeOf } from '@deepseek-ai/dsh-scope';
import { stat } from 'node:fs/promises';
import { catalogTools, toolCatalogEntry } from "./catalog.js";
import { assertPathAllowed } from "./paths.js";
import { installConversationExecutor } from "./executor.js";
function isTools(value) {
    return typeof value === 'object' && value !== null
        && 'definitions' in value && typeof value.definitions === 'function'
        && 'guard' in value && typeof value.guard === 'function'
        && 'restrict' in value && typeof value.restrict === 'function';
}
function args(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new Error('工具参数无效');
    return Object.fromEntries(Object.entries(value));
}
function textField(value, field) {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0'))
        throw new Error(`缺少有效的 ${field}`);
    return value;
}
function failure(reason) {
    return { isError: true, error: { message: reason }, content: [{ type: 'text', text: `Error: ${reason}` }] };
}
function executionCwd(exec, policy) {
    const agent = exec.agent;
    if (typeof agent === 'object' && agent !== null && 'session' in agent) {
        const session = agent.session;
        if (typeof session === 'object' && session !== null && 'header' in session) {
            const header = session.header;
            if (typeof header === 'object' && header !== null && 'cwd' in header && typeof header.cwd === 'string' && header.cwd)
                return header.cwd;
        }
    }
    return policy.cwd;
}
/** Agent-scoped defense: declarations, async resource gates, final monotonic denial. */
export function installPolicy(agentCtx, options) {
    const tools = agentCtx.get('tools');
    if (!isTools(tools))
        throw new Error('当前宿主缺少 QQ 所需的工具执行守卫');
    const checked = new Map();
    const approved = new Map();
    const disposers = [];
    const setExecutor = tools.setExecutor;
    if (setExecutor && options.getPolicy()?.toolMode !== 'native')
        disposers.push(installConversationExecutor(agentCtx, { setExecutor: executor => setExecutor.call(tools, executor) }, options.getPolicy, options.getCatalog));
    let restriction;
    let installedVersion;
    const scope = scopeOf(agentCtx);
    const inferredId = typeof scope === 'object' && scope !== null && 'id' in scope && typeof scope.id === 'string' ? scope.id : undefined;
    const agentId = options.agentId ?? inferredId;
    const ownsExecution = (exec) => {
        const agent = exec.agent;
        const id = typeof agent === 'object' && agent !== null && 'id' in agent && typeof agent.id === 'string' ? agent.id : undefined;
        return agentId === undefined ? id === undefined : id === agentId;
    };
    const entries = () => options.getCatalog?.() ?? catalogTools(tools, scope);
    const entryFor = (name) => entries().find(entry => entry.name === name) ?? toolCatalogEntry({ name });
    const actualSandboxMode = (exec) => {
        if (options.getSandboxMode)
            return options.getSandboxMode();
        try {
            const executor = agentCtx.get(exec.name === 'run_code' ? 'ptcRuntime' : 'shell');
            if (typeof executor !== 'object' || executor === null || !('sandboxMode' in executor) || executor.sandboxMode === undefined)
                return undefined;
            const policy = agentCtx.get('sandboxPolicy');
            if (typeof policy !== 'object' || policy === null || !('resolve' in policy) || typeof policy.resolve !== 'function')
                return undefined;
            const agent = exec.agent;
            if (typeof agent !== 'object' || agent === null || !('session' in agent))
                return undefined;
            const resolved = Reflect.apply(policy.resolve, policy, [{ session: agent.session }]);
            return typeof resolved === 'object' && resolved !== null && 'mode' in resolved ? resolved.mode : undefined;
        }
        catch {
            return undefined;
        }
    };
    const deny = (exec, reason) => {
        options.onDenied?.(exec.name, reason);
        return reason;
    };
    const baseDenial = (exec) => {
        const policy = options.getPolicy();
        if (!policy)
            return 'QQ 会话缺少有效权限配置';
        if (policy.receiveEnabled === false)
            return '该群已停止接收与执行任务';
        if (exec.signal.aborted)
            return '任务已取消';
        const entry = entryFor(exec.name);
        if (policy.nativeTools === true) {
            if (exec.name.startsWith('memory_') || policy.tools[entry.id] === 'deny')
                return '该群未授权此工具';
        }
        else if (!entry.available || (policy.tools[entry.id] ?? 'deny') === 'deny')
            return '该群未授权此工具';
        // Native mode delegates sandbox and approval to the selected DSH Agent,
        // while this guard retains the explicit per-conversation tool ceiling.
        if (policy.toolMode === 'native')
            return undefined;
        if (entry.constraint === 'execution') {
            if (!policy.resources.executionEnabled)
                return '该群未启用命令或代码执行';
            if (actualSandboxMode(exec) !== policy.resources.sandbox)
                return '无法确认该群所需的执行沙箱';
            if (policy.resources.networkDomains.length > 0)
                return '通用执行工具不能保证联网域名限制';
            const input = typeof exec.arguments === 'object' && exec.arguments !== null ? Object.fromEntries(Object.entries(exec.arguments)) : {};
            const escalation = input.sandbox_permissions;
            if (escalation !== undefined && escalation !== 'use_default' && escalation !== policy.resources.sandbox)
                return '执行请求不能临时提升到该群授权范围之外';
        }
        if ((entry.category === 'mcp' || entry.category === 'network') && policy.resources.networkDomains.length > 0)
            return '此工具尚不支持可靠的联网域名限制';
        if (entry.constraint === 'write-path' && policy.permission !== 'workspace-write')
            return '该群当前为只读权限';
        if (policy.template === 'readonly' && !['read-path', 'none'].includes(entry.constraint))
            return '资料只读模式不允许未适配的工具';
        return undefined;
    };
    const resourceGate = async (exec) => {
        const denied = baseDenial(exec);
        if (denied)
            return denied;
        const policy = options.getPolicy();
        if (!policy)
            return 'QQ 会话缺少有效权限配置';
        const entry = entryFor(exec.name);
        const cwd = executionCwd(exec, policy);
        try {
            if (policy.toolMode !== 'native' && (entry.constraint === 'read-path' || entry.constraint === 'write-path')) {
                const input = args(exec.arguments);
                const search = exec.name === 'grep' || exec.name === 'glob';
                const path = search ? input.path === undefined ? cwd : textField(input.path, 'path') : textField(input.file_path, 'file_path');
                await assertPathAllowed(path, entry.constraint === 'write-path' ? policy.resources.writeRoots : policy.resources.readRoots, cwd, entry.constraint === 'write-path');
            }
            else if (entry.constraint === 'send-path') {
                const input = args(exec.arguments);
                const filePaths = [];
                if (exec.name === 'present') {
                    if (!Array.isArray(input.files))
                        throw new Error('交付文件列表无效');
                    for (const item of input.files) {
                        const value = args(item);
                        filePaths.push(textField(value.path, 'files.path'));
                    }
                }
                else {
                    // Explicit peer/target overrides would turn this into a cross-conversation channel.
                    if (input.target !== undefined || input.targetId !== undefined || input.scope !== undefined)
                        throw new Error('该群只能向当前对话发送文件');
                    filePaths.push(textField(input.path ?? input.file_path ?? input.filePath, 'path'));
                }
                if (filePaths.length > policy.resources.maxFiles)
                    throw new Error('文件数量超过该群限制');
                for (const path of filePaths) {
                    const canonical = await assertPathAllowed(path, policy.resources.sendRoots, cwd);
                    const file = await stat(canonical);
                    if (!file.isFile() || file.size > policy.resources.maxFileMB * 1024 * 1024)
                        throw new Error('交付文件类型或大小超过该群限制');
                }
            }
            exec.signal.throwIfAborted();
            if (options.getPolicy()?.version !== policy.version)
                return '检查期间该群权限已改变，请重新执行';
            checked.set(exec.token, policy.version);
            return undefined;
        }
        catch (error) {
            return error instanceof Error ? error.message : '无法验证工具资源范围';
        }
    };
    // Restrictable definitions include preset ancestors, not just the global view.
    // Ask the public API to validate an ancestor candidate in this exact Host scope;
    // a temporary restrictive filter is removed synchronously before installing the
    // complete mask. This also avoids assuming private scope tags are shared between
    // the Host's and the plugin's separately resolved scope modules.
    const refreshRestriction = () => {
        const policy = options.getPolicy();
        if (!policy || installedVersion === policy.version)
            return;
        if (policy.nativeTools === true) {
            restriction?.();
            restriction = undefined;
            installedVersion = policy.version;
            return;
        }
        const inheritedNames = new Set(tools.definitions().map(def => def.name));
        const candidates = new Set(entries().filter(entry => entry.available && (policy.tools[entry.id] ?? 'deny') !== 'deny').map(entry => entry.name));
        // Opaque native/public MCP ids are exact registry names. Structured MCP ids
        // need the trusted catalog mapping and are deliberately not decoded here.
        for (const [id, decision] of Object.entries(policy.tools))
            if (decision !== 'deny' && !id.startsWith('mcp:') && entryFor(id).available)
                candidates.add(id);
        const allowed = [];
        for (const name of candidates) {
            if (name === 'run_code')
                continue;
            if (inheritedNames.has(name)) {
                allowed.push(name);
                continue;
            }
            try {
                const disposeProbe = tools.restrict({ allow: [name] });
                disposeProbe();
                allowed.push(name);
            }
            catch {
                // A scope-local-only or removed name is not restrictable. Its actual
                // visibility and execution are still controlled by our executor/guard.
            }
        }
        const next = tools.restrict({ allow: allowed });
        restriction?.();
        restriction = next;
        installedVersion = policy.version;
    };
    refreshRestriction();
    const listen = (event, handler) => {
        const disposer = Reflect.apply(agentCtx.on, agentCtx, [event, handler]);
        if (typeof disposer === 'function')
            disposers.push(() => { Reflect.apply(disposer, undefined, []); });
    };
    const preExecute = async (exec, next) => {
        if (!ownsExecution(exec))
            return next();
        refreshRestriction();
        const denied = await resourceGate(exec);
        if (denied)
            return { kind: 'deny', reason: deny(exec, denied) };
        const upstream = await next();
        if (upstream.kind === 'deny' || upstream.kind === 'cancel')
            return upstream;
        const policy = options.getPolicy();
        if (policy?.tools[entryFor(exec.name).id] !== 'ask')
            return upstream;
        // Request here and record the accepted grant, so an outer pre-execute listener
        // cannot turn our returned `ask` into `allow` and bypass the final guard.
        try {
            const approval = agentCtx.get('approval');
            if (!exec.agent || typeof approval !== 'object' || approval === null || !('request' in approval) || typeof approval.request !== 'function')
                return { kind: 'deny', reason: '该群所需的审批服务不可用' };
            const outcome = await Reflect.apply(approval.request, approval, [{
                    agent: exec.agent, toolName: exec.name, callId: exec.callId, signal: exec.signal,
                    reason: `该群的工具 ${exec.name} 需要审批`,
                }]);
            if (outcome !== 'allowed-once')
                return { kind: 'deny', reason: '本次工具调用未获审批' };
            if (options.getPolicy()?.version !== policy.version)
                return { kind: 'deny', reason: '审批期间该群权限已改变' };
            approved.set(exec.token, policy.version);
            return { kind: 'allow' };
        }
        catch {
            return { kind: 'deny', reason: '该群所需的审批未能完成' };
        }
    };
    const execute = async (exec, next) => {
        if (!ownsExecution(exec))
            return next();
        const denied = await resourceGate(exec);
        if (denied)
            return failure(deny(exec, denied));
        return next();
    };
    listen('tools/pre-execute', preExecute);
    listen('tools/execute', execute);
    listen('tools/result', (exec) => { checked.delete(exec.token); approved.delete(exec.token); });
    disposers.push(tools.guard(exec => {
        if (!ownsExecution(exec))
            return options.protectedDescendant?.(exec.agent) ? undefined : 'QQ 子任务没有可验证的权限继承';
        const denied = baseDenial(exec);
        if (denied)
            return deny(exec, denied);
        if (checked.get(exec.token) !== options.getPolicy()?.version)
            return deny(exec, '该群权限已改变或调用未经资源检查');
        if (options.getPolicy()?.tools[entryFor(exec.name).id] === 'ask' && approved.get(exec.token) !== options.getPolicy()?.version)
            return deny(exec, '该群工具调用缺少有效审批');
        return undefined;
    }));
    return () => {
        restriction?.();
        for (const dispose of disposers.reverse())
            dispose();
        checked.clear();
        approved.clear();
    };
}
//# sourceMappingURL=install.js.map