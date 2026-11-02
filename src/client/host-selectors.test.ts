import { describe, expect, it } from 'vitest';
import { findModel, modelChoiceId, modelLabel, parseAgentPresets, parseModelCatalog, parsePermissionCatalog, presetLabel } from './host-selectors.ts';

function catalog(groups: unknown[], failures: unknown[] = []): unknown {
  return { ok: true, value: { default: { provider: 'first', model: 'shared' }, routableProviders: ['first', 'second'], groups, failures } };
}

describe('host settings selector directories', () => {
  it('uses only actual Host permission ids and rejects malformed or duplicate directory rows', () => {
    expect(parsePermissionCatalog({ ok: true, value: { options: [{ value: 'read-only', name: 'Read only' }, { value: 'custom', name: 'Custom policy' }] } }).map(option => option.value)).toEqual(['read-only', 'custom']);
    expect(() => parsePermissionCatalog({ ok: true, value: { options: [{ value: 'custom' }, { value: 'custom' }] } })).toThrow('重复');
    expect(() => parsePermissionCatalog({ ok: true, value: { options: [{ value: 3 }] } })).toThrow('无效');
  });

  it('parses per-model reasoning efforts and default effort from the host catalog', () => {
    const directory = parseModelCatalog(catalog([
      { id: 'first', name: 'P', models: [
        { id: 'think', name: 'Think', reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High', description: 'more' }], defaultEffort: 'high' } },
        { id: 'plain', name: 'Plain' },
      ] },
    ]));
    const think = findModel(directory, { provider: 'first', model: 'think' });
    expect(think?.efforts.map((effort) => effort.id)).toEqual(['off', 'high']);
    expect(think?.defaultEffort).toBe('high');
    expect(findModel(directory, { provider: 'first', model: 'plain' })?.efforts).toEqual([]);
    expect(findModel(directory, { provider: 'first', model: 'plain' })?.defaultEffort).toBeUndefined();
    expect(findModel(directory, { provider: 'first', model: 'think' })?.efforts.find((effort) => effort.id === 'high')?.description).toBe('more');
  });

  it('keeps provider identities separate when model ids are identical', () => {
    const directory = parseModelCatalog(catalog([
      { id: 'first', name: 'First provider', models: [{ id: 'shared', name: 'First model', description: 'First description' }] },
      { id: 'second', name: 'Second provider', models: [{ id: 'shared', name: 'Second model' }] },
    ]));

    expect(directory.defaultModel).toEqual({ provider: 'first', model: 'shared' });
    expect(modelLabel(directory, { provider: 'second', model: 'shared' })).toBe('Second provider / Second model');
    expect(modelChoiceId({ provider: 'first', model: 'shared' })).not.toBe(modelChoiceId({ provider: 'second', model: 'shared' }));
    expect(findModel(directory, { provider: 'first', model: 'shared' })?.description).toBe('First description');
  });

  it('retains usable model entries and reports malformed, duplicate, and failed entries', () => {
    const directory = parseModelCatalog(catalog([
      { id: 'first', models: [{ id: 'shared' }, { id: 'shared', name: 'duplicate' }, { id: 123 }] },
      { id: 'first', name: 'duplicate provider', models: [] },
      { id: 'invalid', models: null },
    ], [{ id: 'offline', name: 'Offline provider', message: 'Connection failed' }]));

    expect(directory.groups).toHaveLength(1);
    expect(directory.groups[0]?.models).toEqual([{ provider: 'first', model: 'shared', name: 'shared', description: undefined, efforts: [], defaultEffort: undefined }]);
    expect(directory.failures.join('；')).toContain('格式无效或重复');
    expect(directory.failures).toContain('Offline provider：Connection failed');
  });

  it('retains the saved route label after that route disappears from a new catalog', () => {
    const saved = { provider: 'old-provider', model: 'retired-model' };
    const directory = parseModelCatalog(catalog([]));

    expect(modelLabel(directory, saved)).toBe('old-provider / retired-model（不可用）');
    expect(findModel(directory, saved)).toBeUndefined();
    expect(saved).toEqual({ provider: 'old-provider', model: 'retired-model' });
    expect(modelLabel(directory, { provider: '', model: '' })).toBe('DSH 默认：first / shared（不可用）');
    expect(modelLabel(directory, { provider: 'provider-only', model: '' })).toBe('provider-only / 未指定模型（不可用）');
  });

  it('uses collision-safe model option ids for arbitrary provider and model names', () => {
    expect(modelChoiceId({ provider: 'a/b', model: 'c' })).not.toBe(modelChoiceId({ provider: 'a', model: 'b/c' }));
    expect(modelChoiceId({ provider: 'inherit', model: 'inherit' })).not.toBe('inherit');
  });

  it('keeps broken preset reasons and preserves unavailable saved presets', () => {
    const presets = parseAgentPresets({ ok: true, value: { presets: [
      { id: 'healthy', isDefault: true, name: 'Healthy agent', description: 'Ready' },
      { id: 'broken', isDefault: false, broken: 'Required plugin is inactive' },
      { id: 'empty-reason', isDefault: false, broken: '' },
    ] } });

    expect(presets[0]).toEqual({ id: 'healthy', name: 'Healthy agent', description: 'Ready', broken: undefined, isDefault: true });
    expect(presets[1]?.broken).toBe('Required plugin is inactive');
    expect(presetLabel(presets, 'broken')).toBe('broken（不可用）');
    expect(presetLabel(presets, 'empty-reason')).toBe('empty-reason（不可用）');
    expect(presetLabel(presets, 'deleted')).toBe('deleted（不可用）');
    expect(presetLabel(presets, '')).toBe('DSH 默认：Healthy agent');
  });

  it('reports remote refusals and invalid top-level payloads', () => {
    const refused = { ok: false, error: { code: 'gateway/invocation-unavailable', message: 'Service is unavailable' } };
    expect(() => parseModelCatalog(refused)).toThrow('Service is unavailable');
    expect(() => parseAgentPresets(refused)).toThrow('Service is unavailable');
    expect(() => parseModelCatalog({ ok: true, value: { groups: null, failures: [] } })).toThrow('模型目录返回格式无效');
    expect(() => parseModelCatalog({ groups: [], failures: [] })).toThrow('宿主目录返回格式无效');
    expect(() => parseAgentPresets({ ok: true, value: { presets: {} } })).toThrow('Agent 预设目录返回格式无效');
  });

  it('rejects ambiguous preset rosters instead of offering malformed choices', () => {
    expect(() => parseAgentPresets({ ok: true, value: { presets: [{ id: 'same' }, { id: 'same' }] } })).toThrow('无效或重复');
    expect(() => parseAgentPresets({ ok: true, value: { presets: [{ id: 123 }] } })).toThrow('无效或重复');
    expect(() => parseAgentPresets({ ok: true, value: { presets: [{ id: 'wrong-status', broken: true }] } })).toThrow('状态格式无效');
  });
});
