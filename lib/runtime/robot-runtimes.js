import { isAbsolute, join } from 'node:path';
import { ConfigSchema } from "../config.js";
import { describeCommands } from "../commands/index.js";
import { bootstrapGateway, openDeliveryLedger } from "../gateway/bootstrap.js";
import { registerSendFileTool } from "../media/send-file-tool.js";
import { PrefsStore } from "../model/prefs-store.js";
import { PLUGIN_HOME } from "../shared/dirs.js";
import { registerAccountRoutes } from "./account-routes.js";
import { AccountAccessService } from "./account-service.js";
import { WorkbenchRequestError } from "./workbench-routes.js";
import { QqTimeline } from "./qq-timeline.js";
import { ConversationSettingsStore, peerKey } from "./workbench-conversations.js";
import { legacyAgentSettings, validateAgentSettings } from "./workbench-agent-settings.js";
import { SessionSwitchConflict } from "../session/session-manager.js";
import { legacyDerivedSessionId } from "../session/session-id.js";
import { WorkbenchToolPolicies } from "./workbench-tools.js";
import { ManualQqSender, ManualSendConflict } from "../transport/manual-send.js";
import { MEDIA_ROOT } from "../media/media-cleaner.js";
function robotMediaRoot(appId, kind) {
    return kind === 'primary' ? MEDIA_ROOT : join(PLUGIN_HOME, 'robots', appId, 'media');
}
export class RobotRuntimes {
    ctx;
    agents;
    logger;
    store;
    prefs;
    conversationSettings;
    timeline;
    toolPolicies;
    slots = new Map();
    changes = new Map();
    primary;
    closed = false;
    constructor(ctx, agents, logger, store) {
        this.ctx = ctx;
        this.agents = agents;
        this.logger = logger;
        this.store = store;
        this.prefs = new PrefsStore(undefined, { onError: message => logger.warn(message) });
        this.conversationSettings = new ConversationSettingsStore(join(PLUGIN_HOME, 'conversation-settings.json'));
        this.timeline = new QqTimeline(join(PLUGIN_HOME, 'timeline'), logger);
        this.toolPolicies = new WorkbenchToolPolicies(ctx, agents, key => this.conversationSettings.get(key).agent, id => this.prefs.findKnownSessionKey(id));
        ctx.effect(() => () => {
            this.closed = true;
            for (const slot of this.slots.values())
                this.deactivate(slot);
        });
        registerSendFileTool(ctx, {
            runtimes: () => [...this.slots.values()].flatMap(slot => slot.runtime ? [slot.runtime] : []),
            ownerOf: sessionId => {
                const key = this.prefs.findKnownSessionKey(sessionId);
                if (key !== undefined)
                    return /^qqbot:([^:]+):/.exec(key)?.[1];
                return [...this.slots.values()].find(slot => slot.runtime?.manager.findBySessionId(sessionId))?.config.appId;
            },
            defaultAppId: () => {
                const [only, ...others] = this.records();
                return others.length === 0 ? only?.appId : undefined;
            },
        }, logger);
    }
    bindPrimary(config) {
        if (this.closed || this.primary)
            return;
        const access = new AccountAccessService(config, this.logger);
        this.primary = { config, access };
        registerAccountRoutes(this.ctx, access, () => {
            const manager = this.slots.get(config.appId)?.runtime?.manager;
            return manager ? describeCommands({ manager, config, logger: this.logger }) : [];
        });
    }
    async start() {
        for (const robot of this.records())
            for (const binding of this.prefs.listSessionBindings(robot.appId)) {
                for (const id of [...binding.history, ...(binding.current ? [binding.current] : [])]) {
                    const agent = this.agents.get(id);
                    if (agent)
                        await this.toolPolicies.attach(agent, binding.key);
                }
            }
        await Promise.all(this.records().map(record => this.sync(record.appId)));
    }
    list() {
        return this.records().map(record => this.view(record));
    }
    defaults(appId) {
        const config = this.configFor(appId);
        return this.conversationSettings.template(appId) ?? { revision: 0, settings: legacyAgentSettings(config) };
    }
    async saveDefaults(appId, next, assertWritable) {
        const config = this.configFor(appId);
        const current = this.defaults(appId);
        if (current.revision !== next.revision) {
            throw new WorkbenchRequestError(409, '机器人默认设置已更新，请重新加载后保存。');
        }
        try {
            await validateAgentSettings(this.ctx, config, next.settings, current.settings);
        }
        catch (error) {
            throw new WorkbenchRequestError(400, error instanceof Error ? error.message : 'Agent 设置无效。');
        }
        assertWritable();
        const keys = new Set([
            ...this.prefs.listSessionBindings(appId).map(binding => binding.key),
            ...this.conversationSettings.keys(appId),
            ...this.timeline.peers(appId).map(({ scope, openId }) => peerKey(appId, scope, openId)),
        ]);
        const established = new Map([...keys].map(key => [key, this.legacySettings(config, key)]));
        return this.conversationSettings.saveTemplate(appId, next, established);
    }
    conversationAccount(appId) {
        const record = this.records().find(item => item.appId === appId);
        if (!record)
            return undefined;
        const manager = this.slots.get(appId)?.runtime?.manager;
        const members = (record.kind === 'primary' ? this.primary?.access : manager?.accountAccess)?.store;
        const profiles = members?.memberProfiles();
        const config = this.configFor(appId);
        return {
            mediaRoot: robotMediaRoot(appId, record.kind),
            access: record.kind === 'additional' ? record.access : this.primary.access.currentAccess(),
            liveSessionId: (scope, openId) => manager?.getSessionRecord(scope, openId)?.sessionId,
            agentSettings: (scope, openId, existing) => {
                const key = peerKey(appId, scope, openId);
                return this.conversationSettings.get(key).agent
                    ?? (existing ? this.legacySettings(config, key) : this.defaults(appId).settings);
            },
            validateAgent: (next, current) => validateAgentSettings(this.ctx, config, next, current),
            peerName: (scope, openId) => {
                const profile = profiles && Object.hasOwn(profiles, openId) ? profiles[openId] : undefined;
                if (profile?.scene === scope && profile.nickname)
                    return profile.nickname.slice(0, 300);
                const legacy = members?.peerName(scope, openId);
                return legacy?.alias || legacy?.name || '';
            },
        };
    }
    async newSession(input, peer, assertWritable) {
        const { appId, scope, openId } = input;
        const key = peerKey(appId, scope, openId);
        const runtime = this.slots.get(appId)?.runtime;
        const base = peer.agent;
        if (!runtime || !base)
            throw new WorkbenchRequestError(409, '当前机器人未连接。');
        if (input.cwd && !isAbsolute(input.cwd))
            throw new WorkbenchRequestError(400, '工作区必须使用绝对路径。');
        const templateRevision = this.defaults(appId).revision;
        let revision = input.revision;
        const assertCurrent = () => {
            assertWritable();
            if (this.closed || this.slots.get(appId)?.runtime !== runtime || runtime.state !== 'connected'
                || runtime.allowTarget?.({ scope, targetId: openId }) !== true) {
                throw new WorkbenchRequestError(409, '机器人已断开，或此 QQ 会话已暂停接收。');
            }
            if (this.conversationSettings.get(key).revision !== revision || this.defaults(appId).revision !== templateRevision) {
                throw new WorkbenchRequestError(409, '会话设置已变化，请刷新后重试。');
            }
        };
        const settings = { ...base, cwd: input.cwd, preset: input.preset };
        try {
            await validateAgentSettings(this.ctx, this.configFor(appId), settings, base);
        }
        catch (error) {
            throw new WorkbenchRequestError(400, error instanceof Error ? error.message : '新会话配置无效。');
        }
        assertCurrent();
        // Freeze the same per-peer baseline as first QQ ingress, including tool policy.
        this.conversationSettings.initialize(key, base);
        revision = this.conversationSettings.get(key).revision;
        try {
            return await runtime.manager.createAndBindSession(scope, openId, input.currentSessionId, settings, assertCurrent);
        }
        catch (error) {
            if (error instanceof WorkbenchRequestError)
                throw error;
            if (error instanceof SessionSwitchConflict)
                throw new WorkbenchRequestError(409, error.message);
            this.logger.warn('QQ 工作台无法建立新的 Session。', error);
            throw new WorkbenchRequestError(503, '无法新建 Session，原接收会话保持不变。请检查工作区与宿主状态。');
        }
    }
    answerDestination(sessionId) {
        const key = this.prefs.findUniqueCurrentSessionKey(sessionId);
        const binding = key && /^qqbot:([^:]+):(group|c2c):([A-Za-z0-9_-]{1,256})$/.exec(key);
        if (!key || !binding)
            return undefined;
        const [, appId, scope, openId] = binding;
        if (!appId || !openId || (scope !== 'c2c' && scope !== 'group'))
            return undefined;
        const account = this.conversationAccount(appId);
        const robot = this.list().find(item => item.appId === appId);
        if (!account || !robot || this.prefs.getSessionId(key) !== sessionId)
            return undefined;
        const live = account.liveSessionId(scope, openId);
        if (live !== undefined && live !== sessionId)
            return undefined;
        const peer = this.conversationSettings.get(key);
        const runtime = this.slots.get(appId)?.runtime;
        const blockedReason = !runtime || robot.state !== 'connected'
            ? '当前机器人未连接。'
            : runtime.allowTarget?.({ scope, targetId: openId }) !== true
                ? '这个 QQ 会话已暂停或不再允许接入。' : undefined;
        const externalTurns = this.configFor(appId).proactiveDelivery?.externalTurns ?? 'c2c';
        return {
            appId, scope, openId, recording: peer.recording, blockedReason,
            automaticWebReplies: externalTurns === 'all' || (externalTurns === 'c2c' && scope === 'c2c'),
            robotName: robot.alias || (robot.primary ? '主机器人' : `机器人 ${appId}`),
            peerName: peer.alias || account.peerName(scope, openId) || `${scope === 'group' ? '群聊' : '私聊'} ${openId.slice(-8)}`,
        };
    }
    manualStatus(appId, target, operation) {
        this.configFor(appId);
        const runtime = this.slots.get(appId)?.runtime;
        return runtime ? runtime.manual.status(target, operation) : ManualQqSender.status(openDeliveryLedger(appId), appId, target, operation);
    }
    async manualSend(appId, target, operation, text, assertWritable, sourceSessionId, attachment, replyTo) {
        const account = this.conversationAccount(appId);
        if (!account)
            throw new WorkbenchRequestError(404, '找不到这个 QQ 机器人。');
        const key = peerKey(appId, target.scope, target.targetId);
        const peer = this.conversationSettings.get(key);
        const listed = (target.scope === 'group' ? account.access.groupAllow : account.access.c2cAllow).includes(target.targetId);
        if (!listed && peer.revision === 0 && !this.prefs.listSessionBindings(appId).some(binding => binding.key === key)) {
            throw new WorkbenchRequestError(404, '这个 QQ 会话尚未登记。');
        }
        const runtime = this.slots.get(appId)?.runtime;
        if (!runtime)
            throw new WorkbenchRequestError(409, '当前机器人未连接。');
        try {
            return await runtime.manual.submit(target, operation, text, () => {
                assertWritable();
                return !this.closed && this.slots.get(appId)?.runtime === runtime && runtime.state === 'connected'
                    && runtime.allowTarget?.(target) === true;
            }, () => this.conversationSettings.get(key).recording, sourceSessionId, attachment, replyTo);
        }
        catch (error) {
            if (error instanceof ManualSendConflict)
                throw new WorkbenchRequestError(409, error.message);
            throw error;
        }
    }
    legacySettings(config, key) {
        const settings = legacyAgentSettings(config);
        return { ...settings, model: this.prefs.getOverride(key) ?? settings.model, preset: this.prefs.getPreset(key) ?? settings.preset };
    }
    configFor(appId) {
        const record = this.records().find(entry => entry.appId === appId);
        if (!record)
            throw new WorkbenchRequestError(404, '找不到这个 QQ 机器人。');
        if (record.kind === 'primary')
            return this.primary.config;
        return {
            ...ConfigSchema({}), appId, appSecret: record.appSecret,
            cwd: join(PLUGIN_HOME, 'robots', appId, 'workspace'), access: record.access,
        };
    }
    async save(patch) {
        if (this.closed || !this.store)
            throw new WorkbenchRequestError(503, 'QQ 账号配置当前不可写');
        const record = this.records().find(item => item.appId === patch.appId);
        if ((record?.revision ?? null) !== patch.revision) {
            throw new WorkbenchRequestError(409, 'QQ 账号配置已更新，请重新加载后保存');
        }
        if (record?.kind === 'primary' && (patch.appSecret !== undefined || patch.access !== undefined)) {
            throw new WorkbenchRequestError(400, '请在原账号设置中修改绑定凭据和名单');
        }
        if (!record && !patch.appSecret)
            throw new WorkbenchRequestError(400, '添加机器人需要 AppSecret');
        const common = {
            appId: patch.appId,
            alias: patch.alias ?? record?.alias ?? '',
            enabled: patch.enabled ?? record?.enabled ?? true,
            revision: record?.revision ?? 0,
        };
        const saved = this.store.save(record?.kind === 'primary'
            ? { ...common, kind: 'primary' }
            : {
                ...common,
                kind: 'additional',
                appSecret: patch.appSecret ?? (record?.kind === 'additional' ? record.appSecret : ''),
                access: {
                    ...(record?.kind === 'additional' ? record.access : {
                        c2cMode: 'allowlist', c2cAllow: [], groupMode: 'allowlist', groupAllow: [], commandMode: 'open',
                    }),
                    ...patch.access,
                },
            });
        const slot = this.slots.get(saved.appId);
        if (slot && !this.matches(slot, saved))
            this.deactivate(slot);
        await this.sync(saved.appId);
        const current = this.records().find(item => item.appId === saved.appId);
        if (!current)
            throw new WorkbenchRequestError(409, 'QQ 账号配置已更新');
        return this.view(current);
    }
    records() {
        const entries = this.store?.list() ?? [];
        const primary = this.primary?.config.appId;
        const extras = entries.filter(entry => entry.kind === 'additional' && entry.appId !== primary);
        if (primary === undefined)
            return extras;
        const entry = entries.find(row => row.appId === primary && row.kind === 'primary');
        return [entry ?? { kind: 'primary', appId: primary, alias: '', enabled: true, revision: 0 }, ...extras];
    }
    view(record) {
        const access = record.kind === 'additional' ? record.access : this.primary.access.currentAccess();
        return {
            appId: record.appId,
            primary: record.kind === 'primary',
            alias: record.alias,
            enabled: record.enabled,
            revision: record.revision,
            state: record.enabled ? this.slots.get(record.appId)?.runtime?.state ?? 'failed' : 'disabled',
            access,
        };
    }
    deactivate(slot) {
        slot.stopped = true;
        slot.runtime?.deactivate();
    }
    matches(slot, record) {
        return record.enabled && !slot.stopped
            && (record.kind === 'primary' || slot.config.appSecret === record.appSecret);
    }
    async sync(appId) {
        const prior = this.changes.get(appId);
        const change = (prior ?? Promise.resolve()).catch(() => { }).then(() => this.reconcile(appId));
        this.changes.set(appId, change);
        try {
            await change;
        }
        finally {
            if (this.changes.get(appId) === change)
                this.changes.delete(appId);
        }
    }
    async reconcile(appId) {
        if (this.closed)
            return;
        let record = this.records().find(entry => entry.appId === appId);
        const slot = this.slots.get(appId);
        if (slot && record && this.matches(slot, record) && slot.runtime)
            return;
        if (slot) {
            this.deactivate(slot);
            await slot.fiber?.dispose();
            this.slots.delete(appId);
            record = this.records().find(entry => entry.appId === appId);
        }
        if (!record?.enabled || this.closed)
            return;
        try {
            if (record.kind === 'primary') {
                const primary = this.primary;
                await this.mount(primary.config, primary.access);
                return;
            }
            const config = this.configFor(appId);
            const read = () => {
                const current = this.store?.get(appId);
                if (current?.kind !== 'additional')
                    throw new Error('QQ 账号配置已变更');
                return current;
            };
            const access = new AccountAccessService(config, this.logger, { access: {
                    read: () => read().access,
                    update: update => {
                        const current = read();
                        this.store.save({ ...current, access: update(current.access) });
                    },
                } });
            await this.mount(config, access, robotMediaRoot(appId, record.kind));
        }
        catch {
            this.logger.error(`QQ 网关初始化失败（AppID ${appId}）`);
        }
    }
    async mount(config, access, mediaRoot) {
        const slot = { config, stopped: false };
        this.slots.set(config.appId, slot);
        slot.fiber = this.ctx.plugin({
            name: 'im-qqbot.account',
            apply: (child) => {
                if (this.closed || slot.stopped)
                    return;
                const receiving = ({ scope, targetId }) => {
                    try {
                        return this.conversationSettings.get(peerKey(config.appId, scope, targetId)).receiving;
                    }
                    catch {
                        this.logger.warn('im-qqbot: peer settings unavailable; QQ conversation denied');
                        return false;
                    }
                };
                slot.runtime = bootstrapGateway(child, this.agents, config, this.logger, access, mediaRoot, this.prefs, receiving, {
                    timeline: this.timeline,
                    recording: ({ scope, targetId }) => this.conversationSettings.get(peerKey(config.appId, scope, targetId)).recording,
                    initialize: async ({ scope, targetId }) => {
                        const key = peerKey(config.appId, scope, targetId);
                        if (this.conversationSettings.get(key).agent)
                            return;
                        const template = this.conversationSettings.template(config.appId);
                        if (!template) {
                            this.conversationSettings.initialize(key, this.legacySettings(config, key));
                            return;
                        }
                        const persistence = this.ctx.get('sessionPersistence');
                        const existing = this.prefs.getSessionId(key) || this.prefs.getPreset(key) || this.prefs.getOverride(key)
                            || !persistence || await persistence.stat(legacyDerivedSessionId(key));
                        if (!receiving({ scope, targetId }) || !access.allowsConversation(scope, targetId) || slot.stopped)
                            return;
                        this.conversationSettings.initialize(key, existing ? this.legacySettings(config, key) : this.defaults(config.appId).settings);
                    },
                    agent: {
                        read: key => this.conversationSettings.get(key).agent,
                        constrain: (agent, key) => this.toolPolicies.attach(agent, key),
                        defaults: () => this.defaults(config.appId).settings,
                        update: (key, patch) => {
                            const current = this.conversationSettings.get(key);
                            if (!current.agent)
                                return false;
                            this.conversationSettings.save(key, { revision: current.revision, agent: { ...current.agent, ...patch } });
                            return true;
                        },
                    },
                });
            },
        });
        await slot.fiber.await();
    }
}
//# sourceMappingURL=robot-runtimes.js.map