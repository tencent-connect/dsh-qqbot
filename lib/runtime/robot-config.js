import { readFileSync } from 'node:fs';
import { atomicWrite } from "../shared/atomic-file.js";
export class RobotConfigConflictError extends Error {
    constructor() {
        super('机器人配置已修改，请重新加载后再保存。');
    }
}
export function robotAppId(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
        throw new Error('AppID 格式无效。');
    return value;
}
export function robotRevision(value) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
        throw new Error('配置版本无效。');
    return value;
}
export function robotAlias(value) {
    if (typeof value !== 'string' || value.length > 120 || /[\x00-\x1f\x7f]/.test(value))
        throw new Error('机器人名称格式无效。');
    return value.trim();
}
export function robotSecret(value) {
    if (typeof value !== 'string' || !/^\S{1,512}$/.test(value) || /[\x00-\x1f\x7f]/.test(value))
        throw new Error('AppSecret 格式无效。');
    return value;
}
export function robotEnabled(value) {
    if (typeof value !== 'boolean')
        throw new Error('启用状态无效。');
    return value;
}
export function robotObject(value, fields) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('机器人配置格式无效。');
    const record = value;
    if (Object.keys(record).some(key => !fields.includes(key)))
        throw new Error('机器人配置包含未知字段。');
    return record;
}
export function robotAccessPatch(input) {
    const fields = ['c2cMode', 'groupMode', 'commandMode', 'c2cAllow', 'groupAllow'];
    const value = robotObject(input, fields);
    const patch = {};
    for (const key of ['c2cMode', 'groupMode', 'commandMode']) {
        if (!Object.hasOwn(value, key))
            continue;
        const mode = value[key];
        if (mode !== 'open' && mode !== 'allowlist' && mode !== 'disabled')
            throw new Error('访问模式无效。');
        patch[key] = mode;
    }
    for (const key of ['c2cAllow', 'groupAllow']) {
        if (!Object.hasOwn(value, key))
            continue;
        const ids = value[key];
        if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !/^\S{1,1024}$/.test(id) || id.includes('\0'))) {
            throw new Error('白名单 OpenID 格式无效。');
        }
        patch[key] = [...new Set(ids)];
    }
    return patch;
}
function parseRecord(input) {
    const fields = ['appId', 'revision', 'enabled', 'alias', 'kind'];
    if (input && typeof input === 'object' && 'kind' in input && input.kind === 'primary') {
        const value = robotObject(input, fields);
        return { kind: 'primary', appId: robotAppId(value.appId), revision: robotRevision(value.revision), enabled: robotEnabled(value.enabled), alias: robotAlias(value.alias) };
    }
    const value = robotObject(input, [...fields, 'appSecret', 'access']);
    if (value.kind !== 'additional')
        throw new Error('机器人配置类型无效。');
    const { c2cMode, groupMode, commandMode, c2cAllow, groupAllow } = robotAccessPatch(value.access);
    if (!c2cMode || !groupMode || !commandMode || !c2cAllow || !groupAllow)
        throw new Error('机器人访问配置不完整。');
    return {
        kind: 'additional', appId: robotAppId(value.appId), revision: robotRevision(value.revision),
        enabled: robotEnabled(value.enabled), alias: robotAlias(value.alias), appSecret: robotSecret(value.appSecret),
        access: { c2cMode, groupMode, commandMode, c2cAllow, groupAllow },
    };
}
export class RobotConfigStore {
    path;
    constructor(path) {
        this.path = path;
    }
    list() {
        let data;
        try {
            data = readFileSync(this.path, 'utf8');
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return [];
            throw error;
        }
        try {
            const { version, robots } = robotObject(JSON.parse(data), ['version', 'robots']);
            if (version !== 1 || !Array.isArray(robots))
                throw new Error();
            const records = robots.map(parseRecord);
            if (new Set(records.map(record => record.appId)).size !== records.length || records.some(record => record.revision === 0)) {
                throw new Error();
            }
            return records;
        }
        catch {
            throw new Error('机器人配置目录无法读取，请检查保存的数据。');
        }
    }
    get(appId) {
        return this.list().find(record => record.appId === appId);
    }
    /** CAS prevents an old browser draft from reapplying a list that was changed separately. */
    save(record) {
        const records = this.list();
        const index = records.findIndex(existing => existing.appId === record.appId);
        const current = records[index];
        if (record.revision !== (current?.revision ?? 0) || (current && current.kind !== record.kind)) {
            throw new RobotConfigConflictError();
        }
        const access = record.kind === 'additional' ? { ...record.access, commandMode: record.access.commandMode ?? 'open' } : undefined;
        const next = parseRecord({
            ...record,
            ...(access ? { access } : {}),
            revision: record.revision + 1,
        });
        if (index < 0)
            records.push(next);
        else
            records[index] = next;
        atomicWrite(this.path, [JSON.stringify({ version: 1, robots: records })]);
        return next;
    }
}
//# sourceMappingURL=robot-config.js.map