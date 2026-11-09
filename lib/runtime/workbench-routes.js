import { WORKBENCH_ROBOTS_PATH } from "../shared/workbench-protocol.js";
import { RobotConfigConflictError, robotAccessPatch, robotAlias, robotAppId, robotEnabled, robotObject, robotRevision, robotSecret } from "./robot-config.js";
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
function json(data, status = 200) {
    return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function registerWorkbenchRoutes(ctx, listRobots, saveRobot) {
    ctx.inject(['connection'], scope => {
        const connection = scope.get('connection');
        const registry = connection?.fetch;
        // The exact Fetch registry admits only owners. Older hosts leave the endpoint unavailable.
        if (typeof registry?.register !== 'function')
            return;
        scope.effect(() => {
            let active = true;
            const unregister = registry.register({
                path: WORKBENCH_ROBOTS_PATH,
                methods: saveRobot ? ['GET', 'POST'] : ['GET'],
                requestBody: 'buffered',
                fetch: async (request) => {
                    if (!active)
                        return json({ error: 'QQ 插件已重载，请刷新后重试。' }, 503);
                    try {
                        if (request.method === 'GET') {
                            const response = { robots: listRobots().map(publicRobot) };
                            return json(response);
                        }
                        if (request.method !== 'POST' || !saveRobot)
                            return json({ error: '不支持的请求方法。' }, 405);
                        let patch;
                        try {
                            patch = await readPatch(request);
                        }
                        catch (error) {
                            return json({ error: error instanceof Error && !(error instanceof SyntaxError) ? error.message : '机器人配置格式无效。' }, 400);
                        }
                        if (!active)
                            return json({ error: 'QQ 插件已重载，请刷新后重试。' }, 503);
                        if (request.signal.aborted)
                            return json({ error: '请求已取消。' }, 400);
                        return json({ robot: publicRobot(await saveRobot(patch)) });
                    }
                    catch (error) {
                        if (error instanceof WorkbenchRequestError)
                            return json({ error: error.message }, error.status);
                        if (error instanceof RobotConfigConflictError)
                            return json({ error: error.message }, 409);
                        return json({ error: '机器人配置暂时不可用，请检查运行状态。' }, 503);
                    }
                },
            });
            return () => {
                active = false;
                return unregister();
            };
        }, 'im-qqbot.workbench-robots');
    });
}
//# sourceMappingURL=workbench-routes.js.map