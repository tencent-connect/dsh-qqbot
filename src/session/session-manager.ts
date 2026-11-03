/**
 * SessionManager — 管理 QQ peer → dsh Agent 的映射和生命周期
 *
 * sessionKey 格式: `qqbot:${appId}:${kind}:${peerId}`
 *   - c2c:   peerId = senderId (用户 openid)
 *   - group: peerId = groupOpenid
 *
 * 当前 SessionId 由对话目录保存，旧版派生 id 仅用于迁移。
 * Agent 与原生 Session 页共享同一个注册实例，并由公开控制器恢复。
 *
 * 支持 agent-presets 系统：通过 setup hook 在 create/resume 时
 * 挂载 preset（工具集、prompt sections 等），实现场景化配置。
 */
import { legacyDerivedSessionId, mintSessionId } from './session-id.ts';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { Context } from '@deepseek-ai/cordis';
import { createHostAdapter, type HostAdapter } from '../host/adapter.ts';
import { mkdirSync } from 'node:fs';
import { resolveAgentCwd } from '../shared/dirs.ts';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';
import type { ImQQBotConfig } from '../config.ts';
import { ModelResolver } from '../model/model-resolver.ts';
import type { ModelRoute, ModelEntry } from '../model/types.ts';
import { IdleEvictor } from './idle-evictor.ts';
import type { HumanReplyReceiptInput, QuestionChannel } from '../features/question-channel.ts';
import type { ApprovalChannel } from '../features/approval-channel.ts';
import type { ConversationService } from '../runtime/conversation-service.ts';
import type {
  SessionEventLike,
  DshAgent,
  DshAgentHandle,
  DshAgentRegistry,
  AgentPresetsLike,
  PresetComposition,
  PresetEntry,
  PresetSwitchOutcome,
  SessionRecord,
  SessionStatus,
  TokenUsageStats,
  CompactionServiceLike,
  CompactOutcome,
} from './types.ts';

/** ManualCompactionError 各 code 的友好提示 */
const COMPACTION_ERROR_HINTS: Record<string, string> = {
  busy: '压缩服务忙，请稍后重试',
  cancelled: '压缩已取消',
  changed: '历史在压缩过程中发生变化，请重试',
  commit: '压缩提交失败',
  persistence: '压缩完成但保存失败',
};

interface SessionPresetQuery {
  observeSession(id: SessionId, options: { projectionMode: 'all' }): Promise<Disposable & {
    projections?: { values: { agentPreset?: string | null } };
  }>;
}

export class SessionManager {
  private sessions = new Map<string, SessionRecord>();
  private readonly peerOperations = new Set<string>();
  private readonly freshSessionKeys = new Set<string>();
  private readonly evictor: IdleEvictor;
  private readonly modelResolver: ModelResolver;
  private readonly ctx: Context;
  private readonly host: HostAdapter;
  private readonly agents: DshAgentRegistry;
  private readonly config: ImQQBotConfig;
  private readonly logger: Logger;
  /** 由 bootstrap 注入的问答通道（ask_user_question → QQ），会话回收时清理其待答问题 */
  public questionChannel?: QuestionChannel;
  /** 由 bootstrap 注入的审批通道（approval/request → QQ），会话回收时清理其待批审批 */
  public approvalChannel?: ApprovalChannel;
  public conversations?: ConversationService;

  canApprove(scope: ChatScope, peerId: string, actor?: string): boolean { return this.conversations?.canApprove(scope, peerId, actor) ?? false; }
  canRelayInteraction(sessionId: string): boolean { return !!this.conversations?.interactionRecord(sessionId); }
  interactionRecord(sessionId: string, turn?: number): SessionRecord | undefined { return this.conversations?.interactionRecord(sessionId, turn); }
  async recordHumanReply(input: HumanReplyReceiptInput): Promise<void> {
    if (!this.conversations) throw new Error('QQ 问答回执服务不可用');
    await this.conversations.recordHumanReply(input);
  }
  canAnswer(scope: ChatScope, peerId: string, actor?: string): boolean { return this.conversations?.canAnswer(scope, peerId, actor) ?? false; }

