import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema } from '../config.ts';
import { MemberStore } from './member-store.ts';
import { AccountAccessService } from './account-service.ts';
import { PairingService } from './pairing-service.ts';
import { readPairingState } from './pairing-state.ts';
import { persistCredentialsToProfile, readProfileAccess, updateProfileConfig } from '../setup/persist.ts';
import { whitelistEntries } from '../client/whitelist-export.ts';
import * as files from '../shared/atomic-file.ts';

const profile = vi.hoisted(() => ({ dir: undefined as string | undefined }));
vi.mock('../shared/index.ts', async original => ({ ...await original<object>(), getProfileDir: () => profile.dir }));
afterEach(() => { vi.restoreAllMocks(); if (profile.dir) rmSync(profile.dir, { recursive: true, force: true }); profile.dir = undefined; });

function fixture() {
  profile.dir ??= mkdtempSync(join(tmpdir(), 'qq-membership-'));
  const config = ConfigSchema({ appId: 'fixture', appSecret: 'fixture' });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const store = new MemberStore(join(profile.dir, 'data'), config.appId);
  const service = new AccountAccessService(config, logger, {
    store,
    pairing: new PairingService({ stateFile: join(profile.dir, 'pairing.json') }),
  });
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
  it.each(['owner', 'allow-c2c', 'allow-group'] as const)('blocks all pre-revocation codes for a manually added %s member, but permits a new invitation', purpose => {
    const { service } = fixture();
    const first = service.issuePairCode(purpose).code;
    const second = service.issuePairCode(purpose).code;
    const scope = purpose === 'allow-group' ? 'group' : 'c2c';
    const id = purpose === 'allow-group' ? 'peer' : 'sender';
    expect(service.addManualMember(purpose, `${id}:Test`).ok).toBe(true);
    expect(service.revokePair(id, purpose).ok).toBe(true);
    const reloaded = fixture().service;
    for (const code of [first, second]) {
      expect(reloaded.beginClaimFromMessage(scope, 'peer', code, 'sender', 'Test').ok).toBe(false);
      expect(reloaded.isActivePairCode(code)).toBe(true);
    }
    expect(reloaded.beginClaimFromMessage(scope, 'another-peer', first, 'another-sender', 'Another').ok).toBe(true);
    const fresh = reloaded.issuePairCode(purpose).code;
    expect(reloaded.beginClaimFromMessage(scope, 'peer', fresh, 'sender', 'Test').ok).toBe(true);
    expect(reloaded.beginClaimFromMessage(scope, 'peer', first, 'sender', 'Test').ok).toBe(false);
  });
  it.each(['owner', 'allow-c2c', 'allow-group'] as const)('rejects another pre-existing %s code after a successful claim is revoked', purpose => {
    const { service } = fixture();
    const first = service.issuePairCode(purpose).code;
    const second = service.issuePairCode(purpose).code;
    const scope = purpose === 'allow-group' ? 'group' : 'c2c';
    const id = purpose === 'allow-group' ? 'peer' : 'sender';
    expect(service.beginClaimFromMessage(scope, 'peer', first, 'sender', 'Test').ok).toBe(true);
    expect(service.revokePair(id, purpose).ok).toBe(true);
    const reloaded = fixture().service;
    expect(reloaded.isActivePairCode(second)).toBe(true);
    expect(reloaded.pairing.claimResult(second, id)).toBeUndefined();
    expect(reloaded.beginClaimFromMessage(scope, 'peer', second, 'sender', 'Test').ok).toBe(false);
    const list = purpose === 'owner' ? 'owners' : purpose === 'allow-c2c' ? 'allowC2c' : 'allowGroup';
    expect(reloaded.pairStatus()[list]).toEqual([]);
  });
  it('replays the pairing model counterexample after restoring only the pre-revocation pairing file', () => {
    const { service } = fixture();
    const purpose = 'allow-c2c';
    const first = service.issuePairCode(purpose).code;
    expect(service.beginClaimFromMessage('c2c', 'sender', first, 'sender', 'Test').ok).toBe(true);
    const second = service.issuePairCode(purpose).code;
    const statePath = join(profile.dir!, 'pairing.json');
    const beforeRevocation = readFileSync(statePath);
    expect(service.revokePair('sender', purpose).ok).toBe(true);
    expect(readPairingState(statePath).map(batch => batch.revokedOpenids)).toEqual([['sender'], ['sender']]);
    writeFileSync(statePath, beforeRevocation);

    const reloaded = fixture().service;
    expect(reloaded.pairStatus().allowC2c).toEqual([]);
    expect(reloaded.pairing.claimResult(first, 'sender')?.state).toBe('added');
    expect(reloaded.pairing.claimResult(second, 'sender')).toBeUndefined();
    expect(reloaded.beginClaimFromMessage('c2c', 'sender', first, 'sender', 'Test').ok).toBe(false);
    expect(reloaded.beginClaimFromMessage('c2c', 'sender', second, 'sender', 'Test').ok).toBe(true);
    expect(fixture().service.pairStatus().allowC2c.map(member => member.openid)).toEqual(['sender']);
  });
  it('keeps revocation authoritative when a prior successful membership write lost its receipt', () => {
    const { service } = fixture(); const code = service.issuePairCode('allow-c2c').code;
    vi.spyOn(service.pairing, 'recordResult').mockImplementationOnce(() => { throw new Error('receipt write failed'); });
    expect(() => service.beginClaimFromMessage('c2c', 'peer', code, 'sender', 'Test')).toThrow('receipt write failed');
    expect(service.pairStatus().allowC2c.map(member => member.openid)).toContain('sender');
    expect(service.revokePair('sender', 'allow-c2c').ok).toBe(true);
    expect(fixture().service.beginClaimFromMessage('c2c', 'peer', code, 'sender', 'Test').ok).toBe(false);
  });
  it('reads current command members and preserves removal when a stale store renames or discovers another identity', () => {
    const first = fixture().service; first.addManualMember('owner', 'alice:Alice');
    const stale = fixture().service;
    expect(first.revokePair('alice', 'owner').ok).toBe(true);
    expect(stale.isOwner('alice')).toBe(false);
    stale.renameMember('bob', 'Bob');
    stale.store.setMemberProfile('bob', { nickname: 'Bob', scene: 'c2c', sceneName: '', claimedAt: 0 });
    expect(fixture().service.isOwner('alice')).toBe(false);
  });
  it.each(['rename', 'discovery'])('does not restore revoked command members during a stale %s mutation', mutation => {
    const first = fixture().service; first.addManualMember('owner', 'alice:Alice');
    const stale = fixture().service;
    first.revokePair('alice', 'owner');
    if (mutation === 'rename') stale.renameMember('bob', 'Bob');
    else stale.store.setMemberProfile('bob', { nickname: 'Bob', scene: 'c2c', sceneName: '', claimedAt: 0 });
    expect(fixture().service.isOwner('alice')).toBe(false);
  });
  it('does not report removal or change membership if the revocation fence cannot be persisted', () => {
    const { service } = fixture(); const code = service.issuePairCode('allow-c2c').code;
    service.addManualMember('allow-c2c', 'sender:Test');
    const write = files.atomicWrite;
    vi.spyOn(files, 'atomicWrite').mockImplementation((path, data) => {
      if (path === join(profile.dir!, 'pairing.json')) throw new Error('revocation write failed');
      write(path, data);
    });
    expect(() => service.revokePair('sender', 'allow-c2c')).toThrow('revocation write failed');
    expect(fixture().service.pairStatus().allowC2c.map(member => member.openid)).toContain('sender');
    expect(service.pairing.isRevoked(code, 'sender')).toBe(false);
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
  it('rejects redemption after the current batch ends without writing the whitelist', () => {
    const { service } = fixture(); const code = service.issuePairCode('allow-c2c').code;
    service.endPairCode(code, 'allow-c2c');
    expect(service.beginClaimFromMessage('c2c', 'peer', code, 'sender', '小明').ok).toBe(false);
    expect(service.pairStatus().allowC2c).toEqual([]);
  });
  it('returns earlier successes when a later manual write fails', () => {
    const { service, store } = fixture();
    const write = store.claimOwner.bind(store);
    vi.spyOn(store, 'claimOwner').mockImplementation((openid, profile) => {
      if (openid === 'blocked') throw new Error('disk full');
      write(openid, profile);
    });
    expect(service.addManualMember('owner', 'first:Alice\nblocked:Bob\nlast:Carol')).toMatchObject({
      ok: true, added: 2, results: [{ openid: 'first' }, { openid: 'last' }], errors: [{ input: 'blocked:Bob' }],
    });
    expect(fixture().store.ownerIds()).toEqual(['first', 'last']);
  });
  it('copies delimiter-containing nicknames without creating any extra authorization', () => {
    const { service } = fixture();
    const nickname = 'Alice,unexpected-id；"nickname"\nnext-line';
    expect(service.addManualMember('owner', 'person').ok).toBe(true);
    service.renameMember('person', nickname);
    const copied = whitelistEntries(service.pairStatus().owners);
    service.revokePair('person', 'owner');
    expect(service.addManualMember('owner', copied)).toMatchObject({ ok: true, added: 1 });
    expect(service.pairStatus().owners).toMatchObject([{ openid: 'person', nickname }]);
    expect(service.addManualMember('owner', 'other:"unterminated,unexpected-id')).toMatchObject({ ok: false, added: 0 });
    expect(service.store.ownerIds()).toEqual(['person']);
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
    store.claimOwner('other', { nickname: '', scene: 'c2c', sceneName: '', claimedAt: 0 });
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

  it('keeps the private-chat nickname when the same identity loses command access', () => {
    const { service } = fixture();
    service.addManualMember('allow-c2c', 'alice:Alice');
    service.addManualMember('owner', 'alice');
    service.revokePair('alice', 'owner');
    expect(service.isOwner('alice')).toBe(false);
    expect(fixture().service.pairStatus().allowC2c).toEqual([expect.objectContaining({ openid: 'alice', nickname: 'Alice' })]);
  });

  it.each([
    ['allow-group', 'c2c', 'group'], ['allow-c2c', 'group', 'c2c'],
  ] as const)('does not consume %s codes in %s, then accepts the correct scene', (purpose, wrong, correct) => {
    const { service, store } = fixture();
    const challenge = service.issuePairCode(purpose);
    expect(service.beginClaimFromMessage(wrong, 'wrong-peer', challenge.code, 'sender').ok).toBe(false);
    expect(service.pairing.hasActiveCode(challenge.code)).toBe(true);
    expect(store.memberProfiles()).toEqual({});
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
    expect(readProfileAccess(undefined, profile.dir)).toMatchObject({ c2cMode: 'disabled', c2cAllow: ['keep'], groupMode: 'open', groupAllow: ['team'], commandMode: 'disabled' });
  });
});

it('rejects an old account even when the replacement keeps the same conversation lists', () => {
  const { service } = fixture();
  expect(persistCredentialsToProfile({ appId: service.config.appId, appSecret: 'fixture' }, profile.dir!, service.logger)).toBe(true);
  expect(service.addManualMember('allow-c2c', 'peer').ok).toBe(true);
  expect(service.addManualMember('allow-group', 'team').ok).toBe(true);
  expect(service.allowsConversation('c2c', 'peer')).toBe(true);
  expect(service.allowsConversation('group', 'team')).toBe(true);
  expect(persistCredentialsToProfile({ appId: 'replacement', appSecret: 'fixture' }, profile.dir!, service.logger)).toBe(true);
  expect(readProfileAccess(undefined, profile.dir, 'replacement')).toMatchObject({ c2cAllow: ['peer'], groupAllow: ['team'] });
  expect(() => service.allowsConversation('c2c', 'peer')).toThrow();
  expect(() => service.allowsConversation('group', 'team')).toThrow();
});
