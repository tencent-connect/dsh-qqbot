import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema } from '../config.ts';
import { commandAccessError } from './auth.ts';
import { buildCommandList, describeCommands } from './index.ts';
import type { CommandDeps } from './types.ts';
import type { SlashCommandHandlerContext } from '@tencent-connect/qqbot-nodejs';
import { ConversationService } from '../runtime/conversation-service.ts';
import { ConversationStore } from '../conversations/index.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'qq-command-access-'));
  roots.push(root);
  const store = new ConversationStore(root, 'test-app');
  store.setOwnerIds(['member']);
  const config = ConfigSchema({ appId: 'test-app', appSecret: 'not-a-real-secret' });
  // Keep disk state isolated while using the production authorization and command wrappers.
  const service = Object.assign(Object.create(ConversationService.prototype) as ConversationService, { config, store });
  const deps = { manager: { conversations: service }, config, logger: { warn: vi.fn() } } as unknown as CommandDeps;
  const context = (senderId?: string) => ({ message: { senderId, kind: 'c2c' } }) as SlashCommandHandlerContext;
  return { store, service, config, deps, context, root };
}

describe('QQ slash-command access modes', () => {
  it('defaults to allowlist and rejects missing identities and unknown modes', () => {
    expect(commandAccessError(undefined, 'member', true)).toBeUndefined();
    expect(commandAccessError(undefined, 'outsider', false)).toContain('白名单');
    expect(commandAccessError('open', undefined, true)).toContain('身份');
    expect(commandAccessError('unexpected', 'member', true)).toBeDefined();
  });

  it.each(['c2c', 'group'] as const)('checks %s query/help/mutation handlers before execution', async kind => {
    const { deps, config, context } = fixture();
    const list = buildCommandList(deps);
    for (const mode of ['allowlist', 'disabled'] as const) {
      config.access.commandMode = mode;
      for (const command of list) {
        const ctx = context('outsider');
        ctx.message.kind = kind;
        expect(await command.handler(ctx)).toContain(mode === 'disabled' ? '关闭' : '白名单');
      }
    }
    // Even a previously allowed identity cannot bypass disabled mode.
    expect(await list[0]!.handler(context('member'))).toContain('关闭');
  });

  it('rechecks the current policy for an existing handler after mode changes and revocation', async () => {
    const { deps, config, context, store } = fixture();
    const ping = buildCommandList(deps).find(command => command.name === 'bot-ping')!;
    expect(await ping.handler(context('outsider'))).toContain('白名单');
    config.access.commandMode = 'open';
    expect(await ping.handler(context('outsider'))).toContain('pong');
    config.access.commandMode = 'allowlist';
    expect(await ping.handler(context('member'))).toContain('pong');
    store.revokeOwner('member');
    expect(await ping.handler(context('member'))).toContain('白名单');
    config.access.commandMode = 'disabled';
    expect(await ping.handler(context('member'))).toContain('关闭');
  });

  it('preserves the whitelist across mode switches and a store restart', () => {
    const { config, store, root } = fixture();
    for (const mode of ['open', 'disabled', 'allowlist'] as const) {
      config.access.commandMode = mode;
      expect(store.ownerIds()).toEqual(['member']);
    }
    expect(new ConversationStore(root, 'test-app').ownerIds()).toEqual(['member']);
  });

  it('reports the effective policy in the command catalog while retaining aliases', () => {
    const { config, deps } = fixture();
    for (const [mode, scope] of [['open', 'all'], ['allowlist', 'owner'], ['disabled', 'disabled']] as const) {
      config.access.commandMode = mode;
      const commands = describeCommands(deps);
      expect(commands.every(command => command.scope === scope)).toBe(true);
      expect(commands.find(command => command.name === 'new')?.aliases).toEqual(expect.arrayContaining(['reset', 'clear']));
      expect(commands.some(command => command.name === 'bot-me')).toBe(true);
    }
  });
  it('uses the configured whitelist kind instead of stale member display metadata', () => {
    const { config, store, service } = fixture();
    config.access.groupAllow = ['group-id'];
    config.access.c2cAllow = ['private-id'];
    store.claimOwner('group-id', { nickname: 'Test group', scene: 'c2c', sceneName: '', claimedAt: 0 });
    store.claimOwner('private-id', { nickname: 'Test user', scene: 'group', sceneName: '', claimedAt: 0 });
    Object.assign(service, { pairing: { listClaimed: () => [], listChallenges: () => [] } });
    const snapshot = service.pairStatus();
    expect(snapshot.allowGroup[0]?.scene).toBe('group');
    expect(snapshot.allowC2c[0]?.scene).toBe('c2c');
  });

});
