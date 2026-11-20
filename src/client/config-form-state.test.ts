import { describe, expect, it } from 'vitest';
import { configDraft, configPatch, isConfigDirty, normalizeConfig, parseConfigDraft, rebaseConfig, type ConfigWire } from './config-form-state.ts';

function baseline(): ConfigWire {
  return {
    appId: 'account-a', alias: '', requireMention: true,
    access: { c2cMode: 'allowlist', c2cAllow: ['owner'], groupMode: 'open', groupAllow: [] },
  };
}

describe('config form draft reconciliation', () => {
  it('keeps a group edit while accepting a newly bound private owner and readonly fields', () => {
    const initial = baseline();
    const form: ConfigWire = { ...initial, access: { ...initial.access!, groupMode: 'allowlist', groupAllow: ['group-a'] } };
    const incoming = { ...initial, alias: '新名称', robotRevision: 2, access: { ...initial.access!, c2cAllow: ['new-owner'] } };

    const refreshed = rebaseConfig(initial, form, incoming);

    expect(refreshed.access).toEqual({ c2cMode: 'allowlist', c2cAllow: ['new-owner'], groupMode: 'allowlist', groupAllow: ['group-a'] });
    expect(refreshed.alias).toBe('新名称');
    expect(refreshed.robotRevision).toBe(2);
    expect(configPatch(incoming, refreshed)).toEqual({ access: refreshed.access });
  });

  it('preserves the group mention policy edit while applying a concurrent rename', () => {
    const initial = baseline();
    const form = { ...initial, requireMention: false };
    const incoming = { ...initial, alias: '另一个页面改的名称' };

    const refreshed = rebaseConfig(initial, form, incoming);

    expect(refreshed.requireMention).toBe(false);
    expect(refreshed.alias).toBe('另一个页面改的名称');
    expect(isConfigDirty(incoming, refreshed)).toBe(true);
    expect(configPatch(initial, form)).toEqual({ requireMention: false });
  });

  it('clears a restored draft when a save completed before the client reloaded', () => {
    const initial = baseline();
    const submitted = { ...initial, requireMention: false };
    const restored = rebaseConfig(initial, submitted, submitted);

    expect(isConfigDirty(submitted, restored)).toBe(false);
  });

  it('normalizes submitted allowlists without modifying editable blank lines', () => {
    const form = baseline();
    form.access!.c2cAllow = [' owner ', '', 'owner', 'second', '  '];

    const submitted = normalizeConfig(form);

    expect(submitted.access!.c2cAllow).toEqual(['owner', 'second']);
    expect(form.access!.c2cAllow).toEqual([' owner ', '', 'owner', 'second', '  ']);
  });

  it('never submits readonly values or stores unrecognized response fields', () => {
    const initial = baseline();
    const serverResponse = { ...initial, appSecret: 'must-not-store', cwd: '/changed', newSecret: 'unknown' };

    expect(configPatch(initial, serverResponse)).toEqual({});
    const form = { ...serverResponse, groupPrompt: 'previous panel only', alias: 'edited' };
    const stored = configDraft(serverResponse, form);
    expect(JSON.stringify(stored)).not.toContain('must-not-store');
    expect(JSON.stringify(stored)).not.toContain('newSecret');
    expect(stored.form).not.toHaveProperty('cwd');
    expect(stored.form).not.toHaveProperty('groupPrompt');
    expect(stored.form.alias).toBe('edited');
  });

  it('rejects corrupt persisted field values', () => {
    expect(parseConfigDraft({ baseline: baseline(), form: { requireMention: { invalid: true } } })).toBeUndefined();
    expect(parseConfigDraft({ baseline: baseline(), form: { access: { c2cMode: 'open' } } })).toBeUndefined();
    expect(parseConfigDraft(configDraft(baseline(), { ...baseline(), alias: 'draft' }))?.form.alias).toBe('draft');
  });
});

describe('command-mode drafts', () => {
  it('rebases a mode draft onto a revoked list and its new revision', () => {
    const base = { ...baseline(), accessRevision: 'old' };
    const form = { ...base, access: { ...base.access!, commandMode: 'disabled' as const } };
    const fresh = { ...base, accessRevision: 'new', access: { ...base.access!, c2cAllow: [] } };
    const updated = rebaseConfig(base, form, fresh);
    expect(updated.access?.c2cAllow).toEqual([]);
    expect(configDraft(fresh, updated).baseline.accessRevision).toBe('new');
    expect(configPatch(fresh, updated).access).toMatchObject({ commandMode: 'disabled', c2cAllow: [] });
  });
  it('preserves a local command edit when the group list refreshes', () => {
    const base = baseline();
    const form = { ...base, access: { ...base.access!, commandMode: 'disabled' as const } };
    const incoming = { ...base, access: { ...base.access!, groupAllow: ['new-group'] } };
    const updated = rebaseConfig(base, form, incoming);
    expect(updated.access?.commandMode).toBe('disabled');
    expect(updated.access?.groupAllow).toEqual(['new-group']);
    expect(parseConfigDraft({ baseline: base, form: updated })).toBeDefined();
    expect(parseConfigDraft({ baseline: base, form: { ...updated, access: { ...updated.access, commandMode: 'unexpected' } } })).toBeUndefined();
  });
});
