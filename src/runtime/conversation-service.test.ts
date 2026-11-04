import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema } from '../config.ts';
import { ConversationStore } from '../conversations/index.ts';
import { ConversationService } from './conversation-service.ts';
import { PairingService } from './pairing-service.ts';
import { readProfileAccess, updateProfileConfig } from '../setup/persist.ts';

const profile = vi.hoisted(() => ({ dir: undefined as string | undefined }));
vi.mock('../shared/index.ts', async original => ({ ...await original<object>(), getProfileDir: () => profile.dir }));
afterEach(() => { if (profile.dir) rmSync(profile.dir, { recursive: true, force: true }); profile.dir = undefined; });

function fixture() {
  profile.dir ??= mkdtempSync(join(tmpdir(), 'qq-membership-'));
  const config = ConfigSchema({ appId: 'fixture', appSecret: 'fixture' });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const store = new ConversationStore(join(profile.dir, 'data'), config.appId);
  const service = Object.assign(Object.create(ConversationService.prototype) as ConversationService,
    { config, logger, store, pairing: new PairingService() });
  return { service, store };
}

describe('membership persistence and pairing scope', () => {
  it('retains manually added names and scenes after the service and store reopen', () => {
    const { service, store } = fixture();
    expect(service.addManualMember('allow-c2c', 'alice:Alice').ok).toBe(true);
    expect(service.addManualMember('allow-group', 'team:Project Group').ok).toBe(true);
    store.setOwnerIds(['other']);
    const reopened = fixture().service;
    expect(reopened.pairStatus().allowC2c).toEqual([expect.objectContaining({ openid: 'alice', nickname: 'Alice', scene: 'c2c' })]);
    expect(reopened.pairStatus().allowGroup).toEqual([expect.objectContaining({ openid: 'team', nickname: 'Project Group', scene: 'group' })]);
  });
  it('reads latest members across stale service instances and preserves revocation on the next add', () => {
    const first = fixture(); const stale = fixture();
    expect(first.service.addManualMember('allow-c2c', 'alice').ok).toBe(true);
    expect(stale.service.addManualMember('allow-c2c', 'bob').ok).toBe(true);
    expect(first.service.pairStatus().allowC2c.map(m => m.openid)).toEqual(['alice', 'bob']);
    expect(stale.service.revokePair('alice', 'allow-c2c').ok).toBe(true);
    expect(first.service.addManualMember('allow-group', 'team').ok).toBe(true);
    expect(first.service.pairStatus().allowC2c.map(m => m.openid)).toEqual(['bob']);
    expect(first.service.pairStatus().allowGroup.map(m => m.openid)).toEqual(['team']);
  });

  it.each([
    ['allow-group', 'c2c', 'group'], ['allow-c2c', 'group', 'c2c'],
  ] as const)('does not consume %s codes in %s, then accepts the correct scene', (purpose, wrong, correct) => {
    const { service, store } = fixture();
    const challenge = service.issuePairCode(purpose);
    expect(service.beginClaimFromMessage(wrong, 'wrong-peer', challenge.code, 'sender').ok).toBe(false);
    expect(service.pairing.hasActiveCode(challenge.code)).toBe(true);
    expect(store.list()).toEqual([]);
    expect(service.beginClaimFromMessage(correct, 'right-peer', challenge.code, 'sender').ok).toBe(true);
    expect(service.pairing.hasActiveCode(challenge.code)).toBe(false);
    const access = readProfileAccess(undefined, profile.dir);
    expect(purpose === 'allow-group' ? access.groupAllow : access.c2cAllow)
      .toEqual([purpose === 'allow-group' ? 'right-peer' : 'sender']);
  });

  it('retains existing modes and the other list when membership is changed', () => {
    const { service } = fixture();
    updateProfileConfig({ access: { c2cMode: 'disabled', c2cAllow: ['keep'], groupMode: 'open', groupAllow: [], commandMode: 'disabled' } }, profile.dir);
    expect(service.addManualMember('allow-group', 'team').ok).toBe(true);
    expect(readProfileAccess(undefined, profile.dir)).toMatchObject({ c2cMode: 'disabled', c2cAllow: ['keep'], commandMode: 'disabled' });
  });
});
