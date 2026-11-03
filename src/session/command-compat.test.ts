import type { Context } from '@deepseek-ai/cordis';
import { AgentModel, modelSelectionProjectionDefinition } from '@deepseek-ai/dsh-agent';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm/brand';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema } from '../config.ts';
import type { ModelRoute } from '../model/types.ts';
import type { ConversationService } from '../runtime/conversation-service.ts';
import { defaultQQAgentSettings, type QQAgentSettings } from '../shared/agent-settings.ts';
import type { Logger, ReplyTarget } from '../types.ts';
import { SessionManager } from './session-manager.ts';
import type { AgentPresetsLike, DshAgent, DshAgentHandle, DshAgentRegistry, SessionEventLike } from './types.ts';

const state = vi.hoisted(() => ({
  overrides: new Map<string, ModelRoute>(),
  presets: new Map<string, string>(),
  ids: new Map<string, string>(),
  hostDefaults: new Map<string, ModelRoute>(),
  validate: vi.fn<(route: ModelRoute, current?: ModelRoute) => Promise<ModelRoute>>(),
}));

vi.mock('../model/model-resolver.ts', () => ({
  ModelResolver: class {
    constructor(_ctx: unknown, private config: { provider?: string; model?: string }) {}
    resolveDefault() { return { provider: this.config.provider || 'host', model: this.config.model || 'default' }; }
    resolveHostDefault() { return state.hostDefaults.get('route') ?? this.resolveDefault(); }
    getEffectiveRoute(key: string) { return state.overrides.get(key) ?? this.resolveDefault(); }
    getResumeRoute(key: string) { return this.getEffectiveRoute(key); }
    getOverride(key: string) { return state.overrides.get(key); }
    setOverride(key: string, route: ModelRoute) { state.overrides.set(key, route); }
    clearOverride(key: string) { state.overrides.delete(key); }
    getPreset(key: string) { return state.presets.get(key); }
    setPreset(key: string, preset: string) { state.presets.set(key, preset); }
    clearPreset(key: string) { return state.presets.delete(key); }
    getSessionId(key: string) { return state.ids.get(key); }
    setSessionId(key: string, id: string) { state.ids.set(key, id); }
    validateRoute(route: ModelRoute, current?: ModelRoute) { return state.validate(route, current); }
  },
}));
vi.mock('node:fs', () => ({ mkdirSync: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function modelState(session: Session) {
  return session.snapshotEvents().reduce(
    (state, event) => modelSelectionProjectionDefinition.apply(state, event),
    modelSelectionProjectionDefinition.init(session.header),
  );
}

function harness(options: { query?: boolean } = {}) {
  const config = ConfigSchema({ appId: 'test-app', provider: 'web', model: 'default', preset: 'standard', sessionIdleTimeout: 0 });
  const headers = new Map<string, { agentPreset?: string }>();
  const projectedPresets = new Map<string, string | null>();
  const releaseObservation = vi.fn();
  const observeSession = vi.fn(async (id: string, _options: { projectionMode: 'all' }) => {
    if (!headers.has(id)) throw Object.assign(new Error('not found'), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' });
    return {
      projections: { values: { agentPreset: projectedPresets.get(id) } },
      [Symbol.dispose]: releaseObservation,
    };
  });
  const live = new Map<string, DshAgent>();
  const statuses = new Map<string, DshAgent['status']>();
  const routes = new Map<string, ModelRoute>();
  const events = new Map<string, SessionEventLike[]>();
  const controllers = new Map<string, AbortController>();
  const handles = new Map<string, DshAgentHandle>();
  const presets = {
    defaultId: 'standard',
    resolve: vi.fn<AgentPresetsLike['resolve']>(async (id) => ({ id: id ?? 'standard' })),
    mount: vi.fn(async () => undefined),
    presetForSession: (session: DshAgent['session']) => projectedPresets.has(session.id) ? projectedPresets.get(session.id) ?? null : headers.get(session.id)?.agentPreset ?? null,
    list: vi.fn(async () => [
      { id: 'standard' }, { id: 'minimal' }, { id: 'broken', broken: 'load failed' },
    ]),
  };
  const ctx = {
    get: (name: string) => name === 'sessionQuery' ? (options.query ? { observeSession } : undefined)
      : name === 'sessionController' ? { resolveAgent: async (id: string) => {
        const current = live.get(id);
        if (current) return { agent: current };
        if (!headers.has(id)) return { error: Object.assign(new Error('not found'), { code: 'session/not-found' }) };
        using observation = options.query ? await observeSession(id, { projectionMode: 'all' }) : undefined;
        const preset = options.query ? observation?.projections.values.agentPreset : headers.get(id)?.agentPreset;
        if (options.query && preset === undefined) throw new Error('no current agentPreset projection');
        const composed = preset == null ? undefined : await presets.resolve(preset);
        if (composed?.broken) throw new Error(composed.broken);
        const handle = await agents.resume({ resumeSessionId: id,
          ...(routes.has(id) ? { agentOptions: routes.get(id) } : {}),
          ...(composed ? { setup: async (ctx: Context) => { await presets.mount(ctx, composed.id); } } : {}) });
        return { agent: handle.agent };
      } } : name === 'agentPresets' ? presets : name === 'sessionPersistence'
      ? { stat: async (id: string) => headers.has(id) ? { header: headers.get(id) } : undefined } : undefined,
    on: vi.fn(),
  } as unknown as Context;
  function makeAgent(id: string, route?: ModelRoute): DshAgentHandle {
    if (route) routes.set(id, route);
    events.set(id, [{ type: 'turn/start', seq: 0 }, { type: 'turn/end', seq: 1 }]);
    const agent: DshAgent = {
      id, ctx,
      get status() { return statuses.get(id) ?? 'idle'; },
      model: {
        current: () => routes.get(id),
        select: vi.fn((route) => { routes.set(id, { ...route }); }),
      },
      session: { id, snapshotEvents: () => events.get(id) ?? [] },
      cancel: vi.fn(() => { statuses.set(id, 'idle'); controllers.get(id)?.abort(); }),
      followup: vi.fn(), whenIdle: async () => undefined,
      runMaintenance: async (task) => {
        if (controllers.has(id)) throw new Error('maintenance busy');
        const controller = new AbortController(); controllers.set(id, controller);
        try { return await task(controller.signal); } finally { controllers.delete(id); }
      },
    };
    const handle = { agent, dispose: vi.fn(async () => { live.delete(id); }) };
    live.set(id, agent); handles.set(id, handle);
    return handle;
  }
  const agents = {
    get: vi.fn<DshAgentRegistry['get']>((id) => live.get(id)),
    resume: vi.fn<DshAgentRegistry['resume']>(async (options) => {
      if (!headers.has(options.resumeSessionId)) throw new Error('not found');
      await options.setup?.(ctx);
      return makeAgent(options.resumeSessionId, options.agentOptions?.provider && options.agentOptions.model
        ? { provider: options.agentOptions.provider, model: options.agentOptions.model } : undefined);
    }),
    create: vi.fn<DshAgentRegistry['create']>(async (options) => {
      await options.setup?.(ctx);
      headers.set(options.sessionId, { agentPreset: options.meta?.agentPreset });
      projectedPresets.set(options.sessionId, options.meta?.agentPreset ?? null);
      return makeAgent(options.sessionId, options.agentOptions?.provider && options.agentOptions.model
        ? { provider: options.agentOptions.provider, model: options.agentOptions.model } : undefined);
    }),
  } satisfies DshAgentRegistry;
  const logger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const makeManager = () => new SessionManager(ctx, agents, config, logger);
  const manager = makeManager();
  const key = (peer = 'peer') => `qqbot:test-app:c2c:${peer}`;
  const target: ReplyTarget = { scope: 'c2c', targetId: 'peer' };
  const create = (peer = 'peer') => manager.getOrCreate('c2c', peer, peer, { ...target, targetId: peer });
  return { manager, config, agents, presets, headers, projectedPresets, observeSession, releaseObservation, live, statuses, routes, events, handles, controllers, makeAgent, makeManager, key, create, target };
}

beforeEach(() => {
  state.overrides.clear(); state.presets.clear(); state.ids.clear();
  state.hostDefaults.clear();
  state.validate.mockReset().mockImplementation(async (route) => {
    if (route.model === 'invalid') throw new Error('unknown model');
    return route;
  });
});

function conversationSettingsFixture(h: ReturnType<typeof harness>, defaults: QQAgentSettings, settings: QQAgentSettings) {
  const entry: { settings: QQAgentSettings; currentSessionId?: string } = { settings };
  const service = {
    store: { get: (key: string) => key === h.key() ? entry : undefined, defaults: () => ({ settings: defaults }) },
    assertMigrationReady: () => {}, ensure: () => entry, cwd: () => '/offline/qq-workspace',
    validateSelection: vi.fn(), assertCommandAuthority: () => {}, reset: () => {}, release: () => {},
    attach: (record: { sessionId: string }) => { entry.currentSessionId = record.sessionId; },
    recordModelSetting: (_scope: string, _peer: string, model: QQAgentSettings['model']) => { entry.settings = { ...entry.settings, model }; },
    recordPresetSetting: (_scope: string, _peer: string, preset: string) => { entry.settings = { ...entry.settings, preset }; },
  } as unknown as ConversationService;
  h.manager.conversations = service;
  return { entry, service };
}

describe('QQ command and Web default compatibility', () => {
  it('resets a live model to QQ Web defaults rather than Host defaults and restores that selection after restart', async () => {
    const h = harness({ query: true });
    const hostDefault = { provider: 'host-a', model: 'model-a' };
    const qqDefault = { provider: 'qq-b', model: 'model-b' };
    state.hostDefaults.set('route', hostDefault);
    const defaults = { ...defaultQQAgentSettings(), model: qqDefault };
    const f = conversationSettingsFixture(h, defaults, { ...defaults, model: { provider: 'peer-c', model: 'model-c' } });
    const record = await h.create();
    await h.manager.clearModelOverride('c2c', 'peer');
    expect(h.manager.getDefaultModel()).toEqual(hostDefault);
    expect(record.agent.model?.current()).toEqual(qqDefault);
    expect(f.entry.settings.model).toEqual(qqDefault);
    expect(state.overrides.has(h.key())).toBe(false);
    const sessionId = record.sessionId;
    await h.manager.disposeAll();
    const restarted = h.makeManager(); restarted.conversations = f.service;
    const restored = await restarted.getOrCreate('c2c', 'peer', 'peer', h.target);
    expect(restored.sessionId).toBe(sessionId);
    expect(restored.agent.model?.current()).toEqual(qqDefault);
    expect(restarted.getEffectiveModel('c2c', 'peer')).toEqual(qqDefault);
    expect(h.agents.create).toHaveBeenCalledOnce();
  });

  it('keeps an explicit inherited conversation model on Host defaults even when QQ Web defaults differ', () => {
    const h = harness();
    const hostDefault = { provider: 'host-a', model: 'model-a' };
    const qqDefault = { provider: 'qq-b', model: 'model-b' };
    state.hostDefaults.set('route', hostDefault);
    const defaults = { ...defaultQQAgentSettings(), model: qqDefault };
    conversationSettingsFixture(h, defaults, { ...defaults, model: null });
    expect(h.manager.getQQDefaultModel()).toEqual(qqDefault);
    expect(h.manager.getEffectiveModel('c2c', 'peer')).toEqual(hostDefault);
  });

  it('resets a live preset to QQ Web defaults and restores the fresh Session after restart', async () => {
    const h = harness({ query: true });
    const defaults = { ...defaultQQAgentSettings(), preset: 'qq-b' };
    const f = conversationSettingsFixture(h, defaults, { ...defaults, preset: 'minimal' });
    const original = await h.create();
    const result = await h.manager.clearPresetOverride('c2c', 'peer');
    expect(result).toMatchObject({ ok: true, presetId: 'qq-b' });
    const reset = h.manager.getSessionRecord('c2c', 'peer');
    expect(reset?.sessionId).not.toBe(original.sessionId);
    expect(reset?.agentPreset).toBe('qq-b');
    expect(f.entry.settings.preset).toBe('qq-b');
    expect(h.manager.getDefaultPreset()).toBe('standard');
    await h.manager.disposeAll();
    const restarted = h.makeManager(); restarted.conversations = f.service;
    const restored = await restarted.getOrCreate('c2c', 'peer', 'peer', h.target);
    expect(restored.sessionId).toBe(reset?.sessionId);
    expect(restored.agentPreset).toBe('qq-b');
    expect(restarted.getEffectivePreset('c2c', 'peer')).toBe('qq-b');
  });
  it('starts a fresh Session for presets and selects its model without losing the old history', async () => {
    const h = harness(); const record = await h.create(); const oldId = record.sessionId;
    await h.manager.setPresetOverride('c2c', 'peer', 'minimal');
    await h.manager.setModelOverride('c2c', 'peer', { provider: 'peer-provider', model: 'selected' });
    const current = h.manager.getSessionRecord('c2c', 'peer');
    expect(current?.sessionId).not.toBe(oldId);
    expect(current?.agentPreset).toBe('minimal');
    expect(record.agentPreset).toBe('standard');
    expect(h.manager.getStatus('c2c', 'peer')).toMatchObject({ provider: 'peer-provider', model: 'selected', preset: 'minimal', nextPreset: 'minimal' });
    expect(h.handles.get(oldId)?.dispose).toHaveBeenCalledOnce();
    expect(h.agents.create).toHaveBeenCalledTimes(2);
    await h.manager.remove('c2c', 'peer');
    const fresh = await h.create();
    expect(fresh.agentPreset).toBe('minimal');
    expect(h.manager.getStatus('c2c', 'peer').model).toBe('selected');
  });

  it('keeps a Web preset change for the next Session while changing models', async () => {
    const h = harness(); const record = await h.create();
    h.config.preset = 'minimal';
    await h.manager.setModelOverride('c2c', 'peer', { provider: 'web', model: 'other' });
    expect(record.agentPreset).toBe('standard');
    expect(h.manager.getStatus('c2c', 'peer').nextPreset).toBe('minimal');
  });

  it('records a native selection over the last request model and restores it without generating', async () => {
    const h = harness(); const record = await h.create(); const sourceId = record.sessionId;
    const source = Session.create(SessionId(sourceId));
    const previous = { provider: 'web', model: 'default' };
    const selected = { provider: 'other-provider', model: 'selected', reasoningEffort: ReasoningEffortId('low') };
    source.append('turn/start', { turn: 1 });
    source.append('request/header', { header: { config: previous }, reason: 'initial' });
    source.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
    const prefix = source.snapshotEvents();
    const model = new AgentModel(() => modelState(source), source, selected);
    record.agent = { ...record.agent, model, session: source };
    h.live.set(sourceId, record.agent);
    expect(model.current()).toEqual(previous);

    await h.manager.setModelOverride('c2c', 'peer', selected);

    expect(record.sessionId).toBe(sourceId);
    expect(record.agent.model?.current()).toEqual(selected);
    expect(h.manager.getStatus('c2c', 'peer')).toMatchObject({ provider: selected.provider, model: selected.model });
    expect(source.snapshotEvents().slice(0, prefix.length)).toEqual(prefix);
    expect(source.snapshotEvents().at(-1)).toMatchObject({ type: 'model/selection', data: selected });
    expect(source.snapshotEvents().filter((event) => event.type === 'request/header')).toHaveLength(1);
    const restored = Session.create(SessionId('restored-selection'), source.snapshotEvents());
    const restoredModel = new AgentModel(() => modelState(restored), restored, {});
    expect(restoredModel.current()).toEqual(selected);
    expect(modelSelectionProjectionDefinition.wire.view(modelState(restored))).toEqual({ lastUsed: previous, next: selected });
    expect(h.handles.get(sourceId)?.dispose).not.toHaveBeenCalled();
    expect(h.agents.create).toHaveBeenCalledOnce();
  });

  it.each(['switch', 'reset'])('writes a cold %s to the stored Session and restores that selection after another restart', async (operation) => {
    const h = harness({ query: true });
    const id = 'session-cold-selection';
    const lastUsed = { provider: 'old', model: 'last-used' };
    const previous = { provider: 'old', model: 'pending', reasoningEffort: ReasoningEffortId('high') };
    const requested = { provider: 'new', model: 'selected', reasoningEffort: ReasoningEffortId('low') };
    const expected = operation === 'reset' ? { provider: 'web', model: 'default' } : requested;
    const source = Session.create(SessionId(id));
    source.append('turn/start', { turn: 1 });
    source.append('request/header', { header: { config: lastUsed }, reason: 'initial' });
    source.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
    source.append('model/selection', previous);
    const prefix = source.snapshotEvents();
    let stored = prefix;
    let latestSession = source;
    state.ids.set(h.key(), id);
    state.overrides.set(h.key(), previous);
    state.presets.set(h.key(), 'minimal');
    h.headers.set(id, { agentPreset: 'standard' });
    h.projectedPresets.set(id, 'standard');
    h.agents.resume.mockImplementation(async (options) => {
      const session = Session.create(SessionId(options.resumeSessionId), stored);
      latestSession = session;
      const base = h.makeAgent(options.resumeSessionId);
      await options.setup?.(base.agent.ctx);
      const model = new AgentModel(() => modelState(session), session, options.agentOptions ?? {});
      const agent = { ...base.agent, model, session };
      const handle = {
        agent,
        dispose: vi.fn(async () => { stored = session.snapshotEvents(); h.live.delete(id); }),
      };
      h.live.set(id, agent); h.handles.set(id, handle);
      return handle;
    });
    expect(h.manager.size).toBe(0);

    if (operation === 'reset') await h.manager.clearModelOverride('c2c', 'peer');
    else await h.manager.setModelOverride('c2c', 'peer', requested);

    const record = h.manager.getSessionRecord('c2c', 'peer');
    expect(record?.sessionId).toBe(id);
    expect(record?.agentPreset).toBe('standard');
    expect(record?.agent.model?.current()).toEqual(expected);
    expect(record?.agent.session.snapshotEvents().slice(0, prefix.length)).toEqual(prefix);
    expect(record?.agent.session.snapshotEvents().at(-1)).toMatchObject({ type: 'model/selection', data: expected });
    expect(h.agents.create).not.toHaveBeenCalled();
    expect(state.ids.get(h.key())).toBe(id);
    expect(state.presets.get(h.key())).toBe('minimal');
    expect(state.overrides.get(h.key())).toEqual(operation === 'reset' ? undefined : requested);
    await h.manager.disposeAll();
    const restarted = h.makeManager();
    const resumed = await restarted.getOrCreate('c2c', 'peer', 'peer', h.target);
    expect(resumed.sessionId).toBe(id);
    expect(resumed.agentPreset).toBe('standard');
    expect(resumed.agent.model?.current()).toEqual(expected);
    expect(modelSelectionProjectionDefinition.wire.view(modelState(latestSession))).toEqual({ lastUsed, next: expected });
    expect(resumed.agent.session.snapshotEvents().filter((event) => event.type === 'request/header')).toHaveLength(1);
    expect(h.presets.mount.mock.calls.every((call) => call[1] === 'standard')).toBe(true);
  });

  it('does not create a Session just to restore or change preferences for a new peer', async () => {
    const h = harness({ query: true });
    expect(await h.manager.restoreExisting('c2c', 'peer')).toBeUndefined();
    await h.manager.setModelOverride('c2c', 'peer', { provider: 'new', model: 'selected' });
    expect(state.overrides.get(h.key())).toEqual({ provider: 'new', model: 'selected' });
    await h.manager.clearModelOverride('c2c', 'peer');
    expect(state.overrides.has(h.key())).toBe(false);
    expect(h.manager.size).toBe(0);
    expect(h.agents.resume).not.toHaveBeenCalled();
    expect(h.agents.create).not.toHaveBeenCalled();
    expect(h.presets.mount).not.toHaveBeenCalled();
  });

  it('does not replace a known stored Session when a cold model reset cannot resume it', async () => {
    const h = harness({ query: true });
    const previous = { provider: 'old', model: 'selected' };
    state.ids.set(h.key(), 'session-unavailable');
    state.overrides.set(h.key(), previous);
    h.headers.set('session-unavailable', { agentPreset: 'standard' });
    h.projectedPresets.set('session-unavailable', 'standard');
    h.agents.resume.mockRejectedValueOnce(new Error('resume failed'));
    await expect(h.manager.clearModelOverride('c2c', 'peer')).rejects.toThrow('resume failed');
    expect(h.agents.create).not.toHaveBeenCalled();
    expect(state.ids.get(h.key())).toBe('session-unavailable');
    expect(state.overrides.get(h.key())).toEqual(previous);
    expect(h.manager.size).toBe(0);
  });

  it('refreshes a temporarily revived group sender and reply target on the next real message', async () => {
    const h = harness();
    state.ids.set('qqbot:test-app:group:group-peer', 'session-group');
    h.headers.set('session-group', { agentPreset: 'standard' });
    const restored = await h.manager.restoreExisting('group', 'group-peer');
    expect(restored?.senderId).toBe('group-peer');
    const record = await h.manager.getOrCreate('group', 'group-peer', 'actual-owner', { scope: 'group', targetId: 'group-peer', msgId: 'latest-message' });
    expect(record.senderId).toBe('actual-owner');
    expect(record.replyTarget.msgId).toBe('latest-message');
  });

  it.each(['unavailable', 'append-failed'])('keeps the old Session and preferences when model selection is %s', async (failure) => {
    const h = harness(); const record = await h.create(); const sourceId = record.sessionId;
    const sourceAgent = record.agent;
    Object.assign(record.agent, {
      model: {
        current: () => ({ provider: 'web', model: 'default' }),
        ...(failure === 'append-failed' ? { select: () => { throw new Error('append failed'); } } : {}),
      },
    });
    await expect(h.manager.setModelOverride('c2c', 'peer', { provider: 'web', model: 'other' })).rejects.toThrow(
      failure === 'append-failed' ? 'append failed' : '不支持记录会话模型选择',
    );
    expect(h.handles.get(sourceId)?.dispose).not.toHaveBeenCalled();
    expect(record.agent).toBe(sourceAgent);
    expect(record.sessionId).toBe(sourceId);
    expect(state.ids.get(h.key())).toBe(sourceId);
    expect(state.overrides.size).toBe(0);
    expect(h.agents.create).toHaveBeenCalledOnce();
  });

  it('resets to the latest Web model without changing the Session or another peer override', async () => {
    const h = harness(); const record = await h.create();
    await h.manager.setModelOverride('c2c', 'peer', { provider: 'selected', model: 'custom' });
    await h.manager.setModelOverride('c2c', 'other-peer', { provider: 'another', model: 'custom' });
    h.config.provider = 'updated-web'; h.config.model = 'updated-default';
    await h.manager.clearModelOverride('c2c', 'peer');
    expect(state.overrides.has(h.key())).toBe(false);
    expect(state.ids.get(h.key())).toBe(record.sessionId);
    expect(h.manager.getStatus('c2c', 'peer')).toMatchObject({ provider: 'updated-web', model: 'updated-default', preset: 'standard' });
    expect(h.manager.getEffectiveModel('c2c', 'other-peer')).toEqual({ provider: 'another', model: 'custom' });
  });

  it('keeps the old Session and preferences on an invalid route', async () => {
    const h = harness(); const record = await h.create();
    const before = { id: record.sessionId, agent: record.agent, handle: record.handle };
    await expect(h.manager.setModelOverride('c2c', 'peer', { provider: 'web', model: 'invalid' })).rejects.toThrow();
    expect(record.sessionId).toBe(before.id);
    expect(record.agent).toBe(before.agent);
    expect(record.handle).toBe(before.handle);
    expect(h.handles.get(before.id)?.dispose).not.toHaveBeenCalled();
    expect(h.manager.getEffectiveModel('c2c', 'peer')).toEqual({ provider: 'web', model: 'default' });
    expect(state.ids.get(h.key())).toBe(before.id);
  });

  it('does not clear a working override when native reset selection fails', async () => {
    const h = harness(); const record = await h.create();
    await h.manager.setModelOverride('c2c', 'peer', { provider: 'custom', model: 'selected' });
    Object.assign(record.agent.model!, { select: () => { throw new Error('cannot select'); } });
    await expect(h.manager.clearModelOverride('c2c', 'peer')).rejects.toThrow('cannot select');
    expect(h.manager.getEffectiveModel('c2c', 'peer')).toEqual({ provider: 'custom', model: 'selected' });
  });

  it('keeps the same Session when selecting its current model or resetting an identical default', async () => {
    const h = harness(); const record = await h.create(); const id = record.sessionId;
    h.events.set(id, []);
    await h.manager.setModelOverride('c2c', 'peer', { provider: 'web', model: 'default' });
    expect(state.overrides.has(h.key())).toBe(true);
    await h.manager.clearModelOverride('c2c', 'peer');
    expect(state.overrides.has(h.key())).toBe(false);
    expect(record.sessionId).toBe(id);
    expect(record.agent.model?.select).not.toHaveBeenCalled();
    expect(h.agents.create).toHaveBeenCalledOnce();
    expect(h.handles.get(id)?.dispose).not.toHaveBeenCalled();
  });

  it('rejects a running Session before validation or preference changes', async () => {
    const h = harness(); const record = await h.create(); h.statuses.set(record.agent.id, 'running');
    await expect(h.manager.setModelOverride('c2c', 'peer', { provider: 'web', model: 'other' })).rejects.toThrow('/stop');
    expect(state.validate).not.toHaveBeenCalled();
    expect(state.overrides.size).toBe(0);
  });

  it('rejects concurrent peer operations until the admitted switch settles', async () => {
    const h = harness(); await h.create();
    const validation = deferred<void>(); const entered = deferred<void>();
    state.validate.mockImplementationOnce(async (route) => { entered.resolve(); await validation.promise; return route; });
    const switching = h.manager.setModelOverride('c2c', 'peer', { provider: 'web', model: 'first' });
    await entered.promise;
    await expect(h.manager.setModelOverride('c2c', 'peer', { provider: 'web', model: 'second' })).rejects.toThrow('正在更新');
    await expect(h.create()).rejects.toThrow('正在更新');
    await expect(h.manager.remove('c2c', 'peer')).rejects.toThrow('正在更新');
    validation.resolve(); await switching;
    expect(h.manager.getStatus('c2c', 'peer').model).toBe('first');
    await h.manager.clearModelOverride('c2c', 'peer');
    expect(h.manager.getStatus('c2c', 'peer').model).toBe('default');
  });

  it('recovers current preset and route from a reused live Session instead of Web defaults', async () => {
    const h = harness(); h.config.preset = 'minimal';
    const live = h.makeAgent('session-existing', { provider: 'active-provider', model: 'active-model' });
    state.ids.set(h.key(), live.agent.id); h.headers.set(live.agent.id, { agentPreset: 'standard' });
    const record = await h.create();
    expect(record.agentPreset).toBe('standard');
    expect(h.presets.mount).not.toHaveBeenCalled();
    expect(h.manager.getStatus('c2c', 'peer')).toMatchObject({ provider: 'active-provider', model: 'active-model', preset: 'standard', nextPreset: 'minimal' });
  });

  it('selects a preset for a persisted bare Session by creating a new identity', async () => {
    const h = harness(); state.ids.set(h.key(), 'session-legacy'); h.headers.set('session-legacy', {});
    const record = await h.create();
    await h.manager.setPresetOverride('c2c', 'peer', 'minimal');
    await h.manager.setModelOverride('c2c', 'peer', { provider: 'web', model: 'other' });
    expect(record.agentPreset).toBeUndefined();
    const current = h.manager.getSessionRecord('c2c', 'peer');
    expect(current?.agentPreset).toBe('minimal');
    expect(current?.sessionId).not.toBe(record.sessionId);
    expect(h.presets.mount).toHaveBeenCalledWith(expect.anything(), 'minimal');
    expect(h.agents.create).toHaveBeenCalledOnce();
  });

  it('cold-resumes the selected preset projection and keeps it while changing models', async () => {
    const h = harness({ query: true });
    state.ids.set(h.key(), 'session-selected');
    h.headers.set('session-selected', { agentPreset: 'standard' });
    h.projectedPresets.set('session-selected', 'minimal');
    const record = await h.create();
    expect(record.agentPreset).toBe('minimal');
    expect(h.presets.mount).toHaveBeenLastCalledWith(expect.anything(), 'minimal');
    expect(h.observeSession).toHaveBeenCalledExactlyOnceWith('session-selected', { projectionMode: 'all' });
    expect(h.releaseObservation).toHaveBeenCalledOnce();
    expect(h.manager.getStatus('c2c', 'peer')).toMatchObject({ preset: 'minimal', nextPreset: 'standard' });
    await h.manager.setModelOverride('c2c', 'peer', { provider: 'web', model: 'other' });
    expect(record.agentPreset).toBe('minimal');
    expect(h.agents.create).not.toHaveBeenCalled();
  });

  it('preserves an explicitly bare projection despite a header and Web default preset', async () => {
    const h = harness({ query: true });
    state.ids.set(h.key(), 'session-bare');
    h.headers.set('session-bare', { agentPreset: 'standard' });
    h.projectedPresets.set('session-bare', null);
    const record = await h.create();
    await h.manager.setModelOverride('c2c', 'peer', { provider: 'web', model: 'other' });
    expect(record.agentPreset).toBeUndefined();
    expect(h.presets.resolve).not.toHaveBeenCalled();
    expect(h.presets.mount).not.toHaveBeenCalled();
    expect(h.releaseObservation).toHaveBeenCalledOnce();
  });

  it('rejects a removed projected preset instead of mounting the header or Web default', async () => {
    const h = harness({ query: true });
    state.ids.set(h.key(), 'session-removed');
    h.headers.set('session-removed', { agentPreset: 'standard' });
    h.projectedPresets.set('session-removed', 'removed');
    h.presets.resolve.mockRejectedValueOnce(new Error('Unknown agent preset: removed'));
    await expect(h.create()).rejects.toThrow('Unknown agent preset: removed');
    expect(h.presets.resolve).toHaveBeenCalledExactlyOnceWith('removed');
    expect(h.agents.resume).not.toHaveBeenCalled();
    expect(h.agents.create).not.toHaveBeenCalled();
    expect(h.releaseObservation).toHaveBeenCalledOnce();
    expect(state.ids.get(h.key())).toBe('session-removed');
  });

  it.each(['missing-projection', 'query-failure'])('does not treat %s as an absent stored Session', async (failure) => {
    const h = harness({ query: true });
    state.ids.set(h.key(), 'session-unreadable');
    h.headers.set('session-unreadable', { agentPreset: 'standard' });
    if (failure === 'query-failure') {
      h.observeSession.mockRejectedValueOnce(Object.assign(new Error('storage failed'), { code: 'SESSION_QUERY_PERSISTENCE_FAILED' }));
    }
    await expect(h.create()).rejects.toThrow(failure === 'query-failure' ? 'storage failed' : 'no current agentPreset projection');
    expect(h.presets.resolve).not.toHaveBeenCalled();
    expect(h.agents.resume).not.toHaveBeenCalled();
    expect(h.agents.create).not.toHaveBeenCalled();
    expect(h.releaseObservation).toHaveBeenCalledTimes(failure === 'query-failure' ? 0 : 1);
    expect(state.ids.get(h.key())).toBe('session-unreadable');
  });

  it('uses the new-session default after a query confirms the candidate does not exist', async () => {
    const h = harness({ query: true });
    const record = await h.create();
    expect(record.agentPreset).toBe('standard');
    expect(h.presets.mount).toHaveBeenLastCalledWith(expect.anything(), 'standard');
    expect(h.agents.create).toHaveBeenCalledOnce();
    expect(h.releaseObservation).not.toHaveBeenCalled();
  });

  it('preserves an explicit bare preset reported by a reused live Session', async () => {
    const h = harness();
    const live = h.makeAgent('session-live-bare');
    state.ids.set(h.key(), live.agent.id);
    h.headers.set(live.agent.id, { agentPreset: 'standard' });
    Object.assign(h.presets, { presetForSession: () => null });
    const record = await h.create();
    await h.manager.setModelOverride('c2c', 'peer', { provider: 'web', model: 'other' });
    expect(record.agentPreset).toBeUndefined();
    expect(h.presets.resolve).not.toHaveBeenCalled();
    expect(h.agents.create).not.toHaveBeenCalled();
  });

  it('does not select or save preferences if maintenance is cancelled before admission', async () => {
    const h = harness(); const record = await h.create(); const oldId = record.sessionId;
    const admitted = deferred<void>(); const entered = deferred<void>();
    const controller = new AbortController();
    record.agent.runMaintenance = async (task) => {
      entered.resolve(); await admitted.promise;
      return task(controller.signal);
    };
    const switching = h.manager.setModelOverride('c2c', 'peer', { provider: 'web', model: 'next' });
    await entered.promise; controller.abort(); admitted.resolve();
    await expect(switching).rejects.toThrow();
    expect(record.agent.model?.select).not.toHaveBeenCalled();
    expect(h.handles.get(oldId)?.dispose).not.toHaveBeenCalled();
    expect(record.sessionId).toBe(oldId); expect(state.overrides.size).toBe(0);
  });

  it('changes a blank Session model without requiring a completed turn', async () => {
    const h = harness(); const record = await h.create(); const id = record.sessionId;
    h.events.set(id, []);
    await h.manager.setModelOverride('c2c', 'peer', { provider: 'web', model: 'other' });
    expect(h.manager.getStatus('c2c', 'peer').model).toBe('other');
    expect(record.sessionId).toBe(id);
    expect(h.agents.create).toHaveBeenCalledOnce();
  });

  it('selects and persists the normalized route including same-model reasoning effort changes', async () => {
    const h = harness(); const record = await h.create();
    const selected = { provider: 'web', model: 'default', reasoningEffort: ReasoningEffortId('high') };
    state.validate.mockResolvedValueOnce(selected);
    await h.manager.setModelOverride('c2c', 'peer', { provider: 'web', model: 'default' });
    expect(record.agent.model?.select).toHaveBeenCalledExactlyOnceWith(selected);
    expect(state.overrides.get(h.key())).toEqual(selected);
    expect(record.agent.model?.current()).toEqual(selected);
  });

  it('filters unavailable presets and stores defaults without creating a new peer Session', async () => {
    const h = harness();
    expect(await h.manager.setPresetOverride('c2c', 'peer', 'minimal')).toEqual({ ok: true, presetId: 'minimal' });
    expect(h.manager.getEffectivePreset('c2c', 'peer')).toBe('minimal');
    expect(await h.manager.clearPresetOverride('c2c', 'peer')).toEqual({ ok: true, presetId: 'standard' });
    expect(h.manager.getEffectivePreset('c2c', 'peer')).toBe('standard');
    expect((await h.manager.listPresets()).map(p => p.id)).toEqual(['standard', 'minimal']);
    expect(h.agents.create).not.toHaveBeenCalled(); expect(h.agents.resume).not.toHaveBeenCalled();
  });

  it('restores with the public native controller and creates a fresh Session for a preset', async () => {
    const h = harness({ query: true }); const id = 'persisted-preset-session';
    state.ids.set(h.key(), id); h.headers.set(id, { agentPreset: 'standard' }); h.projectedPresets.set(id, 'standard');
    const outcome = await h.manager.setPresetOverride('c2c', 'peer', 'minimal');
    const record = h.manager.getSessionRecord('c2c', 'peer');
    expect(outcome).toEqual({ ok: true, presetId: 'minimal', sessionId: record?.sessionId });
    expect(record?.sessionId).not.toBe(id); expect(record?.agentPreset).toBe('minimal');
    expect(h.headers.get(id)?.agentPreset).toBe('standard');
    expect(h.agents.create).toHaveBeenCalledOnce();
    expect(state.presets.get(h.key())).toBe('minimal');
    expect(record?.agent.followup).not.toHaveBeenCalled();
  });

  it('preserves the current Session and preferences on invalid, broken, or failed composition', async () => {
    const h = harness(); const record = await h.create(); const sourceId = record.sessionId;
    h.presets.resolve.mockRejectedValueOnce(new Error('unknown preset'));
    expect(await h.manager.setPresetOverride('c2c', 'peer', 'missing')).toMatchObject({ ok: false, reason: 'unknown-preset' });
    h.presets.resolve.mockResolvedValueOnce({ id: 'broken', broken: 'load failed' });
    expect(await h.manager.setPresetOverride('c2c', 'peer', 'broken')).toMatchObject({ ok: false, reason: 'broken' });
    h.agents.create.mockRejectedValueOnce(new Error('composition failed'));
    expect(await h.manager.setPresetOverride('c2c', 'peer', 'minimal')).toMatchObject({ ok: false, reason: 'failed' });
    expect(h.manager.getSessionRecord('c2c', 'peer')).toBe(record);
    expect(state.ids.get(h.key())).toBe(sourceId); expect(state.presets.size).toBe(0);
    expect(h.handles.get(sourceId)?.dispose).not.toHaveBeenCalled();
  });

  it('refuses a running or queued Session before creating its replacement', async () => {
    const h = harness(); const record = await h.create();
    h.statuses.set(record.sessionId, 'running');
    await expect(h.manager.setPresetOverride('c2c', 'peer', 'minimal')).rejects.toThrow('/stop');
    h.statuses.set(record.sessionId, 'idle');
    Object.assign(record.agent, { inbox: { nextTurn: [{}], nextStep: [] } });
    expect(await h.manager.setPresetOverride('c2c', 'peer', 'minimal')).toMatchObject({ ok: false, reason: 'failed' });
    expect(h.agents.create).toHaveBeenCalledOnce(); expect(state.presets.size).toBe(0);
  });

  it('clears an override only after a new Session adopts the actual configured or Host fallback', async () => {
    const h = harness(); const original = await h.create();
    await h.manager.setPresetOverride('c2c', 'peer', 'minimal');
    const reset = await h.manager.clearPresetOverride('c2c', 'peer');
    expect(reset).toMatchObject({ ok: true, presetId: 'standard' });
    expect(h.manager.getSessionRecord('c2c', 'peer')?.agentPreset).toBe('standard');
    expect(h.manager.getSessionRecord('c2c', 'peer')?.sessionId).not.toBe(original.sessionId);
    expect(state.presets.has(h.key())).toBe(false);
    await h.manager.setPresetOverride('c2c', 'peer', 'minimal');
    h.config.preset = ''; h.presets.defaultId = 'host-default';
    h.presets.resolve.mockImplementation(async id => ({ id: id ?? h.presets.defaultId }));
    expect(await h.manager.clearPresetOverride('c2c', 'peer')).toMatchObject({ ok: true, presetId: 'host-default' });
    expect(h.manager.getSessionRecord('c2c', 'peer')?.agentPreset).toBe('host-default');
  });

  it('retains the override and current Session when its fallback cannot be created', async () => {
    const h = harness(); await h.create(); await h.manager.setPresetOverride('c2c', 'peer', 'minimal');
    const record = h.manager.getSessionRecord('c2c', 'peer');
    h.agents.create.mockRejectedValueOnce(new Error('fallback unavailable'));
    expect(await h.manager.clearPresetOverride('c2c', 'peer')).toMatchObject({ ok: false, reason: 'failed' });
    expect(state.presets.get(h.key())).toBe('minimal'); expect(h.manager.getSessionRecord('c2c', 'peer')).toBe(record);
  });

  it('commits preferences after creation and excludes concurrent peer updates', async () => {
    const h = harness(); const record = await h.create();
    const entered = deferred<void>(); const gate = deferred<void>();
    const originalCreate = h.agents.create.getMockImplementation()!;
    h.agents.create.mockImplementationOnce(async options => { entered.resolve(); await gate.promise; return originalCreate(options); });
    const changing = h.manager.setPresetOverride('c2c', 'peer', 'minimal'); await entered.promise;
    expect(state.presets.size).toBe(0); expect(h.manager.getSessionRecord('c2c', 'peer')).toBe(record);
    await expect(h.manager.clearPresetOverride('c2c', 'peer')).rejects.toThrow('正在更新');
    await expect(h.manager.setModelOverride('c2c', 'peer', { provider: 'web', model: 'other' })).rejects.toThrow('正在更新');
    gate.resolve(); expect(await changing).toMatchObject({ ok: true, presetId: 'minimal' });
    expect(state.presets.get(h.key())).toBe('minimal');
  });

  it('rejects native work enqueued while a replacement is being composed and preserves the old mapping', async () => {
    const h = harness(); const record = await h.create();
    const originalCreate = h.agents.create.getMockImplementation()!;
    h.agents.create.mockImplementationOnce(async options => {
      const handle = await originalCreate(options);
      Object.assign(record.agent, { inbox: { nextTurn: [{}], nextStep: [] } });
      return handle;
    });
    expect(await h.manager.setPresetOverride('c2c', 'peer', 'minimal')).toMatchObject({ ok: false, reason: 'failed' });
    expect(h.manager.getSessionRecord('c2c', 'peer')).toBe(record); expect(state.presets.size).toBe(0);
    expect(h.handles.get(record.sessionId)?.dispose).not.toHaveBeenCalled();
  });

  it('forgets a replaced Agent instance and reuses the registry winner with the same Session', async () => {
    const h = harness(); const record = await h.create(); const winner = h.makeAgent(record.sessionId);
    expect(h.manager.getSessionRecord('c2c', 'peer')).toBeUndefined();
    const restored = await h.create();
    expect(restored.agent).toBe(winner.agent); expect(restored.sessionId).toBe(record.sessionId);
    expect(record.agent.followup).not.toHaveBeenCalled();
    expect(h.handles.get(record.sessionId)?.agent).toBe(winner.agent);
  });
  it('preserves the current native Session directory when a preset starts a fresh Session', async () => {
    const h = harness(); const record = await h.create();
    Object.assign(record.agent.session, { header: { cwd: '/native/current-workspace' } });
    await h.manager.setPresetOverride('c2c', 'peer', 'minimal');
    expect(h.agents.create.mock.calls.at(-1)?.[0].meta?.cwd).toBe('/native/current-workspace');
    expect(h.manager.getSessionRecord('c2c', 'peer')?.sessionId).not.toBe(record.sessionId);
  });

});
