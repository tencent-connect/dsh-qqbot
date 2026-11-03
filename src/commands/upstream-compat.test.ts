import { Context } from '@deepseek-ai/cordis';
import { QQBot, runMiddlewareChain, type Middleware } from '@tencent-connect/qqbot-nodejs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema } from '../config.ts';
import { setupMiddlewares } from '../gateway/middleware-setup.ts';
import type { QQMiddlewareContext } from '../middleware/qq-context.ts';
import { ConversationService } from '../runtime/conversation-service.ts';
import type { SessionManager } from '../session/session-manager.ts';
import type { ChatScope } from '../types.ts';
import { validateQQAgentSettings } from '../shared/agent-settings.ts';
import { buildCommandList, describeCommands } from './index.ts';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(scope: ChatScope = 'group') {
  const root = mkdtempSync(join(tmpdir(), 'qq-upstream-commands-')); roots.push(root);
  const peer = scope === 'group' ? 'group-openid' : 'user-openid';
  const owner = scope === 'group' ? 'owner' : peer;
  const config = ConfigSchema({ appId: 'upstream-commands', appSecret: 'dummy', cwd: root,
    access: { c2cMode: 'open', c2cAllow: [], groupMode: 'open', groupAllow: [] } });
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const agent = { status: 'running', cancel: vi.fn() };
  const dependencies = {
    getDefaultModel: () => ({ provider: 'offline', model: 'default' }), getDefaultPreset: () => 'standard',
    getEffectiveModel: () => ({ provider: 'offline', model: 'default' }), getEffectivePreset: () => 'standard',
    getStatus: () => ({ active: false }), getSessionRecord: vi.fn(() => undefined),
    restoreExisting: vi.fn(async (): Promise<{ agent: typeof agent } | undefined> => undefined), getOrCreate: vi.fn(),
    listAvailableModels: vi.fn(async () => [{ provider: 'offline', id: 'default' }, { provider: 'offline', id: 'other' }]),
    listPresets: vi.fn(async () => [{ id: 'standard' }, { id: 'other' }]),
    setModelOverride: vi.fn(async () => {}), clearModelOverride: vi.fn(async () => {}),
    setPresetOverride: vi.fn(async () => ({ ok: true, presetId: 'other' })),
    clearPresetOverride: vi.fn(async () => ({ ok: true })),
    remove: vi.fn(async () => {}), compact: vi.fn(async () => ({ ok: true })),
  };
  const manager = dependencies as unknown as SessionManager;
  const ctx = new Context();
  const service = new ConversationService(ctx, manager, config, logger, root);
  manager.conversations = service;
  service.store.setOwnerIds([owner]);
  const entry = service.entry(scope, peer);
  service.store.updatePolicy(entry.key, entry.policy.version, { ...entry.policy, controllers: ['controller'] });
  const bot = new QQBot({ appId: config.appId, appSecret: config.appSecret, logger });
  const sendText = vi.spyOn(bot, 'sendText').mockResolvedValue({ id: 'offline-reply', timestamp: new Date().toISOString() });
  const sendMarkdown = vi.spyOn(bot, 'sendMarkdown').mockResolvedValue({ id: 'offline-reply', timestamp: new Date().toISOString() });
  const middlewares: Middleware[] = [];
  vi.spyOn(bot, 'use').mockImplementation(middleware => { middlewares.push(middleware); return bot; });
  setupMiddlewares(bot, config, manager, logger);
  const newTurn = vi.fn();
  middlewares.push(async () => { newTurn(); });
  let sequence = 0;
  async function run(content: string, actor = owner, mentioned = true) {
    let stopped = false;
    let stopReason: string | undefined;
    const replyTarget = { scope, targetId: peer };
    const input: QQMiddlewareContext = {
      bot, log: logger, replyTarget, state: {}, receivedAt: Date.now(), signal: new AbortController().signal,
      message: { kind: scope, senderId: actor, senderName: actor, groupOpenid: scope === 'group' ? peer : undefined,
        content, messageId: `command-${++sequence}`, timestamp: new Date().toISOString(), replyTarget,
        rawEventType: scope === 'group' ? mentioned ? 'GROUP_AT_MESSAGE_CREATE' : 'GROUP_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE', mentions: [], attachments: [] },
      stop: reason => { stopped = true; stopReason = reason; },
      get stopped() { return stopped; }, get stopReason() { return stopReason; },
      abort: reason => { stopped = true; stopReason = reason; }, aborted: false,
    };
    await runMiddlewareChain(middlewares, input);
    return input;
  }
  return { config, manager, dependencies, service, run, sendText, sendMarkdown, newTurn, peer, owner, entry, logger, agent };
}

// Upstream a4a01fa's public names and aliases remain available through the SDK registry.
const upstreamCommands = ['new', 'compact', 'model', 'preset', 'stop', 'bot-ping', 'bot-version', 'bot-me', 'bot-status', 'bot-help'];

