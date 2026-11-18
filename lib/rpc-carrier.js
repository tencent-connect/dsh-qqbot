function ok(value) {
    return { ok: true, value };
}
function failure(code, message) {
    return { ok: false, error: { code, message, details: {} } };
}
function rpcResponse(rpcId, result) {
    return Response.json({ type: 'server-response', rpcId, result }, { headers: { 'cache-control': 'no-store' } });
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** 解析客户端信封 {type:'client-request', rpcId, method, payload:{method,payload}} */
function parseEnvelope(message, endpoint) {
    if (!isRecord(message))
        return undefined;
    if (message.type !== 'client-request')
        return undefined;
    if (message.method !== endpoint)
        return undefined;
    const rpcId = message.rpcId;
    if (typeof rpcId !== 'string')
        return undefined;
    const call = message.payload;
    if (!isRecord(call) || typeof call.method !== 'string' || !Object.hasOwn(call, 'payload'))
        return undefined;
    if (!isRecord(call.payload))
        return undefined;
    return { rpcId, method: call.method, payload: call.payload };
}
/**
 * 注册一个插件 RPC 端点。ctx.inject(['connection']) 子 fiber 内注册：
 * connection 服务缺席（极老宿主）时静默跳过；fiber 卸载时路由随之注销。
 *
 * @returns 注入子 fiber（thenable + dispose）：dispose 即注销该端点全部
 *          路由；HMR 时宿主随插件 fiber 卸载自动调用，调用方通常无需触碰。
 */
export function registerPluginRpc(ctx, endpoint, handler) {
    return ctx.inject(['connection'], (scoped) => {
        const registry = scoped.get('connection')?.fetch;
        if (typeof registry?.register !== 'function')
            return;
        const connection = registry;
        let disposed = false;
        const stop = connection.register({
            path: `/api/${endpoint}`,
            methods: ['POST'],
            requestBody: 'buffered',
            fetch: async (request) => {
                if (request.method !== 'POST')
                    return new Response('method not allowed', { status: 405 });
                const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
                if (contentType !== 'application/json') {
                    return new Response('content type must be application/json', { status: 415 });
                }
                let message;
                try {
                    const body = await request.text();
                    if (Buffer.byteLength(body) > 512 * 1024)
                        return new Response('body is too large', { status: 413 });
                    message = JSON.parse(body);
                }
                catch {
                    return new Response('body is not JSON', { status: 400 });
                }
                const call = parseEnvelope(message, endpoint);
                if (call === undefined) {
                    const rpcId = isRecord(message) && typeof message.rpcId === 'string' ? message.rpcId : 'invalid-request';
                    return rpcResponse(rpcId, failure('qqbot/bad-request', '无效的请求信封'));
                }
                if (disposed) {
                    return rpcResponse(call.rpcId, failure('plugin/reloading', 'QQ 插件已重载，请刷新后重试。'));
                }
                if (request.signal.aborted) {
                    return rpcResponse(call.rpcId, failure('qqbot/cancelled', '请求已取消'));
                }
                let result;
                try {
                    result = await handler(call.method, call.payload, request.signal);
                }
                catch (error) {
                    result = failure('qqbot/internal', error instanceof Error ? error.message : String(error));
                }
                return rpcResponse(call.rpcId, result);
            },
        });
        // 宿主注册表按 fiber 记账自动清理；disposer 兜底（幂等）
        scoped.effect(() => () => {
            disposed = true;
            void Promise.resolve().then(stop).catch(() => undefined);
        }, `im-qqbot.rpc.${endpoint}`);
    });
}
export { ok as rpcOk, failure as rpcFailure };
//# sourceMappingURL=rpc-carrier.js.map