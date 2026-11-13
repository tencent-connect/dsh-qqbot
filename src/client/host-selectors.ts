/** Read-only host directories; selections are saved with the QQ settings draft. */
export interface SelectorSource {
  modelCatalog(): Promise<unknown>;
  listAgentPresets(): Promise<unknown>;
  permissionCatalog?(): Promise<unknown>;
}

export interface ModelReasoningEffort { id: string; name: string; description?: string }
export interface ModelChoice {
  provider: string;
  model: string;
  name: string;
  description: string | undefined;
  /** Selectable reasoning efforts for this exact route; empty when the model has none. */
  efforts: readonly ModelReasoningEffort[];
  /** Host-advised default effort; undefined when the model has no reasoning control. */
  defaultEffort: string | undefined;
}

export interface ModelGroup {
  id: string;
  name: string;
  models: ModelChoice[];
}

export interface ModelDirectory {
  groups: ModelGroup[];
  failures: string[];
  defaultModel: { provider: string; model: string } | undefined;
}

export interface PresetChoice {
  id: string;
  name: string;
  description: string | undefined;
  broken: string | undefined;
  /** Host marks the default preset (the one used when a conversation inherits). */
  isDefault: boolean;
}

/** Actual permission options declared by the current Host. */
export interface PermissionChoice { value: string; name: string; description?: string }
export interface PermissionDirectory { options: PermissionChoice[]; defaultPreset?: string }

/** Validate the Host catalog once; no UI-only permission ids are introduced. */
export function parsePermissionCatalog(response: unknown, localize?: (id: string, name: string) => string | undefined): PermissionDirectory {
  const value = remoteValue(response);
  if (!Array.isArray(value.options)) throw new Error('权限目录返回格式无效。');
  const options: PermissionChoice[] = [];
  const seen = new Set<string>();
  for (const candidate of value.options) {
    const option = record(candidate);
    const id = text(option?.value);
    if (option === undefined || id === undefined || seen.has(id)) throw new Error('权限目录含无效或重复的条目。');
    seen.add(id);
    const name = text(option.name) ?? id;
    options.push({ value: id, name: localize?.(id, name) ?? name, description: text(option.description) });
  }
  return { options, defaultPreset: text(value.defaultPreset) };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** Unwrap the host RemoteResult before projecting the fields used by the menu. */
function remoteValue(response: unknown): Record<string, unknown> {
  const result = record(response);
  if (result?.ok === false) throw new Error(text(record(result.error)?.message) ?? '宿主目录读取失败。');
  const value = result?.ok === true ? record(result.value) : undefined;
  if (value === undefined) throw new Error('宿主目录返回格式无效。');
  return value;
}

export function parseModelCatalog(response: unknown): ModelDirectory {
  const value = remoteValue(response);
  if (!Array.isArray(value.groups) || !Array.isArray(value.failures)) throw new Error('模型目录返回格式无效。');
  const groups: ModelGroup[] = [];
  const failures: string[] = [];
  const seenProviders = new Set<string>();
  for (const candidate of value.groups) {
    const group = record(candidate);
    const id = text(group?.id);
    if (group === undefined || id === undefined || !Array.isArray(group.models) || seenProviders.has(id)) {
      failures.push('有提供方条目格式无效或重复');
      continue;
    }
    seenProviders.add(id);
    const models: ModelChoice[] = [];
    const seenModels = new Set<string>();
    for (const candidateModel of group.models) {
      const model = record(candidateModel);
      const modelId = text(model?.id);
      if (model === undefined || modelId === undefined || seenModels.has(modelId)) {
        failures.push(`${text(group.name) ?? id} 有模型条目格式无效或重复`);
        continue;
      }
      seenModels.add(modelId);
      const reasoning = record(model.reasoning);
      const efforts: ModelReasoningEffort[] = Array.isArray(reasoning?.efforts)
        ? reasoning.efforts.flatMap((candidateEffort) => {
            const effort = record(candidateEffort);
            const effortId = text(effort?.id);
            if (effort === undefined || effortId === undefined) return [];
            return [{ id: effortId, name: text(effort.name) ?? effortId, ...(text(effort.description) === undefined ? {} : { description: text(effort.description) }) }];
          })
        : [];
      models.push({ provider: id, model: modelId, name: text(model.name) ?? modelId, description: text(model.description), efforts, defaultEffort: text(reasoning?.defaultEffort) });
    }
    groups.push({ id, name: text(group.name) ?? id, models });
  }
  for (const candidate of value.failures) {
    const failure = record(candidate);
    failures.push(`${text(failure?.name) ?? text(failure?.id) ?? '未知提供方'}：${text(failure?.message) ?? '目录加载失败'}`);
  }
  const defaultValue = record(value.default);
  const provider = text(defaultValue?.provider);
  const model = text(defaultValue?.model);
  return {
    groups, failures: [...new Set(failures)],
    defaultModel: provider === undefined || model === undefined ? undefined : { provider, model },
  };
}

export function parseAgentPresets(response: unknown, localize?: (id: string) => string | undefined): PresetChoice[] {
  const value = remoteValue(response);
  if (!Array.isArray(value.presets)) throw new Error('Agent 预设目录返回格式无效。');
  const presets: PresetChoice[] = [];
  const seen = new Set<string>();
  for (const candidate of value.presets) {
    const preset = record(candidate);
    const id = text(preset?.id);
    if (preset === undefined || id === undefined || seen.has(id)) throw new Error('Agent 预设目录含无效或重复的条目。');
    if (preset.broken !== undefined && typeof preset.broken !== 'string') throw new Error('Agent 预设状态格式无效。');
    seen.add(id);
    presets.push({ id, name: text(preset.name) ?? localize?.(id) ?? id, description: text(preset.description), broken: typeof preset.broken === 'string' ? preset.broken : undefined, isDefault: preset.isDefault === true });
  }
  return presets;
}

export function modelChoiceId(selection: { provider: string; model: string }): string {
  return `model:${JSON.stringify([selection.provider, selection.model])}`;
}

export function findModel(directory: ModelDirectory | null, selection: { provider: string; model: string }): ModelChoice | undefined {
  return directory?.groups.find((group) => group.id === selection.provider)?.models.find((model) => model.model === selection.model);
}

/** Resolve a model route to a human label without an inherit fallback. */
function routeLabel(directory: ModelDirectory | null, selection: { provider: string; model: string }): string {
  const model = findModel(directory, selection);
  const fallback = `${selection.provider || '未指定提供方'} / ${selection.model || '未指定模型'}`;
  return model === undefined
    ? `${fallback}${directory === null ? '' : '（不可用）'}`
    : `${directory?.groups.find((group) => group.id === selection.provider)?.name ?? selection.provider} / ${model.name}`;
}

/** Label for "inherit": show the host's actual default route when it is known. */
export function defaultModelLabel(directory: ModelDirectory | null): string {
  return directory?.defaultModel ? `DSH 默认：${routeLabel(directory, directory.defaultModel)}` : 'DSH 默认';
}

/** Label for "inherit" preset: show the host's actual default preset when it is known. */
export function defaultPresetLabel(presets: PresetChoice[] | null): string {
  const preset = presets?.find((candidate) => candidate.isDefault);
  return preset ? `DSH 默认：${preset.name}` : 'DSH 默认';
}
