import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { ConfigSchema, type ImQQBotConfig } from '../config.ts';
import { describeCommands } from '../commands/index.ts';
import { bootstrapGateway, type GatewayRuntime } from '../gateway/bootstrap.ts';
import { registerSendFileTool } from '../media/send-file-tool.ts';
import { PrefsStore } from '../model/prefs-store.ts';
import type { DshAgentRegistry } from '../session/index.ts';
import { PLUGIN_HOME } from '../shared/dirs.ts';
import type { WorkbenchRobot, WorkbenchRobotPatch } from '../shared/workbench-protocol.ts';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';
import { registerAccountRoutes } from './account-routes.ts';
import { AccountAccessService } from './account-service.ts';
import { RobotConfigStore, type RobotConfigRecord } from './robot-config.ts';
import { WorkbenchRequestError } from './workbench-routes.ts';
import { QqTimeline } from './qq-timeline.ts';
import { ConversationSettingsStore, peerKey } from './workbench-conversations.ts';

interface GatewaySlot {
  config: ImQQBotConfig;
  fiber?: ReturnType<Context['plugin']>;
  runtime?: GatewayRuntime;
  stopped: boolean;
}

export class RobotRuntimes {
  readonly prefs: PrefsStore;
  readonly conversationSettings: ConversationSettingsStore;
  readonly timeline: QqTimeline;
  private readonly slots = new Map<string, GatewaySlot>();
  private readonly changes = new Map<string, Promise<void>>();
  private primary?: { config: ImQQBotConfig; access: AccountAccessService };
  private closed = false;

  constructor(
    private readonly ctx: Context,
    private readonly agents: DshAgentRegistry,
    private readonly logger: Logger,
    private readonly store?: RobotConfigStore,
  ) {
    this.prefs = new PrefsStore(undefined, { onError: message => logger.warn(message) });
    this.conversationSettings = new ConversationSettingsStore(join(PLUGIN_HOME, 'conversation-settings.json'));
    this.timeline = new QqTimeline(join(PLUGIN_HOME, 'timeline'), logger);
    ctx.effect(() => () => {
      this.closed = true;
      for (const slot of this.slots.values()) this.deactivate(slot);
    });
    registerSendFileTool(ctx, {
      runtimes: () => [...this.slots.values()].flatMap(slot => slot.runtime ? [slot.runtime] : []),
      ownerOf: sessionId => {
        const key = this.prefs.findKnownSessionKey(sessionId);
        if (key !== undefined) return /^qqbot:([^:]+):/.exec(key)?.[1];
        return [...this.slots.values()].find(slot => slot.runtime?.manager.findBySessionId(sessionId))?.config.appId;
      },
      defaultAppId: () => {
        const [only, ...others] = this.records();
        return others.length === 0 ? only?.appId : undefined;
      },
    }, logger);
  }

  bindPrimary(config: ImQQBotConfig): void {
    if (this.closed || this.primary) return;
    const access = new AccountAccessService(config, this.logger);
    this.primary = { config, access };
    registerAccountRoutes(this.ctx, access, () => {
      const manager = this.slots.get(config.appId)?.runtime?.manager;
      return manager ? describeCommands({ manager, config, logger: this.logger }) : [];
    });
  }

  async start(): Promise<void> {
    await Promise.all(this.records().map(record => this.sync(record.appId)));
  }

  list(): WorkbenchRobot[] {
    return this.records().map(record => this.view(record));
  }

  conversationAccount(appId: string) {
    const record = this.records().find(item => item.appId === appId);
    if (!record) return undefined;
    const manager = this.slots.get(appId)?.runtime?.manager;
    const members = (record.kind === 'primary' ? this.primary?.access : manager?.accountAccess)?.store;
    const profiles = members?.memberProfiles();
    return {
      access: record.kind === 'additional' ? record.access : this.primary!.access.currentAccess(),
      liveSessionId: (scope: ChatScope, openId: string) => manager?.getSessionRecord(scope, openId)?.sessionId,
      peerName: (scope: ChatScope, openId: string) => {
        const profile = profiles && Object.hasOwn(profiles, openId) ? profiles[openId] : undefined;
        if (profile?.scene === scope && profile.nickname) return profile.nickname.slice(0, 300);
        const legacy = members?.peerName(scope, openId);
        return legacy?.alias || legacy?.name || '';
      },
    };
  }

