import { isAbsolute, join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { AccessControlSchema, ConfigSchema, type ImQQBotConfig } from '../config.ts';
import { describeCommands } from '../commands/index.ts';
import { bootstrapGateway, openDeliveryLedger, type GatewayRuntime } from '../gateway/bootstrap.ts';
import { sessionIdentityReader } from '../host/adapter.ts';
import { registerSendFileTool } from '../media/send-file-tool.ts';
import { PrefsStore } from '../model/prefs-store.ts';
import type { DshAgent, DshAgentRegistry } from '../session/index.ts';
import { PLUGIN_HOME, resolveRobotWorkspace, SESSION_PREFERENCES_FILE } from '../shared/dirs.ts';
import type { WorkbenchRobot, WorkbenchRobotPatch } from '../shared/workbench-protocol.ts';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';
import { registerAccountRoutes } from './account-routes.ts';
import { AccountAccessService } from './account-service.ts';
import { RobotConfigStore, type BoundRobotConfig } from './robot-config.ts';
import { WorkbenchRequestError } from './workbench-routes.ts';
import { QqTimeline } from './qq-timeline.ts';
import { QqDisplayNames } from './qq-display-names.ts';
import { unbindProfileCredentials } from '../setup/persist.ts';
import { ConversationSettingsStore, peerKey } from './workbench-conversations.ts';
import { legacyAgentSettings, validateAgentSettings } from './workbench-agent-settings.ts';
import type { WorkbenchAgentSettings, WorkbenchDefaults } from '../shared/workbench-agent-settings.ts';
import type { WorkbenchConversation, WorkbenchNewSession } from '../shared/workbench-conversation-protocol.ts';
import { SessionSwitchConflict } from '../session/session-manager.ts';
import { clearAccountHistory } from '../features/history-store.ts';
import type { WorkbenchRobotRemoval } from '../shared/workbench-protocol.ts';
import { WorkbenchToolPolicies } from './workbench-tools.ts';
import { ManualQqSender, ManualSendConflict, type ManualAttachment } from '../transport/manual-send.ts';
import type { AnswerDestination } from '../shared/workbench-answer-protocol.ts';
import { importLegacyPreferences } from './legacy-preferences.ts';
import { legacyPreferencesPath } from './data-directory.ts';

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
  readonly toolPolicies: WorkbenchToolPolicies;
  private readonly names: QqDisplayNames;
  private readonly additionalAccess = new Map<string, AccountAccessService>();
  private readonly slots = new Map<string, GatewaySlot>();
  private readonly changes = new Map<string, Promise<void>>();
  private primary?: { config: ImQQBotConfig; access: AccountAccessService };
  private closed = false;
  private closing?: Promise<void>;

  constructor(
    private readonly ctx: Context,
    private readonly agents: DshAgentRegistry,
    private readonly logger: Logger,
    private readonly store?: RobotConfigStore,
    private readonly dataDir = PLUGIN_HOME,
  ) {
    this.prefs = new PrefsStore(undefined, { path: join(dataDir, SESSION_PREFERENCES_FILE), onError: message => logger.warn(message) });
    this.conversationSettings = new ConversationSettingsStore(join(dataDir, 'conversation-settings.json'));
    this.timeline = new QqTimeline(join(dataDir, 'timeline'), logger, (appId, { scope, targetId }) => {
      const days = this.conversationSettings.recordedDays(peerKey(appId, scope, targetId));
      return days === undefined ? undefined : Date.now() - days * 86_400_000;
    });
    this.names = new QqDisplayNames(join(dataDir, 'qq-display-names.json'), logger);
    this.toolPolicies = new WorkbenchToolPolicies(ctx, agents,
      key => this.conversationSettings.get(key).agent, id => {
        const key = this.prefs.findKnownSessionKey(id);
        const appId = key?.split(':', 2)[1];
        return this.records().some(record => record.enabled && record.appId === appId) ? key : undefined;
      }, logger,
      (agent, key) => this.retireInbox(agent, key));
    ctx.effect(() => () => this.close());
    ctx.effect(() => {
      const timer = setInterval(() => this.expireHistory(), 60 * 60_000);
      timer.unref();
      return () => clearInterval(timer);
    });
    registerAccountRoutes(ctx, requested => {
      const appId = requested ?? this.primary?.config.appId;
      if (this.closed || appId === undefined) return undefined;
      const record = this.records().find(entry => entry.appId === appId);
      if (!record) return undefined;
      return { service: this.accountAccess(record), enabled: record.enabled, revision: record.revision };
    }, ({ service }) => {
      const manager = this.slots.get(service.config.appId)?.runtime?.manager;
      return manager ? describeCommands({ manager, config: service.config, logger: this.logger }) : [];
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

  close(): Promise<void> {
    this.closed = true;
    for (const slot of this.slots.values()) this.deactivate(slot);
    this.toolPolicies.close();
    return this.closing ??= Promise.allSettled([
      ...this.changes.values(),
      ...[...this.slots.values()].map(slot => slot.fiber?.dispose()),
    ]).then(results => {
      this.timeline.close();
      if (results.some(result => result.status === 'rejected')) this.logger.warn('QQBot could not completely dispose a gateway.');
    });
  }

  get active(): boolean { return !this.closed; }

  private retireInbox(agent: DshAgent, key: string): void {
    const appId = key.split(':', 2)[1];
    if (!appId || !agent.inbox) return;
    const messages = [...agent.inbox.nextStep, ...agent.inbox.nextTurn];
    if (messages.length === 0) return;
    const ledger = openDeliveryLedger(appId, this.dataDir);
    for (const message of messages) {
      if (!ledger.knowsInput(message.id)) continue;
      ledger.discardInput(agent.id, message.id);
      agent.inbox.remove(message.id);
    }
  }

  async prepareLegacy(appId: string): Promise<void> {
    const ownsSession = await sessionIdentityReader(this.ctx).catch(() => {
      this.logger.warn('QQBot could not read the Session identities for 0.5.5 import.');
      return undefined;
    });
    if (!ownsSession) return;
    await importLegacyPreferences({
      source: legacyPreferencesPath, directory: this.dataDir, appId,
      prefs: this.prefs, logger: this.logger, active: () => this.active,
      ownsSession,
    });
  }

  private mediaDirectory(appId: string): string {
    return join(this.dataDir, 'robots', appId, 'media');
  }

  bindPrimary(config: ImQQBotConfig): void {
    if (this.closed || this.primary) return;
    this.store?.activatePrimary(config.appId);
    const access = new AccountAccessService(config, this.logger, {}, this.dataDir);
    this.primary = { config, access };
  }

  async start(): Promise<void> {
    for (const [appId, revision] of this.store?.pendingClears() ?? []) {
      try {
        // An interrupted request may have persisted its intent before removing the credentials.
        if (this.records().some(robot => robot.appId === appId)) this.store?.setPendingClear(appId);
        else this.finishClear(appId, revision);
      } catch {
        this.logger.warn('QQ 消息记录清理尚未完成。');
      }
    }
    for (const robot of this.records()) if (!robot.enabled) this.toolPolicies.detachAccount(robot.appId);
    await this.toolPolicies.restoreLive();
    if (this.closed) return;
    await Promise.all(this.records().map(record => this.sync(record.appId)));
    if (!this.closed) this.expireHistory();
  }

  private expireHistory(): void {
    try {
      for (const { appId, scope, openId } of this.conversationSettings.expiringPeers()) {
        this.timeline.expire(appId, { scope, targetId: openId });
      }
    } catch {
      this.logger.warn('无法读取 QQ 消息保留策略，将在下次清理时重试。');
    }
  }

  private recordsMessages(key: string): boolean {
    try {
      return this.conversationSettings.remember(key).retention !== 'paused';
    } catch {
      this.logger.warn('无法保存 QQ 消息记录设置。');
      return false;
    }
  }

  list(): WorkbenchRobot[] {
    return this.records().map(record => this.view(record));
  }

  defaults(appId: string): WorkbenchDefaults {
    const config = this.configFor(appId);
    return this.conversationSettings.template(appId) ?? { revision: 0, settings: legacyAgentSettings(config) };
  }

  async saveDefaults(appId: string, next: WorkbenchDefaults, assertWritable: () => void): Promise<WorkbenchDefaults> {
    const config = this.configFor(appId);
    const current = this.defaults(appId);
    if (current.revision !== next.revision) {
      throw new WorkbenchRequestError(409, '机器人默认设置已更新，请重新加载后保存。');
    }
    try {
      await validateAgentSettings(this.ctx, config, next.settings, current.settings);
    } catch (error) {
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

  conversationAccount(appId: string) {
    const record = this.records().find(item => item.appId === appId);
    if (!record) return undefined;
    const manager = this.slots.get(appId)?.runtime?.manager;
    const members = this.accountAccess(record).store;
    const profiles = members.memberProfiles();
    const config = this.configFor(appId);
    return {
      mediaRoot: this.mediaDirectory(appId),
      executionBlocked: (scope: ChatScope, openId: string) => this.toolPolicies.blocked(peerKey(appId, scope, openId)),
      access: record.kind === 'additional' ? record.access : this.primary!.access.currentAccess(),
      liveSessionId: (scope: ChatScope, openId: string) => manager?.getSessionRecord(scope, openId)?.sessionId,
      sessionChangePending: (scope: ChatScope, openId: string) => manager?.sessionChangePending(scope, openId) ?? false,
      agentSettings: (scope: ChatScope, openId: string, existing: boolean) => {
        const key = peerKey(appId, scope, openId);
        return this.conversationSettings.get(key).agent
          ?? (existing ? this.legacySettings(config, key) : this.defaults(appId).settings);
      },
      validateAgent: (next: WorkbenchAgentSettings, current: WorkbenchAgentSettings) => validateAgentSettings(this.ctx, config, next, current),
      peerName: (scope: ChatScope, openId: string) => {
        const legacy = members?.peerName(scope, openId);
        if (legacy?.alias) return legacy.alias;
        const profile = profiles && Object.hasOwn(profiles, openId) ? profiles[openId] : undefined;
        if (profile?.scene === scope && profile.nickname) return profile.nickname.slice(0, 300);
        return this.names.peer(appId, scope, openId) || legacy?.name || '';
      },
      mentionName: (groupId: string, openId: string) => {
        const botName = this.names.botMention(appId, groupId, openId);
        if (openId === appId || botName) {
          return record.alias || (botName !== '机器人' && botName) || (record.kind === 'primary' ? '主机器人' : `机器人 ${appId}`);
        }
        return this.names.peer(appId, 'c2c', openId);
      },
    };
  }

  async newSession(input: WorkbenchNewSession, peer: WorkbenchConversation, assertWritable: () => void): Promise<string> {
    const { appId, scope, openId } = input;
    const key = peerKey(appId, scope, openId);
    const runtime = this.slots.get(appId)?.runtime;
    const base = peer.agent;
    if (!runtime || !base) throw new WorkbenchRequestError(409, '当前机器人未连接。');
    if (input.cwd && !isAbsolute(input.cwd)) throw new WorkbenchRequestError(400, '工作区必须使用绝对路径。');
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
    try { await validateAgentSettings(this.ctx, this.configFor(appId), settings, base); }
    catch (error) {
      throw new WorkbenchRequestError(400, error instanceof Error ? error.message : '新会话配置无效。');
    }
    assertCurrent();
    // Freeze the same per-peer baseline as first QQ ingress, including tool policy.
    this.conversationSettings.initialize(key, base, peer.sessions.length > 0);
    revision = this.conversationSettings.get(key).revision;
    try {
      return await runtime.manager.createAndBindSession(scope, openId, input.currentSessionId, settings, assertCurrent);
    } catch (error) {
      if (error instanceof WorkbenchRequestError) throw error;
      if (error instanceof SessionSwitchConflict) throw new WorkbenchRequestError(409, error.message);
      this.logger.warn('QQ 工作台无法建立新的 Session。', error);
      throw new WorkbenchRequestError(503, '无法新建 Session，原接收会话保持不变。请检查工作区与宿主状态。');
    }
  }

  answerDestination(sessionId: string): AnswerDestination | undefined {
    const key = this.prefs.findUniqueCurrentSessionKey(sessionId);
    const binding = key && /^qqbot:([^:]+):(group|c2c):([A-Za-z0-9_-]{1,256})$/.exec(key);
    if (!key || !binding) return undefined;
    const [, appId, scope, openId] = binding;
    if (!appId || !openId || (scope !== 'c2c' && scope !== 'group')) return undefined;
    const account = this.conversationAccount(appId);
    const robot = this.list().find(item => item.appId === appId);
    if (!account || !robot || this.prefs.getSessionId(key) !== sessionId) return undefined;
    const live = account.liveSessionId(scope, openId);
    if (live !== undefined && live !== sessionId) return undefined;
    const peer = this.conversationSettings.get(key);
    const runtime = this.slots.get(appId)?.runtime;
    const blockedReason = !runtime || robot.state !== 'connected'
      ? '当前机器人未连接。'
      : runtime.allowTarget?.({ scope, targetId: openId }) !== true
        ? '这个 QQ 会话已暂停或不再允许接入。' : undefined;
    const externalTurns = this.configFor(appId).proactiveDelivery?.externalTurns ?? 'c2c';
    return {
      appId, scope, openId, recording: peer.retention !== 'paused', blockedReason,
      automaticWebReplies: externalTurns === 'all' || (externalTurns === 'c2c' && scope === 'c2c'),
      robotName: robot.alias || (robot.primary ? '主机器人' : `机器人 ${appId}`),
      peerName: peer.alias || account.peerName(scope, openId) || `${scope === 'group' ? '群聊' : '私聊'} ${openId.slice(-8)}`,
    };
  }

  manualStatus(appId: string, target: ReplyTarget, operation: string) {
    this.configFor(appId);
    const runtime = this.slots.get(appId)?.runtime;
    return runtime ? runtime.manual.status(target, operation) : ManualQqSender.status(openDeliveryLedger(appId, this.dataDir), appId, target, operation);
  }

  async manualSend(appId: string, target: ReplyTarget, operation: string, text: string, assertWritable: () => void,
    sourceSessionId?: string, attachment?: ManualAttachment, replyTo?: string) {
    const account = this.conversationAccount(appId);
    if (!account) throw new WorkbenchRequestError(404, '找不到这个 QQ 机器人。');
    const key = peerKey(appId, target.scope, target.targetId);
    const peer = this.conversationSettings.get(key);
    const listed = (target.scope === 'group' ? account.access.groupAllow : account.access.c2cAllow).includes(target.targetId);
    if (!listed && peer.revision === 0 && !this.prefs.listSessionBindings(appId).some(binding => binding.key === key)) {
      throw new WorkbenchRequestError(404, '这个 QQ 会话尚未登记。');
    }
    const runtime = this.slots.get(appId)?.runtime;
    if (!runtime) throw new WorkbenchRequestError(409, '当前机器人未连接。');
    try {
      return await runtime.manual.submit(target, operation, text, () => {
        assertWritable();
        return !this.closed && this.slots.get(appId)?.runtime === runtime && runtime.state === 'connected'
          && runtime.allowTarget?.(target) === true;
      }, () => this.recordsMessages(key), sourceSessionId, attachment, replyTo);
    } catch (error) {
      if (error instanceof ManualSendConflict) throw new WorkbenchRequestError(409, error.message);
      throw error;
    }
  }

  private legacySettings(config: ImQQBotConfig, key: string): WorkbenchAgentSettings {
    const settings = legacyAgentSettings(config);
    return { ...settings, model: this.prefs.getOverride(key) ?? settings.model, preset: this.prefs.getPreset(key) ?? settings.preset };
  }

  private configFor(appId: string): ImQQBotConfig {
    const record = this.records().find(entry => entry.appId === appId);
    if (!record) throw new WorkbenchRequestError(404, '找不到这个 QQ 机器人。');
    if (record.kind === 'primary') return this.primary!.config;
    return {
      ...ConfigSchema({} as ImQQBotConfig), appId, appSecret: record.appSecret,
      cwd: resolveRobotWorkspace(appId), access: record.access,
    };
  }

  async save(patch: WorkbenchRobotPatch): Promise<WorkbenchRobot> {
    if (this.closed || !this.store) throw new WorkbenchRequestError(503, 'QQ 账号配置当前不可写');
    const record = this.records().find(item => item.appId === patch.appId);
    if (record && patch.revision === null) {
      throw new WorkbenchRequestError(409, '这个机器人已添加，请在机器人列表中选择它。');
    }
    if ((record?.revision ?? null) !== patch.revision) {
      throw new WorkbenchRequestError(409, 'QQ 账号配置已更新，请重新加载后保存');
    }
    if (record?.kind === 'primary' && (patch.appSecret !== undefined || patch.access !== undefined)) {
      throw new WorkbenchRequestError(400, '请在原账号设置中修改绑定凭据和名单');
    }
    if (!record && !patch.appSecret) throw new WorkbenchRequestError(400, '添加机器人需要 AppSecret');
    if (!record) this.prepareBinding(patch.appId);
    const detached = !record ? this.store.get(patch.appId) : undefined;
    const bindingChanges = record && ((record.enabled && patch.enabled === false)
      || (record.kind === 'additional' && patch.appSecret !== undefined && patch.appSecret !== record.appSecret));
    if (bindingChanges) this.accountAccess(record).pairing.endAll();

    const unboundAccess = detached?.kind === 'primary' ? detached.unboundAccess : detached?.kind === 'unbound' ? detached.access : undefined;
    const savedAccess = record?.kind === 'additional' ? record.access : unboundAccess;
    const common = {
      appId: patch.appId,
      alias: patch.alias ?? record?.alias ?? detached?.alias ?? '',
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
            ...(savedAccess ?? AccessControlSchema()),
            ...patch.access,
            ...(unboundAccess && patch.access?.c2cAllow ? {
              c2cMode: unboundAccess.c2cMode,
              c2cAllow: [...new Set([...unboundAccess.c2cAllow, ...patch.access.c2cAllow])],
            } : {}),
          },
        }, detached?.revision);
    if (bindingChanges) this.additionalAccess.delete(saved.appId);
    const slot = this.slots.get(saved.appId);
    if (slot && !this.matches(slot, saved)) this.deactivate(slot);
    if (bindingChanges) this.toolPolicies.detachAccount(saved.appId);
    const sync = this.sync(saved.appId);
    if (saved.enabled) await sync;
    else void sync.catch(() => this.logger.warn(`无法完成 QQ 网关清理（AppID ${saved.appId}）。`));
    const current = this.records().find(item => item.appId === saved.appId);
    if (!current) throw new WorkbenchRequestError(409, 'QQ 账号配置已更新');
    return this.view(current);
  }

  remove(appId: string, revision: number, profileDir: string, mode: WorkbenchRobotRemoval = 'retain', bindingRevision?: number): void {
    if (this.closed || !this.store) throw new WorkbenchRequestError(503, 'QQ 账号配置当前不可写。');
    const record = this.records().find(item => item.appId === appId);
    if (!record) {
      if (mode === 'clear') {
        if (this.store.pendingClears().get(appId) === revision) this.finishClear(appId, revision);
        else if (this.prefs.clearedRevision(appId) !== revision) {
          throw new WorkbenchRequestError(409, '这里的绑定已结束，清除记录尚未执行。');
        }
      }
      return;
    }
    if (bindingRevision === undefined ? record.revision !== revision : (record.bindingRevision ?? record.revision) !== bindingRevision) {
      throw new WorkbenchRequestError(409, '机器人配置已变化，请重新确认后再解绑。');
    }
    if (mode === 'clear') this.store.setPendingClear(appId, revision);
    try {
      this.accountAccess(record).pairing.endAll();
      if (record.kind === 'primary') {
        // Fence old requests before removing the binding from the profile.
        const access = this.accountAccess(record).currentAccess();
        this.store.save({ ...record, unboundAccess: access });
        if (!unbindProfileCredentials(profileDir, this.logger, appId)) {
          throw new WorkbenchRequestError(409, '无法解绑主机器人，请检查当前 profile 的凭据配置。');
        }
        this.primary = undefined;
      } else {
        this.store.removeAdditional(appId, record.revision);
        this.additionalAccess.delete(appId);
      }
    } catch (error) {
      if (mode === 'clear') this.store.setPendingClear(appId);
      throw error;
    }
    const slot = this.slots.get(appId);
    if (slot) this.deactivate(slot);
    this.toolPolicies.detachAccount(appId);
    // Admission stops synchronously. Fiber disposal (including a profile
    // reload for the primary) can wait for work unrelated to this request.
    void this.sync(appId).catch(() => this.logger.warn(`无法完成 QQ 网关清理（AppID ${appId}）。`));
    if (mode === 'clear') this.finishClear(appId, revision);
  }

  prepareBinding(appId: string): void {
    if (this.closed) throw new WorkbenchRequestError(503, 'QQ 机器人正在停用。');
    const revision = this.store?.pendingClears().get(appId);
    if (revision !== undefined) this.finishClear(appId, revision);
  }

  private finishClear(appId: string, revision: number): void {
    try {
      this.prefs.clearAccountSessions(appId, revision);
      this.timeline.clearAccount(appId);
      clearAccountHistory(appId);
      this.store?.setPendingClear(appId);
    } catch {
      throw new WorkbenchRequestError(503, '机器人已解绑，清除记录尚未完成，请重试。');
    }
  }

  private records(): BoundRobotConfig[] {
    const entries = this.store?.list() ?? [];
    const primary = this.primary?.config.appId;
    const extras = entries.filter(entry => entry.kind === 'additional').filter(entry => entry.appId !== primary);
    if (primary === undefined) return extras;
    const entry = entries.find(row => row.kind === 'primary' && row.appId === primary);
    if (entry?.kind === 'primary') return [entry, ...extras];
    return [{ kind: 'primary', appId: primary, alias: '', enabled: true, revision: 0 }, ...extras];
  }

  private view(record: BoundRobotConfig): WorkbenchRobot {
    const access = record.kind === 'additional' ? record.access : this.primary!.access.currentAccess();
    return {
      appId: record.appId,
      primary: record.kind === 'primary',
      alias: record.alias,
      enabled: record.enabled,
      revision: record.revision,
      bindingRevision: record.bindingRevision ?? record.revision,
      state: record.enabled ? this.slots.get(record.appId)?.runtime?.state ?? 'failed' : 'disabled',
      access,
    };
  }

  private deactivate(slot: GatewaySlot): void {
    slot.stopped = true;
    slot.runtime?.deactivate();
  }

  private matches(slot: GatewaySlot, record: BoundRobotConfig): boolean {
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
    if (!record || this.closed) return;
    try {
      this.conversationSettings.preserveLegacy([
        ...this.prefs.listSessionBindings(appId).map(binding => binding.key),
        ...this.timeline.peers(appId).map(({ scope, openId }) => peerKey(appId, scope, openId)),
      ]);
    } catch {
      this.logger.warn('无法读取既有 QQ 消息记录设置。');
    }
    if (!record.enabled) return;
    try {
      if (this.toolPolicies.enableAccount(appId)) await this.toolPolicies.restoreLive();
      if (record.kind === 'primary') {
        const primary = this.primary!;
        await this.mount(primary.config, primary.access, this.mediaDirectory(appId));
        return;
      }
      await this.mount(this.configFor(appId), this.accountAccess(record), this.mediaDirectory(appId));
    } catch {
      this.logger.error(`QQ 网关初始化失败（AppID ${appId}）`);
    }
  }

  private accountAccess(record: BoundRobotConfig): AccountAccessService {
    if (record.kind === 'primary') return this.primary!.access;
    const { appId } = record;
    const cached = this.additionalAccess.get(appId);
    if (cached) return cached;
    const read = () => {
      const current = this.store?.get(appId);
      if (current?.kind !== 'additional' || current.appSecret !== record.appSecret) {
        throw new Error('QQ 账号配置已变更');
      }
      return current;
    };
    const service = new AccountAccessService(this.configFor(appId), this.logger, { access: {
      read: () => read().access,
      update: change => {
        const current = read();
        this.store!.save({ ...current, access: change(current.access) });
      },
    } }, this.dataDir);
    this.additionalAccess.set(appId, service);
    return service;
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
            const key = peerKey(config.appId, scope, targetId);
            return this.conversationSettings.get(key).receiving && this.toolPolicies.blocked(key) === undefined;
          } catch {
            this.logger.warn('im-qqbot: peer settings unavailable; QQ conversation denied');
            return false;
          }
        };
        slot.runtime = bootstrapGateway(child, this.agents, config, this.logger, access, mediaRoot, this.prefs, receiving, {
          timeline: this.timeline,
          names: this.names,
          recording: ({ scope, targetId }) => this.recordsMessages(peerKey(config.appId, scope, targetId)),
          initialize: async ({ scope, targetId }) => {
            const key = peerKey(config.appId, scope, targetId);
            if (this.conversationSettings.get(key).agent) return;
            const template = this.conversationSettings.template(config.appId);
            if (!template) {
              this.conversationSettings.initialize(key, this.legacySettings(config, key));
              return;
            }
            const persistence = this.ctx.get('sessionPersistence') as { stat(id: string): Promise<unknown> } | undefined;
            const legacy = this.prefs.legacySessionId(key);
            const existing = this.prefs.getSessionId(key) || this.prefs.getPreset(key) || this.prefs.getOverride(key)
              || (legacy !== undefined && (!persistence || await persistence.stat(legacy)));
            if (!receiving({ scope, targetId }) || !access.allowsConversation(scope, targetId) || slot.stopped) return;
            this.conversationSettings.initialize(key, existing ? this.legacySettings(config, key) : this.defaults(config.appId).settings, !!existing);
          },
          agent: {
            read: key => this.conversationSettings.get(key).agent,
            constrain: (agent, key) => this.toolPolicies.attach(agent, key),
            defaults: () => this.defaults(config.appId).settings,
            update: (key, patch) => {
              const current = this.conversationSettings.get(key);
              if (!current.agent) return false;
              this.conversationSettings.save(key, { revision: current.revision, agent: { ...current.agent, ...patch } });
              return true;
            },
          },
        }, this.dataDir);
      },
    });
    await slot.fiber.await();
  }
}
