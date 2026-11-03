import type { Context } from '@deepseek-ai/cordis';
import type { SlashCommandHandlerContext } from '@tencent-connect/qqbot-nodejs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema } from '../config.ts';
import { ConversationService } from '../runtime/conversation-service.ts';
import type { SessionManager } from '../session/session-manager.ts';
import { buildCommandList } from './index.ts';
import type { CommandDeps } from './types.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(actor = 'owner', origin: CommandDeps['origin'] = 'qq') {
  const root = mkdtempSync(join(tmpdir(), 'qq-command-menu-')); roots.push(root);
  const ctx = { on: () => () => {}, get: (name: string) => name === 'permissionPresets' ? { catalog: () => ({ options: [{ value: 'read-only' }, { value: 'workspace-write' }] }) } : undefined } as unknown as Context;
  const config = ConfigSchema({ appId: 'menus', appSecret: 'dummy', cwd: root, access: { c2cMode: 'open', groupMode: 'open' } });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const manager = {
    getDefaultModel: () => ({ provider: 'p', model: 'default' }), getDefaultPreset: () => 'standard', getEffectivePreset: () => 'standard',
    getEffectiveModel: () => ({ provider: 'p', model: 'default' }), getSessionRecord: () => undefined,
    getStatus: () => ({ active: true, provider: 'actual', model: 'current' }),
    restoreExisting: vi.fn(async () => undefined),
    listAvailableModels: async () => [{ provider: 'p', id: 'allowed', name: 'Allowed model' }, { provider: 'p', id: 'forbidden', name: 'Forbidden model' }, { provider: 'p', id: 'default' }],
    listPresets: async () => [{ id: 'allowed-preset', name: 'Allowed preset' }, { id: 'forbidden-preset' }, { id: 'standard' }],
    setModelOverride: vi.fn(async (scope: 'group', peer: string, value: { provider: string; model: string }) => service.validateSelection(scope, peer, 'model', `${value.provider}/${value.model}`)),
    setPresetOverride: vi.fn(async (scope: 'group', peer: string, value: string) => { service.validateSelection(scope, peer, 'preset', value); return { ok: true as const, presetId: value }; }),
  };
  const service = new ConversationService(ctx, manager as unknown as SessionManager, config, logger, root);
  Object.assign(manager, { conversations: service });
  const entry = service.entry('group', 'g');
  service.store.setOwnerIds(['owner']);
  service.store.updatePolicy(entry.key, entry.policy.version, { ...entry.policy, nativeTools: false, controllers: ['controller'], allowedModels: ['p/allowed'], allowedPresets: ['allowed-preset'], allowedPermissions: ['read-only'] });
  const sendMarkdown = vi.fn(async (_target: unknown, _text: string) => {});
  const commands = buildCommandList({ manager: manager as unknown as SessionManager, config, logger, origin });
  const run = async (name: string, raw = '') => {
    const command = commands.find(item => item.name === name); if (!command) throw new Error('missing real command');
    const input = { message: { kind: 'group', senderId: actor, groupOpenid: 'g' }, command: { raw }, bot: { sendMarkdown }, replyTarget: { scope: 'group', targetId: 'g' } } as unknown as SlashCommandHandlerContext;
    return command.handler(input);
  };
  return { service, manager, run, sendMarkdown, entry };
}

