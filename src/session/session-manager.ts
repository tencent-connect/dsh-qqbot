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
import { createHostAdapter, type HostAdapter, type PermissionKnobs } from '../host/adapter.ts';
import { mkdirSync } from 'node:fs';
import { resolveAgentCwd } from '../shared/dirs.ts';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';
import type { ImQQBotConfig } from '../config.ts';
import { ModelResolver } from '../model/model-resolver.ts';
import type { ModelRoute, ModelEntry } from '../model/types.ts';
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
  SessionGroup,
  SessionGroupEntry,
  SwitchSessionOutcome,
  StartNewOutcome,
  SetPermissionOutcome,
  TokenUsageStats,
  CompactionServiceLike,
  CompactOutcome,
} from './types.ts';

/** /sessions 列表默认上限（QQ 单条消息有限长，超出提示用 id 直达） */
const LIST_WORKSPACE_CAP = 5;
const LIST_SESSION_CAP = 8;

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
  private attachPrompt(agent: DshAgent, scope: ChatScope): void {
    if (this.promptHandles.has(agent)) return;
    if (!agent.ctx.get?.('systemPrompt')) return;
    try {
      this.promptHandles.set(agent, installQQPrompt(agent.ctx, {
        scope,
        personaCard: () => '',
        extraPrompts: () => ({ group: this.config.groupPrompt, direct: this.config.directPrompt }),
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

  /**
   * 从 session 持久化 header 读 session 当初的 preset（started 锁定语义）。
   * 读不到（服务缺失 / session 不存在 / 未记录 agentPreset）返回 undefined。
   */
  private async resolvePersistedPreset(sessionId: string): Promise<string | undefined> {
    return (await this.host.sessionHeader(sessionId))?.agentPreset;
  }

  // ── 模型相关（委托给 ModelResolver） ──

  getEffectiveModel(scope: ChatScope, peerId: string): ModelRoute | undefined {
    return this.modelResolver.getEffectiveRoute(this.sessionKey(scope, peerId));
  }

  /**
   * 获取指定 peer 的生效 preset（per-peer 覆盖 > config.preset）
   */
  getEffectivePreset(scope: ChatScope, peerId: string): string | undefined {
    return this.getEffectivePresetByKey(this.sessionKey(scope, peerId));
  }

  /** 按 sessionKey 解析生效 preset */
  private getEffectivePresetByKey(key: string): string | undefined {
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

    this.modelResolver.setOverride(key, route);

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
    this.modelResolver.setPreset(key, presetId);

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
    this.modelResolver.clearPreset(key);
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
    const effectiveRoute = options.route ?? this.modelResolver.getEffectiveRoute(key);
    const composed = await this.composePreset(this.getEffectivePresetByKey(key));
    const created = await this.agents.create({
      sessionId: childId,
      seed,
      inheritedEventCount: boundary + 1,
      meta: {
        cwd: this.workspaceDir(record.sessionKey),
        isSeeded: true,
        // 旧版宿主的 delivery 豁免要求 parentSession，新版忽略——都传
        parentSession: record.sessionId,
        ...(composed.agentPreset ? { agentPreset: composed.agentPreset } : {}),
      },
      ...(effectiveRoute ? { agentOptions: effectiveRoute } : {}),
      ...(composed.setup ? { setup: composed.setup } : {}),
    });

    this.modelResolver.setSessionId(key, childId);

    const oldHandle = record.handle;
    const oldAgent = record.agent;
    record.sessionId = childId;
    this.attachPrompt(created.agent, record.scope);
    record.agent = created.agent;
    record.handle = created;
    record.agentPreset = composed.agentPreset;
    record.lastActivity = Date.now();

    this.releasePrompt(oldAgent);
    void oldHandle.dispose().catch(() => {});
    this.logger.info(`session rebuilt via fork: key=${key} preset=${composed.agentPreset ?? 'none'} sessionId=${childId}`);
  }

  clearModelOverride(scope: ChatScope, peerId: string): void {
    const key = this.sessionKey(scope, peerId);
    this.modelResolver.clearOverride(key);
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

  private async composePreset(presetId?: string): Promise<PresetComposition> {
    const presets = this.getPresetsService();
    if (!presets) return {};

    try {
      const resolved = await presets.resolve(presetId);
      const resolvedId = resolved.id;
      return {
        agentPreset: resolvedId,
        setup: async (agentCtx: Context) => {
          await presets.mount(agentCtx, resolvedId);
        },
      };
    } catch (err) {
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
    const route = this.modelResolver.getEffectiveRoute(key);
    // prefs 命中 = 已知存量会话；miss 时取 0.5.x 派生 id 仅作存量探测候选，不用于新建
    const candidateIsLegacy = this.modelResolver.getSessionId(key) === undefined;
    let sessionId = SessionId(this.currentSessionId(key));
    this.logger.info(`getOrCreate: key=${key} route=${route ? `${route.provider}/${route.model}` : 'host-default'} sessionId=${sessionId}`);

    let agent: DshAgent;
    let handle: DshAgentHandle | undefined;
    let agentPreset: string | undefined;

    const live = this.agents.get(sessionId);
    if (live) {
      agent = live;
      this.persistSessionId(key, sessionId);
      this.logger.info(`reusing live agent: key=${key}`);
    } else {
      // preset 只解析一次：resume/create 共用同一组合，避免重复 resolve/mount 目录。
      // 优先 session 当初的 preset（started 锁定语义），无则用当前 effective preset。
      const presetId = (await this.resolvePersistedPreset(sessionId)) ?? this.getEffectivePresetByKey(key);
      const composed = await this.composePreset(presetId);
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
        sessionId = this.resolveCreateId(key, sessionId, candidateIsLegacy);
        const created = await this.agents.create({
          sessionId,
          meta: {
            cwd: this.workspaceDir(key),
            ...(agentPreset ? { agentPreset } : {}),
          },
          ...(route ? { agentOptions: route } : {}),
          ...(composed.setup ? { setup: composed.setup } : {}),
        });
        agent = created.agent;
        handle = created;
        this.persistSessionId(key, sessionId);
        this.logger.info(`created new session: key=${key} sessionId=${sessionId} preset=${agentPreset ?? 'none'}`);
        // per-peer 权限偏好是新会话的默认 knob（resume 路径由事件重放恢复，无需重复 append）
        const permPref = this.modelResolver.getPermission(key);
        if (permPref) {
          const applied = await this.host.applyPermissionKnobs(agent.session, permPref);
          if (!applied) {
            this.logger.warn(`permission pref apply failed (session keeps deployment default): key=${key}`);
          }
        }
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

    this.attachPrompt(agent, scope);
    this.sessions.set(key, record);

    // 挂载到对应工作区（侧边栏可见性）；fail-soft、异步执行，不阻塞消息处理。
    // 宿主只在客户端 session.create RPC 时挂载会话，插件会话不走那条路径，
    // 闲置回收后会从侧边栏消失（详见 host/adapter.ts 的 attachSessionToWorkspace）。
    // cwd 必须与 meta.cwd 同源（workspaceDir()），否则 attachSession 的
    // header.cwd 校验（realpath 后须等于工作区 path）会失败。
    void this.host.attachSessionToWorkspace(sessionId, this.workspaceDir(key));

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

  /**
   * Agent 工作目录（per-peer）：prefs 工作区偏好（须为宿主已登记工作区）优先，
   * 缺省 config.cwd / ~/.dsh-qqbot/workspace（不随宿主进程 cwd）。
   * 会话 cwd 不可变——偏好只影响"下一次 create"，切换工作区即换新会话。
   */
  private workspaceDirs = new Map<string, string>();
  /** 未登记偏好的降级 warn 去重（每 key 一次，避免每条消息刷屏） */
  private workspacePrefWarned = new Set<string>();
  private workspaceDir(key: string): string {
    const cached = this.workspaceDirs.get(key);
    if (cached) return cached;
    const dir = this.resolveWorkspacePref(key) ?? resolveAgentCwd(this.config.cwd);
    mkdirSync(dir, { recursive: true });
    this.workspaceDirs.set(key, dir);
    return dir;
  }

  /** 展示用当前工作区路径（无副作用，不 mkdir）：/sessions 列表标记当前组 */
  effectiveWorkspacePath(key: string): string {
    return this.resolveWorkspacePref(key) ?? resolveAgentCwd(this.config.cwd);
  }

  /** prefs 偏好命中且仍为已登记工作区才生效；未登记回退默认并 warn（每 key 一次） */
  private resolveWorkspacePref(key: string): string | undefined {
    const pref = this.modelResolver.getWorkspace(key);
    if (pref === undefined) return undefined;
    if (this.isRegisteredWorkspace(pref)) return pref;
    if (!this.workspacePrefWarned.has(key)) {
      this.workspacePrefWarned.add(key);
      this.logger.warn(`per-peer workspace not registered, fallback to default: key=${key} dir=${pref}`);
    }
    return undefined;
  }

  private isRegisteredWorkspace(path: string): boolean {
    return this.host.listWorkspaces().some((workspace) => workspace.path === path);
  }

  /** 目标会话是否在宿主某工作区账目内（/sessions 切换的准入校验） */
  isRegisteredSession(sessionId: string): boolean {
    return this.host.listWorkspaces().some((workspace) => workspace.sessionIds.includes(sessionId));
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

  // ── /sessions：工作区分组的会话导航 ──

  /** 列出宿主工作区（title + path），/sessions new 的错误提示用 */
  listWorkspaceRefs(): Array<{ title: string; path: string }> {
    return this.host.listWorkspaces().map((workspace) => ({ title: workspace.title, path: workspace.path }));
  }

  /**
   * 按工作区分组列出会话（当前工作区置顶，当前会话标记 isCurrent）。
   * 数据源是宿主 workspaceRegistry 的会话账目——插件不自建会话历史，
   * 避免双写漂移；每组条数与组数有上限（QQ 单条消息有限长）。
   */
  async listSessionGroups(
    scope: ChatScope,
    peerId: string,
    caps: { workspaces?: number; sessions?: number } = {},
  ): Promise<SessionGroup[]> {
    const key = this.sessionKey(scope, peerId);
    const workspaceCap = caps.workspaces ?? LIST_WORKSPACE_CAP;
    const sessionCap = caps.sessions ?? LIST_SESSION_CAP;
    const currentSessionId = this.sessions.get(key)?.sessionId ?? this.modelResolver.getSessionId(key);
    const currentPath = this.effectiveWorkspacePath(key);

    const all = this.host.listWorkspaces();
    if (all.length === 0) return [];

    // 当前工作区排最前，其余保持注册表顺序（sort 稳定）
    const ordered = [...all].sort(
      (a, b) => Number(b.path === currentPath) - Number(a.path === currentPath),
    );

    const groups: SessionGroup[] = [];
    for (const workspace of ordered.slice(0, workspaceCap)) {
      const shown = workspace.sessionIds.slice(0, sessionCap);
      const truncated = workspace.sessionIds.length - shown.length;
      const sessions: SessionGroupEntry[] = [];
      for (const sessionId of shown) {
        const header = await this.host.sessionHeader(sessionId);
        sessions.push({
          sessionId,
          createdAt: header?.createdAt,
          agentPreset: header?.agentPreset,
          isCurrent: sessionId === currentSessionId,
        });
      }
      groups.push({
        path: workspace.path,
        title: workspace.title,
        isCurrentWorkspace: workspace.path === currentPath,
        sessions,
        truncated,
      });
    }
    return groups;
  }

  /**
   * 解析 /sessions <arg> 的目标：1 起始的序号（对齐列表渲染顺序，仅覆盖已
   * 展示范围）或完整/前缀会话 id（在全部工作区账目内匹配，多命中视为歧义）。
   */
  async resolveSessionTarget(scope: ChatScope, peerId: string, arg: string): Promise<string | undefined> {
    const trimmed = arg.trim();
    if (trimmed === '') return undefined;

    if (/^\d+$/.test(trimmed)) {
      const groups = await this.listSessionGroups(scope, peerId);
      const displayed = groups.flatMap((group) => group.sessions.map((session) => session.sessionId));
      const index = Number(trimmed);
      return index >= 1 && index <= displayed.length ? displayed[index - 1] : undefined;
    }

    const registered = this.host.listWorkspaces().flatMap((workspace) => [...workspace.sessionIds]);
    const matches = registered.filter((id) => id === trimmed || id.startsWith(trimmed));
    return matches.length === 1 ? matches[0] : undefined;
  }

  /**
   * 切换到指定会话（/sessions <id>）：写入 prefs 映射并释放当前 agent，
   * 下一条消息经 getOrCreate resume 目标会话。目标须在宿主工作区账目内。
   * 工作区偏好同步为目标会话的 cwd（已登记时），保证此后 /new 落在同一个工作区。
   */
  async switchSession(scope: ChatScope, peerId: string, targetSessionId: string): Promise<SwitchSessionOutcome> {
    const key = this.sessionKey(scope, peerId);
    if (!this.isRegisteredSession(targetSessionId)) {
      this.logger.warn(`switch to unregistered session refused: key=${key} target=${targetSessionId}`);
      return { ok: false, reason: 'unknown-session' };
    }

    const record = this.sessions.get(key);
    const currentId = record?.sessionId ?? this.modelResolver.getSessionId(key);
    if (currentId === targetSessionId) return { ok: true, alreadyCurrent: true };

    this.modelResolver.setSessionId(key, targetSessionId);
    const header = await this.host.sessionHeader(targetSessionId);
    if (header?.cwd !== undefined && this.isRegisteredWorkspace(header.cwd)) {
      this.modelResolver.setWorkspace(key, header.cwd);
    } else {
      this.modelResolver.clearWorkspace(key);
    }
    this.workspaceDirs.delete(key);

    if (record) {
      this.sessions.delete(key);
      this.releasePrompt(record.agent);
      record.agent.cancel({ kind: 'user' });
      await record.handle.dispose().catch(() => {});
    }
    this.logger.info(`session switched: key=${key} -> ${targetSessionId}`);
    return { ok: true };
  }

  /**
   * 在指定工作区开新会话（/sessions new <工作区>）：写工作区偏好 + 铸新
   * 会话 id（/new 语义），下一条消息在新 cwd create。工作区须已登记。
   */
  async startNewInWorkspace(scope: ChatScope, peerId: string, workspaceRef: string): Promise<StartNewOutcome> {
    const key = this.sessionKey(scope, peerId);
    const workspace = this.host.listWorkspaces().find(
      (candidate) => candidate.path === workspaceRef || candidate.title === workspaceRef,
    );
    if (!workspace) {
      this.logger.warn(`new session in unknown workspace refused: key=${key} ref=${workspaceRef}`);
      return { ok: false, reason: 'unknown-workspace' };
    }

    this.modelResolver.setWorkspace(key, workspace.path);
    this.workspaceDirs.delete(key);
    await this.remove(scope, peerId); // 铸新 id + 释放当前 agent
    this.logger.info(`new session in workspace: key=${key} -> ${workspace.path}`);
    return { ok: true, path: workspace.path };
  }

  // ── /permission：会话内权限切换 ──

  /**
   * 当前生效的权限 knob：活跃会话事件（实际值）> per-peer 偏好（新会话默认）。
   * 两者皆无 → source 'default'（跟随宿主部署配置）。
   */
  getPermissionStatus(
    scope: ChatScope,
    peerId: string,
  ): { knobs?: PermissionKnobs; source: 'session' | 'pref' | 'default' } {
    const key = this.sessionKey(scope, peerId);
    const record = this.sessions.get(key);
    if (record) {
      const knobs = this.host.readPermissionKnobs(record.agent.session);
      if (knobs) return { knobs, source: 'session' };
    }
    const pref = this.modelResolver.getPermission(key);
    if (pref) return { knobs: pref, source: 'pref' };
    return { source: 'default' };
  }

  /**
   * 切换权限：活跃会话立即 append knob 事件生效（durable，重启重放保留）；
   * 同时持久化为 per-peer 偏好，/new 后的新会话沿用（knob 事件随旧会话归档）。
   * 宿主策略模块不可用（最小组合）时 live 应用失败，偏好仍已保存。
   */
  async setPermission(scope: ChatScope, peerId: string, knobs: PermissionKnobs): Promise<SetPermissionOutcome> {
    const key = this.sessionKey(scope, peerId);
    this.modelResolver.setPermission(key, knobs);

    const record = this.sessions.get(key);
    if (!record) {
      this.logger.info(`permission pref saved (no active session): key=${key} → ${knobs.sandbox}+${knobs.approval}`);
      return { ok: true, appliedLive: false };
    }
    const applied = await this.host.applyPermissionKnobs(record.agent.session, knobs);
    if (!applied) {
      this.logger.warn(`permission apply failed on live session: key=${key}`);
      return { ok: false, reason: 'apply-failed' };
    }
    this.logger.info(`permission switched: key=${key} → ${knobs.sandbox}+${knobs.approval}`);
    return { ok: true, appliedLive: true };
  }

  /**
   * 清除 per-peer 权限偏好（/permission reset）：新会话回到宿主部署默认。
   * 活跃会话已 append 的 knob 事件是 durable 日志，无法回收——当前会话保持
   * 现状直到 /new（命令文案已说明）。
   */
  clearPermission(scope: ChatScope, peerId: string): boolean {
    return this.modelResolver.clearPermission(this.sessionKey(scope, peerId));
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
