import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ConversationStore } from './index.ts';
import { defaultQQAgentSettings, QQ_EXTRA_PROMPT_MAX_CHARS } from '../shared/agent-settings.ts';

const roots: string[] = [];
function fixture() { const root = mkdtempSync(join(tmpdir(), 'qq-agent-settings-')); roots.push(root); return { root, store: new ConversationStore(root, 'account') }; }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('QQ account defaults and per-peer settings', () => {
  it('reloads both scope prompts at the supported 80,000-character limit without losing their tails', () => {
    const { root, store } = fixture();
    expect(QQ_EXTRA_PROMPT_MAX_CHARS).toBe(80_000);
    const prompt = (tail: string): string => 'x'.repeat(QQ_EXTRA_PROMPT_MAX_CHARS - tail.length) + tail;
    const settings = { ...defaultQQAgentSettings(), promptGroup: prompt('GROUP_TAIL'), promptDirect: prompt('DIRECT_TAIL') };
    const entry = store.ensure('group', 'long-prompt');
    store.updateDefaults(1, settings);
    store.updateSettings(entry.key, entry.policy.version, settings, '', true);
    const reloaded = new ConversationStore(root, 'account');
    expect(reloaded.defaults()).toEqual({ version: 2, settings });
    expect(reloaded.get(entry.key)?.settings).toEqual(settings);
    expect(reloaded.ensure('c2c', 'new-person').settings).toEqual(settings);
  });
  it.each([
    ['promptGroup', '群聊补充提示词'], ['promptDirect', '私聊补充提示词'],
  ])('rejects an over-limit %s write without changing defaults or peer settings', (field, label) => {
    const { root, store } = fixture();
    const entry = store.ensure('group', 'rejected-prompt');
    const defaults = store.defaults();
    const path = join(root, `conversations-${createHash('sha256').update('account').digest('hex')}.json`);
    const persisted = readFileSync(path, 'utf8');
    const settings = { ...defaultQQAgentSettings(), [field]: 'x'.repeat(QQ_EXTRA_PROMPT_MAX_CHARS + 1) };
    expect(() => store.updateDefaults(defaults.version, settings)).toThrow(`${label}不能超过 80000 个字符`);
    expect(() => store.updateSettings(entry.key, entry.policy.version, settings, 'rejected alias', false)).toThrow(`${label}不能超过 80000 个字符`);
    expect(store.defaults()).toEqual(defaults);
    expect(store.get(entry.key)).toEqual(entry);
    expect(readFileSync(path, 'utf8')).toBe(persisted);
    const reloaded = new ConversationStore(root, 'account');
    expect(reloaded.defaults()).toEqual(defaults);
    expect(reloaded.get(entry.key)).toMatchObject(entry);
  });
  it('loads a legacy prompt at the existing 80,000-character limit', () => {
    const { root, store } = fixture();
    const entry = store.ensure('c2c', 'legacy-prompt');
    const path = join(root, `conversations-${createHash('sha256').update('account').digest('hex')}.json`);
    const catalog = JSON.parse(readFileSync(path, 'utf8'));
    const prompt = 'x'.repeat(QQ_EXTRA_PROMPT_MAX_CHARS - 'LEGACY_TAIL'.length) + 'LEGACY_TAIL';
    for (const settings of [catalog.defaults.settings, catalog.entries[0].settings]) {
      settings.prompt = prompt;
      delete settings.promptGroup;
      delete settings.promptDirect;
    }
    writeFileSync(path, JSON.stringify(catalog));
    const reloaded = new ConversationStore(root, 'account');
    expect(reloaded.defaults().settings).toMatchObject({ promptGroup: prompt, promptDirect: prompt });
    expect(reloaded.get(entry.key)?.settings).toMatchObject({ promptGroup: prompt, promptDirect: prompt });
  });
  it('persists versioned defaults for new peers without altering existing group or private peers', () => {
    const { root, store } = fixture();
    const group = store.ensure('group', 'old-group'); const direct = store.ensure('c2c', 'old-person');
    const settings = { ...defaultQQAgentSettings(), preset: 'new-agent', model: { provider: 'p', model: 'm' }, cwd: '/tmp/new', promptGroup: 'new prompt' };
    store.updateDefaults(1, settings);
    expect(store.get(group.key)).toEqual(group); expect(store.get(direct.key)).toEqual(direct);
    const reloaded = new ConversationStore(root, 'account');
    expect(reloaded.defaults()).toEqual({ version: 2, settings });
    for (const scope of ['group', 'c2c'] as const) expect(reloaded.ensure(scope, 'new').settings).toEqual(settings);
    expect(() => reloaded.updateDefaults(1, defaultQQAgentSettings())).toThrow('已更新');
    expect(reloaded.defaults().version).toBe(2);
  });
  it('copies current defaults on first admission rather than denied identity discovery', () => {
    const { store } = fixture();
    const discovered = store.ensure('group', 'blocked', { admitted: false });
    expect(discovered.defaultsPending).toBe(true);
    store.updateDefaults(1, { ...defaultQQAgentSettings(), promptGroup: 'latest before admission' });
    expect(store.ensure('group', 'blocked', { admitted: false }).settings?.promptGroup).toBe('');
    const admitted = store.ensure('group', 'blocked', { admitted: true });
    expect(admitted.settings?.promptGroup).toBe('latest before admission'); expect(admitted.defaultsPending).toBe(false);
    store.updateDefaults(2, { ...defaultQQAgentSettings(), promptGroup: 'later global edit' });
    expect(store.ensure('group', 'blocked', { admitted: true }).settings?.promptGroup).toBe('latest before admission');
  });
  it('migrates an old restricted policy to native tools on load and applies permission changes directly', () => {
    const { root, store } = fixture(); const entry = store.ensure('group', 'legacy');
    const path = join(root, `conversations-${createHash('sha256').update('account').digest('hex')}.json`);
    const catalog = JSON.parse(readFileSync(path, 'utf8')); delete catalog.entries[0].policy.nativeTools; delete catalog.defaults; delete catalog.entries[0].settings; delete catalog.entries[0].defaultsPending;
    writeFileSync(path, JSON.stringify(catalog));
    const reloaded = new ConversationStore(root, 'account'); const before = reloaded.get(entry.key)!;
    expect(before.policy.nativeTools).toBe(true);
    const edited = { ...before.settings!, execution: { kind: 'native' as const, permission: 'workspace-write' as const } };
    const converted = reloaded.updateSettings(entry.key, before.policy.version, edited, '', true);
    expect(converted.policy).toMatchObject({ nativeTools: true, toolMode: 'native', permission: 'workspace-write', tools: {} });
  });
  it('saves settings in one transaction and persists scope prompts', () => {
    const { store } = fixture(); const first = store.ensure('c2c', 'person');
    store.bindSession(first.key, 'original'); const before = store.get(first.key)!;
    const settings = { ...before.settings!, promptDirect: 'next Session only', execution: { kind: 'custom' as const, permission: 'read-only' as const, tools: ['read'] } };
    const after = store.updateSettings(first.key, before.policy.version, settings, 'alias', true);
    expect(after).toMatchObject({ alias: 'alias', settings, policy: { nativeTools: false, tools: { read: 'allow' } } });
    expect(after.settings?.promptDirect).toBe('next Session only');
  });
  it.each(['group', 'c2c'] as const)('keeps an explicit custom tool ceiling when reopening a %s conversation', scope => {
    const { root, store } = fixture();
    const entry = store.ensure(scope, 'custom-tools');
    const settings = { ...entry.settings!, execution: { kind: 'custom' as const, permission: 'read-only' as const, tools: ['read'] } };
    const saved = store.updateSettings(entry.key, entry.policy.version, settings, 'restricted peer', true);
    const reloaded = new ConversationStore(root, 'account');
    expect(reloaded.get(entry.key)).toMatchObject(saved);
    expect(reloaded.get(entry.key)?.policy).toMatchObject({ nativeTools: false, tools: { read: 'allow' } });
    expect(new ConversationStore(root, 'account').get(entry.key)).toMatchObject(saved);
  });
  it('preserves an explicit legacy restricted policy while deriving missing settings', () => {
    const { root, store } = fixture();
    const entry = store.ensure('group', 'legacy-custom');
    const saved = store.updatePolicy(entry.key, entry.policy.version, { ...entry.policy, nativeTools: false, tools: { read: 'ask', bash: 'deny' } });
    const path = join(root, `conversations-${createHash('sha256').update('account').digest('hex')}.json`);
    const catalog = JSON.parse(readFileSync(path, 'utf8'));
    delete catalog.entries[0].settings;
    writeFileSync(path, JSON.stringify(catalog));
    const reloaded = new ConversationStore(root, 'account');
    expect(reloaded.get(entry.key)?.policy).toEqual(saved.policy);
    expect(reloaded.get(entry.key)?.settings?.execution).toEqual({ kind: 'custom', permission: 'read-only', tools: ['read'] });
  });
  it('repairs a custom tool ceiling overwritten by the earlier native-tools migration', () => {
    const { root, store } = fixture();
    const entry = store.ensure('group', 'previously-widened');
    const saved = store.updatePolicy(entry.key, entry.policy.version, { ...entry.policy, nativeTools: false, tools: { read: 'ask', bash: 'deny' } });
    const path = join(root, `conversations-${createHash('sha256').update('account').digest('hex')}.json`);
    const catalog = JSON.parse(readFileSync(path, 'utf8'));
    expect(catalog.entries[0].settings.execution.kind).toBe('custom');
    catalog.entries[0].policy.nativeTools = true;
    writeFileSync(path, JSON.stringify(catalog));
    const reloaded = new ConversationStore(root, 'account');
    expect(reloaded.get(entry.key)).toMatchObject(saved);
    expect(JSON.parse(readFileSync(path, 'utf8')).entries[0].policy.nativeTools).toBe(false);
    expect(new ConversationStore(root, 'account').get(entry.key)).toMatchObject(saved);
  });
});