describe('upstream QQ commands through the configured SDK middleware', () => {
  it.each(['c2c', 'group'] as const)('answers /bot-me in %s without restoring or creating an Agent', async scope => {
    const f = fixture(scope);
    const input = await f.run(scope === 'group' ? '<@!bot> /BoT-Me' : '/bot-me');
    expect(input.stopReason).toBe('command:matched:bot-me');
    expect(input.state.command).toEqual({ name: 'bot-me', args: [], raw: '' });
    const content = f.sendMarkdown.mock.calls[0]?.[1];
    expect(content).toContain(`**${f.owner}**`);
    if (scope === 'group') expect(content).toContain('本群 OpenID：**group-openid**');
    else expect(content).not.toContain('本群 OpenID');
    expect(f.dependencies.restoreExisting).not.toHaveBeenCalled();
    expect(f.dependencies.getOrCreate).not.toHaveBeenCalled();
    expect(f.newTurn).not.toHaveBeenCalled();
    expect(f.service.store.messages(f.entry.key)).toMatchObject([{ provenance: 'command', contextEligible: false }]);
  });

  it('keeps the upstream command set and aliases in the metadata used by Web', async () => {
    const f = fixture();
    const deps = { manager: f.manager, config: f.config, logger: f.logger };
    const descriptors = describeCommands(deps);
    expect(descriptors.map(command => command.name)).toEqual([...upstreamCommands, 'permission']);
    expect(descriptors.find(command => command.name === 'new')?.aliases).toEqual(['reset', 'clear']);
    expect(descriptors.find(command => command.name === 'bot-me')).toMatchObject({ category: 'qqbot', scope: 'owner', description: '查看你的 OpenID' });
    for (const descriptor of descriptors) expect(descriptor.scope).toBe('owner');
    expect(f.service.snapshot().commands).toEqual(descriptors);
    await f.run('/bot-help');
    const content = f.sendMarkdown.mock.calls.map(call => call[1]).join('\n');
    expect(content).toContain('斜杠命令仅机器人超管可用。');
    for (const name of [...upstreamCommands, 'permission']) expect(content).toContain(`text="/${name}"`);
  });

  it.each(['bot-me', 'bot-ping', 'bot-version', 'bot-status', 'bot-help', 'model', 'preset', 'permission', 'stop', 'new', 'reset', 'clear', 'compact', 'model offline/other', 'preset other', 'permission read-only', 'query', 'unknown'])('rejects a non-owner /%s before SDK dispatch or Agent work', async command => {
    const f = fixture();
    const input = await f.run(`/${command}`, 'member');
    expect(input.stopReason).toBe('slash-command-owner-required');
    expect(input.state.command).toBeUndefined();
    expect(f.sendText).toHaveBeenCalledWith(expect.anything(), '斜杠命令仅机器人超管可用。');
    expect(f.sendMarkdown).not.toHaveBeenCalled();
    for (const operation of [f.dependencies.restoreExisting, f.dependencies.getOrCreate, f.dependencies.remove, f.dependencies.compact, f.dependencies.setModelOverride, f.dependencies.setPresetOverride]) expect(operation).not.toHaveBeenCalled();
    expect(f.newTurn).not.toHaveBeenCalled();
  });

  it.each(['model', 'preset', 'permission'])('lets the owner query /%s without starting an Agent turn', async name => {
    const f = fixture();
    expect((await f.run(`/${name}`)).stopReason).toBe(`command:matched:${name}`);
    const reply = [...f.sendText.mock.calls, ...f.sendMarkdown.mock.calls].map(call => call[1]).join('\n');
    expect(reply).not.toContain('仅机器人超管');
    expect(f.newTurn).not.toHaveBeenCalled();
  });

  it.each(['bot-me', 'model', 'model offline/other', 'stop', 'new'])('does not grant a group controller /%s', async command => {
    const f = fixture();
    expect(f.service.canManage('group', f.peer, 'controller')).toBe(true);
    await f.run(`/${command}`, 'controller');
    expect(f.sendText).toHaveBeenCalledWith(expect.anything(), '斜杠命令仅机器人超管可用。');
    for (const mutation of [f.dependencies.remove, f.dependencies.compact, f.dependencies.setModelOverride, f.dependencies.setPresetOverride]) expect(mutation).not.toHaveBeenCalled();
    expect(f.newTurn).not.toHaveBeenCalled();
  });

  it.each(['reset', 'clear'])('dispatches the /%s alias through SDK parsing to the management handler', async alias => {
    const f = fixture();
    const input = await f.run(`/${alias}`);
    expect(input.state.command).toEqual({ name: alias, args: [], raw: '' });
    expect(f.dependencies.remove).toHaveBeenCalledExactlyOnceWith('group', f.peer);
  });

  it('parses a model argument before applying the declared mutation authority', async () => {
    const f = fixture();
    const input = await f.run('/MODEL offline/other');
    expect(input.state.command).toEqual({ name: 'model', args: ['offline/other'], raw: 'offline/other' });
    expect(f.dependencies.setModelOverride).toHaveBeenCalledExactlyOnceWith('group', f.peer, { provider: 'offline', model: 'other' });
  });

  it('lets the owner stop while busy', async () => {
    const f = fixture();
    f.dependencies.restoreExisting.mockResolvedValueOnce({ agent: f.agent });
    vi.spyOn(f.service, 'busy').mockReturnValue(true);
    await f.run('/stop');
    expect(f.agent.cancel).toHaveBeenCalledExactlyOnceWith({ kind: 'user' }, { keepInbox: true });
    expect(f.sendText).toHaveBeenCalledWith(expect.anything(), '已中止 ⛔');
  });

  it.each(['c2c', 'group'] as const)('keeps owner /bot-me behind the existing %s access gate', async scope => {
    const f = fixture(scope);
    if (scope === 'group') f.config.access.groupMode = 'allowlist';
    else f.config.access.c2cMode = 'allowlist';
    const input = await f.run('/bot-me');
    expect(input.state.command).toBeUndefined();
    expect(f.sendMarkdown).not.toHaveBeenCalled();
    expect(f.newTurn).not.toHaveBeenCalled();
    expect(f.dependencies.getOrCreate).not.toHaveBeenCalled();
    expect(f.service.store.messages(f.entry.key)).toEqual([]);
  });

  it('rejects slash commands when the owner directory service is unavailable', async () => {
    const f = fixture(); f.manager.conversations = undefined;
    expect((await f.run('/bot-me')).stopReason).toBe('slash-command-owner-required');
    expect(f.sendText).toHaveBeenCalledWith(expect.anything(), '斜杠命令仅机器人超管可用。');
    expect(f.sendMarkdown).not.toHaveBeenCalled(); expect(f.newTurn).not.toHaveBeenCalled();
  });

  it.each(['bot-me', 'model', 'model offline/other', 'stop', 'new', 'unknown'])('does not grant a private peer /%s through self-management authority', async command => {
    const f = fixture('c2c'); f.service.store.setOwnerIds([]);
    expect(f.service.canManage('c2c', f.peer, f.peer)).toBe(true);
    await f.run(`/${command}`);
    expect(f.sendText).toHaveBeenCalledWith(expect.anything(), '斜杠命令仅机器人超管可用。');
    expect(f.dependencies.restoreExisting).not.toHaveBeenCalled();
    expect(f.newTurn).not.toHaveBeenCalled();
  });

  it.each([false, true])('ignores the removed slash switch %s and uses only owner identity', async value => {
    const f = fixture();
    const entry = f.service.requireEntry(f.entry.key);
    const settings = validateQQAgentSettings({ ...entry.settings, slashCommands: value });
    expect(settings).not.toHaveProperty('slashCommands');
    f.service.store.updateSettings(entry.key, entry.policy.version, settings, entry.alias, true);
    await f.run('/bot-me', 'member');
    expect(f.sendText).toHaveBeenCalledWith(expect.anything(), '斜杠命令仅机器人超管可用。');
    await f.run('/bot-me');
    expect(f.sendMarkdown).toHaveBeenCalledWith(expect.anything(), expect.stringContaining(`**${f.owner}**`));
    expect(f.newTurn).not.toHaveBeenCalled();
  });

  it('keeps owner commands behind the receive and group mention gates', async () => {
    const f = fixture();
    expect((await f.run('/bot-me', f.owner, false)).stopReason).toBe('mention-gate:no_mention');
    const entry = f.service.requireEntry(f.entry.key);
    f.service.store.updatePolicy(entry.key, entry.policy.version, { ...entry.policy, receiveEnabled: false });
    expect((await f.run('/bot-me')).stopReason).toBe('conversation-disabled');
    expect(f.sendText).not.toHaveBeenCalled(); expect(f.sendMarkdown).not.toHaveBeenCalled(); expect(f.newTurn).not.toHaveBeenCalled();
  });

  it('answers an unknown owner command without starting an Agent turn', async () => {
    const f = fixture();
    expect((await f.run('/unknown')).stopReason).toBe('unknown-command');
    expect(f.sendText).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('未知命令'));
    expect(f.newTurn).not.toHaveBeenCalled();
  });

  it.each(['group', 'c2c'] as const)('keeps non-owner ordinary text chatting available in %s', async scope => {
    const f = fixture(scope); f.service.store.setOwnerIds([]);
    await f.run('ordinary text');
    expect(f.newTurn).toHaveBeenCalledOnce(); expect(f.sendText).not.toHaveBeenCalled();
  });

  it('declares authority on every command without exposing it as UI metadata', () => {
    const f = fixture();
    const deps = { manager: f.manager, config: f.config, logger: f.logger };
    const commands = buildCommandList(deps);
    for (const command of commands) expect(command.authority).toBeDefined();
    for (const descriptor of describeCommands(deps)) expect(descriptor).not.toHaveProperty('authority');
  });
});
