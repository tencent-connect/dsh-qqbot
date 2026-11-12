import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { QqExtensionScope, QqExtensionSettingsDefinition } from '../shared/workbench-extension.ts';
import { WorkbenchExtensionSettings } from './workbench-extension-settings.ts';

const definition: QqExtensionSettingsDefinition = {
  id: 'test.settings',
  defaults: { enabled: false, label: 'default' },
  parseOverrides(value) {
    const overrides = value as { enabled?: boolean; label?: string };
    if (overrides.enabled !== undefined && typeof overrides.enabled !== 'boolean') throw new Error('Expected boolean');
    if (overrides.label !== undefined && typeof overrides.label !== 'string') throw new Error('Expected string');
    return { ...overrides };
  },
};
const globalScope = { kind: 'global' } as const;
const robot = { kind: 'robot', appId: 'first' } as const;
const group = { kind: 'conversation', appId: 'first', scope: 'group', openId: 'same-id' } as const;
const direct = { ...group, scope: 'c2c' } as const;
const otherRobot = { ...group, appId: 'second' } as const;

let dir: string;
let path: string;
let store: WorkbenchExtensionSettings;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'qqbot-extension-settings-'));
  path = join(dir, 'settings.json');
  store = new WorkbenchExtensionSettings(path);
  store.registerSettings(definition);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function get(scope: QqExtensionScope) {
  return store.getSettings(definition.id, scope);
}

function save(scope: QqExtensionScope, revision: number, overrides: unknown) {
  return store.saveSettings(definition.id, scope, revision, overrides);
}

describe('workbench extension settings', () => {
  it('inherits each field, preserves explicit false and isolates robot and conversation keys', () => {
    expect(get(group)).toEqual({
      revision: 0, overrides: {}, effective: { enabled: false, label: 'default' },
      sources: { enabled: 'default', label: 'default' },
    });
    save(globalScope, 0, { enabled: true, label: 'global' });
    save(robot, 0, { label: 'robot' });
    expect(save(group, 0, { enabled: false })).toEqual({
      revision: 1, overrides: { enabled: false }, effective: { enabled: false, label: 'robot' },
      sources: { enabled: 'conversation', label: 'robot' },
    });
    expect(get(direct).effective).toEqual({ enabled: true, label: 'robot' });
    expect(get(otherRobot).effective).toEqual({ enabled: true, label: 'global' });

    expect(save(group, 1, {})).toMatchObject({
      revision: 2, overrides: {}, effective: { enabled: true, label: 'robot' },
      sources: { enabled: 'global', label: 'robot' },
    });
    expect(() => save(group, 0, { enabled: false })).toThrow(expect.objectContaining({ status: 409 }));
  });

  it('leaves current values intact on invalid writes and isolates extension namespaces', () => {
    const second = { ...definition, id: 'test.other' };
    store.registerSettings(second);
    save(robot, 0, { enabled: true });
    expect(() => save(robot, 1, { enabled: 'false' })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => save(robot, 1, { other: true })).toThrow(expect.objectContaining({ status: 400 }));
    expect(get(robot)).toMatchObject({ revision: 1, overrides: { enabled: true } });
    expect(store.getSettings(second.id, robot)).toMatchObject({ revision: 0, overrides: {} });
  });

  it('disposes registrations and recovers saved overrides on a new instance', () => {
    const restarted = new WorkbenchExtensionSettings(path);
    expect(() => store.registerSettings(definition)).toThrow('Duplicate');
    save(group, 0, { label: 'persisted' });
    const dispose = restarted.registerSettings(definition);
    expect(restarted.getSettings(definition.id, group).effective.label).toBe('persisted');
    dispose();
    expect(() => restarted.getSettings(definition.id, group)).toThrow(expect.objectContaining({ status: 404 }));
    restarted.registerSettings(definition);
    dispose();
    expect(restarted.getSettings(definition.id, group).effective.label).toBe('persisted');
  });

  it('does not overwrite a damaged settings file', () => {
    writeFileSync(path, '{');
    expect(() => save(robot, 0, { enabled: true })).toThrow();
    expect(readFileSync(path, 'utf8')).toBe('{');
  });
});
