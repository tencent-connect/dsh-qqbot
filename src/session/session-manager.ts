import { installQQPrompt, type QQPromptHandle } from '../prompt/install.ts';
/**
 * SessionManager — 管理 QQ peer → dsh Agent 的映射和生命周期
 *
 * sessionKey 格式: `qqbot:${appId}:${kind}:${peerId}`
 *   - c2c:   peerId = senderId (用户 openid)
 *   - group: peerId = groupOpenid
 *
 * sessionKey → sessionId 的映射存于 prefs（`model-prefs.json`），新会话 id 由
 * `mintSessionId()` 铸造（`session-` + UUID，与宿主一致）。0.5.x 的 SHA-256 确定性
 * 派生 id 仅用于探测存量会话并迁移，不再用于新建——确定性 id 跨进程必然相同，
 * 两个进程各自新建会把同一 id 写入不同 project 目录。
 *
 * 支持 agent-presets 系统：通过 setup hook 在 create/resume 时
 * 挂载 preset（工具集、prompt sections 等），实现场景化配置。
 */
import { legacyDerivedSessionId, mintSessionId } from './session-id.ts';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { Context } from '@deepseek-ai/cordis';
import type { PrefsStore } from '../model/prefs-store.ts';
import { createHostAdapter, type HostAdapter } from '../host/adapter.ts';
import { mkdirSync, statSync } from 'node:fs';
import { resolveAgentCwd } from '../shared/dirs.ts';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';
import type { ImQQBotConfig } from '../config.ts';
import { ModelResolver } from '../model/model-resolver.ts';
import type { ModelRoute, ModelEntry } from '../model/types.ts';
import type { WorkbenchAgentSettings } from '../shared/workbench-agent-settings.ts';
import { IdleEvictor } from './idle-evictor.ts';
import type { QuestionChannel } from '../features/question-channel.ts';
import type { ApprovalChannel } from '../features/approval-channel.ts';
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

export interface PeerAgentSettings {
  read(key: string): WorkbenchAgentSettings | undefined;
  update(key: string, patch: Partial<WorkbenchAgentSettings>): boolean;
  defaults(): WorkbenchAgentSettings;
}

/** ManualCompactionError 各 code 的友好提示 */
const COMPACTION_ERROR_HINTS: Record<string, string> = {
  busy: '压缩服务忙，请稍后重试',
  cancelled: '压缩已取消',
  changed: '历史在压缩过程中发生变化，请重试',
  commit: '压缩提交失败',
  persistence: '压缩完成但保存失败',
};

/** 复刻宿主 latestCompletedPrefixBoundary：最后一个 turn/end 起到下一 turn 开始前的边界 */
export function latestCompletedPrefixBoundary(events: readonly unknown[]): number | undefined {
  const list = events as Array<{ type?: string; seq?: number; surfaceOp?: string }>;
  let lastTurnEndSeq: number | undefined;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const candidate = list[i];
    if (candidate?.type === 'turn/end') {
      lastTurnEndSeq = candidate.seq;
      break;
    }
  }
  if (lastTurnEndSeq === undefined) return undefined;
  let boundary = lastTurnEndSeq;
  for (const next of list.slice(boundary + 1)) {
    if (next.type === 'turn/start'
      || (next.type === 'user/message' && next.surfaceOp === 'append')
      || next.type === 'agent/inbox/spliced') break;
    if (next.seq !== undefined) boundary = next.seq;
  }
  return boundary;
}

export class SessionManager {
  accountAccess?: import('../runtime/account-service.ts').AccountAccessService;
  private sessions = new Map<string, SessionRecord>();
  /**
   * 同 key 正在进行的 getOrCreate（singleflight）。
   *
   * 斜杠命令与待答问题截获位于 concurrencyGuard 之前（见 gateway/middleware-setup），
   * 与普通消息不串行：同 key 并发进入会各自 resume/create，产出两个 agent，
   * 后写入 sessions 的覆盖前者且前者无人 dispose（泄漏）。
   */
  private inflight = new Map<string, Promise<SessionRecord>>();
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

