import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { defaultPolicy, validatePolicy } from "../policy/index.js";
import { appendRecord, atomicWrite, forwardLines, reversedLines } from "./files.js";
import { parseDelivery, parseEntry, parseMessage, parseLifecycle, parseRecording } from "./validation.js";
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
    seen = new Map();
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
    getBySessionId(sessionId) {
        const entry = this.catalog.entries.find((item) => item.sessions.some((session) => session.sessionId === sessionId));
        return entry ? clone(entry) : undefined;
    }
    errors() { return [...this.storageErrors.values()]; }
    legacyMigrationBlocked() { return this.prefsMigrationBlocked; }
    recordingError(key) { return this.storageErrors.get(key) ?? this.storageErrors.get('catalog'); }
    ownerIds() { return [...this.catalog.owners]; }
    defaults() { return clone(this.catalog.defaults); }
    updateDefaults(expectedVersion, input) {
        this.assertWritable();
        if (this.catalog.defaults.version !== expectedVersion)
            throw new ConversationConflictError();
        const defaults = { version: expectedVersion + 1, settings: validateQQAgentSettings(input) };
        this.commit({ ...this.catalog, defaults });
        return clone(defaults);
    }
    updateSettings(key, expectedVersion, input, alias, receiveEnabled) {
        const entry = this.previewSettings(key, expectedVersion, input, alias, receiveEnabled);
        this.replace(entry);
        return clone(entry);
    }
    previewSettings(key, expectedVersion, input, alias, receiveEnabled) {
        this.assertWritable();
        const entry = this.require(key);
        if (entry.policy.version !== expectedVersion)
            throw new ConversationConflictError();
        const settings = validateQQAgentSettings(input);
        if (typeof alias !== 'string' || alias.length > 300 || alias.includes('\0') || typeof receiveEnabled !== 'boolean')
            throw new TypeError('QQ 对话设置无效');
        const policy = this.settingsPolicy(entry.policy, settings);
        entry.settings = settings;
        entry.defaultsPending = false;
        entry.alias = alias;
        entry.policy = { ...policy, version: expectedVersion + 1, receiveEnabled };
        return clone(entry);
    }
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
    bindSession(key, sessionId, workspaceId, cwd, presetId) {
        this.assertWritable();
        const entry = this.require(key);
        if (!sessionId || sessionId.length > 1_024)
            throw new TypeError('Invalid QQ Session identity');
        const other = this.catalog.entries.find((item) => item.key !== key && item.sessions.some((session) => session.sessionId === sessionId));
        if (other)
            throw new Error('QQ Session already belongs to another conversation');
        if (!entry.sessions.some((item) => item.sessionId === sessionId))
            entry.sessions.push({ sessionId, startedAt: this.now(), receivedMessages: 0, role: clone(entry.policy.role), ...(entry.settings ? { prompt: entry.scope === 'group' ? entry.settings.promptGroup : entry.settings.promptDirect } : {}) });
        if (entry.currentSessionId && entry.currentSessionId !== sessionId) {
            const previous = entry.sessions.find(item => item.sessionId === entry.currentSessionId);
            if (previous)
                previous.endedAt = this.now();
        }
        if (workspaceId !== undefined) {
            if (workspaceId === null)
                delete entry.workspaceId;
            else {
                if (!workspaceId.trim() || workspaceId.length > 256 || workspaceId.includes('\0'))
                    throw new TypeError('Invalid QQ workspace identity');
                entry.workspaceId = workspaceId;
            }
            if (cwd && entry.settings && (sessionId !== entry.currentSessionId || workspaceId !== this.require(key).workspaceId)) {
                if (entry.settings.cwd !== cwd)
                    entry.policy.version++;
                entry.settings.cwd = cwd;
                entry.policy.cwd = cwd;
            }
        }
        if (presetId !== undefined && entry.settings && entry.settings.preset !== presetId) {
            entry.settings.preset = presetId;
            entry.policy.version++;
        }
        entry.currentSessionId = sessionId;
        delete entry.legacySessionAssociation;
        this.replace(entry);
        return clone(entry);
    }
    updatePolicy(key, expectedVersion, policy, alias) {
        this.assertWritable();
        const entry = this.require(key);
        if (entry.policy.version !== expectedVersion)
            throw new ConversationConflictError();
        const validated = validatePolicy(policy);
        const checked = { ...validated, nativeTools: validated.nativeTools ?? true };
        const changedRole = JSON.stringify(entry.policy.role) !== JSON.stringify(checked.role);
        entry.policy = { ...checked, version: expectedVersion + 1 };
        if (entry.settings) {
            const legacy = this.projectSettings(entry);
            entry.settings = { ...entry.settings, cwd: checked.cwd, ...(changedRole ? { promptGroup: legacy.promptGroup, promptDirect: legacy.promptDirect } : {}), execution: legacy.execution };
        }
        if (alias !== undefined) {
            if (typeof alias !== 'string' || alias.length > 300)
                throw new TypeError('QQ alias is too long');
            entry.alias = alias;
        }
        this.replace(entry);
        return clone(entry);
    }
    updateLifecycle(key, expectedVersion, value, nativeLog) {
        this.assertWritable();
        const entry = this.require(key);
        if (entry.policy.version !== expectedVersion)
            throw new ConversationConflictError();
        entry.lifecycle = parseLifecycle(value);
        if (nativeLog !== undefined)
            entry.nativeLog = { enabled: nativeLog, since: nativeLog ? entry.nativeLog?.since ?? this.now() : entry.nativeLog?.since ?? null };
        entry.policy.version++;
        this.replace(entry);
        return clone(entry);
    }
    /** 更新保存开关；保留已有显式按天期限，不设置正文条数上限。 */
    updateRecording(key, expectedVersion, input) {
        this.assertWritable();
        const entry = this.require(key);
        const recording = this.recording(entry);
        if (recording.version !== expectedVersion)
            throw new ConversationConflictError();
        entry.recording = parseRecording({ enabled: input.enabled, retentionDays: input.retentionDays, version: expectedVersion + 1, since: input.enabled ? recording.since ?? this.now() : recording.since });
        this.replace(entry);
        this.lastPrune.delete(key);
        this.prune(key, entry.recording.retentionDays);
        return clone(entry);
    }
    /** 清空某对话的消息记录：把所有消息/投递正文置为 expired（保留 id 供去重），记录页随之清空。 */
    clearRecords(key) {
        this.assertWritable();
        this.require(key);
        const next = clone(this.catalog);
        const now = this.now();
        const inbound = [...forwardLines(this.messagePath(key))].map(line => parseStoredMessage(JSON.parse(line)));
        const deliveries = [...forwardLines(this.deliveryPath(key))].map(line => parseDelivery(JSON.parse(line)));
        const changes = new Map();
        const timeline = next.timeline[key] ?? { nextOrder: 1, nextChange: 1 };
        const expireChange = (id) => { const existing = changes.get(id); if (existing !== undefined)
            return existing; const change = timeline.nextChange++; changes.set(id, change); return change; };
        for (const row of inbound) {
            if (row.message.bodyState === 'expired' && !row.message.text && !row.message.senderName && !row.message.attachments.length)
                continue;
            row.change = expireChange(`inbound:${row.message.id}`);
            row.message = { ...row.message, text: '', senderName: '', attachments: [], bodyState: 'expired', bodyHash: row.message.bodyHash ?? hash(row.message.text) };
        }
        for (const row of deliveries) {
            if (row.bodyState === 'expired' && !row.text && !row.error)
                continue;
            row.change = expireChange(`outbound:${row.id}`);
            row.bodyHash ??= hash(row.text);
            row.text = '';
            row.bodyState = 'expired';
            delete row.error;
        }
        next.timeline[key] = timeline;
        const target = next.entries.find(row => row.key === key);
        if (target) {
            target.lastMessage = '';
            target.lastMessageAt = now;
        }
        const state = next.background[key];
        if (state)
            state.published = [];
        this.writeMigration(next, [
            { path: this.messagePath(key), rows: inbound },
            { path: this.deliveryPath(key), rows: deliveries },
        ]);
        this.catalog = next;
        this.seen.delete(key);
        this.recent.delete(key);
        return clone(this.require(key));
    }
    noteReceived(key, sessionId, priorCount = 0) {
        this.assertWritable();
        const entry = this.require(key);
        const row = entry.sessions.find(item => item.sessionId === sessionId);
        if (!row)
            throw new Error('消息会话归属无效');
        row.receivedMessages = (row.receivedMessages ?? priorCount) + 1;
        this.replace(entry);
    }
    noteMessage(key, text, at) {
        this.assertWritable();
        const entry = this.require(key);
        entry.lastMessage = this.recording(entry).enabled ? text.slice(0, 300) : '';
        entry.lastMessageAt = at;
        entry.lastActivity = at;
        this.replace(entry);
    }
    forgetSession(key, sessionId) {
        this.assertWritable();
        const entry = this.require(key);
        if (entry.currentSessionId === sessionId)
            throw new Error('不能清理当前会话');
        entry.sessions = entry.sessions.filter(item => item.sessionId !== sessionId);
        this.replace(entry);
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
    recordMessage(key, input) {
        this.assertWritable();
        const entry = this.require(key);
        const message = parseMessage(input);
        const seen = this.seenFor(key);
        if (seen.has(message.id))
            return false;
        const recording = this.recording(entry);
        this.prune(key, recording.retentionDays);
        const recent = this.recentFor(key);
        this.reconcileArchiveCursors();
        const state = this.background(key);
        const expired = recording.retentionDays > 0 && message.at < this.now() - recording.retentionDays * 86_400_000;
        const retainedMessage = expired ? { ...message, text: '', senderName: '', attachments: [], bodyState: 'expired', bodyHash: hash(message.text) } : message;
        const stored = { cursor: state.next, message: retainedMessage };
        const timeline = this.timelineState(key);
        const recorded = { ...stored, order: timeline.nextOrder, change: timeline.nextChange, message: { ...retainedMessage, bodyState: expired ? 'expired' : 'available', bodyHash: hash(message.text) } };
        if (recording.enabled) {
            this.append(key, this.messagePath(key), recorded);
            seen.add(message.id); // The ledger append is durable even if the catalog replacement fails.
        }
        const nextCatalog = clone(this.catalog);
        if (recording.enabled)
            nextCatalog.timeline[key] = { nextOrder: timeline.nextOrder + 1, nextChange: timeline.nextChange + 1 };
        nextCatalog.background[key] = { ...state, next: state.next + 1, seen: [...state.seen, message.id].slice(-10_000) };
        const updated = nextCatalog.entries.find((item) => item.key === key);
        if (updated)
            updated.lastActivity = this.now();
        this.commit(nextCatalog);
        seen.add(message.id);
        // Durable ledger identities also cover retained tombstones beyond the catalog's bounded cache.
        recent.push(stored);
        this.recent.set(key, recent.slice(-Math.max(100, entry.policy.context.maxMessages + 1)));
        return true;
    }
    hasMessage(key, messageId) { return this.seenFor(key).has(messageId); }
    expiredMessageIds(key) {
        const entry = this.require(key);
        this.prune(key, this.recording(entry).retentionDays);
        const ids = new Set();
        for (const line of forwardLines(this.messagePath(key))) {
            const row = parseStoredMessage(JSON.parse(line));
            if (row.message.bodyState === 'expired')
                ids.add(row.message.id);
        }
        return ids;
    }
    consumedCursor(key) { this.require(key); return this.background(key).consumed; }
    /** Claim a command/event identity without retaining its content or advancing context. */
    claimMessage(key, messageId) {
        this.assertWritable();
        this.require(key);
        if (!messageId || messageId.length > 1_024)
            throw new TypeError('Invalid QQ message identity');
        const seen = this.seenFor(key);
        if (seen.has(messageId))
            return false;
        const state = this.background(key);
        const next = clone(this.catalog);
        next.background[key] = { ...state, seen: [...state.seen, messageId].slice(-10_000) };
        this.commit(next);
        seen.add(messageId);
        return true;
    }
    snapshotBackground(key, currentMessageId, throughCursor) {
        const entry = this.require(key);
        const state = this.background(key);
        const recent = this.recentFor(key);
        const current = recent.find((item) => item.message.id === currentMessageId);
        const cursor = throughCursor === undefined ? current?.cursor ?? state.next - 1 : natural(throughCursor);
        if (cursor >= state.next)
            throw new TypeError('Background cursor has not been observed');
        const cutoff = this.now() - entry.policy.context.maxAgeMinutes * 60_000;
        const unique = new Map();
        const source = entry.policy.context.mode === 'interaction' ? state.published : [...recent, ...state.published];
        for (const item of source)
            unique.set(item.cursor, item);
        const eligible = [...unique.values()].filter((item) => item.cursor > state.consumed && item.cursor <= cursor
            && item.message.id !== currentMessageId && item.message.at >= cutoff && item.message.contextEligible !== false && item.message.bodyState !== 'expired')
            .sort((a, b) => a.cursor - b.cursor).slice(-entry.policy.context.maxMessages);
        const lines = [];
        const messageIds = [];
        let remaining = entry.policy.context.maxChars;
        for (const item of eligible.reverse()) {
            const prefix = `[来源消息: ${item.message.id}][${item.message.senderName || item.message.senderId} (${item.message.senderId})] `;
            const available = remaining - (lines.length ? 1 : 0);
            if (available <= 0)
                break;
            const line = `${prefix}${item.message.text}`.slice(0, available);
            lines.unshift(line);
            messageIds.unshift(item.message.id);
            remaining -= line.length + (lines.length > 1 ? 1 : 0);
        }
        return { text: lines.join('\n'), cursor, messageIds };
    }
    commitBackground(key, cursor) {
        this.assertWritable();
        this.require(key);
        natural(cursor);
        const state = this.background(key);
        if (cursor >= state.next)
            throw new TypeError('Background cursor has not been observed');
        if (cursor <= state.consumed)
            return;
        const next = clone(this.catalog);
        next.background[key] = { ...state, consumed: cursor, published: state.published.filter((item) => item.cursor > cursor) };
        this.commit(next);
    }
    resetBackground(key) {
        this.assertWritable();
        this.require(key);
        const state = this.background(key);
        const next = clone(this.catalog);
        next.background[key] = { ...state, consumed: state.next - 1, published: [] };
        this.commit(next);
    }
    /** Compatibility history endpoint; model access is gated by the runtime. */
    messages(key, options = {}) {
        const entry = this.require(key);
        this.prune(key, this.recording(entry).retentionDays);
        const before = options.before === undefined ? Infinity : natural(options.before);
        const requestedLimit = options.limit === undefined ? 50 : natural(options.limit);
        if (requestedLimit < 1)
            throw new TypeError('QQ timeline page size must be positive');
        const limit = Math.min(1000, requestedLimit);
        const query = options.query?.toLocaleLowerCase() ?? '';
        const result = [];
        const seen = new Set();
        for (const line of reversedLines(this.messagePath(key))) {
            const item = parseStoredMessage(JSON.parse(line));
            if (seen.has(item.message.id))
                continue;
            seen.add(item.message.id);
            if (item.cursor >= before || item.message.bodyState === 'expired')
                continue;
            if (query && !`${item.message.senderName}\n${item.message.text}`.toLocaleLowerCase().includes(query))
                continue;
            result.push({ ...item.message, cursor: item.cursor });
            if (result.length >= limit)
                break;
        }
        return result;
    }
    /** A snapshot freezes change visibility; order cursors never depend on timestamps. */
    timeline(key, options = {}) {
        const entry = this.require(key);
        this.prune(key, this.recording(entry).retentionDays);
        const high = this.timelineState(key).nextChange - 1;
        const snapshot = options.snapshot === undefined ? high : natural(options.snapshot);
        if (snapshot > high)
            throw new TypeError('QQ timeline snapshot has not been observed');
        const before = options.before === undefined ? Infinity : natural(options.before);
        const after = options.after === undefined ? undefined : natural(options.after);
        if (after !== undefined && options.before !== undefined)
            throw new TypeError('QQ timeline cannot mix before and after');
        const requestedLimit = options.limit === undefined ? 50 : natural(options.limit);
        if (requestedLimit < 1)
            throw new TypeError('QQ timeline page size must be positive');
        const limit = Math.min(1000, requestedLimit);
        const query = options.query?.toLocaleLowerCase() ?? '';
        const rows = new Map();
        const expired = new Set();
        for (const line of forwardLines(this.messagePath(key))) {
            const row = parseStoredMessage(JSON.parse(line));
            if (row.order === undefined || row.change === undefined)
                throw new Error('QQ timeline migration incomplete');
            if (row.message.bodyState === 'expired')
                expired.add(`inbound:${row.message.id}`);
            if (row.change <= snapshot)
                rows.set(`inbound:${row.message.id}`, { direction: 'inbound', order: row.order, change: row.change, message: { ...row.message, cursor: row.cursor } });
        }
        for (const line of forwardLines(this.deliveryPath(key))) {
            const delivery = parseDelivery(JSON.parse(line));
            if (delivery.key !== key || delivery.order === undefined || delivery.change === undefined)
                throw new Error('Invalid QQ timeline delivery');
            if (delivery.bodyState === 'expired')
                expired.add(`outbound:${delivery.id}`);
            if (delivery.change <= snapshot)
                rows.set(`outbound:${delivery.id}`, { direction: 'outbound', order: delivery.order, change: delivery.change, delivery });
        }
        for (const [id, operation] of Object.entries(this.catalog.operations)) {
            if (operation.key !== key || rows.has(`outbound:${id}`) || operation.order === undefined || operation.change === undefined || operation.change > snapshot)
                continue;
            rows.set(`outbound:${id}`, { direction: 'outbound', order: operation.order, change: operation.change, delivery: this.retiredDelivery(id, operation) });
        }
        // Expiry also revokes body access through an older pagination snapshot.
        for (const [id, row] of rows)
            if (expired.has(id)) {
                if (row.direction === 'inbound')
                    row.message = { ...row.message, text: '', senderName: '', attachments: [], bodyState: 'expired' };
                else {
                    row.delivery = { ...row.delivery, text: '', bodyState: 'expired' };
                    delete row.delivery.error;
                }
            }
        let items = [...rows.values()].filter(row => row.order < before && (after === undefined || row.change > after));
        // Incremental pages retain body-free identities so clients can remove expired rows.
        if (after === undefined)
            items = items.filter(row => (row.direction === 'inbound' ? row.message.bodyState : row.delivery.bodyState) !== 'expired');
        // Incremental pages must include replacements that no longer match the search.
        if (query && after === undefined)
            items = items.filter(row => {
                const text = row.direction === 'inbound' ? `${row.message.senderName}\n${row.message.text}` : row.delivery.text;
                return text.toLocaleLowerCase().includes(query);
            });
        items.sort(after === undefined ? (a, b) => b.order - a.order : (a, b) => a.change - b.change);
        const hasMore = items.length > limit;
        items = items.slice(0, limit);
        const last = items.at(-1);
        return { items, snapshot, hasMore, ...(last ? { nextBefore: last.order } : {}), ...(after === undefined ? {} : { nextAfter: hasMore && last ? last.change : snapshot }) };
    }
    beginDelivery(key, operationId, text, partCount = 1, publish = true, provenance = {}) {
        this.assertWritable();
        const entry = this.require(key);
        this.prune(key, this.recording(entry).retentionDays);
        if (!validOperationId(operationId) || !text.trim() || text.length > 100_000)
            throw new TypeError('Invalid QQ send request');
        if (!Number.isSafeInteger(partCount) || partCount < 1 || partCount > 1_000)
            throw new TypeError('Invalid QQ delivery part count');
        if (typeof publish !== 'boolean')
            throw new TypeError('Invalid QQ delivery publication mode');
        const previous = Object.hasOwn(this.catalog.operations, operationId) ? this.catalog.operations[operationId] : undefined;
        if (previous && (previous.key !== key || previous.hash !== hash(text) || (previous.publish !== false) !== publish))
            throw new ConversationConflictError('发送标识已用于其他目标、内容或发送方式');
        const existing = this.findDelivery(key, operationId);
        if (existing) {
            if (existing.bodyHash ? existing.bodyHash !== hash(text) : existing.text !== text)
                throw new ConversationConflictError('发送标识已用于其他内容');
            return { record: clone(existing), created: false };
        }
        if (previous) {
            const record = this.retiredDelivery(operationId, previous);
            return { record, created: false };
        }
        const at = this.now();
        const timeline = this.timelineState(key);
        const enabled = this.recording(entry).enabled;
        const record = {
            ...provenance, id: operationId, key, text: enabled ? text : '', bodyHash: hash(text), bodyState: enabled ? 'available' : 'disabled', at, updatedAt: at, state: 'pending', order: timeline.nextOrder, change: timeline.nextChange,
            parts: Array.from({ length: partCount }, (_, index) => ({ index, state: 'pending' })),
        };
        const next = clone(this.catalog);
        next.operations[operationId] = { key, hash: hash(text), publish, at, order: record.order, change: record.change, state: record.state, parts: record.parts };
        next.timeline[key] = { nextOrder: timeline.nextOrder + 1, nextChange: timeline.nextChange + 1 };
        this.commit(next);
        this.append(key, this.deliveryPath(key), record);
        return { record: clone(record), created: true };
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
    retiredDelivery(id, operation) {
        return { id, key: operation.key, text: '', bodyHash: operation.hash, bodyState: operation.retired ? 'expired' : 'disabled', at: operation.at ?? 0, updatedAt: operation.at ?? 0, state: operation.state === 'accepted' || operation.state === 'failed' ? operation.state : 'unknown', parts: operation.parts ?? [], ...(operation.order === undefined ? {} : { order: operation.order }), ...(operation.change === undefined ? {} : { change: operation.change }), error: '发送标识已有持久预留，正文不可用；不能重发。' };
    }
    background(key) { return clone(this.catalog.background[key] ?? { next: 1, consumed: 0, published: [], seen: [] }); }
    messagePath(key) { return join(this.dataDir, 'conversations', hash(key), 'messages.jsonl'); }
    deliveryPath(key) { return join(this.dataDir, 'conversations', hash(key), 'deliveries.jsonl'); }
    seenFor(key) {
        let seen = this.seen.get(key);
        if (seen)
            return seen;
        seen = new Set(this.background(key).seen);
        for (const line of forwardLines(this.messagePath(key)))
            seen.add(parseStoredMessage(JSON.parse(line)).message.id);
        this.seen.set(key, seen);
        return seen;
    }
    recentFor(key) {
        const cached = this.recent.get(key);
        if (cached)
            return cached;
        const entry = this.require(key);
        const items = [];
        const seen = new Set();
        if (this.recording(entry).enabled) {
            for (const line of reversedLines(this.messagePath(key))) {
                const item = parseStoredMessage(JSON.parse(line));
                if (seen.has(item.message.id))
                    continue;
                seen.add(item.message.id);
                if (item.message.bodyState !== 'expired')
                    items.push(item);
                if (items.length >= Math.max(100, entry.policy.context.maxMessages + 1))
                    break;
            }
        }
        items.reverse();
        this.recent.set(key, items);
        return items;
    }
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