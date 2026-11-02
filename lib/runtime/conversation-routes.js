import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { CONVERSATIONS_PATH } from "../shared/conversation-protocol.js";
import { PAIR_ISSUE_PATH, PAIR_MANUAL_PATH, PAIR_RENAME_PATH, PAIR_REVOKE_PATH, PAIR_STATUS_PATH } from "../shared/pairing-protocol.js";
import { ConversationConflictError } from "../conversations/index.js";
export function registerConversationRoutes(ctx, service) {
    ctx.inject(['webServer'], scoped => {
        const server = scoped.get('webServer');
        const handler = async (req, res) => {
            try {
                if (req.method === 'GET') {
                    const url = new URL(req.url ?? CONVERSATIONS_PATH, 'http://localhost');
                    if (url.pathname.endsWith('/detail'))
                        return json(res, 200, service.requireEntry(url.searchParams.get('key') ?? ''));
                    return json(res, 200, service.snapshot());
                }
                if (req.method !== 'POST')
                    return json(res, 405, { error: 'Method not allowed' });
                // These routes inherit Host authentication. Reject browser cross-origin writes too.
                if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
                    return json(res, 403, { error: '跨来源请求被拒绝' });
                const body = await readBody(req);
                const suffix = new URL(req.url ?? CONVERSATIONS_PATH, 'http://localhost').pathname.slice(CONVERSATIONS_PATH.length);
                const action = ['/defaults', '/settings', '/lifecycle', '/timeline'].includes(suffix) ? suffix.slice(1) : field(body, 'action');
                let result = {};
                if (action === 'owners') {
                    if (!Array.isArray(body.ownerIds) || body.ownerIds.some(id => typeof id !== 'string' || !id.trim()))
                        throw new Error('所有者标识无效');
                    service.store.setOwnerIds(body.ownerIds);
                }
                else if (action === 'defaults') {
                    if (!Number.isSafeInteger(body.expectedVersion))
                        throw new Error('默认设置版本无效');
                    await service.saveDefaults(Number(body.expectedVersion), body.settings);
                }
                else {
                    const key = field(body, 'key');
                    const entry = service.requireEntry(key);
                    const { scope, peerId } = entry;
                    const manager = service.manager;
                    const running = service.busy(key);
                    if (action === 'settings') {
                        if (!Number.isSafeInteger(body.expectedVersion) || typeof body.receiveEnabled !== 'boolean')
                            throw new Error('对话设置无效');
                        result.notice = await service.saveSettings(key, Number(body.expectedVersion), body.settings, field(body, 'alias', true), body.receiveEnabled);
                    }
                    else if (action === 'admit') {
                        if (typeof body.enabled !== 'boolean')
                            throw new Error('接收开关无效');
                        if (service.setAdmission(key, body.enabled))
                            result.notice = '访问规则已保存；QQ消息接收规则将在连接重载后生效。';
                    }
                    else if (action === 'policy') {
                        if (!Number.isSafeInteger(body.expectedVersion))
                            throw new Error('配置版本无效');
                        await service.savePolicy(key, Number(body.expectedVersion), body.policy, field(body, 'alias', true));
                    }
                    else if (action === 'lifecycle') {
                        if (running)
                            throw new Error('会话忙碌，请稍后修改生命周期');
                        if (!Number.isSafeInteger(body.expectedVersion))
                            throw new Error('配置版本无效');
                        service.store.updateLifecycle(key, Number(body.expectedVersion), body.lifecycle);
                    }
                    else if (action === 'clear-records') {
                        if (!Number.isSafeInteger(body.expectedRecordingVersion) || Number(body.expectedRecordingVersion) !== (service.store.get(key)?.recording?.version ?? 0))
                            throw new Error('记录设置已更新，请刷新后重试');
                        service.clearRecords(key);
                    }
                    else if (action === 'timeline') {
                        for (const name of ['before', 'after', 'snapshot', 'limit'])
                            if (body[name] !== undefined && (!Number.isSafeInteger(body[name]) || Number(body[name]) < 0))
                                throw new Error('时间线分页参数无效');
                        if (body.query !== undefined && (typeof body.query !== 'string' || body.query.length > 2000))
                            throw new Error('查询文字无效');
                        result.timeline = service.store.timeline(key, { before: typeof body.before === 'number' ? body.before : undefined, after: typeof body.after === 'number' ? body.after : undefined, snapshot: typeof body.snapshot === 'number' ? body.snapshot : undefined, limit: typeof body.limit === 'number' ? body.limit : undefined, query: typeof body.query === 'string' ? body.query : undefined });
                    }
                    else if (action === 'create-session') {
                        if (body.expectedCurrentSessionId !== null && typeof body.expectedCurrentSessionId !== 'string')
                            throw new Error('当前会话标识无效');
                        if (!Number.isSafeInteger(body.expectedPolicyVersion))
                            throw new Error('配置版本无效');
                        result.sessionId = await service.createSession(key, { operationId: field(body, 'operationId'), expectedCurrentSessionId: body.expectedCurrentSessionId, expectedPolicyVersion: Number(body.expectedPolicyVersion), workspaceId: field(body, 'workspaceId'), presetId: field(body, 'presetId') });
                    }
                    else if (action === 'unarchive') {
                        await service.unarchive(key, field(body, 'sessionId'));
                    }
                    else if (action === 'messages') {
                        if (body.before !== undefined && (!Number.isSafeInteger(body.before) || Number(body.before) < 0))
                            throw new Error('分页位置无效');
                        result.messages = service.store.messages(key, { before: typeof body.before === 'number' ? body.before : undefined, query: typeof body.query === 'string' ? body.query : undefined });
                    }
                    else if (action === 'deliveries')
                        result.deliveries = service.store.deliveries(key);
                    else if (action === 'send') {
                        const source = body.sourceSessionId === undefined && body.sourceMessageId === undefined ? undefined
                            : { sessionId: field(body, 'sourceSessionId'), messageId: field(body, 'sourceMessageId') };
                        result.delivery = await service.send(key, field(body, 'operationId'), field(body, 'text'), source);
                    }
                    else if (action === 'analyze')
                        throw new Error('本地分析已合并到当前聊天，请使用仅网页回复');
                    else if (action === 'stop')
                        (await manager.restoreExisting(scope, peerId))?.agent.cancel({ kind: 'user' }, { keepInbox: true });
                    else {
                        service.assertCurrentSession(key, body.sessionId);
                        if (running)
                            throw new Error('会话正在生成，请停止后再修改');
                        if (action === 'workspace') {
                            const record = await service.selectWorkspace(key, field(body, 'workspaceId'));
                            result.sessionId = record.sessionId;
                        }
                        else if (action === 'reset')
                            await manager.remove(scope, peerId);
                        else if (action === 'model') {
                            const value = field(body, 'value');
                            await manager.restoreExisting(scope, peerId);
                            if (value === 'reset' || value === 'default')
                                await manager.clearModelOverride(scope, peerId);
                            else {
                                const slash = value.indexOf('/');
                                if (slash < 1)
                                    throw new Error('模型必须为 provider/model');
                                await manager.setModelOverride(scope, peerId, { provider: value.slice(0, slash), model: value.slice(slash + 1), ...(body.reasoningEffort === undefined ? {} : { reasoningEffort: reasoningEffort(body.reasoningEffort) }) });
                            }
                        }
                        else if (action === 'preset') {
                            const value = field(body, 'value');
                            const switched = value === 'reset' || value === 'default' ? await manager.clearPresetOverride(scope, peerId) : await manager.setPresetOverride(scope, peerId, value);
                            if (!switched.ok)
                                throw new Error(switched.message ?? '预设切换失败');
                        }
                        else if (action === 'permission') {
                            const value = field(body, 'value');
                            await service.selectPermission(key, value);
                        }
                        else
                            throw new Error('未知操作');
                    }
                }
                result.snapshot = service.snapshot();
                json(res, 200, result);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : 'QQ 会话操作失败';
                json(res, error instanceof ConversationConflictError || /version|conflict|版本|冲突|已更新/i.test(message) ? 409 : 400, { error: message });
            }
        };
        const disposers = ['', '/action', '/detail', '/defaults', '/settings', '/lifecycle', '/recording', '/timeline'].map(suffix => server.register({ kind: 'exact', path: CONVERSATIONS_PATH + suffix, handler }));
        const pairHandler = async (req, res) => {
            try {
                if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
                    return json(res, 403, { error: '跨来源请求被拒绝' });
                const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
                if (pathname === PAIR_STATUS_PATH)
                    return json(res, 200, service.pairStatus());
                if (req.method !== 'POST')
                    return json(res, 405, { error: 'Method not allowed' });
                const body = await readBody(req);
                if (pathname === PAIR_ISSUE_PATH) {
                    const purpose = body.purpose;
                    if (purpose !== 'owner' && purpose !== 'allow-c2c' && purpose !== 'allow-group')
                        throw new Error('认领用途无效');
                    return json(res, 200, { ...service.issuePairCode(purpose), ...service.pairStatus() });
                }
                if (pathname === PAIR_MANUAL_PATH) {
                    const purpose = body.purpose;
                    if (purpose !== 'owner' && purpose !== 'allow-c2c' && purpose !== 'allow-group')
                        throw new Error('认领用途无效');
                    const openid = field(body, 'openid');
                    const result = service.addManualMember(purpose, openid);
                    return json(res, result.ok ? 200 : 400, { ...result, ...service.pairStatus() });
                }
                if (pathname === PAIR_RENAME_PATH) {
                    const openid = field(body, 'openid');
                    const nickname = typeof body.nickname === 'string' ? body.nickname : '';
                    const result = service.renameMember(openid, nickname);
                    return json(res, result.ok ? 200 : 400, { ...result, ...service.pairStatus() });
                }
                if (pathname === PAIR_REVOKE_PATH) {
                    const openid = field(body, 'openid');
                    const purpose = body.purpose;
                    if (purpose !== 'owner' && purpose !== 'allow-c2c' && purpose !== 'allow-group')
                        throw new Error('认领用途无效');
                    const result = service.revokePair(openid, purpose);
                    return json(res, result.ok ? 200 : 400, { ...result, ...service.pairStatus() });
                }
                return json(res, 404, { error: '未知配对操作' });
            }
            catch (error) {
                json(res, 400, { error: error instanceof Error ? error.message : '配对操作失败' });
            }
        };
        disposers.push(server.register({ kind: 'exact', path: PAIR_STATUS_PATH, handler: pairHandler }));
        disposers.push(server.register({ kind: 'exact', path: PAIR_ISSUE_PATH, handler: pairHandler }));
        disposers.push(server.register({ kind: 'exact', path: PAIR_REVOKE_PATH, handler: pairHandler }));
        disposers.push(server.register({ kind: 'exact', path: PAIR_MANUAL_PATH, handler: pairHandler }));
        disposers.push(server.register({ kind: 'exact', path: PAIR_RENAME_PATH, handler: pairHandler }));
        scoped.effect(() => () => { for (const dispose of disposers)
            dispose(); }, 'im-qqbot.conversations');
    });
}
function field(body, name, empty = false) {
    const value = body[name];
    if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > 100_000)
        throw new Error(`${name} 无效`);
    return value;
}
async function readBody(req) {
    let bytes = 0;
    const chunks = [];
    for await (const raw of req) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        bytes += chunk.length;
        if (bytes > 512 * 1024)
            throw new Error('请求过大');
        chunks.push(chunk);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('请求内容无效');
    return value;
}
function json(res, code, data) { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(data)); }
function reasoningEffort(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 120)
        throw new Error('推理强度无效');
    return ReasoningEffortId(value);
}
//# sourceMappingURL=conversation-routes.js.map