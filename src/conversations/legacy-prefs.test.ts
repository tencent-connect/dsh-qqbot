import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { ConversationStore, type StoreOptions } from './index.ts';
import * as files from './files.ts';
import { PrefsStore } from '../model/prefs-store.ts';
import { defaultQQAgentSettings } from '../shared/agent-settings.ts';
import type { ConversationEntry } from '../shared/conversation-protocol.ts';

let root = '';
const now = 1_800_000_000_000;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'qq-legacy-prefs-')); });
afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); });
const key = (scope: 'group' | 'c2c', peer: string, app = 'app'): string => `qqbot:${app}:${scope}:${peer}`;
const prefsPath = (): string => join(root, 'model-prefs.json');
const catalogPath = (app = 'app'): string => join(root, `conversations-${createHash('sha256').update(app).digest('hex')}.json`);
const requirementPath = (app = 'app'): string => join(root, `legacy-prefs-required-${createHash('sha256').update(app).digest('hex')}.json`);
const store = (options: StoreOptions = {}, app = 'app'): ConversationStore => new ConversationStore(root, app, { now: () => now, ...options });
function prefs(): PrefsStore { return new PrefsStore(undefined, { path: prefsPath() }); }

describe('legacy QQ preferences migration', () => {
  it('imports the real PrefsStore file including model-only and preset-only peers without inventing Sessions', () => {
    const legacy = prefs();
    legacy.setSessionId(key('group', 'full'), 'fork-session');
    const route = { provider: 'legacy-provider', model: 'legacy-model', reasoningEffort: ReasoningEffortId('high') };
    legacy.setOverride(key('group', 'full'), route);
    legacy.setPreset(key('group', 'full'), 'old-agent');
    legacy.setOverride(key('c2c', 'model-only'), route);
    legacy.setPreset(key('group', 'preset-only'), 'old-preset');
    const bytes = readFileSync(prefsPath());
    const projected = { ...defaultQQAgentSettings(), preset: 'configured-agent', promptGroup: 'original group prompt', promptDirect: 'original direct prompt', cwd: '/tmp/qq-work' };
    const target = store({ projectSettings: () => projected });
    const write = vi.spyOn(files, 'atomicWrite');
    expect(target.migratePrefs()).toBe(3);
    expect(write.mock.calls.filter(([path]) => path === catalogPath())).toHaveLength(1);
    expect(target.get(key('group', 'full'))).toMatchObject({
      currentSessionId: 'fork-session', legacySessionAssociation: { state: 'pending', sessionId: 'fork-session' },
      settings: { ...projected, model: route, preset: 'old-agent' },
      sessions: [{ sessionId: 'fork-session' }],
      recording: { enabled: false, since: null, retentionDays: 0 },
      lifecycle: { rotateDays: 0, maxMessages: 0, retentionDays: null },
    });
    for (const peer of [key('c2c', 'model-only'), key('group', 'preset-only')]) {
      expect(target.get(peer)).toMatchObject({ currentSessionId: null, sessions: [] });
      expect(target.get(peer)?.legacySessionAssociation).toBeUndefined();
    }
    expect(target.get(key('c2c', 'model-only'))?.settings?.model).toEqual(route);
    expect(target.get(key('group', 'preset-only'))?.settings?.preset).toBe('old-preset');
    expect(target.ownerIds()).toEqual([]);
    expect(readFileSync(prefsPath())).toEqual(bytes);
    expect(store().get(key('group', 'full'))?.legacySessionAssociation).toEqual({ state: 'pending', sessionId: 'fork-session' });
    expect(target.ensure('c2c', 'new').recording?.enabled).toBe(true);
    expect(target.ensure('c2c', 'new').lifecycle).toEqual({ rotateDays: 7, maxMessages: 1000, retentionDays: null });
  });

  it('separates accounts and scopes when reading all three key maps', () => {
    const legacy = prefs();
    legacy.setPreset(key('group', 'g'), 'first');
    legacy.setOverride(key('c2c', 'p', 'application'), { provider: 'other', model: 'route' });
    legacy.setSessionId(key('group', 'g', 'other'), 'other-session');
    legacy.setSessionId('qqbot:app:channel:wrong-scope', 'not-a-conversation');
    legacy.setSessionId('qqbot:app:group:', 'missing-peer');
    legacy.setSessionId('qqbot:app:group:\0bad', 'bad-peer');
    const first = store();
    expect(first.migratePrefs()).toBe(1);
    expect(first.list().map(entry => entry.key)).toEqual([key('group', 'g')]);
    const other = store({}, 'other');
    expect(other.migratePrefs()).toBe(1);
    expect(other.list().map(entry => entry.key)).toEqual([key('group', 'g', 'other')]);
    const application = store({}, 'application');
    expect(application.migratePrefs()).toBe(1);
    expect(application.list().map(entry => entry.key)).toEqual([key('c2c', 'p', 'application')]);
  });

  it('keeps post-upgrade edits and the replacement Session across repeated imports and restarts', () => {
    const legacy = prefs(); legacy.setSessionId(key('group', 'g'), 'legacy-session'); legacy.setPreset(key('group', 'g'), 'legacy-agent');
    const target = store(); target.migratePrefs();
    const original = target.get(key('group', 'g'));
    if (!original?.settings) throw new Error('Migrated settings missing');
    target.updateSettings(original.key, original.policy.version, { ...original.settings, preset: 'edited-agent', promptGroup: 'user edit' }, 'edited alias', false);
    const saved = target.bindSession(original.key, 'new-session');
    expect(saved.legacySessionAssociation).toBeUndefined();
    expect(target.migratePrefs()).toBe(0);
    const reopened = store(); expect(reopened.migratePrefs()).toBe(0);
    expect(reopened.get(original.key)).toMatchObject(saved);
  });

  it('marks an older already-imported catalog complete without overwriting any newer entry choices', () => {
    const target = store();
    const original = target.ensure('group', 'g');
    const updated = target.updateSettings(original.key, original.policy.version, { ...defaultQQAgentSettings(), preset: 'user-agent', promptGroup: 'user prompt' }, 'user alias', false);
    const saved = target.bindSession(updated.key, 'newer-session');
    const legacy = prefs(); legacy.setSessionId(original.key, 'old-session'); legacy.setPreset(original.key, 'old-agent');
    expect(target.migratePrefs()).toBe(0);
    expect(target.get(original.key)).toEqual(saved);
    expect(JSON.parse(readFileSync(catalogPath(), 'utf8')).legacyPrefsMigration).toEqual({ version: 1, completedAt: now });
    expect(store().get(original.key)).toMatchObject(saved);
  });

  it('marks a previously imported matching mapping pending without changing its settings or recording choices', () => {
    const target = store(); const original = target.ensure('group', 'g');
    const saved = target.bindSession(original.key, 'old-session');
    prefs().setSessionId(original.key, 'old-session');
    expect(target.migratePrefs()).toBe(0);
    expect(target.get(original.key)).toEqual({ ...saved, legacySessionAssociation: { state: 'pending', sessionId: 'old-session' } });
  });

  it('projects all entries before writing so a projection failure can be retried completely', () => {
    const legacy = prefs(); legacy.setSessionId(key('group', 'a'), 'a-session'); legacy.setPreset(key('c2c', 'b'), 'b-agent');
    let fail = true;
    const project = vi.fn((entry: ConversationEntry) => {
      if (fail && entry.peerId === 'b') throw new Error('projection failed');
      return defaultQQAgentSettings();
    });
    const target = store({ projectSettings: project });
    const bytes = readFileSync(prefsPath());
    expect(() => target.migratePrefs()).toThrow('projection failed');
    expect(target.list()).toEqual([]); expect(existsSync(catalogPath())).toBe(false);
    expect(target.legacyMigrationBlocked()).toBe(true);
    expect(() => target.ensure('group', 'a')).toThrow('旧偏好迁移未确认');
    expect(readFileSync(prefsPath())).toEqual(bytes);
    rmSync(prefsPath());
    const restarted = store(); expect(restarted.legacyMigrationBlocked()).toBe(true);
    expect(() => restarted.ensure('group', 'a')).toThrow('旧偏好迁移未确认');
    writeFileSync(prefsPath(), bytes);
    fail = false;
    expect(target.migratePrefs()).toBe(2);
    expect(store().list()).toHaveLength(2);
  });

  it('leaves no partial defaults or marker when the atomic write fails and retries in one transaction', () => {
    const legacy = prefs(); legacy.setSessionId(key('group', 'a'), 'a-session'); legacy.setPreset(key('c2c', 'b'), 'b-agent');
    const target = store(); const bytes = readFileSync(prefsPath());
    const atomicWrite = files.atomicWrite;
    let fail = true;
    const write = vi.spyOn(files, 'atomicWrite').mockImplementation((path, chunks) => {
      if (path === catalogPath() && fail) { fail = false; throw new Error('disk full'); }
      return atomicWrite(path, chunks);
    });
    expect(() => target.migratePrefs()).toThrow('disk full');
    expect(target.list()).toEqual([]); expect(existsSync(catalogPath())).toBe(false);
    expect(target.legacyMigrationBlocked()).toBe(true);
    expect(() => target.ensure('group', 'a')).toThrow('旧偏好迁移未确认');
    expect(target.errors().join(' ')).toContain('disk full');
    rmSync(prefsPath());
    const restarted = store(); expect(restarted.legacyMigrationBlocked()).toBe(true);
    expect(restarted.migratePrefs()).toBe(0);
    expect(() => restarted.ensure('group', 'a')).toThrow('旧偏好迁移未确认');
    writeFileSync(prefsPath(), bytes);
    expect(target.migratePrefs()).toBe(2);
    expect(write.mock.calls.filter(([path]) => path === catalogPath())).toHaveLength(2); expect(target.errors()).toEqual([]);
    expect(store().migratePrefs()).toBe(0); expect(readFileSync(prefsPath())).toEqual(bytes);
  });

  it.each(['{broken', 'null', '{"sessionIds":[]}'])('keeps corrupt legacy bytes and blocks mutations without a completed catalog: %s', broken => {
    writeFileSync(prefsPath(), broken);
    const target = store();
    expect(target.migratePrefs()).toBe(0);
    expect(target.legacyMigrationBlocked()).toBe(true);
    expect(target.errors().join(' ')).toContain('旧偏好读取失败');
    expect(() => target.ensure('group', 'g')).toThrow('旧偏好迁移未确认');
    expect(() => target.updateDefaults(1, defaultQQAgentSettings())).toThrow('旧偏好迁移未确认');
    expect(existsSync(catalogPath())).toBe(false);
    expect(readFileSync(prefsPath(), 'utf8')).toBe(broken);
  });

  it('keeps an unmarked valid catalog read-only when the legacy source is corrupt', () => {
    const target = store(); const saved = target.ensure('group', 'g');
    writeFileSync(prefsPath(), '{broken'); const bytes = readFileSync(catalogPath());
    expect(target.migratePrefs()).toBe(0); expect(target.legacyMigrationBlocked()).toBe(true);
    expect(target.ensure('group', 'g', { name: 'ignored while blocked' })).toEqual(saved);
    expect(() => target.bindSession(saved.key, 'new')).toThrow('旧偏好迁移未确认');
    expect(readFileSync(catalogPath())).toEqual(bytes);
    expect(readFileSync(prefsPath(), 'utf8')).toBe('{broken');
    const reopened = store(); expect(reopened.migratePrefs()).toBe(0); expect(reopened.legacyMigrationBlocked()).toBe(true);
  });

  it('resumes a blocked migration after the legacy source is repaired without discarding its mappings', () => {
    writeFileSync(prefsPath(), '{broken'); const target = store(); target.migratePrefs();
    writeFileSync(prefsPath(), JSON.stringify({ sessionIds: { [key('group', 'g')]: 'retained-session' } }));
    expect(target.migratePrefs()).toBe(1); expect(target.legacyMigrationBlocked()).toBe(false); expect(target.errors()).toEqual([]);
    expect(target.get(key('group', 'g'))?.currentSessionId).toBe('retained-session');
    expect(target.ensure('c2c', 'new').currentSessionId).toBeNull();
  });

  it('does not depend on a later corrupt legacy source after a durable completion marker', () => {
    prefs().setSessionId(key('group', 'g'), 'legacy-session');
    const target = store(); target.migratePrefs();
    const saved = target.get(key('group', 'g'));
    writeFileSync(prefsPath(), '{broken');
    const reopened = store();
    expect(reopened.migratePrefs()).toBe(0); expect(reopened.legacyMigrationBlocked()).toBe(false); expect(reopened.errors()).toEqual([]);
    expect(reopened.get(key('group', 'g'))).toMatchObject(saved);
    expect(reopened.ensure('c2c', 'new').currentSessionId).toBeNull();
    expect(readFileSync(prefsPath(), 'utf8')).toBe('{broken');
  });

  it('rejects conflicting legacy Session ownership before committing any entry', () => {
    const target = store();
    expect(() => target.migratePrefs({ sessionIds: { [key('group', 'a')]: 'same-session', [key('c2c', 'b')]: 'same-session' } })).toThrow('more than one conversation');
    expect(target.list()).toEqual([]); expect(existsSync(catalogPath())).toBe(false);
  });

  it('preserves the legacy allowlist authority during the first real account migration in the same atomic write', () => {
    const legacy = prefs(); legacy.setSessionId(key('group', 'g'), 'legacy-session');
    const bytes = readFileSync(prefsPath());
    const target = store({ legacyOwnerIds: () => [' legacy-owner ', 'legacy-owner', 'second-owner'] });
    const write = vi.spyOn(files, 'atomicWrite');
    expect(target.migratePrefs()).toBe(1);
    expect(write.mock.calls.filter(([path]) => path === catalogPath())).toHaveLength(1);
    expect(target.ownerIds()).toEqual(['legacy-owner', 'second-owner']);
    expect(readFileSync(prefsPath())).toEqual(bytes);
    const saved = store(); expect(saved.ownerIds()).toEqual(['legacy-owner', 'second-owner']);
    saved.revokeOwner('legacy-owner'); saved.revokeOwner('second-owner');
    const reopened = store({ legacyOwnerIds: () => ['legacy-owner', 'second-owner'] });
    expect(reopened.migratePrefs()).toBe(0); expect(reopened.ownerIds()).toEqual([]);
  });

  it.each(['empty', 'conversation', 'owners', 'explicit-empty-owners', 'defaults'] as const)('does not add legacy owners to an existing %s catalog', scenario => {
    const initial = store({ legacyOwnerIds: () => ['legacy-owner'] });
    if (scenario === 'conversation') initial.ensure('group', 'new-peer');
    else if (scenario === 'owners') initial.setOwnerIds(['new-owner']);
    else if (scenario === 'defaults') initial.updateDefaults(1, defaultQQAgentSettings());
    else initial.setOwnerIds([]);
    const target = scenario === 'explicit-empty-owners' ? initial : store({ legacyOwnerIds: () => ['legacy-owner'] });
    const legacy = prefs(); legacy.setSessionId(key('group', 'g'), 'legacy-session');
    expect(target.migratePrefs()).toBe(1);
    expect(target.ownerIds()).toEqual(scenario === 'owners' ? ['new-owner'] : []);
  });

  it('does not promote an allowlist for a new installation without legacy preferences', () => {
    const owners = vi.fn(() => ['allowlisted-person']); const target = store({ legacyOwnerIds: owners });
    expect(target.migratePrefs()).toBe(0);
    expect(target.ensure('c2c', 'new-person').currentSessionId).toBeNull();
    expect(target.ownerIds()).toEqual([]); expect(owners).not.toHaveBeenCalled();
  });

  it('does not promote an allowlist from unrelated accounts or invalid legacy targets', () => {
    const legacy = prefs(); legacy.setSessionId(key('group', 'g', 'other'), 'other-session');
    legacy.setPreset('qqbot:app:channel:wrong-scope', 'agent');
    const owners = vi.fn(() => ['allowlisted-person']); const target = store({ legacyOwnerIds: owners });
    expect(target.migratePrefs()).toBe(0); expect(target.ownerIds()).toEqual([]); expect(owners).not.toHaveBeenCalled();
  });

  it('does not treat explicit input as evidence of an old installation for owner migration', () => {
    const owners = vi.fn(() => ['allowlisted-person']); const target = store({ legacyOwnerIds: owners });
    expect(target.migratePrefs({ sessionIds: { [key('group', 'g')]: 'session' } })).toBe(1);
    expect(target.ownerIds()).toEqual([]); expect(owners).not.toHaveBeenCalled();
  });

  it('validates migrated owner identities before committing any entry or completion marker', () => {
    prefs().setSessionId(key('group', 'g'), 'legacy-session');
    const target = store({ legacyOwnerIds: () => Array.from({ length: 101 }, (_, index) => `owner-${index}`) });
    expect(() => target.migratePrefs()).toThrow('Too many QQ owner identities');
    expect(target.list()).toEqual([]); expect(target.ownerIds()).toEqual([]); expect(existsSync(catalogPath())).toBe(false);
  });

  it('remembers a corrupt legacy source across its deletion and restart, then resumes after repair', () => {
    writeFileSync(prefsPath(), '{broken');
    const target = store(); expect(target.migratePrefs()).toBe(0);
    expect(JSON.parse(readFileSync(requirementPath(), 'utf8'))).toEqual({ version: 1, required: true, accountHash: createHash('sha256').update('app').digest('hex') });
    rmSync(prefsPath());
    const reopened = store(); expect(reopened.legacyMigrationBlocked()).toBe(true);
    expect(reopened.migratePrefs()).toBe(0);
    expect(() => reopened.ensure('group', 'g')).toThrow('旧偏好迁移未确认');
    expect(existsSync(catalogPath())).toBe(false);
    writeFileSync(prefsPath(), JSON.stringify({ sessionIds: { [key('group', 'g')]: 'original-session' } }));
    expect(reopened.migratePrefs()).toBe(1); expect(reopened.legacyMigrationBlocked()).toBe(false);
    expect(reopened.get(key('group', 'g'))?.currentSessionId).toBe('original-session');
  });

  it('keeps migration requirements account-local and leaves installations with no old source usable', () => {
    writeFileSync(prefsPath(), '{broken'); store().migratePrefs(); rmSync(prefsPath());
    const unrelated = store({}, 'other');
    expect(unrelated.legacyMigrationBlocked()).toBe(false); expect(unrelated.migratePrefs()).toBe(0);
    expect(unrelated.ensure('group', 'new').currentSessionId).toBeNull();
    expect(existsSync(requirementPath('other'))).toBe(false);
  });

  it.each(['{broken', JSON.stringify({ version: 1, required: true, accountHash: 'wrong-account' })])('blocks an invalid requirement without following paths from its contents: %s', contents => {
    writeFileSync(requirementPath(), contents);
    const target = store(); expect(target.legacyMigrationBlocked()).toBe(true); expect(target.errors().join(' ')).toContain('迁移标记无效');
    expect(() => target.ensure('group', 'new')).toThrow('旧偏好迁移未确认');
    expect(readFileSync(requirementPath(), 'utf8')).toBe(contents);
  });

  it('gives a completed catalog priority over a leftover or corrupt requirement when the source is absent', () => {
    prefs().setSessionId(key('group', 'g'), 'original-session'); const target = store(); target.migratePrefs();
    expect(existsSync(requirementPath())).toBe(true);
    rmSync(prefsPath()); writeFileSync(requirementPath(), '{broken');
    const reopened = store(); expect(reopened.legacyMigrationBlocked()).toBe(false); expect(reopened.migratePrefs()).toBe(0); expect(reopened.errors()).toEqual([]);
    expect(reopened.get(key('group', 'g'))?.currentSessionId).toBe('original-session');
    expect(reopened.ensure('c2c', 'new').currentSessionId).toBeNull();
  });

  it('stops before reading legacy contents if it cannot durably record the migration requirement', () => {
    prefs().setSessionId(key('group', 'g'), 'original-session'); const target = store(); const bytes = readFileSync(prefsPath());
    vi.spyOn(files, 'atomicWrite').mockImplementationOnce(() => { throw new Error('requirement write failed'); });
    expect(() => target.migratePrefs()).toThrow('requirement write failed');
    expect(target.legacyMigrationBlocked()).toBe(true); expect(target.list()).toEqual([]); expect(existsSync(catalogPath())).toBe(false);
    expect(readFileSync(prefsPath())).toEqual(bytes); expect(target.errors().join(' ')).toContain('迁移标记写入失败');
    expect(target.migratePrefs()).toBe(1);
  });

  it('defers startup catalog migrations while blocked and completes them only after restoring the legacy source', () => {
    const initial = store(); const entry = initial.ensure('group', 'g'); initial.bindSession(entry.key, 'original-session');
    const catalog = JSON.parse(readFileSync(catalogPath(), 'utf8'));
    delete catalog.entries[0].settings; delete catalog.entries[0].recording;
    const bytes = JSON.stringify(catalog); writeFileSync(catalogPath(), bytes);
    writeFileSync(requirementPath(), JSON.stringify({ version: 1, required: true, accountHash: createHash('sha256').update('app').digest('hex') }));
    const project = vi.fn(() => defaultQQAgentSettings());
    const reopened = store({ projectSettings: project });
    expect(reopened.legacyMigrationBlocked()).toBe(true); expect(project).not.toHaveBeenCalled();
    expect(readFileSync(catalogPath(), 'utf8')).toBe(bytes);
    writeFileSync(prefsPath(), JSON.stringify({ sessionIds: { [entry.key]: 'original-session' } }));
    expect(reopened.migratePrefs()).toBe(0); expect(reopened.legacyMigrationBlocked()).toBe(false);
    expect(project).toHaveBeenCalled(); expect(reopened.get(entry.key)?.recording).toBeDefined();
    expect(reopened.get(entry.key)?.currentSessionId).toBe('original-session');
  });
});
