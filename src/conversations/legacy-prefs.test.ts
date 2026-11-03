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

  it.each(['empty', 'conversation', 'owners', 'explicit-empty-owners'] as const)('does not add legacy owners to an existing %s catalog', scenario => {
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

});
