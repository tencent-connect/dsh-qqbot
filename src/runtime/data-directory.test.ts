import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { lockDataDirectories, profileDataDirectory, QqDataDirectoryBusy } from './data-directory.ts';
import { importLegacyPreferences } from './legacy-preferences.ts';
import { PrefsStore } from '../model/prefs-store.ts';
import { legacyDerivedSessionId } from '../session/session-id.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qqbot-state-'));
  roots.push(dir);
  return dir;
}

it('isolates profiles, refuses a second writer through a symlink, and recovers after process death', async () => {
  const root = fixture();
  const primary = profileDataDirectory(join(root, 'one'));
  const sibling = profileDataDirectory(join(root, 'two'));
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    const { lockDataDirectories } = await import(process.argv[1]);
    const release = lockDataDirectories([process.argv[2]]);
    process.on('exit', release);
    process.stdout.write('ready');
    setInterval(() => {}, 1000);
  `, new URL('./data-directory.ts', import.meta.url).href, primary], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  try {
    expect(String((await Promise.race([once(child.stdout!, 'data'), exited]))[0])).toBe('ready');
    const alias = join(root, 'alias');
    symlinkSync(primary, alias, 'dir');
    expect(() => lockDataDirectories([alias])).toThrow(QqDataDirectoryBusy);
    const release = lockDataDirectories([sibling]);
    release();
  } finally {
    child.kill('SIGKILL');
    await exited;
  }
  const release = lockDataDirectories([primary]);
  release();
  // The same physical directory can occur in both the profile and explicit overrides.
  lockDataDirectories([primary, join(root, 'alias')])();
});

it('adopts only 0.5.5 bindings belonging to the current profile and leaves the source untouched', async () => {
  const dir = fixture();
  const source = join(dir, 'legacy.json');
  const prefix = 'qqbot:bot:';
  const explicit = prefix + 'group:explicit';
  const derived = prefix + 'c2c:derived';
  const foreign = prefix + 'group:foreign';
  const reset = prefix + 'c2c:reset';
  const pending = 'session-d5bb3dfb-66f3-43b0-9003-472673db9afa';
  const derivedId = legacyDerivedSessionId(derived);
  const original = JSON.stringify({
    sessionIds: { [explicit]: 'session-one', [foreign]: 'session-two', [reset]: pending, [prefix + 'group:broken']: 123, 'qqbot:other:group:peer': 'session-one' },
    overrides: { [derived]: { provider: 'test-provider', model: 'test-model' }, [reset]: { provider: 'test-provider', model: 'reset-model' } },
    presets: { [derived]: 'standard', [reset]: 'minimal' },
  });
  writeFileSync(source, original);
  const path = join(dir, 'current.json');
  const prefs = new PrefsStore(undefined, { path });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const ownsSession = vi.fn(async (id: string) => id === 'session-one' || id === derivedId || id === legacyDerivedSessionId(reset));
  const options = { source, directory: dir, appId: 'bot', prefs, logger, ownsSession, active: () => true };
  await importLegacyPreferences(options);
  const reserved = prefs.getSessionId(reset);
  expect(reserved).toMatch(/^session-/);
  expect(reserved).not.toBe(pending);
  expect(prefs.listSessionBindings('bot').map(binding => binding.current).sort()).toEqual([derivedId, 'session-one', reserved].sort());
  expect(prefs.getOverride(reset)?.model).toBe('reset-model');
  expect(prefs.getPreset(reset)).toBe('minimal');
  expect(ownsSession).not.toHaveBeenCalledWith(legacyDerivedSessionId(reset));
  expect(prefs.getOverride(derived)).toEqual({ provider: 'test-provider', model: 'test-model' });
  expect(prefs.getPreset(derived)).toBe('standard');
  expect(prefs.listSessionBindings('other')).toEqual([]);
  const { readFileSync } = await import('node:fs');
  expect(readFileSync(source, 'utf8')).toBe(original);
  expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('skipped 2'));
  ownsSession.mockClear();
  await importLegacyPreferences({ ...options, prefs: new PrefsStore(undefined, { path }) });
  expect(ownsSession).not.toHaveBeenCalled();
});