describe('mobile menus use the same per-conversation authority as mutations', () => {
  it('shows the owner only executable model and preset choices', async () => {
    const f = fixture();
    await f.run('model'); const model = f.sendMarkdown.mock.calls[0]?.[1];
    expect(model).toContain('text="/model p/allowed"'); expect(model).toContain('actual/current');
    expect(model).not.toContain('p/forbidden'); expect(model).not.toContain('text="/model reset"');
    expect(model).toContain('不能恢复');
    f.sendMarkdown.mockClear(); await f.run('preset'); const preset = f.sendMarkdown.mock.calls[0]?.[1];
    expect(preset).toContain('text="/preset allowed-preset"'); expect(preset).not.toContain('forbidden-preset');
    expect(preset).toContain('不携带旧上下文');
  });

  it.each(['member', 'controller'])('blocks %s from query and mutation handlers even when bypassing SDK middleware', async actor => {
    const f = fixture(actor);
    for (const name of ['model', 'preset', 'permission', 'bot-me', 'stop', 'bot-help']) {
      expect(await f.run(name)).toBe('斜杠命令仅机器人超管可用。');
    }
    expect(f.sendMarkdown).not.toHaveBeenCalled(); expect(f.manager.restoreExisting).not.toHaveBeenCalled();
    for (const name of ['model', 'preset']) {
      const reply = await f.run(name, name === 'model' ? 'p/allowed' : 'allowed-preset');
      expect(reply).toBe('斜杠命令仅机器人超管可用。');
    }
    expect(f.manager.setModelOverride).not.toHaveBeenCalled(); expect(f.manager.setPresetOverride).not.toHaveBeenCalled();
  });

  it('keeps the service allowlist authoritative even for an owner typing an unlisted option', async () => {
    const f = fixture('owner');
    // A restricted (custom-tool) policy still enforces its per-conversation allowlist ceiling.
    f.service.store.updatePolicy(f.entry.key, f.service.entry('group', 'g').policy.version, { ...f.service.entry('group', 'g').policy, nativeTools: false });
    expect(await f.run('model', 'p/forbidden')).toContain('未授权模型');
    expect(await f.run('preset', 'forbidden-preset')).toContain('未授权预设');
  });

  it('allows an authenticated web owner menu without trusting actor identity', async () => {
    const f = fixture('web-identity', 'web-owner'); await f.run('model');
    expect(f.sendMarkdown.mock.calls[0]?.[1]).toContain('text="/model p/allowed"');
  });

  it('lists all available choices when the conversation has no explicit selection list', async () => {
    const f = fixture(); const entry = f.service.requireEntry(f.entry.key);
    f.service.store.updatePolicy(entry.key, entry.policy.version, { ...entry.policy, allowedModels: [], allowedPresets: [] });
    await f.run('model'); const model = f.sendMarkdown.mock.calls[0]?.[1];
    expect(model).toContain('text="/model p/default"'); expect(model).toContain('text="/model reset"'); expect(model).toContain('text="/model p/allowed"'); expect(model).toContain('text="/model p/forbidden"');
    f.sendMarkdown.mockClear(); await f.run('preset'); const preset = f.sendMarkdown.mock.calls[0]?.[1];
    expect(preset).toContain('text="/preset standard"'); expect(preset).toContain('text="/preset allowed-preset"'); expect(preset).toContain('text="/preset forbidden-preset"');
  });

  it('follows native Agent selections even when legacy allowlists are populated', async () => {
    const f = fixture(); const entry = f.service.requireEntry(f.entry.key);
    f.service.store.updatePolicy(entry.key, entry.policy.version, { ...entry.policy, nativeTools: true });
    await f.run('model');
    expect(f.sendMarkdown.mock.calls[0]?.[1]).toContain('text="/model p/forbidden"');
    f.sendMarkdown.mockClear(); await f.run('preset');
    expect(f.sendMarkdown.mock.calls[0]?.[1]).toContain('text="/preset forbidden-preset"');
  });

  it('permission query keeps the owner within the conversation mode ceiling', async () => {
    const f = fixture(); const text = await f.run('permission');
    expect(text).toContain('本对话可用模式：read-only'); expect(text).not.toContain('workspace-write');
    expect(text).toContain('授权范围只能由所有者在 DSH 网页修改');
  });

  it('rechecks owner identity after an async restore even when the former owner is a controller', async () => {
    const f = fixture();
    const entry = f.service.requireEntry(f.entry.key);
    f.service.store.updatePolicy(entry.key, entry.policy.version, { ...entry.policy, controllers: ['owner'] });
    f.manager.restoreExisting.mockImplementationOnce(async () => { f.service.store.setOwnerIds([]); return undefined; });
    expect(await f.run('model', 'p/allowed')).toContain('命令操作者的权限已撤销');
    expect(f.service.canManage('group', 'g', 'owner')).toBe(true);
  });

  it('does not require a QQ owner identity on an authenticated web mutation', async () => {
    const f = fixture('web-identity', 'web-owner');
    expect(await f.run('model', 'p/allowed')).toContain('当前会话模型已切换');
    expect(f.manager.setModelOverride).toHaveBeenCalledOnce();
  });

  it('rejects a direct QQ handler when the owner directory service is unavailable', async () => {
    const f = fixture(); f.service.manager.conversations = undefined;
    expect(await f.run('model')).toBe('斜杠命令仅机器人超管可用。');
    expect(f.manager.restoreExisting).not.toHaveBeenCalled(); expect(f.sendMarkdown).not.toHaveBeenCalled();
  });

  it('keeps explicit web-owner standalone query handling available without the QQ service', async () => {
    const f = fixture('web-identity', 'web-owner'); f.service.manager.conversations = undefined;
    await f.run('model');
    expect(f.sendMarkdown.mock.calls[0]?.[1]).toContain('text="/model p/allowed"');
  });
});
