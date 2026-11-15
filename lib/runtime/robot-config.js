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
function parseAccess(input) {
    const { c2cMode, groupMode, commandMode, c2cAllow, groupAllow } = robotAccessPatch(input);
    if (!c2cMode || !groupMode || !commandMode || !c2cAllow || !groupAllow)
        throw new Error('机器人访问配置不完整。');
    return { c2cMode, groupMode, commandMode, c2cAllow, groupAllow };
}
function parseRecord(input) {
    const fields = ['appId', 'revision', 'bindingRevision', 'enabled', 'alias', 'kind'];
    if (input && typeof input === 'object' && 'kind' in input && input.kind === 'primary') {
        const value = robotObject(input, [...fields, 'unboundAccess']);
        return { kind: 'primary', appId: robotAppId(value.appId), revision: robotRevision(value.revision),
            enabled: robotEnabled(value.enabled), alias: robotAlias(value.alias),
            ...(value.bindingRevision === undefined ? {} : { bindingRevision: robotRevision(value.bindingRevision) }),
            ...(value.unboundAccess === undefined ? {} : { unboundAccess: parseAccess(value.unboundAccess) }),
        };
    }
    const value = robotObject(input, [...fields, 'appSecret', 'access']);
    if (value.kind !== 'additional' && value.kind !== 'unbound')
        throw new Error('机器人配置类型无效。');
    if (value.kind === 'unbound' && Object.hasOwn(value, 'appSecret'))
        throw new Error('解绑记录不能包含凭据。');
    const config = {
        appId: robotAppId(value.appId), revision: robotRevision(value.revision),
        enabled: robotEnabled(value.enabled), alias: robotAlias(value.alias),
        ...(value.bindingRevision === undefined ? {} : { bindingRevision: robotRevision(value.bindingRevision) }),
        access: parseAccess(value.access),
    };
    return value.kind === 'unbound' ? { ...config, kind: 'unbound' }
        : { ...config, kind: 'additional', appSecret: robotSecret(value.appSecret) };
}
export class RobotConfigStore {
    path;
    constructor(path) {
        this.path = path;
    }
    read() {
        let data;
        try {
            data = readFileSync(this.path, 'utf8');
        }
        catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
                return { records: [], lastRevision: 0, pendingClears: new Map() };
            throw error;
        }
        try {
            const { version, robots, lastRevision, pendingClears } = robotObject(JSON.parse(data), ['version', 'robots', 'lastRevision', 'pendingClears']);
            if (version !== 1 || !Array.isArray(robots))
                throw new Error();
            const records = robots.map(parseRecord);
            if (new Set(records.map(record => record.appId)).size !== records.length || records.some(record => record.revision === 0)) {
                throw new Error();
            }
            return {
                records,
                lastRevision: records.reduce((highest, record) => Math.max(highest, record.revision), lastRevision === undefined ? 0 : robotRevision(lastRevision)),
                pendingClears: collectPendingClears(pendingClears),
            };
        }
        catch {
            throw new Error('机器人配置目录无法读取，请检查保存的数据。');
        }
    }
    list() {
        return this.read().records;
    }
    write({ records, lastRevision, pendingClears }) {
        atomicWrite(this.path, [JSON.stringify({
                version: 1, robots: records, lastRevision,
                ...(pendingClears.size ? { pendingClears: Object.fromEntries(pendingClears) } : {}),
            })]);
    }
    get(appId) {
        return this.list().find(record => record.appId === appId);
    }
    activatePrimary(appId) {
        const file = this.read();
        const { records, lastRevision } = file;
        const current = records.find(record => record.appId === appId);
        if (!current || (current.kind === 'primary' && current.unboundAccess === undefined))
            return;
        const revision = robotRevision(lastRevision + 1);
        const primary = {
            kind: 'primary', appId, revision, alias: current.alias,
            enabled: current.kind === 'primary' ? current.enabled : true,
        };
        this.write({ ...file, records: records.map(record => record === current ? primary : record), lastRevision: revision });
    }
    pendingClears() {
        return this.read().pendingClears;
    }
    setPendingClear(appId, revision) {
        const file = this.read();
        if (revision === undefined) {
            if (!file.pendingClears.delete(appId))
                return;
        }
        else {
            if (file.pendingClears.get(appId) === revision)
                return;
            file.pendingClears.set(appId, revision);
        }
        this.write(file);
    }
    /** CAS prevents an old browser draft from reapplying a list that was changed separately. */
    save(record, unboundRevision) {
        const file = this.read();
        const { records, lastRevision } = file;
        const index = records.findIndex(existing => existing.appId === record.appId);
        const current = records[index];
        const rebind = record.kind === 'additional' && record.revision === 0 && current !== undefined
            && current.kind !== 'additional' && current.revision === unboundRevision;
        if (!rebind && (record.revision !== (current?.revision ?? 0) || (current && current.kind !== record.kind))) {
            throw new RobotConfigConflictError();
        }
        const access = record.kind === 'additional' ? { ...record.access, commandMode: record.access.commandMode ?? 'open' } : undefined;
        const revision = record.revision === 0 ? lastRevision + 1 : record.revision + 1;
        const bindingRevision = rebind ? revision
            : current ? current.bindingRevision ?? current.revision
                : record.kind === 'primary' ? 0 : revision;
        const next = parseRecord({
            ...record,
            ...(access ? { access } : {}),
            revision,
            bindingRevision: bindingRevision === revision ? undefined : bindingRevision,
        });
        if (next.kind === 'unbound')
            throw new RobotConfigConflictError();
        if (index < 0)
            records.push(next);
        else
            records[index] = next;
        this.write({ ...file, lastRevision: Math.max(lastRevision, next.revision) });
        return next;
    }
    removeAdditional(appId, revision) {
        const file = this.read();
        const { records } = file;
        const current = records.find(record => record.appId === appId);
        if (current?.kind !== 'additional' || current.revision !== revision)
            throw new RobotConfigConflictError();
        const { appSecret: _secret, ...settings } = current;
        this.write({ ...file, records: records.map(record => record === current ? { ...settings, kind: 'unbound' } : record) });
    }
}
function collectPendingClears(value) {
    if (value === undefined)
        return new Map();
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('清除记录状态无效。');
    return new Map(Object.entries(value).map(([appId, revision]) => [robotAppId(appId), robotRevision(revision)]));
}
//# sourceMappingURL=robot-config.js.map