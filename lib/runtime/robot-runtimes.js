import { join } from 'node:path';
import { ConfigSchema } from "../config.js";
import { describeCommands } from "../commands/index.js";
import { bootstrapGateway } from "../gateway/bootstrap.js";
import { registerSendFileTool } from "../media/send-file-tool.js";
import { PrefsStore } from "../model/prefs-store.js";
import { PLUGIN_HOME } from "../shared/dirs.js";
import { registerAccountRoutes } from "./account-routes.js";
import { AccountAccessService } from "./account-service.js";
import { WorkbenchRequestError } from "./workbench-routes.js";
export class RobotRuntimes {
    ctx;
    agents;
    logger;
    store;
    prefs;
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
        ctx.effect(() => () => {
            this.closed = true;
            for (const slot of this.slots.values())
                this.deactivate(slot);
        });
        registerSendFileTool(ctx, {
            runtimes: () => [...this.slots.values()].flatMap(slot => slot.runtime ? [slot.runtime] : []),
            ownerOf: sessionId => {
                const key = this.prefs.findSessionKey(sessionId);
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
        await Promise.all(this.records().map(record => this.sync(record.appId)));
    }
    list() {
        return this.records().map(record => this.view(record));
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
            const root = join(PLUGIN_HOME, 'robots', appId);
            const config = { ...ConfigSchema({}), appId, appSecret: record.appSecret, cwd: join(root, 'workspace'), access: record.access };
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
            await this.mount(config, access, join(root, 'media'));
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
                slot.runtime = bootstrapGateway(child, this.agents, config, this.logger, access, mediaRoot, this.prefs);
            },
        });
        await slot.fiber.await();
    }
}
//# sourceMappingURL=robot-runtimes.js.map