  async save(patch: WorkbenchRobotPatch): Promise<WorkbenchRobot> {
    if (this.closed || !this.store) throw new WorkbenchRequestError(503, 'QQ 账号配置当前不可写');
    const record = this.records().find(item => item.appId === patch.appId);
    if ((record?.revision ?? null) !== patch.revision) {
      throw new WorkbenchRequestError(409, 'QQ 账号配置已更新，请重新加载后保存');
    }
    if (record?.kind === 'primary' && (patch.appSecret !== undefined || patch.access !== undefined)) {
      throw new WorkbenchRequestError(400, '请在原账号设置中修改绑定凭据和名单');
    }
    if (!record && !patch.appSecret) throw new WorkbenchRequestError(400, '添加机器人需要 AppSecret');

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
            } as const),
            ...patch.access,
          },
        });
    const slot = this.slots.get(saved.appId);
    if (slot && !this.matches(slot, saved)) this.deactivate(slot);
    await this.sync(saved.appId);
    const current = this.records().find(item => item.appId === saved.appId);
    if (!current) throw new WorkbenchRequestError(409, 'QQ 账号配置已更新');
    return this.view(current);
  }

  private records(): RobotConfigRecord[] {
    const entries = this.store?.list() ?? [];
    const primary = this.primary?.config.appId;
    const extras = entries.filter(entry => entry.kind === 'additional' && entry.appId !== primary);
    if (primary === undefined) return extras;
    const entry = entries.find(row => row.appId === primary && row.kind === 'primary');
    return [entry ?? { kind: 'primary', appId: primary, alias: '', enabled: true, revision: 0 }, ...extras];
  }

  private view(record: RobotConfigRecord): WorkbenchRobot {
    const access = record.kind === 'additional' ? record.access : this.primary!.access.currentAccess();
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

  private deactivate(slot: GatewaySlot): void {
    slot.stopped = true;
    slot.runtime?.deactivate();
  }

  private matches(slot: GatewaySlot, record: RobotConfigRecord): boolean {
    return record.enabled && !slot.stopped
      && (record.kind === 'primary' || slot.config.appSecret === record.appSecret);
  }

  private async sync(appId: string): Promise<void> {
    const prior = this.changes.get(appId);
    const change = (prior ?? Promise.resolve()).catch(() => {}).then(() => this.reconcile(appId));
    this.changes.set(appId, change);
    try {
      await change;
    } finally {
      if (this.changes.get(appId) === change) this.changes.delete(appId);
    }
  }

  private async reconcile(appId: string): Promise<void> {
    if (this.closed) return;
    let record = this.records().find(entry => entry.appId === appId);
    const slot = this.slots.get(appId);
    if (slot && record && this.matches(slot, record) && slot.runtime) return;
    if (slot) {
      this.deactivate(slot);
      await slot.fiber?.dispose();
      this.slots.delete(appId);
      record = this.records().find(entry => entry.appId === appId);
    }
    if (!record?.enabled || this.closed) return;
    try {
      if (record.kind === 'primary') {
        const primary = this.primary!;
        await this.mount(primary.config, primary.access);
        return;
      }
      const root = join(PLUGIN_HOME, 'robots', appId);
      const config = { ...ConfigSchema({} as ImQQBotConfig), appId, appSecret: record.appSecret, cwd: join(root, 'workspace'), access: record.access };
      const read = () => {
        const current = this.store?.get(appId);
        if (current?.kind !== 'additional') throw new Error('QQ 账号配置已变更');
        return current;
      };
      const access = new AccountAccessService(config, this.logger, { access: {
        read: () => read().access,
        update: update => {
          const current = read();
          this.store!.save({ ...current, access: update(current.access) });
        },
      } });
      await this.mount(config, access, join(root, 'media'));
    } catch {
      this.logger.error(`QQ 网关初始化失败（AppID ${appId}）`);
    }
  }

  private async mount(config: ImQQBotConfig, access: AccountAccessService, mediaRoot?: string): Promise<void> {
    const slot: GatewaySlot = { config, stopped: false };
    this.slots.set(config.appId, slot);
    slot.fiber = this.ctx.plugin({
      name: 'im-qqbot.account',
      apply: (child: Context) => {
        if (this.closed || slot.stopped) return;
        const receiving = ({ scope, targetId }: ReplyTarget): boolean => {
          try {
            return this.conversationSettings.get(peerKey(config.appId, scope, targetId)).receiving;
          } catch {
            this.logger.warn('im-qqbot: peer settings unavailable; QQ conversation denied');
            return false;
          }
        };
        slot.runtime = bootstrapGateway(child, this.agents, config, this.logger, access, mediaRoot, this.prefs, receiving, {
          timeline: this.timeline,
          recording: ({ scope, targetId }) => this.conversationSettings.get(peerKey(config.appId, scope, targetId)).recording,
        });
      },
    });
    await slot.fiber.await();
  }
}
