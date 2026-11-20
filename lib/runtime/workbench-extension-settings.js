import { readFileSync } from 'node:fs';
import { atomicWrite } from "../shared/atomic-file.js";
import { WORKBENCH_EXTENSION_SETTINGS_PATH, } from "../shared/workbench-extension.js";
import { robotAppId, robotObject, robotRevision } from "./robot-config.js";
import { validOpenId } from "./workbench-conversations.js";
import { registerWorkbenchFetch, workbenchJson, WorkbenchRequestError } from "./workbench-routes.js";
const globalScope = { kind: 'global' };
function record(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('扩展配置格式无效。');
    return value;
}
function extensionId(value) {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value))
        throw new Error('扩展 ID 无效。');
    return value;
}
function parseScope(input) {
    const { kind, appId, scope, openId } = robotObject(input, ['kind', 'appId', 'scope', 'openId']);
    if (kind === 'global' && appId === undefined && scope === undefined && openId === undefined)
        return globalScope;
    if (kind === 'robot' && scope === undefined && openId === undefined)
        return { kind, appId: robotAppId(appId) };
    if (kind === 'conversation' && (scope === 'group' || scope === 'c2c') && validOpenId(openId)) {
        return { kind, appId: robotAppId(appId), scope, openId };
    }
    throw new Error('扩展配置范围无效。');
}
function scopeKey(id, scope) {
    switch (scope.kind) {
        case 'global': return JSON.stringify([id]);
        case 'robot': return JSON.stringify([id, scope.appId]);
        case 'conversation': return JSON.stringify([id, scope.appId, scope.scope, scope.openId]);
    }
}
function inheritance(scope) {
    switch (scope.kind) {
        case 'global': return [globalScope];
        case 'robot': return [globalScope, scope];
        case 'conversation': return [globalScope, { kind: 'robot', appId: scope.appId }, scope];
    }
}
function validateOverrides(definition, input) {
    const parsed = definition.parseOverrides(robotObject(input, Object.keys(definition.defaults)));
    robotObject(parsed, Object.keys(definition.defaults));
    return parsed;
}
export class WorkbenchExtensionSettings {
    path;
    definitions = new Map();
    constructor(path) {
        this.path = path;
    }
    registerSettings(definition) {
        const id = extensionId(definition.id);
        if (this.definitions.has(id))
            throw new Error(`Duplicate QQ extension settings: ${id}`);
        const registered = { ...definition, defaults: structuredClone(definition.defaults) };
        validateOverrides(registered, registered.defaults);
        this.definitions.set(id, registered);
        return () => {
            if (this.definitions.get(id) === registered)
                this.definitions.delete(id);
        };
    }
    getSettings(id, scope) {
        const definition = this.definition(id);
        return this.resolve(definition, parseScope(scope), this.read());
    }
    saveSettings(id, scope, revision, input) {
        const definition = this.definition(id);
        const key = scopeKey(id, scope);
        const rows = this.read();
        if (revision !== (rows.get(key)?.revision ?? 0)) {
            throw new WorkbenchRequestError(409, '扩展设置已变更，请重新读取后再保存。');
        }
        const overrides = clientInput(() => validateOverrides(definition, input));
        rows.set(key, { revision: revision + 1, overrides });
        const snapshot = this.resolve(definition, scope, rows);
        atomicWrite(this.path, [JSON.stringify({ version: 1, rows: Object.fromEntries(rows) }), '\n']);
        return snapshot;
    }
    definition(id) {
        const definition = this.definitions.get(id);
        if (!definition)
            throw new WorkbenchRequestError(404, '此 QQ 扩展未安装或尚未注册设置。');
        return definition;
    }
    read() {
        let text;
        try {
            text = readFileSync(this.path, 'utf8');
        }
        catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
                return new Map();
            throw error;
        }
        const { version, rows } = record(JSON.parse(text));
        if (version !== 1)
            throw new Error('扩展配置存储版本无效。');
        return new Map(Object.entries(record(rows)).map(([key, value]) => {
            const { revision, overrides } = record(value);
            return [key, { revision: robotRevision(revision), overrides: record(overrides) }];
        }));
    }
    resolve(definition, scope, rows) {
        const effective = new Map(Object.entries(definition.defaults));
        const sources = new Map(Array.from(effective.keys(), key => [key, 'default']));
        let revision = 0;
        let overrides = {};
        for (const layer of inheritance(scope)) {
            const saved = rows.get(scopeKey(definition.id, layer));
            if (saved) {
                const parsed = validateOverrides(definition, saved.overrides);
                for (const [key, value] of Object.entries(parsed)) {
                    effective.set(key, value);
                    sources.set(key, layer.kind);
                }
                if (layer.kind === scope.kind) {
                    revision = saved.revision;
                    overrides = parsed;
                }
            }
        }
        return structuredClone({ revision, overrides, effective: Object.fromEntries(effective), sources: Object.fromEntries(sources) });
    }
}
function clientInput(parse) {
    try {
        return parse();
    }
    catch (error) {
        throw new WorkbenchRequestError(400, error instanceof Error ? error.message : '扩展配置格式无效。');
    }
}
export function registerWorkbenchExtensionSettings(ctx, settings, hasRobot) {
    registerWorkbenchFetch(ctx, WORKBENCH_EXTENSION_SETTINGS_PATH, ['GET', 'POST'], async (request, assertWritable) => {
        const text = request.method === 'POST' ? await request.text() : undefined;
        const { id, scope, revision, overrides } = clientInput(() => {
            if (text !== undefined) {
                if (Buffer.byteLength(text) > 64 * 1024)
                    throw new Error('扩展设置请求过大。');
                const body = robotObject(JSON.parse(text), ['id', 'scope', 'revision', 'overrides']);
                return { id: extensionId(body.id), scope: parseScope(body.scope), revision: robotRevision(body.revision), overrides: body.overrides };
            }
            const entries = [...new URL(request.url).searchParams];
            const params = Object.fromEntries(entries);
            if (entries.length !== Object.keys(params).length)
                throw new Error('扩展设置请求包含重复参数。');
            const { id: rawId, ...rawScope } = params;
            return { id: extensionId(rawId), scope: parseScope(rawScope) };
        });
        if (scope.kind !== 'global' && !hasRobot(scope.appId))
            throw new WorkbenchRequestError(404, '找不到对应机器人。');
        if (revision === undefined)
            return workbenchJson(settings.getSettings(id, scope));
        assertWritable();
        return workbenchJson(settings.saveSettings(id, scope, revision, overrides));
    });
}
//# sourceMappingURL=workbench-extension-settings.js.map