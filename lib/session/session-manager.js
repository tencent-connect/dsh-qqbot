import { installQQPrompt } from "../prompt/install.js";
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
import { legacyDerivedSessionId, mintSessionId } from "./session-id.js";
import { SessionId } from '@deepseek-ai/dsh-session';
import { createHostAdapter } from "../host/adapter.js";
import { mkdirSync, statSync } from 'node:fs';
import { resolveAgentCwd } from "../shared/dirs.js";
import { ModelResolver } from "../model/model-resolver.js";
import { IdleEvictor } from "./idle-evictor.js";
export class SessionSwitchConflict extends Error {
}
export class SessionArchivedError extends Error {
}
/** ManualCompactionError 各 code 的友好提示 */
const COMPACTION_ERROR_HINTS = {
    busy: '压缩服务忙，请稍后重试',
    cancelled: '压缩已取消',
    changed: '历史在压缩过程中发生变化，请重试',
    commit: '压缩提交失败',
    persistence: '压缩完成但保存失败',
};
/** 复刻宿主 latestCompletedPrefixBoundary：最后一个 turn/end 起到下一 turn 开始前的边界 */
export function latestCompletedPrefixBoundary(events) {
    const list = events;
    let lastTurnEndSeq;
    for (let i = list.length - 1; i >= 0; i -= 1) {
        const candidate = list[i];
        if (candidate?.type === 'turn/end') {
            lastTurnEndSeq = candidate.seq;
            break;
        }
    }
    if (lastTurnEndSeq === undefined)
        return undefined;
    let boundary = lastTurnEndSeq;
    for (const next of list.slice(boundary + 1)) {
        if (next.type === 'turn/start'
            || (next.type === 'user/message' && next.surfaceOp === 'append')
            || next.type === 'agent/inbox/spliced')
            break;
        if (next.seq !== undefined)
            boundary = next.seq;
    }
    return boundary;
}
export class SessionManager {
    peerSettings;
    accountAccess;
    sessions = new Map();
    /**
     * 同 key 正在进行的 getOrCreate（singleflight）。
     *
     * 斜杠命令与待答问题截获位于 concurrencyGuard 之前（见 gateway/middleware-setup），
     * 与普通消息不串行：同 key 并发进入会各自 resume/create，产出两个 agent，
     * 后写入 sessions 的覆盖前者且前者无人 dispose（泄漏）。
     */
    inflight = new Map();
    switching = new Map();
    rebuilding = new Set();
    active = true;
    evictor;
    modelResolver;
    ctx;
    host;
    agents;
    config;
    logger;
    /** 由 bootstrap 注入的问答通道（ask_user_question → QQ），会话回收时清理其待答问题 */
    questionChannel;
    /** 由 bootstrap 注入的审批通道（approval/request → QQ），会话回收时清理其待批审批 */
    approvalChannel;
    constructor(ctx, agents, config, logger, prefs, peerSettings) {
        this.peerSettings = peerSettings;
        this.ctx = ctx;
        this.agents = agents;
        this.config = config;
        this.logger = logger;
        this.host = createHostAdapter(ctx, logger);
        this.logger.info(`host adapter capabilities: ${this.host.capabilities.join(', ')}`);
        this.modelResolver = new ModelResolver(ctx, config, logger, prefs);
        this.evictor = new IdleEvictor(this.sessions, config.sessionIdleTimeout, (key, record) => {
            this.logger.info(`evicting idle session: key=${key}`);
            this.sessions.delete(key);
            this.cancelPendingInteractions(key);
            this.releasePrompt(record.agent);
            record.agent.cancel({ kind: 'user' });
            void record.handle.dispose().catch(() => { });
        });
    }
    /** 已装 prompt 的 agent → 句柄。释放时须同步 delete：live 复用的 agent 要能重装，否则 prompt 永久丢失。 */
    promptHandles = new WeakMap();
    /**
     * 在 agent.ctx 上安装 QQ prompt（幂等、fail-soft）：失败仅 warn，不打断会话建立。
     * TODO(split-2): personaCard / turnContext 由 inbound 接线，当前恒空。
     */
    attachPrompt(agent, scope, key) {
        if (this.promptHandles.has(agent))
            return;
        if (!agent.ctx.get?.('systemPrompt'))
            return;
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
        }
        catch (err) {
            this.logger.warn(`qq prompt install failed (session keeps working without it): ${errorText(err)}`);
        }
    }
    /** 释放 prompt 注册项；须在 handle.dispose() 之前（agent 销毁后 ctx 可能失效）。 */
    releasePrompt(agent) {
        const handle = this.promptHandles.get(agent);
        if (!handle)
            return;
        this.promptHandles.delete(agent);
        try {
            handle.dispose();
        }
        catch (err) {
            this.logger.warn(`qq prompt dispose failed: ${errorText(err)}`);
        }
    }
    /**
     * 动态获取 agentPresets 服务（可选，未注入时返回 undefined）
     */
    getPresetsService() {
        try {
            return this.ctx.get('agentPresets');
        }
        catch {
            return undefined;
        }
    }
    // ── 模型相关（委托给 ModelResolver） ──
    getEffectiveModel(scope, peerId) {
        const key = this.sessionKey(scope, peerId);
        return this.sessions.get(key)?.agent.model?.current?.() ?? this.configuredRoute(key);
    }
    configuredRoute(key, settings = this.peerSettings?.read(key)) {
        if (!settings)
            return this.modelResolver.getEffectiveRoute(key);
        const route = settings.model ?? this.modelResolver.resolveDefault(false);
        return { ...route, ...(settings.reasoningEffort ? { reasoningEffort: settings.reasoningEffort } : {}) };
    }
    replyOptions(sessionId) {
        const target = this.deliveryAddress(sessionId);
        return (target && this.peerSettings?.read(this.sessionKey(target.scope, target.targetId))) ?? this.config;
    }
    /**
     * 获取指定 peer 的生效 preset（per-peer 覆盖 > config.preset）
     */
    getEffectivePreset(scope, peerId) {
        return this.getEffectivePresetByKey(this.sessionKey(scope, peerId));
    }
    /** 按 sessionKey 解析生效 preset */
    getEffectivePresetByKey(key) {
        const settings = this.peerSettings?.read(key);
        if (settings)
            return settings.preset || undefined;
        return this.modelResolver.getPreset(key) ?? this.config.preset;
    }
    /**
     * 列出所有可用 preset（/preset 命令用）
     */
    async listPresets() {
        const presets = this.getPresetsService();
        if (!presets)
            return [];
        try {
            const list = await presets.list();
            return list.map((p) => ({ id: p.id, name: p.name, description: p.description }));
        }
        catch (err) {
            this.logger.warn(`list presets failed: ${err instanceof Error ? err.message : String(err)}`);
            return [];
        }
    }
    /**
     * 切换模型（fork + 重建会话，保留历史）
     */
    async setModelOverride(scope, peerId, route) {
        this.assertActive();
        const key = this.sessionKey(scope, peerId);
        if (this.switching.has(key) || this.rebuilding.has(key)) {
            throw new SessionSwitchConflict('此 QQ 会话正在切换 Session，请稍后重试。');
        }
        if (!this.peerSettings?.update(key, { model: route, reasoningEffort: '' }))
            this.modelResolver.setOverride(key, route);
        const record = this.sessions.get(key);
        if (!record) {
            this.logger.info(`model pref saved (no active session): key=${key} → ${route.provider}/${route.model}`);
            return;
        }
        this.rebuilding.add(key);
        try {
            await this.rebuildSession(record, { route });
        }
        finally {
            this.rebuilding.delete(key);
        }
        this.logger.info(`model switched via fork: key=${key} → ${route.provider}/${route.model}`);
    }
    /**
     * 切换指定 peer 的 agent preset（per-peer 覆盖）
     *
     * 已开始的会话保持锁定（blank-session contract）：只持久化为新会话默认，
     * 不 fork/rebuild 当前会话，避免历史工具调用与新 preset 工具集冲突。
     */
    async setPresetOverride(scope, peerId, presetId) {
        const key = this.sessionKey(scope, peerId);
        // 1. 校验 preset 存在 + 可加载（broken 拒绝）
        const presets = this.getPresetsService();
        if (!presets)
            return { ok: false, reason: 'unavailable' };
        let resolved;
        try {
            resolved = await presets.resolve(presetId);
        }
        catch (err) {
            return { ok: false, reason: 'unknown-preset', message: err instanceof Error ? err.message : String(err) };
        }
        if (resolved.broken !== undefined) {
            return { ok: false, reason: 'broken', message: resolved.broken };
        }
        // 2. 持久化 per-peer 覆盖（新会话生效）
        if (!this.peerSettings?.update(key, { preset: presetId }))
            this.modelResolver.setPreset(key, presetId);
        const hasActive = this.sessions.has(key);
        this.logger.info(`preset pref saved: key=${key} → ${presetId}${hasActive ? ' (active session locked, next session applies)' : ''}`);
        return { ok: true, presetId };
    }
    /**
     * 清除 per-peer preset 覆盖，回到 config.preset / 默认（新会话生效）
     */
    async clearPresetOverride(scope, peerId) {
        const key = this.sessionKey(scope, peerId);
        if (!this.peerSettings?.update(key, { preset: this.peerSettings.defaults().preset }))
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
    async rebuildSession(record, options) {
        const key = record.sessionKey;
        // 对齐宿主官方 fork（commands.fork）：buildForkSeed 产物原样作 seed，
        // create 传 inheritedEventCount + isSeeded + parentSession
        const events = this.host.sessionEvents(record.agent.session);
        const boundary = latestCompletedPrefixBoundary(events);
        if (boundary === undefined) {
            this.logger.warn(`fork unavailable (no completed turn), fallback to dispose: key=${key}`);
            this.sessions.delete(key);
            this.cancelPendingInteractions(key);
            this.releasePrompt(record.agent);
            record.agent.cancel({ kind: 'user' });
            await record.handle.dispose().catch(() => { });
            return;
        }
        const seed = await this.host.buildForkSeed(events, boundary);
        this.assertActive();
        if (this.sessions.get(key) !== record)
            throw new SessionSwitchConflict('当前 Session 已变化，请重试。');
        if (seed === undefined) {
            this.logger.warn(`fork seed unavailable (old host), fallback to dispose: key=${key}`);
            this.sessions.delete(key);
            this.cancelPendingInteractions(key);
            this.releasePrompt(record.agent);
            record.agent.cancel({ kind: 'user' });
            await record.handle.dispose().catch(() => { });
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
                if (effectiveRoute)
                    agent?.model?.select(effectiveRoute);
                if (agent)
                    await this.peerSettings?.constrain?.(agent, key);
            },
        });
        try {
            this.assertActive();
            if (this.sessions.get(key) !== record)
                throw new SessionSwitchConflict('当前 Session 已变化，请重试。');
            this.modelResolver.setSessionId(key, childId, { durable: true });
        }
        catch (error) {
            await created.dispose().catch(() => { });
            throw error;
        }
        const oldHandle = record.handle;
        const oldAgent = record.agent;
        this.cancelPendingInteractions(key);
        record.sessionId = childId;
        this.attachPrompt(created.agent, record.scope, key);
        record.agent = created.agent;
        record.handle = created;
        record.agentPreset = composed.agentPreset;
        record.lastActivity = Date.now();
        this.releasePrompt(oldAgent);
        void oldHandle.dispose().catch(() => { });
        void this.host.attachSessionToWorkspace(childId, cwd);
        this.logger.info(`session rebuilt via fork: key=${key} preset=${composed.agentPreset ?? 'none'} sessionId=${childId}`);
    }
    clearModelOverride(scope, peerId) {
        const key = this.sessionKey(scope, peerId);
        if (this.peerSettings) {
            const { model, reasoningEffort } = this.peerSettings.defaults();
            if (!this.peerSettings.update(key, { model, reasoningEffort }))
                this.modelResolver.clearOverride(key);
        }
        else
            this.modelResolver.clearOverride(key);
        this.modelResolver.clearSessionId(key);
    }
    async listAvailableModels() {
        return this.modelResolver.listModels();
    }
    listProviders() {
        return this.modelResolver.listProviders();
    }
    // ── 会话状态 / 统计 ──
    getSessionRecord(scope, peerId) {
        return this.sessions.get(this.sessionKey(scope, peerId));
    }
    getStatus(scope, peerId) {
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
    getTokenUsage(scope, peerId) {
        const record = this.getSessionRecord(scope, peerId);
        const stats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        if (!record)
            return stats;
        const events = this.host.sessionEvents(record.agent.session);
        if (!events)
            return stats;
        for (const event of events) {
            if (event.type !== 'assistant/message' || !event.usage)
                continue;
            stats.input += event.usage.input ?? 0;
            stats.output += event.usage.output ?? 0;
            stats.cacheRead += event.usage.cacheRead ?? 0;
            stats.cacheWrite += event.usage.cacheWrite ?? 0;
        }
        return stats;
    }
    exportMarkdown(scope, peerId) {
        const record = this.getSessionRecord(scope, peerId);
        if (!record)
            return '';
        const events = this.host.sessionEvents(record.agent.session);
        if (!events || events.length === 0)
            return '';
        const lines = [`# QQ 会话导出\n`, `> session: ${record.sessionId}\n`];
        for (const event of events) {
            if (event.type === 'user/message') {
                const text = extractMessageText(event.message);
                if (text)
                    lines.push(`## 用户\n\n${text}\n`);
            }
            else if (event.type === 'assistant/message') {
                const text = extractMessageText(event.message);
                if (text)
                    lines.push(`## 助手\n\n${text}\n`);
            }
        }
        return lines.join('\n');
    }
    countMessages(record) {
        if (!record)
            return 0;
        const events = this.host.sessionEvents(record.agent.session);
        if (!events)
            return 0;
        let count = 0;
        for (const event of events) {
            if (event.type === 'user/message' || event.type === 'assistant/message') {
                count += 1;
            }
        }
        return count;
    }
    // ── Session 生命周期管理 ──
    sessionKey(scope, peerId) {
        return `qqbot:${this.config.appId}:${scope}:${peerId}`;
    }
    /** prefs 命中沿用；miss 返回 0.5.x 派生候选，由 getOrCreate 按 resume 结果迁移或铸造 */
    currentSessionId(sessionKey) {
        return this.modelResolver.getSessionId(sessionKey) ?? legacyDerivedSessionId(sessionKey);
    }
    /** 候选命中后落盘，后续永远走 prefs */
    persistSessionId(sessionKey, sessionId) {
        if (this.modelResolver.getSessionId(sessionKey) !== sessionId) {
            this.modelResolver.setSessionId(sessionKey, sessionId, { durable: true });
        }
    }
    async composePreset(presetId, required = false) {
        const presets = this.getPresetsService();
        if (!presets) {
            if (required)
                throw new Error('所选 Agent 预设不可用。');
            return {};
        }
        try {
            const resolved = await presets.resolve(presetId);
            if (required && resolved.broken !== undefined)
                throw new Error('所选 Agent 预设不可用。');
            const resolvedId = resolved.id;
            return {
                agentPreset: resolvedId,
                setup: async (agentCtx) => {
                    await presets.mount(agentCtx, resolvedId);
                },
            };
        }
        catch (err) {
            if (required)
                throw err;
            this.logger.warn(`im-qqbot: preset ${presetId ?? '(default)'} unavailable: ${err instanceof Error ? err.message : String(err)} — using host composition`);
            return {};
        }
    }
    async createAndBindSession(scope, peerId, expected, settings, assertCurrent) {
        this.assertActive();
        const key = this.sessionKey(scope, peerId);
        const busy = () => new SessionSwitchConflict('此 QQ 会话正在处理任务，请在空闲后新建。');
        if (this.inflight.has(key) || this.switching.has(key) || this.rebuilding.has(key))
            throw busy();
        const previous = this.currentSessionId(key);
        const previousAgent = () => this.sessions.get(key)?.agent ?? this.agents.get(previous);
        if (previousAgent()?.status === 'running')
            throw busy();
        const conflict = () => new SessionSwitchConflict('当前 Session 已变化，请刷新后重试。');
        const task = (async () => {
            const exists = await this.host.sessionExists(previous);
            if (exists === undefined)
                throw new Error('当前宿主无法确认 Session 已保存。');
            if ((exists ? previous : null) !== expected)
                throw conflict();
            this.assertActive();
            assertCurrent();
            const id = SessionId(mintSessionId());
            const { handle, cwd, agentPreset } = await this.createFresh(key, id, settings);
            try {
                if (!await this.host.sessionExists(id))
                    throw new Error('新 Session 未保存，请检查宿主持久化。');
                if (this.currentSessionId(key) !== previous)
                    throw conflict();
                if (previousAgent()?.status === 'running')
                    throw busy();
                this.assertActive();
                assertCurrent();
                this.modelResolver.setSessionId(key, id, { durable: true, previous: expected ?? undefined });
            }
            catch (error) {
                await handle.dispose().catch(() => { });
                throw error;
            }
            const old = this.sessions.get(key);
            this.sessions.set(key, {
                sessionKey: key, sessionId: id, agent: handle.agent, handle,
                replyTarget: { scope, targetId: peerId }, scope, peerId,
                lastActivity: Date.now(), agentPreset,
            });
            this.cancelPendingInteractions(key);
            this.attachPrompt(handle.agent, scope, key);
            if (old) {
                this.releasePrompt(old.agent);
                void old.agent.whenIdle().then(() => old.handle.dispose()).catch(() => { });
            }
            void this.host.attachSessionToWorkspace(id, cwd);
            return id;
        })();
        this.switching.set(key, task);
        try {
            return await task;
        }
        finally {
            this.switching.delete(key);
        }
    }
    assertNotArchived(sessionId) {
        const workspace = this.host.globalService('workspaceRegistry');
        const archived = workspace?.archivedSessionIds;
        if (Array.isArray(archived) && archived.includes(sessionId)) {
            throw new SessionArchivedError('当前 DSH Session 已归档，请在 QQ 工作台恢复原会话或新建 Session。');
        }
    }
    assertBindingOwner(key, sessionId, allowUnbound = false) {
        const current = this.modelResolver.getSessionId(key);
        if ((current !== sessionId && !(allowUnbound && current === undefined))
            || this.modelResolver.hasForeignCurrentBinding(key, sessionId)) {
            throw new SessionSwitchConflict('QQ 会话绑定存在冲突，请为该对话新建 Session。');
        }
    }
    /** 获取或恢复或创建会话（get → resume → create）；同 key 并发合并为一次 */
    async getOrCreate(scope, peerId, senderId, replyTarget) {
        const key = this.sessionKey(scope, peerId);
        while (this.switching.has(key)) {
            await this.switching.get(key)?.catch(() => { });
        }
        this.assertActive();
        const existing = this.sessions.get(key);
        this.assertNotArchived(existing?.sessionId ?? this.currentSessionId(key));
        if (existing) {
            this.assertBindingOwner(key, existing.sessionId);
            existing.replyTarget = replyTarget;
            existing.senderId ??= senderId;
            existing.lastActivity = Date.now();
            return existing;
        }
        // singleflight：同 key 并发复用同一次 resume/create，后到者只更新回复目标
        const pending = this.inflight.get(key);
        if (pending) {
            const shared = await pending;
            this.assertActive();
            this.assertBindingOwner(key, shared.sessionId);
            this.assertNotArchived(shared.sessionId);
            shared.replyTarget = replyTarget;
            shared.lastActivity = Date.now();
            return shared;
        }
        const task = this.openSession(key, scope, peerId, senderId, replyTarget);
        this.inflight.set(key, task);
        try {
            const record = await task;
            this.assertActive();
            this.assertBindingOwner(key, record.sessionId);
            this.assertNotArchived(record.sessionId);
            return record;
        }
        finally {
            this.inflight.delete(key);
        }
    }
    // A QQ /new can advance the binding while the host is opening a session.
    async openSession(key, scope, peerId, senderId, replyTarget) {
        for (;;) {
            this.assertActive();
            const binding = this.modelResolver.getSessionId(key);
            try {
                const record = await this.openSessionAttempt(key, binding, scope, peerId, senderId, replyTarget);
                if (record)
                    return record;
            }
            catch (error) {
                this.assertActive();
                if (this.modelResolver.getSessionId(key) === binding)
                    throw error;
            }
        }
    }
    async openSessionAttempt(key, binding, scope, peerId, senderId, replyTarget) {
        const settings = this.peerSettings?.read(key);
        const route = this.configuredRoute(key, settings);
        // prefs 命中 = 已知存量会话；miss 时取 0.5.x 派生 id 仅作存量探测候选，不用于新建
        let sessionId = SessionId(binding ?? legacyDerivedSessionId(key));
        this.assertBindingOwner(key, sessionId, binding === undefined);
        this.logger.info(`getOrCreate: key=${key} route=${route ? `${route.provider}/${route.model}` : 'host-default'} sessionId=${sessionId}`);
        let agent;
        let handle;
        const header = await this.host.sessionHeader(sessionId);
        this.assertActive();
        this.assertBindingOwner(key, sessionId, binding === undefined);
        let agentPreset = header?.agentPreset;
        let cwd = header?.cwd;
        const live = this.agents.get(sessionId);
        if (live) {
            agent = live;
            this.logger.info(`reusing live agent: key=${key}`);
        }
        else {
            const presetId = header ? (header.agentPreset ?? this.config.preset) : this.getEffectivePresetByKey(key);
            const composed = await this.composePreset(presetId);
            this.assertActive();
            this.assertBindingOwner(key, sessionId, binding === undefined);
            agentPreset = composed.agentPreset;
            try {
                const resumeRoute = this.modelResolver.getResumeRoute(key);
                const resumed = await this.agents.resume({
                    resumeSessionId: sessionId,
                    ...(resumeRoute ? { agentOptions: resumeRoute } : {}),
                    ...(composed.setup || this.peerSettings?.constrain ? { setup: async (ctx, resumedAgent) => {
                            await composed.setup?.(ctx, resumedAgent);
                            if (resumedAgent)
                                await this.peerSettings?.constrain?.(resumedAgent, key);
                        } } : {}),
                });
                agent = resumed.agent;
                handle = resumed;
                this.logger.info(`resumed session: key=${key} preset=${agentPreset ?? 'none'} route=${resumeRoute ? `${resumeRoute.provider}/${resumeRoute.model}` : 'session-own'}`);
            }
            catch (err) {
                if (!(await this.mayCreateAfterResumeFailure(key, sessionId, err)))
                    throw err;
                this.assertActive();
                if (this.modelResolver.getSessionId(key) !== binding)
                    return undefined;
                if (binding === undefined)
                    sessionId = SessionId(mintSessionId());
                this.assertBindingOwner(key, sessionId, binding === undefined);
                const created = await this.createFresh(key, sessionId, settings);
                agentPreset = created.agentPreset;
                cwd = created.cwd;
                agent = created.handle.agent;
                handle = created.handle;
                this.logger.info(`created new session: key=${key} sessionId=${sessionId} preset=${agentPreset ?? 'none'}`);
            }
        }
        // The host and tool-policy setup above can both finish after a reset or reload.
        try {
            this.assertBindingOwner(key, sessionId, binding === undefined);
            await this.peerSettings?.constrain?.(agent, key);
            this.assertActive();
            if (this.modelResolver.getSessionId(key) !== binding) {
                await handle?.dispose().catch(() => { });
                return undefined;
            }
            this.assertBindingOwner(key, sessionId, binding === undefined);
            this.assertNotArchived(sessionId);
            this.persistSessionId(key, sessionId);
        }
        catch (error) {
            await handle?.dispose().catch(() => { });
            throw error;
        }
        const record = {
            sessionKey: key,
            sessionId,
            agent,
            handle: handle ?? { agent, dispose: async () => { } },
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
    async createFresh(key, sessionId, settings = this.peerSettings?.read(key)) {
        const route = this.configuredRoute(key, settings);
        const composed = await this.composePreset(settings?.preset || this.getEffectivePresetByKey(key), !!settings?.preset);
        const selectedCwd = settings?.cwd;
        const usesDefault = !selectedCwd || selectedCwd === resolveAgentCwd(this.config.cwd);
        const cwd = usesDefault ? this.workspaceDir() : selectedCwd;
        if (!usesDefault && !statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
            throw new Error('所选工作区目录不可用。');
        }
        const permission = settings?.permission;
        const permissions = permission ? this.host.globalService('permissionPresets') : undefined;
        if (permission && !permissions?.catalog().options.some(option => option.value === permission)) {
            throw new Error('所选 DSH 执行权限不可用。');
        }
        const handle = await this.agents.create({
            sessionId,
            meta: { cwd, ...(composed.agentPreset ? { agentPreset: composed.agentPreset } : {}) },
            ...(route ? { agentOptions: route } : {}),
            ...(settings || composed.setup ? { setup: async (ctx, agent) => {
                    await composed.setup?.(ctx, agent);
                    if (settings && route)
                        agent?.model?.select(route);
                    if (permissions && permission) {
                        const session = agent?.session ?? this.host.globalService('sessions')?.get(sessionId);
                        if (!session)
                            throw new Error('无法为新 Session 应用执行权限。');
                        permissions.set(session, permission);
                    }
                    if (agent)
                        await this.peerSettings?.constrain?.(agent, key);
                } } : {}),
        });
        return { handle, cwd, agentPreset: composed.agentPreset };
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
    async mayCreateAfterResumeFailure(key, sessionId, resumeError) {
        const context = `key=${key} sessionId=${sessionId} resumeErr=${errorText(resumeError)}`;
        let exists;
        try {
            exists = await this.host.sessionExists(sessionId);
        }
        catch (probeError) {
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
    findBySessionId(sessionId) {
        const key = this.modelResolver.findUniqueCurrentSessionKey(sessionId);
        const record = key && this.sessions.get(key);
        return record && record.sessionId === sessionId ? record : undefined;
    }
    /**
     * 这条 session 对应的 QQ 地址。只读：不把宿主里的 agent 收进会话表，也不拥有它的生命周期。
     * 内存里有记录时沿用它的 replyTarget（含 msgId）；否则按 prefs 的 sessionId 反查对端。
     */
    deliveryAddress(sessionId) {
        const key = this.modelResolver.findUniqueCurrentSessionKey(sessionId);
        if (key === undefined)
            return undefined;
        const parsed = this.parseSessionKey(key);
        if (parsed === undefined)
            return undefined;
        const existing = this.sessions.get(key);
        if (existing && existing.sessionId !== sessionId)
            return undefined;
        return { ...existing?.replyTarget, scope: parsed.scope, targetId: parsed.peerId };
    }
    /** `qqbot:${appId}:${scope}:${peerId}` → scope + peer。只认本机器人的 key。 */
    parseSessionKey(key) {
        const match = /^qqbot:([^:]+):(c2c|group):(.+)$/.exec(key);
        if (match === null || match[1] !== this.config.appId)
            return undefined;
        const scope = match[2];
        const peerId = match[3];
        if ((scope !== 'c2c' && scope !== 'group') || peerId === undefined || peerId === '')
            return undefined;
        return { scope, peerId };
    }
    findByAgent(agent) {
        for (const record of this.sessions.values()) {
            if (record.agent === agent)
                return record;
        }
        return undefined;
    }
    sessionChangePending(scope, peerId) {
        const key = this.sessionKey(scope, peerId);
        return this.inflight.has(key) || this.switching.has(key) || this.rebuilding.has(key);
    }
    async remove(scope, peerId) {
        this.assertActive();
        const key = this.sessionKey(scope, peerId);
        const assertNotSwitching = () => {
            if (this.switching.has(key) || this.rebuilding.has(key))
                throw new SessionSwitchConflict('此 QQ 会话正在切换 Session，请稍后重试。');
        };
        assertNotSwitching();
        let previous;
        if (this.modelResolver.getSessionId(key) === undefined) {
            const legacy = legacyDerivedSessionId(key);
            if (await this.host.sessionExists(legacy))
                previous = legacy;
            assertNotSwitching();
            // A concurrent resume or reset may already have established the mapping.
            if (this.modelResolver.getSessionId(key) !== undefined)
                previous = undefined;
        }
        const record = this.sessions.get(key);
        try {
            this.modelResolver.setSessionId(key, mintSessionId(), { durable: true, previous });
        }
        catch {
            throw new SessionSwitchConflict('无法保存新 Session，原会话保持不变，请稍后重试。');
        }
        if (!record)
            return;
        this.sessions.delete(key);
        this.cancelPendingInteractions(key);
        this.releasePrompt(record.agent);
        record.agent.cancel({ kind: 'user' });
        await record.handle.dispose().catch(() => { });
        this.logger.info(`session removed: key=${key}`);
    }
    /** Agent 工作目录：显式配置优先，缺省独立目录 ~/.dsh-qqbot/workspace（不随宿主进程 cwd） */
    workspaceDir() {
        const dir = resolveAgentCwd(this.config.cwd);
        mkdirSync(dir, { recursive: true });
        return dir;
    }
    /**
     * 原地压缩当前会话历史（保留 sessionId，用摘要替换旧历史）。
     *
     * compaction 是 preset 作用域服务，经 host adapter 从会话 preset 解析，
     * 全局注册的部署再兜底。这是「压缩上下文」的语义，区别于 remove() 的「换新会话」。
     */
    async compact(scope, peerId, revive) {
        const key = this.sessionKey(scope, peerId);
        let record = this.sessions.get(key);
        if (!record) {
            // 无活跃会话（重启/闲置回收）时从磁盘拉起，历史在磁盘上仍可压缩
            if (!revive)
                return { ok: false, reason: 'no-session' };
            record = await this.getOrCreate(scope, peerId, revive.senderId, revive.replyTarget);
        }
        if (record.agent.status !== 'idle')
            return { ok: false, reason: 'busy' };
        const compaction = (await this.host.serviceFor(record.agent, 'compaction')
            ?? this.host.globalService('compaction'));
        if (!compaction)
            return { ok: false, reason: 'unavailable' };
        const route = this.modelResolver.getEffectiveRoute(key);
        const agentCtx = {
            session: record.agent.session,
            options: { provider: route?.provider, model: route?.model },
            runMaintenance: record.agent.runMaintenance.bind(record.agent),
        };
        try {
            const result = await compaction.compactNow(agentCtx, new AbortController().signal);
            if (result === null)
                return { ok: true, shadowed: 0, tokens: 0 };
            return { ok: true, shadowed: result.shadowedSeqs.length, tokens: result.shadowedTokenCount };
        }
        catch (err) {
            const code = err?.code;
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
    deactivate() {
        if (!this.active)
            return;
        this.active = false;
        for (const key of this.sessions.keys())
            this.cancelPendingInteractions(key);
    }
    cancelPendingInteractions(key) {
        this.questionChannel?.cancelPending(key);
        this.approvalChannel?.cancelPending(key);
    }
    assertActive() {
        if (!this.active)
            throw new SessionSwitchConflict('QQ 网关已停用，请稍后重试。');
    }
    async disposeAll() {
        this.deactivate();
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
    get size() {
        return this.sessions.size;
    }
}
/** 错误文案（日志用） */
function errorText(err) {
    return err instanceof Error ? err.message : String(err);
}
/** 从消息对象中提取纯文本（用于导出/统计） */
function extractMessageText(message) {
    const blocks = message?.content;
    if (!blocks || !Array.isArray(blocks))
        return '';
    const parts = [];
    for (const block of blocks) {
        if (block.type === 'text' && block.text) {
            parts.push(block.text);
        }
    }
    return parts.join('\n').trim();
}
//# sourceMappingURL=session-manager.js.map