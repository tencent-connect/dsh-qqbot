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

function fixture(actor = 'controller', origin: CommandDeps['origin'] = 'qq') {
  const root = mkdtempSync(join(tmpdir(), 'qq-command-menu-')); roots.push(root);
  const ctx = { on: () => () => {}, get: (name: string) => name === 'permissionPresets' ? { catalog: () => ({ options: [{ value: 'read-only' }, { value: 'workspace-write' }] }) } : undefined } as unknown as Context;
  const config = ConfigSchema({ appId: 'menus', appSecret: 'dummy', cwd: root });
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
  service.store.updatePolicy(entry.key, entry.policy.version, { ...entry.policy, controllers: ['controller'], allowedModels: ['p/allowed'], allowedPresets: ['allowed-preset'], allowedPermissions: ['read-only'] });
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
  it.each(['controller', 'owner'])('shows %s only executable model and preset choices', async actor => {
    const f = fixture(actor);
    await f.run('model'); const model = f.sendMarkdown.mock.calls[0]?.[1];
    expect(model).toContain('text="/model p/allowed"'); expect(model).toContain('actual/current');
    expect(model).not.toContain('p/forbidden'); expect(model).not.toContain('text="/model reset"');
    expect(model).toContain('不能恢复');
    f.sendMarkdown.mockClear(); await f.run('preset'); const preset = f.sendMarkdown.mock.calls[0]?.[1];
    expect(preset).toContain('text="/preset allowed-preset"'); expect(preset).not.toContain('forbidden-preset');
    expect(preset).toContain('不携带旧上下文');
  });

  it.each(['model', 'preset'])('lets a member view %s as plain read-only values without mutation buttons', async name => {
    const f = fixture('member'); await f.run(name); const text = f.sendMarkdown.mock.calls[0]?.[1];
    expect(text).toContain('只读'); expect(text).toContain('以上仅供查看'); expect(text).not.toContain('<qqbot-cmd-input');
    expect(text).not.toContain('forbidden');
    const reply = await f.run(name, name === 'model' ? 'p/allowed' : 'allowed-preset');
    expect(reply).toContain('无权限'); expect(f.manager.setModelOverride).not.toHaveBeenCalled(); expect(f.manager.setPresetOverride).not.toHaveBeenCalled();
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

  it('lists only the inherited default when the conversation has no explicit selection list', async () => {
    const f = fixture(); const entry = f.service.requireEntry(f.entry.key);
    f.service.store.updatePolicy(entry.key, entry.policy.version, { ...entry.policy, allowedModels: [], allowedPresets: [] });
    await f.run('model'); const model = f.sendMarkdown.mock.calls[0]?.[1];
    expect(model).toContain('text="/model p/default"'); expect(model).toContain('text="/model reset"'); expect(model).not.toContain('p/allowed');
    f.sendMarkdown.mockClear(); await f.run('preset'); const preset = f.sendMarkdown.mock.calls[0]?.[1];
    expect(preset).toContain('text="/preset standard"'); expect(preset).not.toContain('allowed-preset');
  });

  it('permission query distinguishes member read-only mode choices from authorization editing', async () => {
    const f = fixture('member'); const text = await f.run('permission');
    expect(text).toContain('本对话可用模式（只读）：read-only'); expect(text).not.toContain('workspace-write');
    expect(text).toContain('仅所有者或此对话控制者可切换');
  });
});
