import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema } from '../config.ts';
import { ConversationStore } from '../conversations/index.ts';
import { ConversationService } from './conversation-service.ts';
import { PairingService } from './pairing-service.ts';
import { readProfileAccess, updateProfileConfig } from '../setup/persist.ts';
import { whitelistEntries } from '../client/whitelist-export.ts';

const profile = vi.hoisted(() => ({ dir: undefined as string | undefined }));
vi.mock('../shared/index.ts', async original => ({ ...await original<object>(), getProfileDir: () => profile.dir }));
afterEach(() => { if (profile.dir) rmSync(profile.dir, { recursive: true, force: true }); profile.dir = undefined; });

function fixture() {
  profile.dir ??= mkdtempSync(join(tmpdir(), 'qq-membership-'));
  const config = ConfigSchema({ appId: 'fixture', appSecret: 'fixture' });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const store = new ConversationStore(join(profile.dir, 'data'), config.appId);
  const service = Object.assign(Object.create(ConversationService.prototype) as ConversationService,
    { config, logger, store, pairing: new PairingService({ stateFile: join(profile.dir, 'pairing.json') }) });
  return { service, store };
}

describe('membership persistence and pairing scope', () => {
  it.each(['owner', 'allow-c2c', 'allow-group'] as const)('adds two identities with one %s code across a service reload', purpose => {
    const first = fixture().service; const code = first.issuePairCode(purpose).code;
    const scope = purpose === 'allow-group' ? 'group' : 'c2c';
    first.renameMember('one', '一号群'); first.renameMember('two', '二号群');
    expect(first.beginClaimFromMessage(scope, 'one', code, 'sender-one', '小明').ok).toBe(true);
    const reloaded = fixture().service;
    expect(reloaded.beginClaimFromMessage(scope, 'two', code, 'sender-two', 'Alice').ok).toBe(true);
    expect(reloaded.pairStatus().challenges[0]?.claims).toMatchObject([
      { openid: purpose === 'allow-group' ? 'one' : 'sender-one', nickname: purpose === 'allow-group' ? '一号群' : '小明', state: 'added' },
      { openid: purpose === 'allow-group' ? 'two' : 'sender-two', nickname: purpose === 'allow-group' ? '二号群' : 'Alice', state: 'added' },
    ]);
    expect(reloaded.beginClaimFromMessage(scope, 'one', code, 'sender-one', '小明').message).toContain('已在白名单');
    expect(reloaded.pairStatus().challenges[0]?.claims).toHaveLength(2);
    reloaded.endPairCode(code, purpose);
    expect(first.isActivePairCode(code)).toBe(false);
  });
  it.each(['owner', 'allow-c2c', 'allow-group'] as const)('does not re-add a revoked %s identity with the same code', purpose => {
    const { service } = fixture(); const code = service.issuePairCode(purpose).code;
    const scope = purpose === 'allow-group' ? 'group' : 'c2c';
    expect(service.beginClaimFromMessage(scope, 'peer', code, 'sender', '小明').ok).toBe(true);
    expect(service.revokePair(purpose === 'allow-group' ? 'peer' : 'sender', purpose).ok).toBe(true);
    const reloaded = fixture().service;
    expect(reloaded.beginClaimFromMessage(scope, 'peer', code, 'sender', '小明')).toMatchObject({ ok: false });
    expect(reloaded.pairStatus().challenges[0]?.claims[0]?.state).toBe('revoked');
  });
  it('keeps partial manual failures available and returns confirmed identities with saved nicknames', () => {
    const { service } = fixture(); service.renameMember('saved', '已保存昵称');
    const code = service.issuePairCode('allow-c2c').code;
    expect(service.addManualMember('allow-c2c', 'saved，new:小明\n:无效')).toMatchObject({
      ok: true, added: 2, results: [{ openid: 'saved', nickname: '已保存昵称' }, { openid: 'new', nickname: '小明' }], errors: [{ input: ':无效' }],
    });
    expect(service.isActivePairCode(code)).toBe(true);
  });
  it('does not report successful claims when membership persistence fails, and allows retry', () => {
    const { service } = fixture(); const code = service.issuePairCode('allow-c2c').code;
    const blocked = join(profile.dir!, 'cordis.patch.yml.imqqbot.tmp'); mkdirSync(blocked);
    expect(service.beginClaimFromMessage('c2c', 'peer', code, 'sender', '小明').ok).toBe(false);
    expect(service.pairStatus().challenges[0]?.claims).toEqual([]);
    expect(service.isActivePairCode(code)).toBe(true);
    rmSync(blocked, { recursive: true });
    expect(service.beginClaimFromMessage('c2c', 'peer', code, 'sender', '小明').ok).toBe(true);
  });
  it('rejects a legacy confirmation after its batch is closed', () => {
    const { service } = fixture(); const code = service.issuePairCode('allow-c2c').code;
    const result = service.startClaim(code, { openid: 'sender', nickname: '小明', scope: 'c2c', sceneName: '' });
    service.endPairCode(code, 'allow-c2c');
    expect(service.applyClaim(result.nonce!)).toMatchObject({ ok: false });
    expect(service.pairStatus().allowC2c).toEqual([]);
  });
  it.each(['owner', 'allow-c2c', 'allow-group'] as const)('can reimport copied %s entries with nicknames using lines or commas', purpose => {
    const { service } = fixture();
    for (const separator of ['\n', ',']) {
      expect(service.addManualMember(purpose, ['ABCD1234EFGH', 'WXYZ5678:小明', 'IJKL0000:Alice Zhang'].join(separator)))
        .toMatchObject({ ok: true, added: 3 });
      const status = service.pairStatus();
      const members = purpose === 'owner' ? status.owners : purpose === 'allow-group' ? status.allowGroup : status.allowC2c;
      expect(whitelistEntries(members)).toBe('ABCD1234EFGH\nWXYZ5678:小明\nIJKL0000:Alice Zhang');
    }
  });
  it.each([undefined, '', '   '])('reuses a saved nickname when the QQ message has no nickname (%s)', senderName => {
    const { service } = fixture();
    service.renameMember('sender', 'Saved Nickname');
    const code = service.issuePairCode('allow-c2c');
    const result = service.beginClaimFromMessage('c2c', 'sender', code.code, 'sender', senderName);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Saved Nickname');
    expect(fixture().service.pairStatus().allowC2c[0]?.nickname).toBe('Saved Nickname');
  });

  it('does not erase a saved nickname when adding the same OpenID without a new name', () => {
    const { service } = fixture();
    service.addManualMember('allow-c2c', 'sender:Saved Nickname');
    service.addManualMember('allow-c2c', 'sender');
    expect(fixture().service.pairStatus().allowC2c[0]?.nickname).toBe('Saved Nickname');
  });

  it('addresses an unnamed private sender directly without inventing a nickname', () => {
    const { service } = fixture();
    const code = service.issuePairCode('allow-c2c');
    const result = service.beginClaimFromMessage('c2c', 'sender', code.code, 'sender');
    expect(result.message).toBe('✅ 已将你加入私聊白名单。');
    expect(fixture().service.pairStatus().allowC2c[0]?.nickname).toBe('');
  });
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
    expect(service.pairing.hasActiveCode(challenge.code)).toBe(true);
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
