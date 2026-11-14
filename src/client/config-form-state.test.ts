import { describe, expect, it } from 'vitest';
import { configDraft, configPatch, isConfigDirty, normalizeConfig, parseConfigDraft, rebaseConfig, type ConfigWire } from './config-form-state.ts';

function baseline(): ConfigWire {
  return {
    appId: 'account-a', provider: '', model: '', cwd: '/old', streaming: true,
    access: { c2cMode: 'allowlist', c2cAllow: ['owner'], groupMode: 'open', groupAllow: [] },
  };
}

describe('config form draft reconciliation', () => {
  it('keeps a group edit while accepting a newly bound private owner and readonly fields', () => {
    const initial = baseline();
    const form: ConfigWire = { ...initial, access: { ...initial.access!, groupMode: 'allowlist', groupAllow: ['group-a'] } };
    const incoming: ConfigWire = { ...initial, cwd: '/new', streaming: false, access: { ...initial.access!, c2cAllow: ['new-owner'] } };

    const refreshed = rebaseConfig(initial, form, incoming);

    expect(refreshed.access).toEqual({ c2cMode: 'allowlist', c2cAllow: ['new-owner'], groupMode: 'allowlist', groupAllow: ['group-a'] });
    expect(refreshed.streaming).toBe(false);
    expect(refreshed.cwd).toBe('/new');
    expect(configPatch(incoming, refreshed)).toEqual({ access: refreshed.access });
  });

  it('preserves and submits upstream prompt edits while refreshing untouched model defaults', () => {
    const initial = baseline();
    const form = { ...initial, groupPrompt: 'keep my draft' };
    const incoming = { ...initial, model: 'new-default' };

    const refreshed = rebaseConfig(initial, form, incoming);

    expect(refreshed.groupPrompt).toBe('keep my draft');
    expect(refreshed.model).toBe('new-default');
    expect(isConfigDirty(incoming, refreshed)).toBe(true);
    expect(configPatch(initial, form)).toEqual({ groupPrompt: 'keep my draft' });
  });

  it('clears a restored draft when a save completed before the client reloaded', () => {
    const initial = baseline();
    const submitted = { ...initial, directPrompt: 'saved instruction' };
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
    const stored = configDraft(serverResponse, { ...serverResponse, model: 'edited' });
    expect(JSON.stringify(stored)).not.toContain('must-not-store');
    expect(JSON.stringify(stored)).not.toContain('newSecret');
    expect(stored.form.cwd).toBeUndefined();
    expect(stored.form.model).toBe('edited');
  });

  it('rejects corrupt persisted field values', () => {
    expect(parseConfigDraft({ baseline: baseline(), form: { model: { invalid: true } } })).toBeUndefined();
    expect(parseConfigDraft({ baseline: baseline(), form: { access: { c2cMode: 'open' } } })).toBeUndefined();
    expect(parseConfigDraft(configDraft(baseline(), { ...baseline(), model: 'draft' }))?.form.model).toBe('draft');
  });
});

describe('message handling mode drafts', () => {
  it('submits a mode change and preserves the edit through a server refresh', () => {
    const base = baseline();
    const form: ConfigWire = { ...base, messageHandlingMode: 'interrupt' };

    expect(configPatch(base, form)).toEqual({ messageHandlingMode: 'interrupt' });
    const rebased = rebaseConfig(base, form, { ...base, streaming: false });
    expect(rebased.messageHandlingMode).toBe('interrupt');
    expect(rebased.streaming).toBe(false);
    expect(configDraft(rebased, form).form.messageHandlingMode).toBe('interrupt');
  });

  it('rejects an unknown persisted mode', () => {
    const base = baseline();
    expect(parseConfigDraft({ baseline: base, form: { ...base, messageHandlingMode: 'bogus' as never } })).toBeUndefined();
    expect(parseConfigDraft(configDraft(base, { ...base, messageHandlingMode: 'queue' }))?.form.messageHandlingMode).toBe('queue');
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