  constructor(
    ctx: Context,
    agents: DshAgentRegistry,
    config: ImQQBotConfig,
    logger: Logger,
  ) {
    this.ctx = ctx;
    this.agents = agents;
    this.config = config;
    this.logger = logger;
    this.host = createHostAdapter(ctx, logger);
    this.logger.info(`host adapter capabilities: ${this.host.capabilities.join(', ')}`);
    this.modelResolver = new ModelResolver(ctx, config, logger);

    this.evictor = new IdleEvictor(
      this.sessions,
      config.sessionIdleTimeout,
      (key, record) => {
        if (this.currentRecord(key) !== record || record.agent.status !== 'idle' || this.hasPendingInbox(record.agent)) return;
        this.logger.info(`evicting idle session: key=${key}`);
        this.sessions.delete(key);
        this.conversations?.release(record.sessionId);
        record.agent.cancel({ kind: 'user' });
        void record.handle.dispose().catch(() => {});
        // 回收会话时统一清理其待答问题/待批审批，避免 pending 悬挂泄漏
        this.questionChannel?.cancelPending(key);
        this.approvalChannel?.cancelPending(key);
      },
    );

  }

  /**
   * 动态获取 agentPresets 服务（可选，未注入时返回 undefined）
   */
  private getPresetsService(): AgentPresetsLike | undefined {
    try {
      return this.ctx.get('agentPresets') as AgentPresetsLike | undefined;
    } catch {
      return undefined;
    }
  }

  /** 当前 preset 以日志投影为准；仅旧宿主缺少查询服务时回读创建 header。 */
  private async readPersistedPreset(sessionId: string): Promise<{ preset?: string } | undefined> {
    let query: SessionPresetQuery | undefined;
    try {
      query = this.ctx.get('sessionQuery') as SessionPresetQuery | undefined;
    } catch {
      query = undefined;
    }
    if (query?.observeSession) {
      try {
        using observation = await query.observeSession(SessionId(sessionId), { projectionMode: 'all' });
        const preset = observation.projections?.values.agentPreset;
        if (preset === null) return {};
        if (typeof preset === 'string' && preset.trim()) return { preset: preset.trim() };
        throw new Error(`im-qqbot: session ${sessionId} has no current agentPreset projection`);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
          return undefined;
        }
        throw error;
      }
    }

