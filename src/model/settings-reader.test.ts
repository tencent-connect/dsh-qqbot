import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsReader } from './settings-reader.ts';

const paths = vi.hoisted(() => ({ userHome: '' }));
vi.mock('node:os', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:os')>(),
  homedir: () => paths.userHome,
}));

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'qq-settings-reader-'));
  paths.userHome = join(root, 'user');
  mkdirSync(join(paths.userHome, '.dsh'), { recursive: true });
  writeFileSync(join(paths.userHome, '.dsh', 'settings.yaml'), 'agent-default-model:\n  provider: daily\n  model: forbidden\n');
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('legacy settings isolation', () => {
  it('retains a configured reasoning effort while ignoring an invalid optional field', () => {
    const reader = new SettingsReader(root);
    const settings = join(root, 'settings.yaml');
    writeFileSync(settings, 'agent-default-model:\n  provider: isolated\n  model: first\n  reasoningEffort: high\n');
    expect(reader.readDefaultRoute()).toEqual({ provider: 'isolated', model: 'first', reasoningEffort: 'high' });
    writeFileSync(settings, 'agent-default-model:\n  provider: isolated\n  model: first\n  reasoningEffort: 42\n');
    expect(reader.readDefaultRoute()).toEqual({ provider: 'isolated', model: 'first' });
    writeFileSync(settings, 'agent-default-model:\n  provider: isolated\n  model: first\n  reasoningEffort: ""\n');
    expect(reader.readDefaultRoute()).toEqual({ provider: 'isolated', model: 'first' });
  });

  it('reads the selected DSH_HOME rather than the daily user home', () => {
    const home = join(root, 'isolated');
    mkdirSync(home);
    writeFileSync(join(home, 'settings.yaml'), 'agent-default-model:\n  provider: isolated\n  model: first\n');
    vi.stubEnv('DSH_HOME', home);
    expect(new SettingsReader().readDefaultRoute()).toEqual({ provider: 'isolated', model: 'first' });
  });

  it('observes settings changes after an earlier successful or missing read', () => {
    const home = join(root, 'isolated');
    mkdirSync(home);
    const reader = new SettingsReader(home);
    expect(reader.readDefaultRoute()).toBeUndefined();
    writeFileSync(join(home, 'settings.yaml'), 'agent-default-model:\n  provider: first\n  model: one\n');
    expect(reader.readDefaultRoute()).toEqual({ provider: 'first', model: 'one' });
    writeFileSync(join(home, 'settings.yaml'), 'agent-default-model:\n  provider: second\n  model: two\n');
    expect(reader.readDefaultRoute()).toEqual({ provider: 'second', model: 'two' });
  });

  it('ignores malformed fields instead of returning invalid model routes', () => {
    const reader = new SettingsReader(root);
    writeFileSync(join(root, 'settings.yaml'), 'agent-default-model:\n  provider: 42\n  model: true\nllm-pi-ai:\n  providers:\n    isolated:\n      models:\n        - id: 99\n        - id: valid\n          name: true\n');
    expect(reader.readDefaultRoute()).toBeUndefined();
    expect(reader.readModels()).toEqual([{ provider: 'isolated', id: 'valid', name: undefined }]);
    writeFileSync(join(root, 'settings.yaml'), '[]');
    expect(reader.readProviders()).toEqual([]);
  });
});