  constructor(
    ctx: Context,
    agents: DshAgentRegistry,
    config: ImQQBotConfig,
    logger: Logger,
    prefs?: PrefsStore,
    private readonly peerSettings?: PeerAgentSettings,
  ) {
    this.ctx = ctx;
    this.agents = agents;
    this.config = config;
    this.logger = logger;
    this.host = createHostAdapter(ctx, logger);
    this.logger.info(`host adapter capabilities: ${this.host.capabilities.join(', ')}`);
    this.modelResolver = new ModelResolver(ctx, config, logger, prefs);

    this.evictor = new IdleEvictor(
      this.sessions,
      config.sessionIdleTimeout,
      (key, record) => {
        this.logger.info(`evicting idle session: key=${key}`);
        this.sessions.delete(key);
        this.releasePrompt(record.agent);
        record.agent.cancel({ kind: 'user' });
        void record.handle.dispose().catch(() => {});
        // 回收会话时统一清理其待答问题/待批审批，避免 pending 悬挂泄漏
        this.questionChannel?.cancelPending(key);
        this.approvalChannel?.cancelPending(key);
      },
    );

  }

  /** 已装 prompt 的 agent → 句柄。释放时须同步 delete：live 复用的 agent 要能重装，否则 prompt 永久丢失。 */
  private readonly promptHandles = new WeakMap<DshAgent, QQPromptHandle>();

  /**
   * 在 agent.ctx 上安装 QQ prompt（幂等、fail-soft）：失败仅 warn，不打断会话建立。
   * TODO(split-2): personaCard / turnContext 由 inbound 接线，当前恒空。
   */
  private attachPrompt(agent: DshAgent, scope: ChatScope, key: string): void {
    if (this.promptHandles.has(agent)) return;
    if (!agent.ctx.get?.('systemPrompt')) return;
    try {
      this.promptHandles.set(agent, installQQPrompt(agent.ctx, {
        scope,
        personaCard: () => '',
        extraPrompts: () => {
          const settings = this.peerSettings?.read(key);
          return settings ? { group: settings.groupPrompt, direct: settings.directPrompt }
            : { group: this.config.groupPrompt, direct: this.config.directPrompt };
        },
      }));
    } catch (err) {
      this.logger.warn(`qq prompt install failed (session keeps working without it): ${errorText(err)}`);
    }
  }