    let persistence: {
      stat?(id: string): Promise<{ header: { agentPreset?: string } } | undefined>;
      load?(id: string): Promise<{ meta?: { agentPreset?: string } }>;
    } | undefined;
    try {
      persistence = this.ctx.get('sessionPersistence') as typeof persistence | undefined;
    } catch {
      return undefined;
    }
    if (!persistence) return undefined;
    if (persistence.stat) {
      const stored = await persistence.stat(sessionId);
      return stored === undefined ? undefined : { preset: stored.header.agentPreset?.trim() || undefined };
    }
    if (persistence.load) {
      try {
        const { meta } = await persistence.load(sessionId);
        return { preset: meta?.agentPreset?.trim() || undefined };
      } catch (error) {
        if (error instanceof Error && error.name === 'SessionPersistenceNotFoundError') return undefined;
        throw error;
      }
    }
    return undefined;
  }

  private async resolvePersistedPreset(sessionId: string): Promise<string | undefined> {
    return (await this.readPersistedPreset(sessionId))?.preset;
  }

  // ── 模型相关（委托给 ModelResolver） ──

  getEffectiveModel(scope: ChatScope, peerId: string): ModelRoute | undefined {
    return this.getEffectiveModelByKey(this.sessionKey(scope, peerId));
  }
  private getEffectiveModelByKey(key: string): ModelRoute | undefined {
    const entry = this.conversations?.store.get(key);
    if (!entry?.settings) return this.modelResolver.getEffectiveRoute(key);
    if (entry.settings.model) return entry.settings.model;
    // Inherit the host default model, applying the conversation's stored default effort when set.
    const base = this.getDefaultModel();
    return entry.settings.reasoningEffort ? { ...base, reasoningEffort: entry.settings.reasoningEffort } : base;
  }
  async validateModelSetting(route: ModelRoute): Promise<ModelRoute> { return this.modelResolver.validateRoute(route); }

  getDefaultModel(): ModelRoute {
    return this.modelResolver.resolveHostDefault?.() ?? this.modelResolver.resolveDefault();
  }
  getDefaultPreset(): string { return this.getPresetsService()?.defaultId || ''; }

  getQQDefaultModel(): ModelRoute {
    const settings = this.conversations?.store.defaults().settings;
    if (settings?.model) return settings.model;
    const route = settings ? settings.model ?? this.getDefaultModel() : this.modelResolver.resolveDefault();
    return settings?.reasoningEffort ? { ...route, reasoningEffort: settings.reasoningEffort } : route;
  }
  getQQDefaultPreset(): string {
    const settings = this.conversations?.store.defaults().settings;
    return settings ? settings.preset || this.getDefaultPreset() : this.config.preset?.trim() || this.getDefaultPreset();
  }

  /**
   * 获取指定 peer 的生效 preset（per-peer 覆盖 > config.preset）
   */
  getEffectivePreset(scope: ChatScope, peerId: string): string | undefined {
    return this.getEffectivePresetByKey(this.sessionKey(scope, peerId)) ?? this.getPresetsService()?.defaultId;
  }

  /** 按 sessionKey 解析生效 preset */
  private getEffectivePresetByKey(key: string): string | undefined {
    const settings = this.conversations?.store.get(key)?.settings;
    if (settings) return settings.preset || this.getPresetsService()?.defaultId || undefined;
    return this.modelResolver.getPreset(key)?.trim() || this.config.preset?.trim() || undefined;
  }

  /**
   * 列出所有可用 preset（/preset 命令用）
   */
  async listPresets(): Promise<PresetEntry[]> {
    const presets = this.getPresetsService();
    if (!presets) return [];
    try {
      const list = await presets.list();
      return list.filter((p) => p.broken === undefined).map((p) => ({ id: p.id, name: p.name, description: p.description }));
    } catch (err) {
      this.logger.warn(`list presets failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  /** 使用宿主原生选择保留当前会话、历史与预设。 */
  async setModelOverride(scope: ChatScope, peerId: string, route: ModelRoute): Promise<void> {
    this.conversations?.validateSelection(scope, peerId, 'model', `${route.provider}/${route.model}`);
    const key = this.sessionKey(scope, peerId);
    await this.withPeerOperation(key, async () => {
      const selected = await this.switchModel(scope, peerId, route);
      this.modelResolver.setOverride(key, selected);
      this.conversations?.recordModelSetting(scope, peerId, selected);
    });
  }

  private async switchModel(scope: ChatScope, peerId: string, route: ModelRoute): Promise<ModelRoute> {
    const key = this.sessionKey(scope, peerId);
    const record = await this.restoreExistingRecord(scope, peerId);
    if (record?.agent.status === 'running') throw new Error('当前会话正在生成，请先等待结束或发送 /stop。');
    const current = record?.agent.model?.current() ?? record?.modelRoute ?? this.getEffectiveModelByKey(key);
    const selected = await this.modelResolver.validateRoute(route, current);
    this.conversations?.validateSelection(scope, peerId, 'model', `${selected.provider}/${selected.model}`);
    if (record) {
      if (current?.provider === selected.provider && current.model === selected.model
        && current.reasoningEffort === selected.reasoningEffort) return selected;
      await record.agent.runMaintenance(async (signal) => {
        signal.throwIfAborted();
        this.conversations?.validateSelection(scope, peerId, 'model', `${selected.provider}/${selected.model}`);
        if (!record.agent.model?.select) {
          throw new Error('当前宿主不支持记录会话模型选择，原会话和模型保持不变。');
        }
        record.agent.model.select(selected);
        record.modelRoute = selected;
        record.lastActivity = Date.now();
      });
    }
    return selected;
  }

  private async withPeerOperation<T>(key: string, operation: () => Promise<T>): Promise<T> {
    if (this.peerOperations.has(key)) throw new Error('当前会话正在更新，请稍后重试。');
    this.peerOperations.add(key);
    try {
      return await operation();
    } finally {
      this.peerOperations.delete(key);
    }
  }

  /** 通过新 Session 应用预设，成功后保存创建默认；没有存量 Session 时只保存默认。 */
  async setPresetOverride(scope: ChatScope, peerId: string, presetId: string): Promise<PresetSwitchOutcome> {
    this.conversations?.validateSelection(scope, peerId, 'preset', presetId);
    return this.updatePreset(scope, peerId, presetId, false);
  }

  /** 先通过新 Session 应用配置或宿主默认，再清除 per-peer 覆盖。 */
  async clearPresetOverride(scope: ChatScope, peerId: string): Promise<PresetSwitchOutcome> {
    const requested = this.getQQDefaultPreset() || undefined;
    this.conversations?.validateSelection(scope, peerId, 'preset', requested || this.getDefaultPreset());
    return this.updatePreset(scope, peerId, requested, true);
  }

  private async updatePreset(scope: ChatScope, peerId: string, requested: string | undefined, clear: boolean): Promise<PresetSwitchOutcome> {
    const key = this.sessionKey(scope, peerId);
    return this.withPeerOperation(key, async () => {
      const record = await this.restoreExistingRecord(scope, peerId);
      if (record?.agent.status === 'running') throw new Error('当前会话正在生成，请先等待结束或发送 /stop。');
      const presets = this.getPresetsService();
      if (!presets) {
        if (clear && !record) {
          this.conversations?.validateSelection(scope, peerId, 'preset', this.getDefaultPreset());
          this.modelResolver.clearPreset(key);
          return { ok: true };
        }
        return { ok: false, reason: 'unavailable', message: '当前宿主不支持原生会话预设切换，原会话和设置保持不变。' };
      }
      let resolved: { id: string; broken?: string };
      try { resolved = await presets.resolve(requested); }
      catch (error) {
        return { ok: false, reason: 'unknown-preset', message: error instanceof Error ? error.message : String(error) };
      }
      if (resolved.broken !== undefined) return { ok: false, reason: 'broken', message: resolved.broken };
      this.conversations?.validateSelection(scope, peerId, 'preset', resolved.id);
      let replacement: SessionRecord | undefined;
      if (record) {
        try {
          const composed = await this.composePreset(resolved.id);
          replacement = await this.replaceSessionRecord(scope, peerId, undefined, composed, record);
        } catch (error) {
          return { ok: false, reason: 'failed', message: error instanceof Error ? error.message : String(error) };
        }
      }
      if (clear) this.modelResolver.clearPreset(key);
      else this.modelResolver.setPreset(key, resolved.id);
      this.conversations?.recordPresetSetting(scope, peerId, clear ? requested || '' : resolved.id);
      this.logger.info(`preset ${clear ? 'override cleared' : 'selected'}: key=${key} preset=${resolved.id} session=${record?.sessionId ?? 'creation-default'}`);
      return { ok: true, presetId: resolved.id, ...(replacement ? { sessionId: replacement.sessionId } : {}) };
    });
  }

  async clearModelOverride(scope: ChatScope, peerId: string): Promise<void> {
    const key = this.sessionKey(scope, peerId);
    const defaultRoute = (): ModelRoute => this.getQQDefaultModel();
    const fallback = defaultRoute();
    this.conversations?.validateSelection(scope, peerId, 'model', `${fallback.provider}/${fallback.model}`);
    await this.withPeerOperation(key, async () => {
      const selected = await this.switchModel(scope, peerId, defaultRoute());
      this.modelResolver.clearOverride(key);
      this.conversations?.recordModelSetting(scope, peerId, selected, true);
    });
  }

  async listAvailableModels(): Promise<ModelEntry[]> {
    return this.modelResolver.listModels();
  }

  listProviders(): string[] {
    return this.modelResolver.listProviders();
  }

  // ── 会话状态 / 统计 ──

  getSessionRecord(scope: ChatScope, peerId: string): SessionRecord | undefined {
    const key = this.sessionKey(scope, peerId);
    return this.currentRecord(key);
  }

  getStatus(scope: ChatScope, peerId: string): SessionStatus {
    const record = this.getSessionRecord(scope, peerId);
    const route = record?.agent.model?.current() ?? record?.modelRoute;

    return {
      active: !!record,
      sessionId: record?.sessionId,
      provider: route?.provider,
      model: route?.model,
      preset: record?.agentPreset,
      nextPreset: this.getEffectivePreset(scope, peerId),
      lastActivity: record?.lastActivity,
      messageCount: this.countMessages(record),
    };
  }

  getTokenUsage(scope: ChatScope, peerId: string): TokenUsageStats {
    const record = this.getSessionRecord(scope, peerId);
    const stats: TokenUsageStats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    if (!record) return stats;

    const events = this.host.sessionEvents(record.agent.session) as readonly SessionEventLike[];
    if (!events) return stats;

    for (const event of events) {
      if (event.type !== 'assistant/message' || !event.usage) continue;
      stats.input += event.usage.input ?? 0;
      stats.output += event.usage.output ?? 0;
      stats.cacheRead += event.usage.cacheRead ?? 0;
      stats.cacheWrite += event.usage.cacheWrite ?? 0;
    }

    return stats;
  }

  exportMarkdown(scope: ChatScope, peerId: string): string {
    const record = this.getSessionRecord(scope, peerId);
    if (!record) return '';

    const events = this.host.sessionEvents(record.agent.session) as readonly SessionEventLike[];
    if (!events || events.length === 0) return '';

    const lines: string[] = [`# QQ 会话导出\n`, `> session: ${record.sessionId}\n`];

    for (const event of events) {
      if (event.type === 'user/message') {
        const text = extractMessageText(event.message);
        if (text) lines.push(`## 用户\n\n${text}\n`);
      } else if (event.type === 'assistant/message') {
        const text = extractMessageText(event.message);
        if (text) lines.push(`## 助手\n\n${text}\n`);
      }
    }

    return lines.join('\n');
  }

  private countMessages(record: SessionRecord | undefined): number {
    if (!record) return 0;
    const events = this.host.sessionEvents(record.agent.session) as readonly SessionEventLike[];
    if (!events) return 0;

    let count = 0;
    for (const event of events) {
      if (event.type === 'user/message' || event.type === 'assistant/message') {
        count += 1;
      }
    }
    return count;
  }

  // ── Session 生命周期管理 ──

  /** 命令可恢复存量会话读取实际选路；没有存量会话时不创建。 */
  async restoreExisting(
    scope: ChatScope,
    peerId: string,
    revive?: { senderId: string; replyTarget: ReplyTarget },
  ): Promise<SessionRecord | undefined> {
    return this.withPeerOperation(this.sessionKey(scope, peerId), () => this.restoreExistingRecord(scope, peerId, revive));
  }

  private async restoreExistingRecord(
    scope: ChatScope,
    peerId: string,
    revive?: { senderId: string; replyTarget: ReplyTarget },
  ): Promise<SessionRecord | undefined> {
    const key = this.sessionKey(scope, peerId);
    const existing = this.currentRecord(key);
    if (existing) {
      if (revive) {
        existing.senderId = revive.senderId;
        existing.replyTarget = revive.replyTarget;
      }
      return existing;
    }
    const sessionId = this.currentSessionId(key);
    const agent = this.agents.get(sessionId) ?? await this.host.resolveAgent(sessionId);
    if (!agent) return undefined;
    return this.createOrResume(scope, peerId, revive?.senderId ?? peerId, revive?.replyTarget ?? { scope, targetId: peerId }, agent);
  }

  private sessionKey(scope: ChatScope, peerId: string): string {
    return `qqbot:${this.config.appId}:${scope}:${peerId}`;
  }

  /** prefs 命中沿用；miss 返回 0.5.x 派生候选，由 getOrCreate 按 resume 结果迁移或铸造 */
  private currentSessionId(sessionKey: string): string {
    return this.conversations?.store.get(sessionKey)?.currentSessionId ?? this.modelResolver.getSessionId(sessionKey) ?? legacyDerivedSessionId(sessionKey);
  }

  /** 候选命中后落盘，后续永远走 prefs */
  private persistSessionId(sessionKey: string, sessionId: string): void {
    if (this.modelResolver.getSessionId(sessionKey) !== sessionId) {
      this.modelResolver.setSessionId(sessionKey, sessionId);
    }
  }

  private async composePreset(presetId?: string): Promise<PresetComposition> {
    const requestedId = presetId?.trim() || undefined;
    const presets = this.getPresetsService();
    if (!presets) {
      if (requestedId !== undefined) {
        throw new Error(`im-qqbot: preset ${requestedId} requires the agentPresets service`);
      }
      return {};
    }

    let resolved: { id: string; broken?: string };
    try {
      resolved = await presets.resolve(requestedId);
    } catch (err) {
      throw new Error(
        `im-qqbot: preset ${requestedId ?? '(default)'} unavailable: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    if (resolved.broken !== undefined) {
      throw new Error(`im-qqbot: preset ${resolved.id} is broken: ${resolved.broken}`);
    }

    const resolvedId = resolved.id;
    return {
      agentPreset: resolvedId,
      setup: async (agentCtx: Context) => {
        await presets.mount(agentCtx, resolvedId);
      },
    };
  }

  /** 获取或恢复或创建会话（get → resume → create） */
  async getOrCreate(
    scope: ChatScope,
    peerId: string,
    senderId: string,
    replyTarget: ReplyTarget,
  ): Promise<SessionRecord> {
    const key = this.sessionKey(scope, peerId);
    this.conversations?.assertMigrationReady();
    this.conversations?.ensure(scope, peerId, senderId);
    return this.withPeerOperation(key, () => this.createOrResume(scope, peerId, senderId, replyTarget));
  }

  private async createOrResume(
    scope: ChatScope,
    peerId: string,
    senderId: string,
    replyTarget: ReplyTarget,
    resolvedAgent?: DshAgent,
  ): Promise<SessionRecord> {
    const key = this.sessionKey(scope, peerId);
    const existing = this.currentRecord(key);

    if (existing) {
      existing.replyTarget = replyTarget;
      existing.senderId = senderId;
      existing.lastActivity = Date.now();
      return existing;
    }

    const route = this.getEffectiveModelByKey(key);
    let sessionId = SessionId(this.currentSessionId(key));
    let agent = resolvedAgent ?? this.agents.get(sessionId);
    let handle: DshAgentHandle | undefined;
    let agentPreset: string | undefined;
    let modelRoute: ModelRoute | undefined;
    if (!agent) agent = await this.host.resolveAgent(sessionId);
    if (agent) {
      const presets = this.getPresetsService();
      agentPreset = presets?.presetForSession
        ? presets.presetForSession(agent.session) ?? undefined
        : await this.resolvePersistedPreset(sessionId);
      modelRoute = agent.model?.current();
      this.logger.info(`using native agent: key=${key} sessionId=${sessionId}`);
    } else {
      if (!this.freshSessionKeys.has(key) && (this.conversations?.store.get(key)?.currentSessionId || this.modelResolver.getSessionId(key))) {
        throw new Error('原会话不存在，当前映射和旧关联保持不变。请恢复原会话存储后重试，或明确发送 /new 开始新会话；不会自动创建空会话。');
      }
      const composed = await this.composePreset(this.getEffectivePresetByKey(key));
      agentPreset = composed.agentPreset;
      sessionId = SessionId(mintSessionId());
      handle = await this.agents.create({
        sessionId,
        meta: {
          cwd: this.conversations?.cwd(scope, peerId) ?? this.workspaceDir(),
          ...(agentPreset ? { agentPreset } : {}),
        },
        ...(route ? { agentOptions: route } : {}),
        ...(composed.setup ? { setup: composed.setup } : {}),
      });
      agent = handle.agent;
      modelRoute = agent.model?.current() ?? route;
      this.logger.info(`created new session: key=${key} preset=${agentPreset ?? 'none'}`);
    }

    const record: SessionRecord = {
      sessionKey: key,
      sessionId,
      agent,
      handle: handle ?? { agent, dispose: async () => {} },
      replyTarget,
      scope,
      peerId,
      senderId,
      lastActivity: Date.now(),
      agentPreset,
      modelRoute,
    };

    const binding = this.conversations?.store.get(key)?.workspaceId;
    let workspace: ReturnType<ConversationService['resolveWorkspace']> | undefined;
    try {
      workspace = binding ? this.conversations?.resolveWorkspace(binding) : undefined;
      await workspace?.attachSession(SessionId(record.sessionId));
      this.conversations?.attach(record);
    } catch (error) {
      this.conversations?.release(record.sessionId);
      if (handle) {
        await workspace?.detachSession(SessionId(record.sessionId)).catch(() => {});
        await handle.dispose().catch(() => {});
      }
      throw error;
    }
    this.sessions.set(key, record);
    this.persistSessionId(key, sessionId);
    this.freshSessionKeys.delete(key);
    return record;
  }

  private hasPendingInbox(agent: DshAgent): boolean {
    return !!agent.inbox && (agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0);
  }

  private currentRecord(key: string): SessionRecord | undefined {
    const record = this.sessions.get(key);
    if (!record || this.agents.get(record.sessionId) === record.agent) return record;
    this.sessions.delete(key);
    this.questionChannel?.cancelPending(key);
    this.approvalChannel?.cancelPending(key);
    this.conversations?.release(record.sessionId);
    return undefined;
  }

  /** Create a fresh native Session; null clears its workspace binding, undefined inherits it. */
  async replaceSession(scope: ChatScope, peerId: string, workspaceId?: string | null, selection?: { presetId: string; assertCurrent: () => void }): Promise<SessionRecord> {
    this.conversations?.assertMigrationReady();
    const key = this.sessionKey(scope, peerId);
    return this.withPeerOperation(key, async () => {
      selection?.assertCurrent();
      const previous = await this.restoreExistingRecord(scope, peerId);
      if (selection) this.conversations?.validateSelection(scope, peerId, 'preset', selection.presetId);
      const composition = selection ? await this.composePreset(selection.presetId) : undefined;
      const record = await this.replaceSessionRecord(scope, peerId, workspaceId, composition, previous, selection?.assertCurrent);
      if (selection) {
        try { this.modelResolver.setPreset(key, selection.presetId); }
        catch { this.logger.warn('QQ Session 已切换，新会话预设缓存写入未完成'); }
      }
      return record;
    });
  }

  private async replaceSessionRecord(
    scope: ChatScope,
    peerId: string,
    workspaceId?: string | null,
    composition?: PresetComposition,
    previous?: SessionRecord,
    assertCurrent?: () => void,
  ): Promise<SessionRecord> {
    const key = this.sessionKey(scope, peerId);
    const assertBoundary = (): void => {
      assertCurrent?.();
      this.conversations?.assertCommandAuthority(scope, peerId);
      if (previous && (this.currentRecord(key) !== previous || previous.agent.status !== 'idle' || this.hasPendingInbox(previous.agent))) {
        throw new Error('当前会话正在生成、排队或已变化，请等待结束后重试。');
      }
    };
    assertBoundary();
    const currentWorkspaceId = this.conversations?.store.get(key)?.workspaceId;
    const bound = workspaceId === null ? undefined : workspaceId ?? currentWorkspaceId;
    const workspace = bound ? this.conversations?.resolveWorkspace(bound) : undefined;
    if (bound && !workspace) throw new Error('工作区服务不可用');
    const composed = composition ?? await this.composePreset(this.getEffectivePresetByKey(key));
    const route = previous?.agent.model?.current() ?? previous?.modelRoute ?? this.getEffectiveModelByKey(key);
    this.conversations?.assertCommandAuthority(scope, peerId);
    const id = SessionId(mintSessionId());
    const selectedCwd = workspaceId && workspaceId !== currentWorkspaceId ? workspace?.path : undefined;
    const cwd = workspaceId === null ? this.workspaceDir()
      : selectedCwd ?? this.conversations?.cwd(scope, peerId) ?? workspace?.path ?? previous?.agent.session.header?.cwd ?? this.workspaceDir();
    const handle = await this.agents.create({ sessionId: id,
      meta: { cwd, ...(composed.agentPreset ? { agentPreset: composed.agentPreset } : {}) },
      ...(route ? { agentOptions: route } : {}), ...(composed.setup ? { setup: composed.setup } : {}) });
    const record: SessionRecord = { sessionKey: key, sessionId: id, agent: handle.agent, handle,
      replyTarget: previous?.replyTarget ?? { scope, targetId: peerId }, scope, peerId,
      senderId: previous?.senderId ?? peerId, lastActivity: Date.now(), agentPreset: composed.agentPreset,
      modelRoute: handle.agent.model?.current() ?? route };
    try {
      await workspace?.attachSession(id);
      assertBoundary();
      this.conversations?.attach(record, workspaceId === null ? null : bound, composition?.agentPreset);
    } catch (error) {
      this.conversations?.release(id);
      await workspace?.detachSession(id).catch(() => {});
      await handle.dispose().catch(() => {});
      throw error;
    }
    // The conversation directory is authoritative. A cache write failure must not
    // report failure after a committed directory switch or resurrect the old id.
    this.sessions.set(key, record);
    try { this.persistSessionId(key, id); } catch { this.logger.warn('QQ Session 已切换，旧版偏好缓存写入未完成'); }
    try { this.conversations?.reset(scope, peerId); }
    catch { this.logger.warn('QQ Session 已切换，旧背景索引重置未完成；原生新会话不复用旧背景'); }
    if (previous) {
      this.questionChannel?.cancelPending(key);
      this.approvalChannel?.cancelPending(key);
      this.conversations?.release(previous.sessionId);
      previous.agent.cancel({ kind: 'user' });
      await previous.handle.dispose().catch(() => {});
    }
    return record;
  }

  findBySessionId(sessionId: string): SessionRecord | undefined {
    for (const record of this.sessions.values()) {
      if (record.sessionId === sessionId) return this.currentRecord(record.sessionKey);
    }
    return undefined;
  }

  findByAgent(agent: DshAgent): SessionRecord | undefined {
    for (const record of this.sessions.values()) {
      if (record.agent === agent) return this.currentRecord(record.sessionKey);
    }
    return undefined;
  }

  async remove(scope: ChatScope, peerId: string): Promise<void> {
    if (this.conversations) { await this.replaceSession(scope, peerId); return; }
    if (this.getSessionRecord(scope, peerId)?.agent.status === 'running') throw new Error('当前会话正在生成，请先停止。');
    await this.withPeerOperation(this.sessionKey(scope, peerId), () => this.removeRecord(this.sessionKey(scope, peerId)));
  }

  private async removeRecord(key: string): Promise<void> {
    const record = this.sessions.get(key);
    this.modelResolver.setSessionId(key, mintSessionId());
    this.freshSessionKeys.add(key);

    if (!record) return;
    this.sessions.delete(key);
    this.conversations?.release(record.sessionId);
    record.agent.cancel({ kind: 'user' });
    await record.handle.dispose().catch(() => {});
    this.logger.info(`session removed: key=${key}`);
  }

  /** Agent 工作目录：显式配置优先，缺省独立目录 ~/.dsh-qqbot/workspace（不随宿主进程 cwd） */
  private workspaceCache: string | undefined;
  private workspaceDir(): string {
    if (this.workspaceCache) return this.workspaceCache;
    const dir = resolveAgentCwd(this.config.cwd);
    mkdirSync(dir, { recursive: true });
    this.workspaceCache = dir;
    return dir;
  }

  /**
   * 原地压缩当前会话历史（保留 sessionId，用摘要替换旧历史）。
   *
   * compaction 是 preset 作用域服务，经 host adapter 从会话 preset 解析，
   * 全局注册的部署再兜底。这是「压缩上下文」的语义，区别于 remove() 的「换新会话」。
   */
  async compact(
    scope: ChatScope,
    peerId: string,
    revive?: { senderId: string; replyTarget: ReplyTarget },
  ): Promise<CompactOutcome> {
    const key = this.sessionKey(scope, peerId);
    if (this.peerOperations.has(key)) return { ok: false, reason: 'busy' };
    let record = this.sessions.get(key);
    if (!record) {
      // 无活跃会话（重启/闲置回收）时从磁盘拉起，历史在磁盘上仍可压缩
      if (!revive) return { ok: false, reason: 'no-session' };
      record = await this.getOrCreate(scope, peerId, revive.senderId, revive.replyTarget);
    }
    if (record.agent.status !== 'idle') return { ok: false, reason: 'busy' };

    const compaction = (await this.host.serviceFor(record.agent, 'compaction')
      ?? this.host.globalService('compaction')) as CompactionServiceLike | undefined;
    if (!compaction) return { ok: false, reason: 'unavailable' };

    const route = this.modelResolver.getEffectiveRoute(key);
    const agentCtx = {
      session: record.agent.session,
      options: { provider: route?.provider, model: route?.model },
      runMaintenance: record.agent.runMaintenance.bind(record.agent),
    };

    try {
      this.conversations?.assertCommandAuthority(scope, peerId);
      const result = await compaction.compactNow(agentCtx, new AbortController().signal);
      if (result === null) return { ok: true, shadowed: 0, tokens: 0 };
      return { ok: true, shadowed: result.shadowedSeqs.length, tokens: result.shadowedTokenCount };
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      // summary = 摘要没有更小 = 历史不足以压缩，属正常结果而非失败
      if (code === 'summary') {
        return { ok: true, shadowed: 0, tokens: 0 };
      }
      // 其他 ManualCompactionError 预期失败，给友好文案（debug 记录，不 warn 刷屏）
      if (code !== undefined && code in COMPACTION_ERROR_HINTS) {
        this.logger.debug(`compact declined: key=${key} code=${code}`);
        return { ok: false, reason: 'failed', message: COMPACTION_ERROR_HINTS[code] };
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`compact failed: key=${key} err=${message}`);
      return { ok: false, reason: 'failed', message };
    }
  }

  async disposeAll(): Promise<void> {
    this.evictor.dispose();
    const records = [...this.sessions.values()];
    this.sessions.clear();
    for (const record of records) {
      record.agent.cancel({ kind: 'user' });
      this.conversations?.release(record.sessionId);
    }
    await Promise.allSettled(records.map((r) => r.handle.dispose()));
    this.logger.info(`all sessions disposed (count=${records.length})`);
  }

  get size(): number {
    return this.sessions.size;
  }
}

/** 从消息对象中提取纯文本（用于导出/统计） */
function extractMessageText(
  message: SessionEventLike['message'],
): string {
  const blocks = message?.content;
  if (!blocks || !Array.isArray(blocks)) return '';

  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    }
  }
  return parts.join('\n').trim();
}
