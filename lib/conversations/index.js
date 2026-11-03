import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { defaultPolicy, validatePolicy } from "../policy/validation.js";
import { appendRecord, atomicWrite, forwardLines, reversedLines } from "./files.js";
import { parseDelivery, parseEntry, parseMessage } from "./validation.js";
import { defaultQQAgentSettings, validateQQAgentSettings, validateQQDefaults } from "../shared/agent-settings.js";
function object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new TypeError('Invalid QQ conversation storage object');
    return value;
}
function natural(value) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
        throw new TypeError('Invalid QQ conversation cursor');
    return value;
}
function strings(value) {
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
        throw new TypeError('Invalid QQ owner identities');
    return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}
function validateOwnerIds(value) {
    const owners = strings(value);
    if (owners.some(id => id.length > 1_024) || owners.length > 100)
        throw new TypeError('Too many QQ owner identities');
    return owners;
}
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function validOperationId(value) {
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
        && value !== '__proto__' && value !== 'prototype' && value !== 'constructor';
}
function clone(value) { return structuredClone(value); }
function parseStoredMessage(value) {
    const data = object(value);
    return { cursor: natural(data.cursor), message: parseMessage(data.message), ...(data.order === undefined ? {} : { order: natural(data.order) }), ...(data.change === undefined ? {} : { change: natural(data.change) }) };
}
/** One instance is the sole writer for one account in one QQBOT_DATA_DIR. */
export class ConversationStore {
    dataDir;
    appId;
    options;
    catalog;
    path;
    now;
    createPolicy;
    recent = new Map();
    lastPrune = new Map();
    reconcileNeeded = false;
    catalogNeedsMigration = false;
    migrationFailed = false;
    prefsMigrationBlocked = false;
    startupMaintenanceDeferred = false;
    legacyOwnerBootstrapEligible;
    storageErrors = new Map();
    constructor(dataDir, appId, options = {}) {
        this.dataDir = dataDir;
        this.appId = appId;
        this.options = options;
        if (!appId)
            throw new TypeError('QQ AppID is required');
        this.path = join(dataDir, `conversations-${hash(appId)}.json`);
        this.now = options.now ?? Date.now;
        this.createPolicy = options.defaultPolicy ?? (() => defaultPolicy());
        this.resumeRecordingMigration();
        this.legacyOwnerBootstrapEligible = !existsSync(this.path);
        this.catalog = this.load();
        this.restoreLegacyPrefsRequirement();
        if (this.prefsMigrationBlocked) {
            this.startupMaintenanceDeferred = true;
            return;
        }
        this.runStartupMaintenance();
    }
    runStartupMaintenance() {
        this.migrateSettings();
        this.migrateRecording();
        this.reconcileArchiveCursors();
        this.pruneExpired();
        this.recoverDeliveries();
        this.startupMaintenanceDeferred = false;
    }
    key(scope, peerId) {
        if (!peerId || peerId.length > 1_024)
            throw new TypeError('Invalid QQ conversation target');
        return `qqbot:${this.appId}:${scope}:${peerId}`;
    }
    list() { return clone(this.catalog.entries).sort((a, b) => b.lastActivity - a.lastActivity); }
    get(key) { const entry = this.find(key); return entry ? clone(entry) : undefined; }
    errors() { return [...this.storageErrors.values()]; }
    legacyMigrationBlocked() { return this.prefsMigrationBlocked; }
    ownerIds() { return [...this.catalog.owners]; }
    setOwnerIds(ids) {
        this.assertWritable();
        const owners = validateOwnerIds(ids);
        const profiles = { ...(this.catalog.memberProfiles ?? {}) };
        // 删除已不在名单里的 profile，避免残留展示资料。
        for (const id of Object.keys(profiles))
            if (!owners.includes(id))
                delete profiles[id];
        this.commit({ ...this.catalog, owners, memberProfiles: profiles });
    }
    /** 全部认领成员资料（openid -> profile）。 */
    memberProfiles() { return clone(this.catalog.memberProfiles ?? {}); }
    /** 更新某成员的展示昵称（不改 openid 身份）。 */
    setMemberNickname(openid, nickname) {
        this.assertWritable();
        const profiles = { ...(this.catalog.memberProfiles ?? {}) };
        const prev = profiles[openid];
        profiles[openid] = { nickname, scene: prev?.scene ?? 'c2c', sceneName: prev?.sceneName ?? '', claimedAt: prev?.claimedAt ?? Date.now() };
        this.commit({ ...this.catalog, memberProfiles: profiles });
    }
    /** 认领：把 openid 加入 owners 并记录展示资料（幂等，重复认领更新资料/时间）。 */
    claimOwner(openid, profile) {
        this.assertWritable();
        const [id] = strings([openid]);
        if (id === undefined)
            throw new TypeError('QQ 用户标识无效');
        const owners = [...new Set([...this.catalog.owners, id])];
        if (owners.length > 100)
            throw new TypeError('Too many QQ owner identities');
        const profiles = { ...(this.catalog.memberProfiles ?? {}), [id]: profile };
        this.commit({ ...this.catalog, owners, memberProfiles: profiles });
    }
    /** 撤销超管：从 owners 移除并删展示资料。 */
    revokeOwner(openid) {
        this.assertWritable();
        const owners = this.catalog.owners.filter((id) => id !== openid);
        const profiles = { ...(this.catalog.memberProfiles ?? {}) };
        delete profiles[openid];
        this.commit({ ...this.catalog, owners, memberProfiles: profiles });
    }
    ensure(scope, peerId, options = {}) {
        const key = this.key(scope, peerId);
        const existing = this.find(key);
        if (this.prefsMigrationBlocked && existing)
            return clone(existing);
        this.assertWritable();
        const at = this.now();
        const entry = existing ? clone(existing) : {
            key, appId: this.appId, scope, peerId, name: options.name ?? '', alias: '', currentSessionId: null,
            sessions: [], lifecycle: { rotateDays: 7, maxMessages: 1000, retentionDays: null }, nativeLog: { enabled: false, since: null }, recording: { version: 1, enabled: true, since: at, retentionDays: 0 }, members: [], policy: validatePolicy(this.createPolicy()), lastActivity: at, observedAllMessages: false,
        };
        if (!existing || (entry.defaultsPending && options.admitted === true)) {
            entry.settings = this.resolveSettings(this.catalog.defaults.settings, entry);
            entry.policy = this.settingsPolicy(entry.policy, entry.settings);
            entry.defaultsPending = options.admitted === false;
        }
        if (options.name)
            entry.name = options.name.slice(0, 300);
        if (scope === 'c2c' && options.senderName)
            entry.name = options.senderName.slice(0, 300);
        if (options.senderId) {
            const id = options.senderId;
            const member = entry.members.find((item) => item.id === id);
            if (member) {
                member.lastSeen = at;
                if (options.senderName)
                    member.name = options.senderName.slice(0, 300);
            }
            else
                entry.members.push({ id, name: options.senderName?.slice(0, 300) ?? '', lastSeen: at });
            entry.members = entry.members.sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 2_000);
        }
        entry.observedAllMessages ||= options.allMessages === true;
        entry.lastActivity = at;
        this.replace(entry);
        return clone(entry);
    }
    /** Import only verified exact account prefixes; no title/name heuristics. */
    migratePrefs(input) {
        this.assertRecordingWritable();
        if (this.catalog.legacyPrefsMigration)
            return 0;
        let value = input;
        const legacyPath = join(this.dataDir, 'model-prefs.json');
        if (value === undefined && !existsSync(legacyPath))
            return 0;
        this.requireLegacyPrefsMigration();
        let fromLegacyFile = false;
        let data;
        let ids;
        let overrides;
        let presets;
        try {
            if (value === undefined) {
                value = JSON.parse(readFileSync(legacyPath, 'utf8'));
                fromLegacyFile = true;
            }
            data = object(value);
            ids = data.sessionIds === undefined ? {} : object(data.sessionIds);
            overrides = data.overrides === undefined ? {} : object(data.overrides);
            presets = data.presets === undefined ? {} : object(data.presets);
        }
        catch (error) {
            this.prefsMigrationBlocked = true;
            this.storageErrors.set('legacy-prefs', `QQ 旧偏好读取失败，已保留原文件；确认迁移前暂停接收和创建会话：${error instanceof Error ? error.message : String(error)}`);
            return 0;
        }
        this.prefsMigrationBlocked = true;
        this.storageErrors.set('legacy-prefs', 'QQ 旧偏好迁移尚未完成，原文件已保留；修复错误后重试迁移');
        const next = clone(this.catalog);
        let count = 0;
        const keys = new Set([...Object.keys(ids), ...Object.keys(overrides), ...Object.keys(presets)]);
        for (const key of keys) {
            const target = this.legacyTarget(key);
            if (!target)
                continue;
            const id = ids[key];
            const sessionId = typeof id === 'string' && id.trim() && id.length <= 1_024 && !id.includes('\0') ? id : undefined;
            const model = this.legacyModel(overrides[key]);
            const presetValue = presets[key];
            const preset = typeof presetValue === 'string' && presetValue.trim() && presetValue.length <= 256 && !presetValue.includes('\0') ? presetValue.trim() : undefined;
            if (!sessionId && !model && !preset)
                continue;
            const existing = next.entries.find(entry => entry.key === key);
            // An earlier importer may already have produced this entry. Its settings can have
            // been edited since then; the catalog is authoritative once the entry exists.
            if (existing) {
                if (sessionId && existing.currentSessionId === sessionId)
                    existing.legacySessionAssociation ??= { state: 'pending', sessionId };
                continue;
            }
            if (sessionId && next.entries.some(entry => entry.sessions.some(row => row.sessionId === sessionId)))
                throw new Error('Legacy QQ Session belongs to more than one conversation');
            const at = this.now();
            const entry = {
                key, appId: this.appId, ...target, name: '', alias: '', currentSessionId: sessionId ?? null,
                ...(sessionId ? { legacySessionAssociation: { state: 'pending', sessionId } } : {}),
                sessions: [], lifecycle: { rotateDays: 0, maxMessages: 0, retentionDays: null },
                nativeLog: { enabled: false, since: null }, recording: { version: 1, enabled: false, since: null, retentionDays: 0 },
                members: [], policy: validatePolicy(this.createPolicy()), lastActivity: at, observedAllMessages: false, defaultsPending: false,
            };
            entry.settings = validateQQAgentSettings({ ...this.projectSettings(entry), ...(model ? { model } : {}), ...(preset ? { preset } : {}) });
            if (sessionId)
                entry.sessions.push({ sessionId, startedAt: at, receivedMessages: 0, role: clone(entry.policy.role), prompt: entry.scope === 'group' ? entry.settings.promptGroup : entry.settings.promptDirect });
            next.entries.push(entry);
            next.background[key] = { next: 1, consumed: 0, published: [], seen: [] };
            next.timeline[key] = { nextOrder: 1, nextChange: 1 };
            count += 1;
        }
        if (fromLegacyFile && this.legacyOwnerBootstrapEligible && this.catalog.entries.length === 0 && this.catalog.owners.length === 0 && count > 0) {
            next.owners = validateOwnerIds(this.options.legacyOwnerIds?.() ?? []);
        }
        next.legacyPrefsMigration = { version: 1, completedAt: this.now() };
        // Projection and validation must finish before the only catalog write. A failed
        // write leaves both the entries and completion marker available for a full retry.
        this.commit(next, { legacyMigration: true });
        this.prefsMigrationBlocked = false;
        this.storageErrors.delete('legacy-prefs');
        if (this.startupMaintenanceDeferred)
            this.runStartupMaintenance();
        return count;
    }
    legacyPrefsRequirementPath() { return join(this.dataDir, `legacy-prefs-required-${hash(this.appId)}.json`); }
    requireLegacyPrefsMigration() {
        this.prefsMigrationBlocked = true;
        this.storageErrors.set('legacy-prefs', 'QQ 旧偏好迁移尚未完成；请保留或恢复 model-prefs.json 后重试迁移');
        try {
            atomicWrite(this.legacyPrefsRequirementPath(), [JSON.stringify({ version: 1, required: true, accountHash: hash(this.appId) })]);
        }
        catch (error) {
            this.storageErrors.set('legacy-prefs', `QQ 旧偏好迁移标记写入失败，暂停接收和创建会话：${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    restoreLegacyPrefsRequirement() {
        if (this.catalog.legacyPrefsMigration || !existsSync(this.legacyPrefsRequirementPath()))
            return;
        this.prefsMigrationBlocked = true;
        this.storageErrors.set('legacy-prefs', 'QQ 旧偏好迁移尚未完成；请保留或恢复 model-prefs.json 后重试迁移');
        try {
            const data = object(JSON.parse(readFileSync(this.legacyPrefsRequirementPath(), 'utf8')));
            if (data.version !== 1 || data.required !== true || data.accountHash !== hash(this.appId))
                throw new Error('Invalid QQ preference migration requirement');
        }
        catch (error) {
            this.storageErrors.set('legacy-prefs', `QQ 旧偏好迁移标记无效，暂停接收和创建会话：${error instanceof Error ? error.message : String(error)}`);
        }
    }
    legacyTarget(key) {
        for (const scope of ['group', 'c2c']) {
            const prefix = `qqbot:${this.appId}:${scope}:`;
            if (!key.startsWith(prefix))
                continue;
            const peerId = key.slice(prefix.length);
            if (peerId && peerId.length <= 1_024 && !peerId.includes('\0'))
                return { scope, peerId };
        }
        return undefined;
    }
    legacyModel(input) {
        if (input === undefined)
            return null;
        try {
            return validateQQAgentSettings({ ...defaultQQAgentSettings(), model: input }).model;
        }
        catch {
            return null;
        }
    }
    updateDelivery(key, id, update) {
        this.assertWritable();
        this.require(key);
        const existing = this.findDelivery(key, id);
        if (!existing)
            throw new Error('QQ delivery not found');
        if ((existing.state === 'unknown' || existing.state === 'failed') && (update.state === 'pending' || update.state === 'sending'))
            throw new Error('QQ delivery cannot be retried under the same operation identity');
        if (existing.state === 'accepted' && update.state !== 'accepted')
            throw new Error('Accepted QQ delivery cannot be retried');
        if (existing.bodyState === 'expired' && (update.state === 'pending' || update.state === 'sending'))
            throw new Error('QQ delivery body has expired; it cannot be resent');
        const timeline = this.timelineState(key);
        const record = parseDelivery({ ...existing, ...update, ...(existing.bodyState === 'expired' ? { error: undefined } : {}), updatedAt: this.now(), change: timeline.nextChange });
        this.append(key, this.deliveryPath(key), record);
        const next = clone(this.catalog);
        next.timeline[key] = { ...timeline, nextChange: timeline.nextChange + 1 };
        const operation = next.operations[id];
        if (operation)
            Object.assign(operation, { state: record.state, parts: record.parts, change: record.change });
        this.commit(next);
        if (record.state === 'accepted' && existing.state !== 'accepted')
            this.publish(key, record);
        return clone(this.findDelivery(key, id) ?? record);
    }
    deliveries(key) {
        this.require(key);
        const result = [];
        const seen = new Set();
        for (const line of reversedLines(this.deliveryPath(key))) {
            const delivery = parseDelivery(JSON.parse(line));
            if (delivery.key !== key)
                throw new Error('QQ delivery target mismatch');
            if (seen.has(delivery.id))
                continue;
            seen.add(delivery.id);
            result.push(delivery);
        }
        return result;
    }
    /** Called at startup and by the Host's hourly maintenance effect. */
    pruneExpired() {
        this.assertWritable();
        for (const entry of this.catalog.entries)
            this.prune(entry.key, this.recording(entry).retentionDays);
    }
    publish(key, delivery) {
        const state = this.background(key);
        const id = `published:${delivery.id}`;
        const operation = this.catalog.operations[delivery.id];
        if (operation?.published || operation?.publish === false || delivery.bodyState === 'expired' || delivery.bodyState === 'disabled')
            return;
        const message = { id, senderId: 'bot', senderName: '机器人已发送', text: delivery.text, at: delivery.at, mentioned: false, attachments: [] };
        const next = clone(this.catalog);
        if (!state.published.some((item) => item.message.id === id)) {
            next.background[key] = { ...state, next: state.next + 1, published: [...state.published, { cursor: state.next, message }].slice(-100) };
        }
        next.operations[delivery.id] = { ...operation, key, hash: operation?.hash ?? hash(delivery.text), publish: true, published: true };
        this.commit(next);
    }
    find(key) { return this.catalog.entries.find((entry) => entry.key === key); }
    resolveSettings(settings, entry) {
        return validateQQAgentSettings(this.options.resolveSettings?.(clone(settings), clone(entry)) ?? settings);
    }
    projectSettings(entry) {
        if (this.options.projectSettings)
            return validateQQAgentSettings(this.options.projectSettings(clone(entry)));
        // 人设由 personaCardOf(policy.role) 提供；此兜底不再烘焙 prompt。
        return { ...defaultQQAgentSettings(), cwd: entry.policy.cwd, promptGroup: '', promptDirect: '', execution: entry.policy.nativeTools ? { kind: 'native', permission: entry.policy.resources.sandbox } : { kind: 'custom', permission: entry.policy.resources.sandbox, tools: Object.entries(entry.policy.tools).filter(([, decision]) => decision !== 'deny').map(([id]) => id) } };
    }
    settingsPolicy(before, settings) {
        const permission = settings.execution.permission;
        const selected = settings.execution.kind === 'custom' ? settings.execution.tools : [];
        return validatePolicy({ ...before, template: 'custom', name: 'QQ Agent', toolMode: 'native', nativeTools: settings.execution.kind === 'native', permission, allowedPermissions: ['read-only', 'workspace-write', 'danger-full-access'], allowedModels: [], allowedPresets: [], cwd: settings.cwd,
            tools: settings.execution.kind === 'native' ? {} : Object.fromEntries(selected.map(id => [id, before.tools[id] === 'ask' ? 'ask' : 'allow'])),
            resources: { ...before.resources, readRoots: [], writeRoots: [], executionEnabled: true, sandbox: permission, networkDomains: [] },
        });
    }
    migrateSettings() {
        const next = clone(this.catalog);
        let changed = false;
        for (const entry of next.entries) {
            // Saved settings also repair catalogs widened by the earlier migration.
            const nativeTools = entry.settings ? entry.settings.execution.kind === 'native' : entry.policy.nativeTools ?? true;
            if (entry.policy.nativeTools !== nativeTools) {
                entry.policy = { ...entry.policy, nativeTools };
                changed = true;
            }
        }
        for (const entry of next.entries)
            if (!entry.settings) {
                entry.settings = this.projectSettings(entry);
                for (const row of entry.sessions)
                    if (row.prompt === undefined) {
                        const historical = { ...entry, policy: { ...entry.policy, role: row.role ?? entry.policy.role } };
                        row.prompt = entry.scope === 'group' ? this.projectSettings(historical).promptGroup : this.projectSettings(historical).promptDirect;
                    }
                changed = true;
            }
        if (changed)
            this.commit(next);
    }
    require(key) { const entry = this.find(key); if (!entry)
        throw new Error('QQ conversation not found'); return clone(entry); }
    replace(entry) {
        const next = clone(this.catalog);
        const index = next.entries.findIndex((item) => item.key === entry.key);
        if (index < 0)
            next.entries.push(entry);
        else
            next.entries[index] = entry;
        next.background[entry.key] ??= { next: 1, consumed: 0, published: [], seen: [] };
        next.timeline[entry.key] ??= { nextOrder: 1, nextChange: 1 };
        this.commit(next);
    }
    assertWritable() {
        this.assertRecordingWritable();
        if (this.prefsMigrationBlocked)
            throw new Error('QQ 旧偏好迁移未确认，暂停修改和创建会话；请先修复 model-prefs.json 后重试迁移');
    }
    assertRecordingWritable() {
        if (this.migrationFailed)
            throw new Error('QQ 记录迁移不完整，需重启恢复');
    }
    commit(next, options = {}) {
        if (options.legacyMigration)
            this.assertRecordingWritable();
        else
            this.assertWritable();
        try {
            atomicWrite(this.path, [JSON.stringify(next)]);
            this.catalog = next;
            if (!options.legacyMigration)
                this.legacyOwnerBootstrapEligible = false;
            this.storageErrors.delete('catalog');
        }
        catch (error) {
            this.reconcileNeeded = true;
            this.storageErrors.set('catalog', `QQ 记录写入失败：${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    append(key, path, value) {
        this.assertWritable();
        try {
            appendRecord(path, value);
            this.storageErrors.delete(key);
        }
        catch (error) {
            this.reconcileNeeded = true;
            this.storageErrors.set(key, `QQ 记录写入失败：${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    recording(entry) {
        if (!entry.recording)
            throw new Error('QQ recording migration incomplete');
        return entry.recording;
    }
    timelineState(key) {
        const state = clone(this.catalog.timeline[key] ?? { nextOrder: 1, nextChange: 1 });
        // A completed append can survive a failed catalog commit. Re-scan only after a failure.
        if (!this.reconcileNeeded)
            return state;
        for (const line of forwardLines(this.messagePath(key))) {
            const row = parseStoredMessage(JSON.parse(line));
            state.nextOrder = Math.max(state.nextOrder, (row.order ?? 0) + 1);
            state.nextChange = Math.max(state.nextChange, (row.change ?? 0) + 1);
        }
        for (const line of forwardLines(this.deliveryPath(key))) {
            const row = parseDelivery(JSON.parse(line));
            state.nextOrder = Math.max(state.nextOrder, (row.order ?? 0) + 1);
            state.nextChange = Math.max(state.nextChange, (row.change ?? 0) + 1);
        }
        return state;
    }
    background(key) { return clone(this.catalog.background[key] ?? { next: 1, consumed: 0, published: [], seen: [] }); }
    messagePath(key) { return join(this.dataDir, 'conversations', hash(key), 'messages.jsonl'); }
    deliveryPath(key) { return join(this.dataDir, 'conversations', hash(key), 'deliveries.jsonl'); }
    findDelivery(key, id) {
        for (const line of reversedLines(this.deliveryPath(key))) {
            const record = parseDelivery(JSON.parse(line));
            if (record.key !== key)
                throw new Error('QQ delivery target mismatch');
            if (record.id === id)
                return record;
        }
        return undefined;
    }
    recoverDeliveries() {
        for (const entry of this.catalog.entries) {
            for (const record of this.deliveries(entry.key)) {
                if (record.state === 'sending' || record.state === 'pending')
                    this.updateDelivery(entry.key, record.id, {
                        state: 'unknown', error: '宿主在发送期间退出，结果未知；请先核对 QQ。',
                        parts: record.parts.map((part) => part.state === 'pending' ? { ...part, state: 'unknown' } : part),
                    });
                else if (record.state === 'accepted')
                    this.publish(entry.key, record);
            }
        }
    }
    reconcileArchiveCursors() {
        const next = clone(this.catalog);
        let changed = false;
        for (const entry of this.catalog.entries) {
            const [line] = reversedLines(this.messagePath(entry.key));
            if (line === undefined)
                continue;
            const latest = parseStoredMessage(JSON.parse(line));
            const state = next.background[entry.key];
            if (state && latest.cursor >= state.next) {
                state.next = latest.cursor + 1;
                changed = true;
            }
        }
        if (changed)
            this.commit(next);
    }
    prune(key, retentionDays) {
        this.assertWritable();
        const now = this.now();
        this.require(key);
        if (!this.reconcileNeeded && now - (this.lastPrune.get(key) ?? 0) < 3_600_000)
            return;
        const cutoff = retentionDays > 0 ? now - retentionDays * 86_400_000 : -Infinity;
        const next = clone(this.catalog);
        let changed = false;
        const inbound = [...forwardLines(this.messagePath(key))].map(line => parseStoredMessage(JSON.parse(line)));
        const deliveries = [...forwardLines(this.deliveryPath(key))].map(line => parseDelivery(JSON.parse(line)));
        const latestInbound = new Map(inbound.map(row => [row.message.id, row]));
        const latestDelivery = new Map(deliveries.map(row => [row.id, row]));
        const expiredInbound = new Set();
        const expiredDelivery = new Set();
        for (const [id, row] of latestInbound) {
            if (row.message.bodyState === 'expired' || row.message.at < cutoff)
                expiredInbound.add(id);
        }
        for (const [id, row] of latestDelivery) {
            if (row.bodyState === 'expired' || row.at < cutoff)
                expiredDelivery.add(id);
        }
        const entry = next.entries.find(row => row.key === key);
        if (entry?.lastMessage && ((entry.lastMessageAt ?? 0) < cutoff || inbound.some(row => expiredInbound.has(row.message.id)
            && row.message.at === entry.lastMessageAt && row.message.text.slice(0, 300) === entry.lastMessage))) {
            entry.lastMessage = '';
            changed = true;
        }
        const changes = new Map();
        const expireChange = (id) => {
            const existing = changes.get(id);
            if (existing !== undefined)
                return existing;
            const timeline = next.timeline[key] ?? { nextOrder: 1, nextChange: 1 };
            const change = timeline.nextChange++;
            next.timeline[key] = timeline;
            changes.set(id, change);
            return change;
        };
        for (const row of inbound) {
            if (!expiredInbound.has(row.message.id) || (row.message.bodyState === 'expired' && !row.message.text && !row.message.senderName && !row.message.attachments.length))
                continue;
            row.change = expireChange(`inbound:${row.message.id}`);
            row.message = { ...row.message, text: '', senderName: '', attachments: [], bodyState: 'expired', bodyHash: row.message.bodyHash ?? hash(row.message.text) };
            changed = true;
        }
        for (const row of deliveries) {
            if (!expiredDelivery.has(row.id) || (row.bodyState === 'expired' && !row.text && !row.error))
                continue;
            row.change = expireChange(`outbound:${row.id}`);
            row.bodyHash ??= hash(row.text);
            row.text = '';
            row.bodyState = 'expired';
            delete row.error;
            if (row.state === 'pending' || row.state === 'sending') {
                row.state = 'unknown';
                row.updatedAt = now;
                row.parts = row.parts.map(part => part.state === 'pending' ? { ...part, state: 'unknown' } : part);
            }
            changed = true;
        }
        for (const [id, row] of latestDelivery) {
            if (!expiredDelivery.has(id))
                continue;
            const operation = next.operations[id];
            if (operation && (!operation.retired || operation.state !== row.state || operation.change !== row.change)) {
                Object.assign(operation, { retired: true, state: row.state, change: row.change, parts: row.parts });
                changed = true;
            }
        }
        const state = next.background[key];
        if (state) {
            const retained = state.published.filter(row => row.message.at >= cutoff && !expiredDelivery.has(row.message.id.replace(/^published:/, '')));
            if (retained.length !== state.published.length) {
                state.published = retained;
                changed = true;
            }
        }
        if (inbound.length !== latestInbound.size || deliveries.some(row => expiredDelivery.has(row.id) && row !== latestDelivery.get(row.id)))
            changed = true;
        if (changed) {
            // Expired identities remain as single durable tombstones, including all operation reservations.
            const ledgers = [
                { path: this.messagePath(key), rows: [...latestInbound.values()].sort((a, b) => a.cursor - b.cursor) },
                { path: this.deliveryPath(key), rows: deliveries.filter(row => !expiredDelivery.has(row.id) || row === latestDelivery.get(row.id)) },
            ];
            this.writeMigration(next, ledgers);
            this.catalog = next;
        }
        const recent = this.recent.get(key);
        if (recent)
            this.recent.set(key, recent.filter(row => row.message.at >= cutoff && !expiredInbound.has(row.message.id)));
        this.lastPrune.set(key, now);
    }
    /** Journal first, then atomically replace both ledgers and the catalog. Recovery only writes data. */
    writeMigration(next, ledgers) {
        this.assertWritable();
        const journal = join(this.dataDir, `recording-migration-${hash(this.appId)}.json`);
        const value = { catalog: next, ledgers };
        try {
            atomicWrite(journal, [JSON.stringify(value)]);
            for (const ledger of ledgers)
                atomicWrite(ledger.path, ledger.rows.map(row => `${JSON.stringify(row)}\n`));
            atomicWrite(this.path, [JSON.stringify(next)]);
            rmSync(journal);
            this.storageErrors.delete('catalog');
        }
        catch (error) {
            // Restart replays this journal before loading the catalog; later writes would be overwritten.
            this.migrationFailed = true;
            this.storageErrors.set('catalog', `QQ 记录迁移不完整，需重启恢复：${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    resumeRecordingMigration() {
        const journal = join(this.dataDir, `recording-migration-${hash(this.appId)}.json`);
        if (!existsSync(journal))
            return;
        const data = object(JSON.parse(readFileSync(journal, 'utf8')));
        const catalog = object(data.catalog);
        if (catalog.appId !== this.appId || catalog.format !== 2 || !Array.isArray(catalog.entries) || !Array.isArray(data.ledgers))
            throw new Error('Invalid QQ recording migration journal');
        const paths = new Set(catalog.entries.flatMap(value => { const row = parseEntry(value); return [this.messagePath(row.key), this.deliveryPath(row.key)]; }));
        for (const input of data.ledgers) {
            const ledger = object(input);
            if (typeof ledger.path !== 'string' || !paths.has(ledger.path) || !Array.isArray(ledger.rows))
                throw new Error('Invalid QQ recording migration ledger');
            for (const row of ledger.rows)
                ledger.path.endsWith('messages.jsonl') ? parseStoredMessage(row) : parseDelivery(row);
        }
        for (const input of data.ledgers) {
            const ledger = object(input);
            if (typeof ledger.path !== 'string' || !Array.isArray(ledger.rows))
                throw new Error('Invalid QQ recording migration ledger');
            atomicWrite(ledger.path, ledger.rows.map(row => `${JSON.stringify(row)}\n`));
        }
        atomicWrite(this.path, [JSON.stringify(catalog)]);
        rmSync(journal);
    }
    migrateRecording() {
        const next = clone(this.catalog);
        const ledgers = [];
        let changed = this.catalogNeedsMigration;
        for (const entry of next.entries) {
            if (entry.lastMessage && entry.lastMessageAt === undefined) {
                entry.lastMessage = '';
                changed = true;
            }
            if (!entry.recording) {
                entry.recording = { version: 1, enabled: true, since: this.now(), retentionDays: entry.policy.context.mode === 'archive' ? entry.policy.context.retentionDays : 0 };
                changed = true;
            }
            const messages = [...forwardLines(this.messagePath(entry.key))].map(line => parseStoredMessage(JSON.parse(line)));
            const deliveries = [...forwardLines(this.deliveryPath(entry.key))].map(line => parseDelivery(JSON.parse(line)));
            const identities = new Map();
            for (const row of messages)
                identities.set(`inbound:${row.message.id}`, { at: row.message.at, order: row.order });
            for (const row of deliveries)
                if (!identities.has(`outbound:${row.id}`))
                    identities.set(`outbound:${row.id}`, { at: row.at, order: row.order });
            let nextOrder = next.timeline[entry.key]?.nextOrder ?? 1;
            for (const row of identities.values())
                nextOrder = Math.max(nextOrder, (row.order ?? 0) + 1);
            // Only legacy rows lack order. Timestamp plus ledger identity gives a repeatable migration order.
            for (const [id, row] of [...identities].sort((a, b) => a[1].at - b[1].at || a[0].localeCompare(b[0])))
                if (row.order === undefined) {
                    identities.set(id, { ...row, order: nextOrder++ });
                    changed = true;
                }
            let nextChange = next.timeline[entry.key]?.nextChange ?? 1;
            for (const row of messages)
                nextChange = Math.max(nextChange, (row.change ?? 0) + 1);
            for (const row of deliveries)
                nextChange = Math.max(nextChange, (row.change ?? 0) + 1);
            for (const row of messages) {
                if (row.order === undefined)
                    row.order = identities.get(`inbound:${row.message.id}`)?.order;
                if (row.change === undefined) {
                    row.change = nextChange++;
                    changed = true;
                }
            }
            for (const row of deliveries) {
                if (row.order === undefined)
                    row.order = identities.get(`outbound:${row.id}`)?.order;
                if (row.change === undefined) {
                    row.change = nextChange++;
                    changed = true;
                }
                const operation = next.operations[row.id];
                if (operation)
                    Object.assign(operation, { at: row.at, order: row.order, change: row.change, state: row.state, parts: row.parts });
                else {
                    next.operations[row.id] = { key: entry.key, hash: row.bodyHash ?? hash(row.text), publish: true, published: row.state === 'accepted', at: row.at, order: row.order, change: row.change, state: row.state, parts: row.parts, retired: row.bodyState === 'expired' };
                    changed = true;
                }
            }
            const previous = next.timeline[entry.key];
            if (!previous || previous.nextOrder !== nextOrder || previous.nextChange !== nextChange) {
                next.timeline[entry.key] = { nextOrder, nextChange };
                changed = true;
            }
            ledgers.push({ path: this.messagePath(entry.key), rows: messages }, { path: this.deliveryPath(entry.key), rows: deliveries });
        }
        if (changed) {
            this.writeMigration(next, ledgers);
            this.catalog = next;
        }
        this.reconcileNeeded = false;
    }
    load() {
        if (!existsSync(this.path))
            return { format: 2, appId: this.appId, owners: [], entries: [], defaults: { version: 1, settings: validateQQAgentSettings(this.options.defaultSettings?.() ?? defaultQQAgentSettings()) }, background: {}, operations: {}, timeline: {} };
        const data = object(JSON.parse(readFileSync(this.path, 'utf8')));
        if ((data.format !== 1 && data.format !== 2) || data.appId !== this.appId || !Array.isArray(data.entries))
            throw new Error('Unsupported QQ conversation catalog');
        this.catalogNeedsMigration = data.format === 1;
        const entries = data.entries.map(parseEntry);
        const keys = new Set();
        for (const entry of entries) {
            if (entry.appId !== this.appId || entry.key !== this.key(entry.scope, entry.peerId) || keys.has(entry.key))
                throw new Error('QQ conversation catalog target mismatch');
            keys.add(entry.key);
        }
        const background = {};
        for (const [key, input] of Object.entries(object(data.background))) {
            if (!keys.has(key))
                throw new Error('QQ background has no conversation');
            const state = object(input);
            if (!Array.isArray(state.published))
                throw new Error('Invalid QQ published messages');
            background[key] = { next: natural(state.next), consumed: natural(state.consumed), published: state.published.map(parseStoredMessage), seen: state.seen === undefined ? [] : strings(state.seen).slice(-10_000) };
            if (background[key].next <= background[key].consumed)
                throw new Error('Invalid QQ background cursor order');
        }
        const operations = {};
        for (const [id, value] of Object.entries(object(data.operations))) {
            const operation = object(value);
            if (!validOperationId(id) || typeof operation.key !== 'string' || !keys.has(operation.key) || typeof operation.hash !== 'string')
                throw new Error('Invalid QQ delivery reservation');
            operations[id] = { key: operation.key, hash: operation.hash, publish: operation.publish !== false, published: operation.published === true,
                ...(operation.at === undefined ? {} : { at: natural(operation.at) }),
                ...(operation.order === undefined ? {} : { order: natural(operation.order) }),
                ...(operation.change === undefined ? {} : { change: natural(operation.change) }),
                ...(typeof operation.state === 'string' && ['pending', 'sending', 'accepted', 'failed', 'unknown'].includes(operation.state) ? { state: operation.state } : {}),
                ...(operation.parts === undefined ? {} : { parts: parseDelivery({ id, key: operation.key, text: '', at: 0, updatedAt: 0, state: 'unknown', parts: operation.parts }).parts }), retired: operation.retired === true };
        }
        const timeline = {};
        if (data.timeline !== undefined)
            for (const [key, input] of Object.entries(object(data.timeline))) {
                if (!keys.has(key))
                    throw new Error('QQ timeline has no conversation');
                const row = object(input);
                timeline[key] = { nextOrder: natural(row.nextOrder), nextChange: natural(row.nextChange) };
                if (timeline[key].nextOrder < 1 || timeline[key].nextChange < 1)
                    throw new Error('Invalid QQ timeline cursor');
            }
        const defaults = data.defaults === undefined ? { version: 1, settings: validateQQAgentSettings(this.options.defaultSettings?.() ?? defaultQQAgentSettings()) } : validateQQDefaults(data.defaults);
        let legacyPrefsMigration;
        if (data.legacyPrefsMigration !== undefined) {
            const marker = object(data.legacyPrefsMigration);
            if (marker.version !== 1)
                throw new Error('Unsupported legacy QQ preference migration');
            legacyPrefsMigration = { version: 1, completedAt: natural(marker.completedAt) };
        }
        return { format: 2, appId: this.appId, owners: strings(data.owners), entries, defaults, background, operations, timeline, ...(legacyPrefsMigration ? { legacyPrefsMigration } : {}), ...(data.memberProfiles !== undefined && typeof data.memberProfiles === 'object' && data.memberProfiles !== null ? { memberProfiles: data.memberProfiles } : {}) };
    }
}
export class ConversationConflictError extends Error {
    code = 'CONVERSATION_CONFLICT';
    constructor(message = '配置已更新，请刷新后重试') { super(message); this.name = 'ConversationConflictError'; }
}
//# sourceMappingURL=index.js.map