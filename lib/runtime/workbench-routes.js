import { readFile } from 'node:fs/promises';
import { WORKBENCH_GROUP_GUIDE_IMAGES, WORKBENCH_ROBOT_BIND_PATH, WORKBENCH_ROBOTS_PATH } from "../shared/workbench-protocol.js";
import { RobotConfigConflictError, robotAccessPatch, robotAlias, robotAppId, robotEnabled, robotObject, robotRevision, robotSecret } from "./robot-config.js";
import { WORKBENCH_DEFAULTS_PATH, WORKBENCH_TOOLS_PATH } from "../shared/workbench-agent-settings.js";
import { parseAgentSettings } from "./workbench-agent-settings.js";
import { workbenchToolChoices } from "./workbench-tools.js";
export function registerWorkbenchGroupGuideImages(ctx) {
    for (const [filename, path] of Object.entries(WORKBENCH_GROUP_GUIDE_IMAGES)) {
        const image = new URL(`../../assets/qq-group-permissions/${filename}`, import.meta.url);
        registerWorkbenchFetch(ctx, path, ['GET'], async () => new Response(await readFile(image), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } }));
    }
}
export function registerWorkbenchTools(ctx) {
    registerWorkbenchFetch(ctx, WORKBENCH_TOOLS_PATH, ['GET'], async (request) => {
        const preset = new URL(request.url).searchParams.get('preset') ?? '';
        if (preset.length > 256 || preset.includes('\0'))
            return workbenchJson({ error: 'Agent 预设无效。' }, 400);
        try {
            return workbenchJson({ tools: await workbenchToolChoices(ctx, preset) });
        }
        catch (error) {
            return workbenchJson({ error: error instanceof Error ? error.message : '无法读取工具目录。' }, 503);
        }
    });
}
export class WorkbenchRequestError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
function publicRobot({ appId, state, primary, enabled, alias, revision, access }) {
    const { c2cMode, groupMode, commandMode, c2cAllow, groupAllow } = access;
    return { appId, state, primary, enabled, alias, revision, access: { c2cMode, groupMode, commandMode, c2cAllow, groupAllow } };
}
async function readPatch(request) {
    const text = await request.text();
    if (Buffer.byteLength(text) > 512 * 1024)
        throw new Error('机器人配置请求过大。');
    const { appId, revision, enabled, alias, appSecret, access } = robotObject(JSON.parse(text), ['appId', 'revision', 'enabled', 'alias', 'appSecret', 'access']);
    const patch = {
        appId: robotAppId(appId),
        revision: revision === null ? null : robotRevision(revision),
        ...(enabled === undefined ? {} : { enabled: robotEnabled(enabled) }),
        ...(alias === undefined ? {} : { alias: robotAlias(alias) }),
        ...(appSecret === undefined ? {} : { appSecret: robotSecret(appSecret) }),
        ...(access === undefined ? {} : { access: robotAccessPatch(access) }),
    };
    if (patch.revision === null && patch.appSecret === undefined)
        throw new Error('添加机器人时需要填写 AppSecret。');
    return patch;
}
export function workbenchJson(data, status = 200) {
    return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function registerWorkbenchFetch(ctx, path, methods, handle, onDispose) {
    ctx.inject(['connection'], scope => {
        const connection = scope.get('connection');
        const registry = connection?.fetch;
        // The exact Fetch registry admits only owners. Older hosts leave the endpoint unavailable.
        if (typeof registry?.register !== 'function')
            return;
        scope.effect(() => {
            let active = true;
            const unregister = registry.register({
                path,
                methods,
                requestBody: 'buffered',
                fetch: async (request) => {
                    const assertActive = () => {
                        if (!active)
                            throw new WorkbenchRequestError(503, 'QQ 插件已重载，请刷新后重试。');
                        if (request.signal.aborted)
                            throw new WorkbenchRequestError(400, '请求已取消。');
                    };
                    try {
                        assertActive();
                        return await handle(request, assertActive);
                    }
                    catch (error) {
                        if (error instanceof WorkbenchRequestError)
                            return workbenchJson({ error: error.message }, error.status);
                        if (error instanceof RobotConfigConflictError)
                            return workbenchJson({ error: error.message }, 409);
                        return workbenchJson({ error: 'QQ 工作台数据暂时不可用，请检查运行状态。' }, 503);
                    }
                },
            });
            return () => {
                active = false;
                onDispose?.();
                return unregister();
            };
        }, `im-qqbot.workbench:${path}`);
    });
}
export function registerWorkbenchRobotBinding(ctx, saveRobot, createBinding) {
    let attempt;
    const clearAttempt = () => {
        if (!attempt)
            return;
        const previous = attempt;
        attempt = undefined;
        clearTimeout(previous.timer);
        previous.service.dispose();
    };
    const submit = (current, credentials) => {
        if (current.submission)
            return current.submission;
        current.service.dispose();
        current.result = { phase: 'saving' };
        current.submission = (async () => {
            try {
                const appId = robotAppId(credentials.appId);
                const appSecret = robotSecret(credentials.appSecret);
                const userOpenid = credentials.userOpenid;
                const robot = await saveRobot({ appId, appSecret, revision: null,
                    ...(userOpenid ? { access: robotAccessPatch({ c2cMode: 'allowlist', c2cAllow: [userOpenid] }) } : {}),
                });
                return { phase: 'bound', robot: publicRobot(robot) };
            }
            catch (error) {
                return { phase: 'failed', reason: error instanceof RobotConfigConflictError
                        || (error instanceof WorkbenchRequestError && error.status === 409)
                        ? '这个机器人已添加，请在机器人列表中选择它。' : '绑定未保存，请核对凭据后重试。' };
            }
        })().then(result => {
            current.result = result;
            if (result.phase === 'failed')
                current.submission = undefined;
            return result;
        });
        return current.submission;
    };
    registerWorkbenchFetch(ctx, WORKBENCH_ROBOT_BIND_PATH, ['GET', 'POST'], async (request, assertWritable) => {
        if (request.method === 'GET') {
            if (!attempt || new URL(request.url).searchParams.get('id') !== attempt.id) {
                throw new WorkbenchRequestError(404, '绑定已结束，请刷新二维码。');
            }
            return workbenchJson(attempt.result ?? attempt.service.wireState());
        }
        const text = await request.text();
        let body;
        try {
            if (Buffer.byteLength(text) > 4096)
                throw new Error();
            body = robotObject(JSON.parse(text), ['action', 'id', 'appId', 'appSecret']);
        }
        catch {
            throw new WorkbenchRequestError(400, '绑定请求无效。');
        }
        const { action, id } = body;
        if (typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)) {
            throw new WorkbenchRequestError(400, '绑定标识无效。');
        }
        assertWritable();
        if (action === 'start') {
            if (attempt?.submission && attempt.result?.phase === 'saving') {
                throw new WorkbenchRequestError(409, '正在保存机器人，请稍候。');
            }
            clearAttempt();
            const service = createBinding();
            const timer = setTimeout(() => { if (attempt === current)
                clearAttempt(); }, 10 * 60_000);
            timer.unref();
            const current = { id, service, timer };
            attempt = current;
            void service.start().then(credentials => {
                if (credentials && attempt === current)
                    return submit(current, credentials);
            }).catch(() => {
                if (attempt === current)
                    attempt.result = { phase: 'failed', reason: '无法生成二维码，请刷新后重试。' };
            });
            return workbenchJson(service.wireState());
        }
        if (action === 'cancel') {
            if (attempt?.id === id && attempt.result?.phase !== 'saving')
                clearAttempt();
            return workbenchJson({ ok: true });
        }
        if (action === 'manual') {
            const current = attempt;
            if (!current || current.id !== id)
                throw new WorkbenchRequestError(404, '绑定已结束，请刷新二维码。');
            let credentials;
            try {
                credentials = { appId: robotAppId(body.appId), appSecret: robotSecret(body.appSecret) };
            }
            catch {
                throw new WorkbenchRequestError(400, '请填写有效的 AppID 和 AppSecret。');
            }
            return workbenchJson(await submit(current, credentials));
        }
        throw new WorkbenchRequestError(400, '绑定操作无效。');
    }, clearAttempt);
}
export function registerWorkbenchRoutes(ctx, listRobots, saveRobot) {
    registerWorkbenchFetch(ctx, WORKBENCH_ROBOTS_PATH, saveRobot ? ['GET', 'POST'] : ['GET'], async (request, assertWritable) => {
        if (request.method === 'GET') {
            const response = { robots: listRobots().map(publicRobot) };
            return workbenchJson(response);
        }
        if (request.method !== 'POST' || !saveRobot)
            return workbenchJson({ error: '不支持的请求方法。' }, 405);
        let patch;
        try {
            patch = await readPatch(request);
        }
        catch (error) {
            return workbenchJson({ error: error instanceof Error && !(error instanceof SyntaxError) ? error.message : '机器人配置格式无效。' }, 400);
        }
        assertWritable();
        return workbenchJson({ robot: publicRobot(await saveRobot(patch)) });
    });
}
export function registerWorkbenchDefaults(ctx, robots) {
    registerWorkbenchFetch(ctx, WORKBENCH_DEFAULTS_PATH, ['GET', 'POST'], async (request, assertWritable) => {
        if (request.method === 'GET') {
            let appId;
            try {
                appId = robotAppId(new URL(request.url).searchParams.get('appId'));
            }
            catch {
                throw new WorkbenchRequestError(400, '请指定一个有效的 AppID。');
            }
            return workbenchJson(robots.defaults(appId));
        }
        let appId;
        let next;
        try {
            const text = await request.text();
            if (Buffer.byteLength(text) > 512 * 1024)
                throw new Error('默认设置请求过大。');
            const row = robotObject(JSON.parse(text), ['appId', 'revision', 'settings']);
            appId = robotAppId(row.appId);
            next = { revision: robotRevision(row.revision), settings: parseAgentSettings(row.settings) };
        }
        catch (error) {
            throw new WorkbenchRequestError(400, error instanceof Error && !(error instanceof SyntaxError) ? error.message : '默认设置格式无效。');
        }
        return workbenchJson(await robots.saveDefaults(appId, next, assertWritable));
    });
}
//# sourceMappingURL=workbench-routes.js.map