  /** 释放 prompt 注册项；须在 handle.dispose() 之前（agent 销毁后 ctx 可能失效）。 */
  private releasePrompt(agent: DshAgent): void {
    const handle = this.promptHandles.get(agent);
    if (!handle) return;
    this.promptHandles.delete(agent);
    try {
      handle.dispose();
    } catch (err) {
      this.logger.warn(`qq prompt dispose failed: ${errorText(err)}`);
    }
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

  // ── 模型相关（委托给 ModelResolver） ──

  getEffectiveModel(scope: ChatScope, peerId: string): ModelRoute | undefined {
    const key = this.sessionKey(scope, peerId);
    return this.sessions.get(key)?.agent.model?.current?.() ?? this.configuredRoute(key);
  }

  private configuredRoute(key: string, settings = this.peerSettings?.read(key)): (ModelRoute & { reasoningEffort?: string }) | undefined {
    if (!settings) return this.modelResolver.getEffectiveRoute(key);
    const route = settings.model ?? this.modelResolver.resolveDefault(false);
    return { ...route, ...(settings.reasoningEffort ? { reasoningEffort: settings.reasoningEffort } : {}) };
  }

  replyOptions(sessionId: string): Pick<WorkbenchAgentSettings, 'streaming' | 'showToolResults'> {
    const target = this.deliveryAddress(sessionId);
    return (target && this.peerSettings?.read(this.sessionKey(target.scope, target.targetId))) ?? this.config;
  }

  /**
   * 获取指定 peer 的生效 preset（per-peer 覆盖 > config.preset）
   */
  getEffectivePreset(scope: ChatScope, peerId: string): string | undefined {
    return this.getEffectivePresetByKey(this.sessionKey(scope, peerId));
  }

  /** 按 sessionKey 解析生效 preset */
  private getEffectivePresetByKey(key: string): string | undefined {
    const settings = this.peerSettings?.read(key);
    if (settings) return settings.preset || undefined;
    return this.modelResolver.getPreset(key) ?? this.config.preset;
  }

  /**
   * 列出所有可用 preset（/preset 命令用）
   */
  async listPresets(): Promise<PresetEntry[]> {
    const presets = this.getPresetsService();
    if (!presets) return [];
    try {
      const list = await presets.list();
      return list.map((p) => ({ id: p.id, name: p.name, description: p.description }));
    } catch (err) {
      this.logger.warn(`list presets failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  /**
   * 切换模型（fork + 重建会话，保留历史）
   */
  async setModelOverride(scope: ChatScope, peerId: string, route: ModelRoute): Promise<void> {
    const key = this.sessionKey(scope, peerId);

    if (!this.peerSettings?.update(key, { model: route, reasoningEffort: '' })) this.modelResolver.setOverride(key, route);

    const record = this.sessions.get(key);
    if (!record) {
      this.logger.info(`model pref saved (no active session): key=${key} → ${route.provider}/${route.model}`);
      return;
    }

    await this.rebuildSession(record, { route });
    this.logger.info(`model switched via fork: key=${key} → ${route.provider}/${route.model}`);
  }

  /**
   * 切换指定 peer 的 agent preset（per-peer 覆盖）
   *
   * 已开始的会话保持锁定（blank-session contract）：只持久化为新会话默认，
   * 不 fork/rebuild 当前会话，避免历史工具调用与新 preset 工具集冲突。
   */
  async setPresetOverride(scope: ChatScope, peerId: string, presetId: string): Promise<PresetSwitchOutcome> {
    const key = this.sessionKey(scope, peerId);

    // 1. 校验 preset 存在 + 可加载（broken 拒绝）
    const presets = this.getPresetsService();
    if (!presets) return { ok: false, reason: 'unavailable' };
    let resolved: { id: string; broken?: string };
    try {
      resolved = await presets.resolve(presetId);
    } catch (err) {
      return { ok: false, reason: 'unknown-preset', message: err instanceof Error ? err.message : String(err) };
    }
    if (resolved.broken !== undefined) {
      return { ok: false, reason: 'broken', message: resolved.broken };
    }

    // 2. 持久化 per-peer 覆盖（新会话生效）
    if (!this.peerSettings?.update(key, { preset: presetId })) this.modelResolver.setPreset(key, presetId);

    const hasActive = this.sessions.has(key);
    this.logger.info(
      `preset pref saved: key=${key} → ${presetId}${hasActive ? ' (active session locked, next session applies)' : ''}`,
    );
    return { ok: true, presetId };
  }

  /**
   * 清除 per-peer preset 覆盖，回到 config.preset / 默认（新会话生效）
   */
  async clearPresetOverride(scope: ChatScope, peerId: string): Promise<PresetSwitchOutcome> {
    const key = this.sessionKey(scope, peerId);
    if (!this.peerSettings?.update(key, { preset: this.peerSettings.defaults().preset })) this.modelResolver.clearPreset(key);
    this.logger.info(`preset pref cleared: key=${key} (next session applies)`);
    return { ok: true };
  }

  /**
   * fork + 重建会话（保留历史，换 model）
   *
   * options.route 缺省时沿用当前生效值。preset 沿用当前生效 preset（getEffectivePresetByKey）。
   * fork 不可用或失败时降级为 dispose（下次消息重建）。
   */
  private async rebuildSession(
    record: SessionRecord,
    options: { route?: ModelRoute },
  ): Promise<void> {
    const key = record.sessionKey;

    // 对齐宿主官方 fork（commands.fork）：buildForkSeed 产物原样作 seed，
    // create 传 inheritedEventCount + isSeeded + parentSession
    const events = this.host.sessionEvents(record.agent.session);
    const boundary = latestCompletedPrefixBoundary(events);
    if (boundary === undefined) {
      this.logger.warn(`fork unavailable (no completed turn), fallback to dispose: key=${key}`);
      this.sessions.delete(key);
      this.releasePrompt(record.agent);
      record.agent.cancel({ kind: 'user' });
      await record.handle.dispose().catch(() => {});
      return;
    }

    const seed = await this.host.buildForkSeed(events, boundary);
    if (seed === undefined) {
      this.logger.warn(`fork seed unavailable (old host), fallback to dispose: key=${key}`);
      this.sessions.delete(key);
      this.releasePrompt(record.agent);
      record.agent.cancel({ kind: 'user' });
      await record.handle.dispose().catch(() => {});
      return;
    }

    const childId = SessionId(mintSessionId());
    const effectiveRoute = options.route ?? this.configuredRoute(key);
    const header = await this.host.sessionHeader(record.sessionId);
    const cwd = header?.cwd ?? this.workspaceDir();
    const composed = await this.composePreset(header?.agentPreset ?? record.agentPreset ?? this.getEffectivePresetByKey(key));
    const created = await this.agents.create({
      sessionId: childId,
      seed,
      inheritedEventCount: boundary + 1,
      meta: {
        cwd,
        isSeeded: true,
        // 旧版宿主的 delivery 豁免要求 parentSession，新版忽略——都传
        parentSession: record.sessionId,
        ...(composed.agentPreset ? { agentPreset: composed.agentPreset } : {}),
      },
      ...(effectiveRoute ? { agentOptions: effectiveRoute } : {}),
      setup: async (ctx, agent) => {
        await composed.setup?.(ctx, agent);
        if (effectiveRoute) agent?.model?.select(effectiveRoute);
      },
    });

    this.modelResolver.setSessionId(key, childId);

    const oldHandle = record.handle;
    const oldAgent = record.agent;
    record.sessionId = childId;
    this.attachPrompt(created.agent, record.scope, key);
    record.agent = created.agent;
    record.handle = created;
    record.agentPreset = composed.agentPreset;
    record.lastActivity = Date.now();

    this.releasePrompt(oldAgent);
    void oldHandle.dispose().catch(() => {});
    void this.host.attachSessionToWorkspace(childId, cwd);
    this.logger.info(`session rebuilt via fork: key=${key} preset=${composed.agentPreset ?? 'none'} sessionId=${childId}`);
  }

  clearModelOverride(scope: ChatScope, peerId: string): void {
    const key = this.sessionKey(scope, peerId);
    if (this.peerSettings) {
      const { model, reasoningEffort } = this.peerSettings.defaults();
      if (!this.peerSettings.update(key, { model, reasoningEffort })) this.modelResolver.clearOverride(key);
    } else this.modelResolver.clearOverride(key);
    this.modelResolver.clearSessionId(key);
  }

  async listAvailableModels(): Promise<ModelEntry[]> {
    return this.modelResolver.listModels();
  }

  listProviders(): string[] {
    return this.modelResolver.listProviders();
  }

  // ── 会话状态 / 统计 ──

  getSessionRecord(scope: ChatScope, peerId: string): SessionRecord | undefined {
    return this.sessions.get(this.sessionKey(scope, peerId));
  }

  getStatus(scope: ChatScope, peerId: string): SessionStatus {
    const record = this.getSessionRecord(scope, peerId);
    const route = this.getEffectiveModel(scope, peerId);

    return {
      active: !!record,
      sessionId: record?.sessionId,
      provider: route?.provider,
      model: route?.model,
      preset: record?.agentPreset,
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

  private sessionKey(scope: ChatScope, peerId: string): string {
    return `qqbot:${this.config.appId}:${scope}:${peerId}`;
  }

  /** prefs 命中沿用；miss 返回 0.5.x 派生候选，由 getOrCreate 按 resume 结果迁移或铸造 */
  private currentSessionId(sessionKey: string): string {
    return this.modelResolver.getSessionId(sessionKey) ?? legacyDerivedSessionId(sessionKey);
  }

  /** 候选命中后落盘，后续永远走 prefs */
  private persistSessionId(sessionKey: string, sessionId: string): void {
    if (this.modelResolver.getSessionId(sessionKey) !== sessionId) {
      this.modelResolver.setSessionId(sessionKey, sessionId);
    }
  }

  private async composePreset(presetId?: string, required = false): Promise<PresetComposition> {
    const presets = this.getPresetsService();
    if (!presets) {
      if (required) throw new Error('所选 Agent 预设不可用。');
      return {};
    }

    try {
      const resolved = await presets.resolve(presetId);
      if (required && resolved.broken !== undefined) throw new Error('所选 Agent 预设不可用。');
      const resolvedId = resolved.id;
      return {
        agentPreset: resolvedId,
        setup: async (agentCtx: Context) => {
          await presets.mount(agentCtx, resolvedId);
        },
      };
    } catch (err) {
      if (required) throw err;
      this.logger.warn(
        `im-qqbot: preset ${presetId ?? '(default)'} unavailable: ${err instanceof Error ? err.message : String(err)} — using host composition`,
      );
      return {};
    }
  }

  /** 获取或恢复或创建会话（get → resume → create）；同 key 并发合并为一次 */
  async getOrCreate(
    scope: ChatScope,
    peerId: string,
    senderId: string,
    replyTarget: ReplyTarget,
  ): Promise<SessionRecord> {
    const key = this.sessionKey(scope, peerId);
    const existing = this.sessions.get(key);

    if (existing) {
      existing.replyTarget = replyTarget;
      existing.lastActivity = Date.now();
      return existing;
    }

    // singleflight：同 key 并发复用同一次 resume/create，后到者只更新回复目标
    const pending = this.inflight.get(key);
    if (pending) {
      const shared = await pending;
      shared.replyTarget = replyTarget;
      shared.lastActivity = Date.now();
      return shared;
    }

    const task = this.openSession(key, scope, peerId, senderId, replyTarget);
    this.inflight.set(key, task);
    try {
      return await task;
    } finally {
      this.inflight.delete(key);
    }
  }

  /** getOrCreate 的实际打开流程（已通过 singleflight 保证同 key 串行） */
  private async openSession(
    key: string,
    scope: ChatScope,
    peerId: string,
    senderId: string,
    replyTarget: ReplyTarget,
  ): Promise<SessionRecord> {
    const settings = this.peerSettings?.read(key);
    const route = this.configuredRoute(key, settings);
    // prefs 命中 = 已知存量会话；miss 时取 0.5.x 派生 id 仅作存量探测候选，不用于新建
    const candidateIsLegacy = this.modelResolver.getSessionId(key) === undefined;
    let sessionId = SessionId(this.currentSessionId(key));
    this.logger.info(`getOrCreate: key=${key} route=${route ? `${route.provider}/${route.model}` : 'host-default'} sessionId=${sessionId}`);

    let agent: DshAgent;
    let handle: DshAgentHandle | undefined;
    const header = await this.host.sessionHeader(sessionId);
    let agentPreset = header?.agentPreset;
    let cwd = header?.cwd;

    const live = this.agents.get(sessionId);
    if (live) {
      agent = live;
      this.persistSessionId(key, sessionId);
      this.logger.info(`reusing live agent: key=${key}`);
    } else {
      const presetId = header ? (header.agentPreset ?? this.config.preset) : this.getEffectivePresetByKey(key);
      let composed = await this.composePreset(presetId);
      agentPreset = composed.agentPreset;
      try {
        const resumeRoute = this.modelResolver.getResumeRoute(key);
        const resumed = await this.agents.resume({
          resumeSessionId: sessionId,
          ...(resumeRoute ? { agentOptions: resumeRoute } : {}),
          ...(composed.setup ? { setup: composed.setup } : {}),
        });
        agent = resumed.agent;
        handle = resumed;
        // 0.5.x 迁移：候选命中老会话，沿用并落盘
        this.persistSessionId(key, sessionId);
        this.logger.info(`resumed session: key=${key} preset=${agentPreset ?? 'none'} route=${resumeRoute ? `${resumeRoute.provider}/${resumeRoute.model}` : 'session-own'}`);
      } catch (err) {
        if (!(await this.mayCreateAfterResumeFailure(key, sessionId, err))) throw err;
        if (settings?.preset) composed = await this.composePreset(settings.preset, true);
        agentPreset = composed.agentPreset;
        cwd = settings?.cwd || this.workspaceDir();
        if (settings?.cwd && !statSync(cwd).isDirectory()) throw new Error('所选工作区目录不可用。');
        const permission = settings?.permission;
        const permissions = permission ? this.host.globalService('permissionPresets') as {
          catalog(): { options: readonly { value: string }[] };
          set(session: unknown, permission: string): void;
        } | undefined : undefined;
        if (permission && !permissions?.catalog().options.some(option => option.value === permission)) {
          throw new Error('所选 DSH 执行权限不可用。');
        }
        sessionId = this.resolveCreateId(key, sessionId, candidateIsLegacy);
        const created = await this.agents.create({
          sessionId,
          meta: {
            cwd,
            ...(agentPreset ? { agentPreset } : {}),
          },
          ...(route ? { agentOptions: route } : {}),
          ...(settings || composed.setup ? { setup: async (ctx: Context, newAgent?: DshAgent) => {
            await composed.setup?.(ctx, newAgent);
            if (settings && route) newAgent?.model?.select(route);
            if (permissions && permission) {
              const session = newAgent?.session ?? (this.host.globalService('sessions') as { get(id: string): unknown } | undefined)?.get(sessionId);
              if (!session) throw new Error('无法为新 Session 应用执行权限。');
              permissions.set(session, permission);
            }
          } } : {}),
        });
        agent = created.agent;
        handle = created;
        this.persistSessionId(key, sessionId);
        this.logger.info(`created new session: key=${key} sessionId=${sessionId} preset=${agentPreset ?? 'none'}`);
      }
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
    };

    this.attachPrompt(agent, scope, key);
    this.sessions.set(key, record);

    // 挂载到对应工作区（侧边栏可见性）；fail-soft、异步执行，不阻塞消息处理。
    // 宿主只在客户端 session.create RPC 时挂载会话，插件会话不走那条路径，
    // 闲置回收后会从侧边栏消失（详见 host/adapter.ts 的 attachSessionToWorkspace）。
    // cwd 必须与 meta.cwd 同源（workspaceDir()），否则 attachSession 的
    // header.cwd 校验（realpath 后须等于工作区 path）会失败。
    void this.host.attachSessionToWorkspace(sessionId, cwd ?? this.workspaceDir());

    return record;
  }

  /**
   * resume 失败后是否允许首次创建。
   *
   * 只有「会话确实不在盘上」才可创建：损坏/占用/后端故障沿用同一 id 重建，会把
   * 同一 sessionId 写进多个 project 目录，宿主 `list()` 随后报 duplicate，会话
   * 列表整体打不开（对齐宿主 `restoreOrCreateConfigured` 的 fail-loud 语义）。
   *
   * @returns 允许创建返回 true；拒绝时已记录 warn，调用方应抛出原 resume 错误。
   */
  private async mayCreateAfterResumeFailure(key: string, sessionId: string, resumeError: unknown): Promise<boolean> {
    const context = `key=${key} sessionId=${sessionId} resumeErr=${errorText(resumeError)}`;
    let exists: boolean | undefined;
    try {
      exists = await this.host.sessionExists(sessionId);
    } catch (probeError) {
      // 求证本身失败（持久化后端故障）：无法断言不在盘上，按存在处理
      this.logger.warn(`refusing to recreate session, existence unknown: ${context} probeErr=${errorText(probeError)}`);
      return false;
    }
    if (exists === true) {
      this.logger.warn(`refusing to recreate existing session: ${context}`);
      return false;
    }
    if (exists === undefined) {
      // 宿主无 sessionPersistence.stat：没有求证手段，只能按 resume 结果创建（= 修复前行为）
      this.logger.warn(`creating session without existence check (host lacks sessionPersistence.stat): ${context}`);
    }
    return true;
  }

  /**
   * 确认候选会话缺失后决定用哪个 id 新建。
   *
   * - resume 等待期间 prefs 被并发改写（`/new` 换新会话）：采用 prefs 的最新 id，
   *   否则内存与 prefs 指向不同会话，重启后用户被切走；
   * - 候选来自 0.5.x 确定性派生：一律铸造新 id，确定性 id 不进入新建路径；
   * - 候选来自 prefs 且确认缺失：沿用该 id 新建，prefs 无需改写。
   */
  private resolveCreateId(key: string, candidate: SessionId, candidateIsLegacy: boolean): SessionId {
    const latest = this.modelResolver.getSessionId(key);
    if (latest !== undefined && latest !== candidate) {
      this.logger.info(`adopting concurrently written session id: key=${key} sessionId=${latest}`);
      return SessionId(latest);
    }
    if (candidateIsLegacy) {
      const minted = SessionId(mintSessionId());
      this.logger.info(`migrated to minted session id: key=${key} sessionId=${minted}`);
      return minted;
    }
    return candidate;
  }

  findBySessionId(sessionId: string): SessionRecord | undefined {
    for (const record of this.sessions.values()) {
      if (record.sessionId === sessionId) return record;
    }
    return undefined;
  }

  /**
   * 这条 session 对应的 QQ 地址。只读：不把宿主里的 agent 收进会话表，也不拥有它的生命周期。
   * 内存里有记录时沿用它的 replyTarget（含 msgId）；否则按 prefs 的 sessionId 反查对端。
   */
  deliveryAddress(sessionId: string): ReplyTarget | undefined {
    const existing = this.findBySessionId(sessionId);
    if (existing) return existing.replyTarget;

    const key = this.modelResolver.findSessionKey(sessionId);
    if (key === undefined || this.sessions.has(key)) return undefined;
    const parsed = this.parseSessionKey(key);
    if (parsed === undefined) return undefined;
    return { scope: parsed.scope, targetId: parsed.peerId };
  }

  /** `qqbot:${appId}:${scope}:${peerId}` → scope + peer。只认本机器人的 key。 */
  private parseSessionKey(key: string): { scope: ChatScope; peerId: string } | undefined {
    const match = /^qqbot:([^:]+):(c2c|group):(.+)$/.exec(key);
    if (match === null || match[1] !== this.config.appId) return undefined;
    const scope = match[2];
    const peerId = match[3];
    if ((scope !== 'c2c' && scope !== 'group') || peerId === undefined || peerId === '') return undefined;
    return { scope, peerId };
  }

  findByAgent(agent: DshAgent): SessionRecord | undefined {
    for (const record of this.sessions.values()) {
      if (record.agent === agent) return record;
    }
    return undefined;
  }

  async remove(scope: ChatScope, peerId: string): Promise<void> {
    const key = this.sessionKey(scope, peerId);
    const record = this.sessions.get(key);
    this.modelResolver.setSessionId(key, mintSessionId());

    if (!record) return;
    this.sessions.delete(key);
    this.releasePrompt(record.agent);
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
      this.releasePrompt(record.agent);
      record.agent.cancel({ kind: 'user' });
    }
    await Promise.allSettled(records.map((r) => r.handle.dispose()));
    this.logger.info(`all sessions disposed (count=${records.length})`);
  }

  get size(): number {
    return this.sessions.size;
  }
}

/** 错误文案（日志用） */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
