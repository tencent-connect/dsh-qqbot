import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import { parseDocument } from 'yaml';
import { persistCredentialsToProfile, removeCredentialsFromProfile, updateProfileConfig } from './persist.ts';

const credentials = { appId: 'test-app', appSecret: 'test-secret' };
const otherPatches = `# User plugins
- insert:
    - id: custom-plugin
      name: "custom-plugin"
      config: { label: 'keep me' } # inline comment
- id: optional-plugin
  disabled: true
`;
const qqPatch = `# QQ settings
- id: im-qqbot
  config:
    appId: old-app
    appSecret: old-secret
    requireMention: false # user preference
    access:
      c2cMode: allowlist
      c2cAllow: [friend]
`;
const operations = {
  bind: (dir: string) => persistCredentialsToProfile(credentials, dir, logger),
  unbind: (dir: string) => removeCredentialsFromProfile(dir, logger),
  settings: (dir: string) => updateProfileConfig({ streaming: false }, dir, logger),
};
const logger = { info: vi.fn(), warn: vi.fn() };
let dir: string;
let path: string;
const read = () => readFileSync(path, 'utf8');
const entries = () => yaml.load(read()) as Array<Record<string, unknown>>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qqbot-persist-'));
  path = join(dir, 'cordis.patch.yml');
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('profile persistence', () => {
  it.each(Object.entries(operations))('%s preserves unrelated patches and comments', (_name, operation) => {
    writeFileSync(path, otherPatches + qqPatch);
    expect(operation(dir)).toBe(true);
    expect(entries().slice(0, 2)).toEqual(yaml.load(otherPatches));
    for (const text of ['# User plugins', '# inline comment', '# QQ settings', '# user preference', '"custom-plugin"', "'keep me'"]) {
      expect(read()).toContain(text);
    }
    expect(entries()[2]?.config).toMatchObject({ requireMention: false, access: { c2cMode: 'allowlist', c2cAllow: ['friend'] } });
  });

  it('binds, saves settings and unbinds without losing existing QQ options', () => {
    writeFileSync(path, otherPatches + qqPatch);
    expect(operations.bind(dir)).toBe(true);
    expect(updateProfileConfig({ appId: 'ignored', appSecret: 'ignored', access: { c2cMode: 'disabled' } }, dir, logger)).toBe(true);
    expect(entries()[2]?.config).toEqual({ ...credentials, requireMention: false, access: { c2cMode: 'disabled' } });
    expect(operations.unbind(dir)).toBe(true);
    expect(entries()[2]?.config).toEqual({ requireMention: false, access: { c2cMode: 'disabled' } });
    const timestamp = new Date('2000-01-01');
    utimesSync(path, timestamp, timestamp);
    expect(operations.unbind(dir)).toBe(true);
    expect(statSync(path).mtimeMs).toBeGreaterThan(timestamp.getTime());
    expect(entries().slice(0, 2)).toEqual(yaml.load(otherPatches));
  });

  it.each(['', '# Header only\n', '[]\n', otherPatches])('adds QQ configuration to a profile with no QQ override: %j', (content) => {
    writeFileSync(path, content);
    expect(operations.bind(dir)).toBe(true);
    expect(operations.bind(dir)).toBe(true);
    expect(entries().filter((entry) => entry.id === 'im-qqbot')).toEqual([{ id: 'im-qqbot', config: credentials }]);
    if (content.startsWith('#')) expect(read()).toContain(content.split('\n')[0]);
  });

  it('creates a missing profile and keeps credential fields out of settings updates', () => {
    expect(removeCredentialsFromProfile(dir, logger)).toBe(true);
    const nested = join(dir, 'new-profile');
    expect(updateProfileConfig({ appId: 'ignored', appSecret: 'ignored', streaming: false }, nested, logger)).toBe(true);
    expect(yaml.load(readFileSync(join(nested, 'cordis.patch.yml'), 'utf8'))).toEqual([{ id: 'im-qqbot', config: { streaming: false } }]);
  });

  it('preserves loader expressions, anchors, flow style and multiline text in unrelated entries', () => {
    const content = `# Expressions are evaluated by the host, not the editor
- insert:
    - id: custom-plugin
      config: &custom
        enabled: !!js 'true'
        prompt: |-
          line one
          line two
- id: other
  config: *custom
- { id: im-qqbot, config: { appId: "old", appSecret: 'old', requireMention: false } }
`;
    writeFileSync(path, content);
    const options = { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }] };
    const before = parseDocument(content, options).toJS();
    expect(operations.bind(dir)).toBe(true);
    const after = parseDocument(read(), options).toJS();
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(read()).toContain("!!js 'true'");
    expect(read()).toContain('&custom');
    expect(read()).toContain('*custom');
    expect(after[2].config).toEqual({ ...credentials, requireMention: false });
  });

  it('writes literal credentials over loader expressions', () => {
    writeFileSync(path, "- id: im-qqbot\n  config:\n    appId: !!js 'env.APP_ID' # identifier\n    appSecret: !!js 'env.SECRET'\n");
    expect(operations.bind(dir)).toBe(true);
    expect(entries()[0]?.config).toEqual(credentials);
    expect(read()).toContain('# identifier');
  });

  it.each(Object.entries(operations))('%s leaves shared QQ configuration intact', (_name, operation) => {
    const content = '- id: im-qqbot\n  config: &shared { appId: old, appSecret: old }\n- id: other\n  config: *shared\n';
    writeFileSync(path, content);
    expect(operation(dir)).toBe(false);
    expect(read()).toBe(content);
  });

  it.each(Object.entries(operations))('%s leaves invalid YAML and malformed structures unchanged', (_name, operation) => {
    for (const content of ['- [', 'config: {}\n', '- id: other\n- invalid\n', '- id: im-qqbot\n  config: wrong\n']) {
      writeFileSync(path, content);
      expect(operation(dir)).toBe(false);
      expect(read()).toBe(content);
    }
  });
});
