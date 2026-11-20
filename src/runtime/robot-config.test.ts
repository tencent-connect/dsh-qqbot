import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RobotConfigConflictError, RobotConfigStore, type BoundRobotConfig } from './robot-config.ts';

const primary = { appId: 'fixture-primary', enabled: true, alias: '老绑定', kind: 'primary', revision: 0 } as const;
const additional = {
  appId: 'fixture-additional', enabled: false, alias: '第二台', revision: 0, kind: 'additional', appSecret: 'fixture-secret',
  access: { c2cMode: 'allowlist', groupMode: 'disabled', commandMode: 'open', c2cAllow: ['same-peer'], groupAllow: [] },
} satisfies BoundRobotConfig;

describe('robot account catalog', () => {
  let root: string;
  let path: string;
  let store: RobotConfigStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'qqbot-robots-'));
    path = join(root, 'accounts.json');
    store = new RobotConfigStore(path);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('keeps each account independent and does not copy the primary credentials', () => {
    expect(store.list()).toEqual([]);
    store.save(primary);
    const other = store.save(additional);
    const primaryAfter = store.save({ ...primary, revision: 1, enabled: false });

    const reopened = new RobotConfigStore(path);
    expect(reopened.list()).toEqual([primaryAfter, other]);
    expect(reopened.get(additional.appId)).toEqual(other);
    expect(reopened.get(primary.appId)).toEqual({ ...primary, revision: 2, bindingRevision: 0, enabled: false });
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('rejects old snapshots after allowlist revocation by another store', () => {
    const saved = store.save(additional);
    const second = new RobotConfigStore(path);
    if (saved.kind !== 'additional') throw new Error('Expected an additional account');
    second.save({ ...saved, access: { ...saved.access, c2cAllow: [] } });

    expect(() => store.save({ ...saved, alias: 'stale draft' })).toThrow(RobotConfigConflictError);
    expect(store.get(saved.appId)).toMatchObject({ revision: 2, access: { c2cAllow: [] } });
    expect(() => store.save({ ...primary, appId: saved.appId, revision: 2 })).toThrow(RobotConfigConflictError);
  });

  it('reads a saved account without a command mode as open', () => {
    const bytes = JSON.stringify({
      version: 1,
      robots: [{ ...additional, revision: 1, access: { ...additional.access, commandMode: undefined } }],
    });
    writeFileSync(path, bytes, { mode: 0o600 });

    expect(store.get(additional.appId)?.kind).toBe('additional');
    expect(store.get(additional.appId)).toMatchObject({ access: additional.access });
    expect(readFileSync(path, 'utf8')).toBe(bytes);
  });

  it('removes only the selected account and rejects stale requests after it is re-added', () => {
    const kept = store.save(primary);
    const original = store.save(additional);
    expect(() => store.removeAdditional(kept.appId, kept.revision)).toThrow(RobotConfigConflictError);
    expect(() => store.removeAdditional(original.appId, original.revision + 1)).toThrow(RobotConfigConflictError);
    store.removeAdditional(original.appId, original.revision);
    const reopened = new RobotConfigStore(path);
    expect(reopened.list()).toEqual([kept, {
      kind: 'unbound', appId: additional.appId, alias: additional.alias, enabled: false,
      access: additional.access, revision: original.revision,
    }]);
    expect(readFileSync(path, 'utf8')).not.toContain('fixture-secret');
    const rebound = reopened.save(additional, original.revision);
    expect(rebound.revision).toBeGreaterThan(original.revision);
    expect(() => store.removeAdditional(original.appId, original.revision)).toThrow(RobotConfigConflictError);
    expect(() => store.save(original)).toThrow(RobotConfigConflictError);
    expect(store.list()).toEqual([kept, rebound]);
  });

  it.each([
    '{torn',
    JSON.stringify({ version: 2, robots: [] }),
    JSON.stringify({ version: 1, robots: [{ ...additional, revision: 1, access: { ...additional.access, groupMode: undefined } }] }),
    JSON.stringify({ version: 1, robots: [{ ...primary, revision: 1 }, { ...primary, revision: 2 }] }),
  ])('leaves malformed saved state untouched', bytes => {
    writeFileSync(path, bytes, { mode: 0o600 });
    expect(() => store.list()).toThrow('机器人配置目录无法读取');
    expect(() => store.save(primary)).toThrow('机器人配置目录无法读取');
    expect(readFileSync(path, 'utf8')).toBe(bytes);
  });
});
