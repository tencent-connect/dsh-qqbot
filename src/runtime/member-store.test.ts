import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemberStore } from './member-store.ts';
import * as files from '../shared/atomic-file.ts';
import { PrefsStore } from '../model/prefs-store.ts';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'qq-member-store-')); });
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });
const hash = createHash('sha256').update('app').digest('hex');
const memberPath = () => join(root, `members-${hash}.json`);
const catalogPath = () => join(root, `conversations-${hash}.json`);
const profile = { nickname: 'Alice', scene: 'c2c' as const, sceneName: '私聊', claimedAt: 1 };

describe('account-only identity storage', () => {
  it('creates only the identity file, without Session, message, policy or rotation state', () => {
    const members = new MemberStore(root, 'app');
    members.claimOwner('alice', profile);
    expect(readdirSync(root)).toEqual([`members-${hash}.json`]);
    expect(JSON.parse(readFileSync(memberPath(), 'utf8'))).toEqual({ version: 1, appId: 'app', owners: ['alice'], profiles: { alice: profile } });
    if (process.platform !== 'win32') expect(statSync(memberPath()).mode & 0o777).toBe(0o600);
  });

  it('imports existing command members and names once, preserving all old files byte for byte', () => {
    const catalog = { format: 2, appId: 'app', owners: ['alice'], memberProfiles: { alice: profile }, entries: [
      { key: 'qqbot:app:group:team', scope: 'group', peerId: 'team', name: 'Team', alias: '群备注', currentSessionId: 'native-session', policy: { future: true } },
    ], operations: { untouched: true }, background: { untouched: true } };
    writeFileSync(catalogPath(), JSON.stringify(catalog));
    const log = join(root, 'conversations', 'fixture', 'messages.jsonl'); mkdirSync(join(root, 'conversations', 'fixture'), { recursive: true });
    writeFileSync(log, 'old body and even a torn log must remain untouched');
    const before = readFileSync(catalogPath());
    const members = new MemberStore(root, 'app');
    expect(members.ownerIds()).toEqual(['alice']); expect(members.memberProfiles().alice).toEqual(profile);
    expect(members.peerName('group', 'team')).toEqual({ name: 'Team', alias: '群备注' });
    members.revokeOwner('alice');
    expect(new MemberStore(root, 'app').ownerIds()).toEqual([]);
    expect(readFileSync(catalogPath())).toEqual(before);
    expect(readFileSync(log, 'utf8')).toBe('old body and even a torn log must remain untouched');
  });

  it('keeps the upstream PrefsStore as the only owner of Session, model and preset preferences', () => {
    const prefsPath = join(root, 'model-prefs.json'); const prefs = new PrefsStore(undefined, { path: prefsPath });
    prefs.setSessionId('qqbot:app:group:team', 'old-session'); prefs.setPreset('qqbot:app:c2c:alice', 'old-preset');
    prefs.setOverride('qqbot:app:group:team', { provider: 'provider', model: 'model' });
    const bytes = readFileSync(prefsPath);
    const members = new MemberStore(root, 'app', () => [' legacy ', 'legacy']);
    expect(members.ownerIds()).toEqual(['legacy']); expect(readFileSync(prefsPath)).toEqual(bytes);
    members.revokeOwner('legacy');
    expect(new MemberStore(root, 'app', () => ['legacy']).ownerIds()).toEqual([]);
    const reopened = new PrefsStore(undefined, { path: prefsPath });
    expect(reopened.getSessionId('qqbot:app:group:team')).toBe('old-session');
    expect(reopened.getPreset('qqbot:app:c2c:alice')).toBe('old-preset');
    expect(reopened.getOverride('qqbot:app:group:team')).toEqual({ provider: 'provider', model: 'model' });
    expect(existsSync(catalogPath())).toBe(false);
  });

  it.each(['none', 'another-account', 'invalid-scope'])('does not promote the conversation allowlist for %s preferences', scenario => {
    if (scenario !== 'none') writeFileSync(join(root, 'model-prefs.json'), JSON.stringify({ sessionIds: { [scenario === 'another-account' ? 'qqbot:other:group:peer' : 'qqbot:app:channel:peer']: 'session' } }));
    const legacy = vi.fn(() => ['unexpected']);
    expect(new MemberStore(root, 'app', legacy).ownerIds()).toEqual([]); expect(legacy).not.toHaveBeenCalled();
  });

  it('preserves an explicitly empty old command list instead of repopulating it', () => {
    writeFileSync(catalogPath(), JSON.stringify({ format: 2, appId: 'app', owners: [], entries: [] }));
    writeFileSync(join(root, 'model-prefs.json'), JSON.stringify({ sessionIds: { 'qqbot:app:group:team': 'old-session' } }));
    expect(new MemberStore(root, 'app', () => ['unexpected']).ownerIds()).toEqual([]);
  });

  it('reloads identity state before writes so a stale instance cannot undo revocation', () => {
    const first = new MemberStore(root, 'app'); first.claimOwner('alice', profile);
    const stale = new MemberStore(root, 'app'); first.revokeOwner('alice');
    stale.setMemberProfile('bob', { ...profile, nickname: 'Bob' });
    expect(stale.ownerIds()).toEqual([]); expect(first.memberProfiles().bob?.nickname).toBe('Bob');
  });

  it('stores imported special object keys as ordinary identities', () => {
    const members = new MemberStore(root, 'app');
    members.claimOwner('__proto__', profile);
    members.setMemberProfile('constructor', { ...profile, nickname: 'Bob' });
    expect(members.ownerIds()).toEqual(['__proto__']);
    expect(Object.hasOwn(members.memberProfiles(), '__proto__')).toBe(true);
    expect(members.memberProfiles().constructor).toEqual({ ...profile, nickname: 'Bob' });
    members.revokeOwner('__proto__'); expect(members.ownerIds()).toEqual([]);
  });

  it('leaves initialization retryable after a failed atomic write', () => {
    const write = vi.spyOn(files, 'atomicWrite').mockImplementationOnce(() => { throw new Error('disk full'); });
    expect(() => new MemberStore(root, 'app')).toThrow('disk full'); expect(existsSync(memberPath())).toBe(false);
    write.mockRestore(); expect(new MemberStore(root, 'app').ownerIds()).toEqual([]);
  });

  it.each(['bad-json', 'wrong-account', 'bad-owner'])('refuses %s identity data without overwriting it', scenario => {
    const bytes = scenario === 'bad-json' ? '{' : JSON.stringify({ format: 2, appId: scenario === 'wrong-account' ? 'other' : 'app', owners: scenario === 'bad-owner' ? [42] : [], entries: [] });
    writeFileSync(catalogPath(), bytes);
    expect(() => new MemberStore(root, 'app')).toThrow(); expect(readFileSync(catalogPath(), 'utf8')).toBe(bytes);
    expect(existsSync(memberPath())).toBe(false);
  });

  it.each(['identity catalog', 'upstream private whitelist'])('preserves 101 valid identities from the %s and after reload', source => {
    const owners = Array.from({ length: 101 }, (_, i) => 'owner-' + i);
    if (source === 'identity catalog') {
      writeFileSync(catalogPath(), JSON.stringify({ format: 2, appId: 'app', owners }));
    } else {
      new PrefsStore(undefined, { path: join(root, 'model-prefs.json') }).setSessionId('qqbot:app:c2c:owner-0', 'old-session');
    }
    const members = new MemberStore(root, 'app', () => owners);
    expect(members.ownerIds()).toEqual(owners);
    members.claimOwner('next', profile);
    members.revokeOwner('owner-0');
    expect(new MemberStore(root, 'app').ownerIds()).toEqual([...owners.slice(1), 'next']);
  });

  it('does not recreate a missing live identity file from a stale legacy list', () => {
    const members = new MemberStore(root, 'app'); rmSync(memberPath());
    expect(() => members.ownerIds()).toThrow();
    expect(() => members.claimOwner('alice', profile)).toThrow(); expect(existsSync(memberPath())).toBe(false);
  });
});
