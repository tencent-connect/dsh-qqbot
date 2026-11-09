import { readFileSync, statSync } from 'node:fs';
import { legacyDerivedSessionId } from "../session/session-id.js";
import { atomicWrite } from "../shared/atomic-file.js";
import { WORKBENCH_CONVERSATIONS_PATH, } from "../shared/workbench-conversation-protocol.js";
import { allowsConversation } from "./account-service.js";
import { robotAppId, robotObject, robotRevision } from "./robot-config.js";
import { WORKBENCH_TIMELINE_PATH } from "../shared/workbench-timeline-protocol.js";
import { registerWorkbenchFetch, workbenchJson, WorkbenchRequestError } from "./workbench-routes.js";
const defaults = Object.freeze({ alias: '', receiving: true, recording: true, revision: 0 });
export const peerKey = (appId, scope, openId) => `qqbot:${appId}:${scope}:${openId}`;
function validOpenId(value) {
    return typeof value === 'string' && /^\S{1,1024}$/.test(value) && !/[\x00-\x1f\x7f]/.test(value);
}
function parsePeer(appId, key) {
    const prefix = `qqbot:${appId}:`;
    if (!key.startsWith(prefix))
        return undefined;
    const value = key.slice(prefix.length);
    const separator = value.indexOf(':');
    const scope = value.slice(0, separator);
    const openId = value.slice(separator + 1);
    if ((scope !== 'c2c' && scope !== 'group') || !validOpenId(openId))
        return undefined;
    return { scope, openId };
}
function aliasValue(value) {
    if (typeof value !== 'string' || value.length > 120 || /[\x00-\x1f\x7f]/.test(value))
        throw new Error('会话别名格式无效。');
    return value.trim();
}
function receivingValue(value) {
    if (typeof value !== 'boolean')
        throw new Error('会话接收状态无效。');
    return value;
}
export class ConversationSettingsStore {
    path;
    cache;
    seenFile = false;
    constructor(path) {
        this.path = path;
    }
    get(key) {
        return this.read().get(key) ?? defaults;
    }
    keys(appId) {
        return [...this.read().keys()].filter(key => key.startsWith(`qqbot:${appId}:`));
    }
    save(key, patch) {
        const records = new Map(this.read());
        const current = records.get(key) ?? defaults;
        if (patch.revision !== current.revision)
            throw new WorkbenchRequestError(409, '会话设置已更新，请重新加载后再保存。');
        const next = Object.freeze({
            alias: patch.alias ?? current.alias,
            receiving: patch.receiving ?? current.receiving,
            recording: patch.recording ?? current.recording,
            revision: robotRevision(current.revision + 1),
        });
        records.set(key, next);
        atomicWrite(this.path, [JSON.stringify({ version: 1, peers: Object.fromEntries(records) })]);
        this.seenFile = true;
        this.cache = undefined;
        return next;
    }
    read() {
        let stats;
        try {
            stats = statSync(this.path);
        }
        catch (error) {
            if (error.code === 'ENOENT' && !this.seenFile)
                return new Map();
            throw error;
        }
        this.seenFile = true;
        const signature = `${stats.ino}:${stats.mtimeMs}:${stats.size}`;
        if (this.cache?.signature === signature)
            return this.cache.records;
        const root = robotObject(JSON.parse(readFileSync(this.path, 'utf8')), ['version', 'peers']);
        if (root.version !== 1 || !root.peers || typeof root.peers !== 'object' || Array.isArray(root.peers))
            throw new Error('QQ 会话设置格式无效。');
        const records = new Map(Object.entries(root.peers).map(([key, raw]) => {
            const value = robotObject(raw, ['alias', 'receiving', 'recording', 'revision']);
            return [key, Object.freeze({ alias: aliasValue(value.alias), receiving: receivingValue(value.receiving), recording: value.recording === undefined ? true : recordingValue(value.recording), revision: robotRevision(value.revision) })];
        }));
        this.cache = { signature, records };
        return records;
    }
}
function recordingValue(value) {
    if (typeof value !== 'boolean')
        throw new Error('QQ 消息保存开关无效。');
    return value;
}
function getPersistence(ctx) {
    try {
        const value = ctx.get('sessionPersistence');
        return typeof value?.stat === 'function' ? value : undefined;
    }
    catch {
        return undefined;
    }
}
async function projectConversations(robots, appId, persistence, target) {
    const account = robots.conversationAccount(appId);
    if (!account)
        throw new WorkbenchRequestError(404, '找不到这个 QQ 机器人。');
    if (!persistence)
        throw new WorkbenchRequestError(503, '此 DSH 宿主没有可用的会话持久化接口，暂时无法读取 Session。');
    const bindings = new Map(robots.prefs.listSessionBindings(appId).map(binding => [binding.key, binding]));
    const keys = new Set([
        ...bindings.keys(), ...robots.conversationSettings.keys(appId),
        ...robots.timeline.peers(appId).map(({ scope, openId }) => peerKey(appId, scope, openId)),
        ...account.access.groupAllow.map(id => peerKey(appId, 'group', id)),
        ...account.access.c2cAllow.map(id => peerKey(appId, 'c2c', id)),
    ]);
    const readSession = async (id) => {
        const header = (await persistence.stat(id))?.header;
        const createdAt = header?.createdAt;
        if (!header || (header.id !== undefined && header.id !== id) || typeof createdAt !== 'number' || !Number.isSafeInteger(createdAt) || createdAt < 0)
            return undefined;
        return { id, createdAt, cwd: header.cwd, preset: header.agentPreset };
    };
    const peers = [];
    for (const key of keys) {
        const peer = parsePeer(appId, key);
        if (peer && (!target || (peer.scope === target.scope && peer.openId === target.openId)))
            peers.push({ key, ...peer });
    }
    const conversations = [];
    // Bound concurrent stat calls independently of the number of retained peer mappings.
    for (let offset = 0; offset < peers.length; offset += 12) {
        conversations.push(...await Promise.all(peers.slice(offset, offset + 12).map(async ({ key, scope, openId }) => {
            const binding = bindings.get(key);
            const current = account.liveSessionId(scope, openId) ?? binding?.current ?? legacyDerivedSessionId(key);
            const ids = new Set([current, ...(binding?.history ?? [])]);
            const sessions = [];
            for (const id of ids) {
                const session = await readSession(id);
                if (session)
                    sessions.push(session);
            }
            sessions.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
            return {
                scope, openId, name: account.peerName(scope, openId),
                ...robots.conversationSettings.get(key),
                admitted: allowsConversation(account.access, scope, openId),
                currentSessionId: sessions.some(session => session.id === current) ? current : undefined,
                sessions,
            };
        })));
    }
    return conversations;
}
async function parsePatch(request) {
    const text = await request.text();
    if (Buffer.byteLength(text) > 8192)
        throw new Error('会话设置请求过大。');
    const value = robotObject(JSON.parse(text), ['appId', 'scope', 'openId', 'revision', 'alias', 'receiving', 'recording']);
    if ((value.scope !== 'c2c' && value.scope !== 'group') || !validOpenId(value.openId))
        throw new Error('QQ 会话地址无效。');
    if (value.alias === undefined && value.receiving === undefined && value.recording === undefined)
        throw new Error('缺少要保存的会话设置。');
    return {
        appId: robotAppId(value.appId), scope: value.scope, openId: value.openId, revision: robotRevision(value.revision),
        ...(value.alias === undefined ? {} : { alias: aliasValue(value.alias) }),
        ...(value.receiving === undefined ? {} : { receiving: receivingValue(value.receiving) }),
        ...(value.recording === undefined ? {} : { recording: recordingValue(value.recording) }),
    };
}
export function registerWorkbenchConversations(ctx, robots, logger) {
    registerWorkbenchFetch(ctx, WORKBENCH_TIMELINE_PATH, ['GET'], async (request) => {
        if (request.method !== 'GET')
            return workbenchJson({ error: '不支持的请求方法。' }, 405);
        const query = new URL(request.url).searchParams;
        let appId;
        const scope = query.get('scope');
        const openId = query.get('openId');
        const before = query.get('before') ?? undefined;
        try {
            if (['appId', 'scope', 'openId', 'before'].some(key => query.getAll(key).length > 1))
                throw new Error();
            appId = robotAppId(query.get('appId'));
            if ((scope !== 'group' && scope !== 'c2c') || !validOpenId(openId)
                || (before !== undefined && !/^[a-f0-9-]{36,64}$/.test(before)))
                throw new Error();
        }
        catch {
            return workbenchJson({ error: 'QQ 流水查询参数无效。' }, 400);
        }
        if (!robots.conversationAccount(appId))
            return workbenchJson({ error: '找不到这个 QQ 机器人。' }, 404);
        try {
            const page = robots.timeline.page(appId, { scope, targetId: openId }, before);
            return page ? workbenchJson(page) : workbenchJson({ error: '该页记录已不可用，请刷新。' }, 404);
        }
        catch {
            return workbenchJson({ error: 'QQ 流水读取失败，记录可能不完整。' }, 503);
        }
    });
    registerWorkbenchFetch(ctx, WORKBENCH_CONVERSATIONS_PATH, ['GET', 'POST'], async (request, assertWritable) => {
        const persistence = getPersistence(ctx);
        if (request.method === 'GET') {
            let appId;
            try {
                const ids = new URL(request.url).searchParams.getAll('appId');
                if (ids.length !== 1)
                    throw new Error();
                appId = robotAppId(ids[0]);
            }
            catch {
                return workbenchJson({ error: '请指定一个有效的 AppID。' }, 400);
            }
            try {
                return workbenchJson({ conversations: await projectConversations(robots, appId, persistence) });
            }
            catch (error) {
                if (!(error instanceof WorkbenchRequestError))
                    logger.warn('QQ 工作台无法读取会话或宿主持久化。');
                throw error;
            }
        }
        if (request.method !== 'POST')
            return workbenchJson({ error: '不支持的请求方法。' }, 405);
        let patch;
        try {
            patch = await parsePatch(request);
        }
        catch (error) {
            return workbenchJson({ error: error instanceof Error && !(error instanceof SyntaxError) ? error.message : '会话设置格式无效。' }, 400);
        }
        const [conversation] = await projectConversations(robots, patch.appId, persistence, patch);
        if (!conversation)
            throw new WorkbenchRequestError(404, '这个 QQ 会话尚未登记。');
        assertWritable();
        const settings = robots.conversationSettings.save(peerKey(patch.appId, patch.scope, patch.openId), patch);
        return workbenchJson({ conversation: { ...conversation, ...settings } });
    });
}
//# sourceMappingURL=workbench-conversations.js.map