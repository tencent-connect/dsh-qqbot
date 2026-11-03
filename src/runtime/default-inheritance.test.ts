import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { ConfigSchema } from '../config.ts';
import { SessionManager } from '../session/session-manager.ts';
import type { DshAgentRegistry } from '../session/types.ts';
import { ConversationService } from './conversation-service.ts';
import { defaultQQAgentSettings } from '../shared/agent-settings.ts';
vi.mock('../model/prefs-store.ts', () => ({ PrefsStore: class { getOverride() { return undefined; } getPreset() { return undefined; } getSessionId() { return undefined; } clearOverride() {} } }));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it('clears hidden legacy defaults for new peers while preserving existing snapshots', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qq-native-inherit-')); roots.push(root);
  const route = { provider: 'host-provider', model: 'host-model' };
  const config = ConfigSchema({ appId: 'inherit', appSecret: 'dummy', cwd: root, groupPrompt: 'old-group', directPrompt: 'old-private', provider: 'legacy-provider', model: 'legacy-model', preset: 'legacy-preset', sessionIdleTimeout: 0 });
  const services: Record<string, unknown> = { sessionController: { resolveAgent: async () => ({ error: Object.assign(new Error('missing'), { code: 'session/not-found' }) }) }, agentDefaultModel: { currentSelection: () => route }, agentPresets: { defaultId: 'host-preset' }, llm: { listProviders: () => ['host-provider', 'legacy-provider'], listModels: async (provider: string) => [{ id: provider === 'host-provider' ? 'host-model' : 'legacy-model' }] } };
  const ctx = { get: (name: string) => services[name], on: () => () => {} } as unknown as Context;
  const registry: DshAgentRegistry = { get: () => undefined, create: async () => { throw new Error('No Agent should be activated'); }, resume: async () => { throw new Error('No Agent should be activated'); } };
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const manager = new SessionManager(ctx, registry, config, logger);
  try {
    const service = new ConversationService(ctx, manager, config, logger, root); manager.conversations = service;
    const prior = service.entry('group', 'prior');
    expect(prior.settings).toMatchObject({ preset: 'legacy-preset', model: { provider: 'legacy-provider', model: 'legacy-model' } });
    const cleared = defaultQQAgentSettings();
    await service.saveDefaults(service.store.defaults().version, cleared);
    const fresh = service.entry('group', 'fresh');
    // Inherit host default stored as null; the host model resolves at use time via getEffectiveModel.
    expect(fresh.settings).toMatchObject({ promptGroup: '', preset: 'host-preset', model: null });
    expect(manager.getEffectiveModel('group', 'fresh')).toEqual(route);
    expect(service.entry('c2c', 'fresh-private').settings?.promptDirect).toBe('');
    expect(service.requireEntry(prior.key).settings).toEqual(prior.settings);
    service.store.updateSettings(fresh.key, fresh.policy.version, cleared, '', true);
    expect(manager.getEffectiveModel('group', 'fresh')).toEqual(route);
    expect(manager.getEffectivePreset('group', 'fresh')).toBe('host-preset');
    await manager.clearModelOverride('group', 'fresh');
    expect(service.requireEntry(fresh.key).settings?.model).toBeNull();
    expect(manager.getEffectiveModel('group', 'fresh')).toEqual(route);
    await service.saveDefaults(service.store.defaults().version, { ...cleared, model: { ...route, reasoningEffort: 'high' }, reasoningEffort: 'low' });
    await manager.clearModelOverride('group', 'fresh');
    expect(manager.getEffectiveModel('group', 'fresh')).toEqual({ ...route, reasoningEffort: 'high' });
    const restarted = new ConversationService(ctx, manager, config, logger, root); manager.conversations = restarted;
    expect(manager.getEffectiveModel('group', 'fresh')).toEqual({ ...route, reasoningEffort: 'high' });
    await restarted.saveDefaults(restarted.store.defaults().version, cleared);
    restarted.store.updatePolicy(prior.key, prior.policy.version, { ...prior.policy, toolMode: 'restricted', allowedModels: ['legacy-provider/legacy-model'] });
    await manager.clearModelOverride('group', 'prior');
    // Development builds have no legacy settings.yaml fallback: clearing a model override yields the host default.
    expect(manager.getEffectiveModel('group', 'prior')).toEqual(route);
  } finally { await manager.disposeAll(); }
});
