import { createElement as h, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import type { ChatScope } from '../types.ts';
import {
  WORKBENCH_BASE_PERMISSIONS, WORKBENCH_TOOLS_PATH, type WorkbenchAgentSettings, type WorkbenchToolChoice,
} from '../shared/workbench-agent-settings.ts';
import { fetchJson } from './http.ts';
import {
  defaultModelLabel, defaultPresetLabel, findModel, modelChoiceId,
  parseAgentPresets, parseModelCatalog, parsePermissionCatalog,
  type ModelDirectory, type PermissionDirectory, type PresetChoice, type SelectorSource,
} from './host-selectors.ts';
import { QQSelect, type QQSelectOption } from './qq-select.ts';

export interface AgentFormSource extends SelectorSource {
  workspaces(): readonly { path: string; title: string }[];
  addWorkspace?(): Promise<string | null>;
  localizePreset?(id: string): string | undefined;
  localizePermission?(id: string, name: string): string | undefined;
}

interface Catalog {
  models: ModelDirectory | null;
  presets: PresetChoice[];
  permissions: PermissionDirectory;
  errors: string[];
  loading: boolean;
}

const empty: Catalog = { models: null, presets: [], permissions: { options: [] }, errors: [], loading: true };

function useCatalog(source: AgentFormSource | undefined, placementOnly: boolean): [Catalog, () => void] {
  const [catalog, setCatalog] = useState<Catalog>(empty);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const timeout = setTimeout(() => {
      active = false;
      setCatalog(current => ({ ...current, loading: false, errors: ['DSH 目录加载超时。'] }));
    }, 10_000);
    setCatalog(current => ({ ...current, loading: true, errors: [] }));
    const read = async (method?: () => Promise<unknown>): Promise<unknown> => {
      if (!method) throw new Error('此宿主的目录暂不可用。');
      return method();
    };
    void Promise.allSettled([
      placementOnly ? Promise.resolve(null) : read(source?.modelCatalog).then(parseModelCatalog),
      read(source?.listAgentPresets).then(response => parseAgentPresets(response, source?.localizePreset)),
      placementOnly ? Promise.resolve(empty.permissions) : read(source?.permissionCatalog).then(response => parsePermissionCatalog(response, source?.localizePermission)),
    ]).then(([models, presets, permissions]) => {
      if (!active) return;
      clearTimeout(timeout);
      setCatalog(current => ({
        loading: false,
        models: models.status === 'fulfilled' ? models.value : current.models,
        presets: presets.status === 'fulfilled' ? presets.value : current.presets,
        permissions: permissions.status === 'fulfilled' ? permissions.value : current.permissions,
        errors: [
          ...(models.status === 'fulfilled' ? models.value?.failures ?? [] : ['模型目录不可用']),
          ...(presets.status === 'fulfilled' ? [] : ['Agent 预设目录不可用']),
          ...(permissions.status === 'fulfilled' ? [] : ['权限目录不可用']),
        ],
      }));
    });
    return () => { active = false; clearTimeout(timeout); };
  }, [source, attempt, placementOnly]);
  return [catalog, () => setAttempt(value => value + 1)];
}

interface AgentFieldsProps {
  settings: WorkbenchAgentSettings;
  disabled: boolean;
  onChange: (patch: Partial<WorkbenchAgentSettings>) => void;
}

const ADD_WORKSPACE = 'add-workspace';
const CUSTOM_TOOLS = 'qqbot-custom-tools';

function WorkbenchToolPicker({ tools, preset, disabled, onChange }: {
  tools: readonly string[];
  preset: string;
  disabled: boolean;
  onChange: (tools: string[]) => void;
}): ReactNode {
  const [catalog, setCatalog] = useState<WorkbenchToolChoice[]>();
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setCatalog(undefined);
    setError('');
    void fetchJson<{ tools: WorkbenchToolChoice[] }>(`${WORKBENCH_TOOLS_PATH}?${new URLSearchParams({ preset })}`, {
      cache: 'no-store', signal: controller.signal,
    }).then(result => { if (!controller.signal.aborted) setCatalog(result.tools); }, cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '无法读取工具目录。');
    });
    return () => controller.abort();
  }, [preset, attempt]);
  const selected = new Set(tools);
  const term = query.trim().toLocaleLowerCase();
  const known = new Set(catalog?.map(tool => tool.name));
  const available = catalog?.filter(tool => `${tool.name} ${tool.description ?? ''}`.toLocaleLowerCase().includes(term));
  const missing = catalog ? tools.filter(name => !known.has(name)) : [];
  return h('fieldset', { className: 'imqw-tool-picker', disabled },
    h('legend', null, `允许的工具 · 已选 ${tools.length} 项`),
    h(Input, { type: 'search', value: query, placeholder: '搜索工具', 'aria-label': '搜索工具',
      onChange: event => setQuery(event.currentTarget.value) }),
    error ? h('div', { className: 'imqw-actions' },
      h('p', { className: 'imqb-error', role: 'alert' }, error),
      h(Button, { type: 'button', size: 'sm', variant: 'outline', onClick: () => setAttempt(value => value + 1) }, '重试')) : null,
    !catalog && !error ? h('p', { className: 'imqw-muted', role: 'status' }, '正在读取工具…') : null,
    available?.length === 0 ? h('p', { className: 'imqw-muted' }, '没有匹配的工具。') : null,
    h('div', { className: 'imqw-tool-list' },
      ...missing.map(name => h('label', { key: name },
        h('input', { type: 'checkbox', checked: true, onChange: () => onChange(tools.filter(item => item !== name)) }),
        h('span', null, name, h('small', null, '当前预设未提供')))),
      ...(available ?? []).map(({ name, description }) => h('label', { key: name },
        h('input', { type: 'checkbox', checked: selected.has(name),
          onChange: event => onChange(event.currentTarget.checked ? [...tools, name].sort() : tools.filter(item => item !== name)) }),
        h('span', null, name, description ? h('small', null, description) : null))),
    ),
  );
}

export function WorkbenchAgentFields({ settings, source, disabled, onChange, placementOnly = false }: AgentFieldsProps & {
  source?: AgentFormSource;
  placementOnly?: boolean;
}): ReactNode {
  const [catalog, retry] = useCatalog(source, placementOnly);
  const [adding, setAdding] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const workspaceChange = useRef<typeof onChange | undefined>(undefined);
  useLayoutEffect(() => {
    workspaceChange.current = onChange;
    return () => { workspaceChange.current = undefined; };
  }, [onChange]);
  const addWorkspace = source?.addWorkspace;
  const pickWorkspace = async (): Promise<void> => {
    if (!addWorkspace || adding) return;
    setAdding(true);
    setWorkspaceError('');
    try {
      const cwd = await addWorkspace();
      if (cwd) workspaceChange.current?.({ cwd });
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : '无法添加工作区。');
    } finally {
      setAdding(false);
    }
  };
  const models = catalog.models?.groups.flatMap(group => group.models.map(model => ({
    model, option: { value: modelChoiceId(model), label: `${group.name} / ${model.name}`, description: model.description },
  }))) ?? [];
  const route = settings.model ?? catalog.models?.defaultModel;
  const model = route && findModel(catalog.models, route);
  const defaultEffortName = model?.efforts.find(effort => effort.id === model.defaultEffort)?.name;
  const workspaces = source?.workspaces() ?? [];
  const permission = catalog.permissions.options.find(option => option.value === catalog.permissions.defaultPreset);
  const permissionLabel = permission?.name ?? catalog.permissions.defaultPreset;
  const nativeOptions = catalog.permissions.options.map(option => ({
    value: option.value, label: option.name, description: option.description,
  }));
  const baseOptions = WORKBENCH_BASE_PERMISSIONS.flatMap(value => nativeOptions.filter(option => option.value === value));
  const otherOptions = nativeOptions.filter(option => !baseOptions.includes(option));
  const customBase = [settings.permission, catalog.permissions.defaultPreset, baseOptions[0]?.value]
    .find(value => baseOptions.some(option => option.value === value));
  const select = (label: string, value: string, options: readonly QQSelectOption[], onSelect: (value: string) => void, pending = false) =>
    h('div', { className: 'imqw-field' }, h('span', null, label),
      h(QQSelect, { label, value, options, disabled: disabled || pending, onChange: onSelect }));
  return h('div', { className: 'imqw-agent-fields' },
    catalog.loading ? h('p', { className: 'imqw-muted', role: 'status' }, '正在读取 DSH 目录…') : null,
    catalog.errors.length ? h('div', { className: 'imqw-actions' }, h('p', { className: 'imqb-error', role: 'alert' }, catalog.errors.join(' · ')),
      h(Button, { type: 'button', variant: 'outline', size: 'sm', onClick: retry }, '重试目录')) : null,
    !placementOnly ? h('div', { className: 'imqw-model-fields' },
      select('模型', settings.model ? modelChoiceId(settings.model) : '', [{ value: '', label: defaultModelLabel(catalog.models) }, ...models.map(entry => entry.option)], id => {
        const choice = models.find(entry => entry.option.value === id)?.model;
        onChange({ model: choice ? { provider: choice.provider, model: choice.model } : null, reasoningEffort: '' });
      }),
      model?.efforts.length || settings.reasoningEffort ? select('推理强度', settings.reasoningEffort, [
        { value: '', label: defaultEffortName ? `模型默认 · ${defaultEffortName}` : '模型默认' },
        ...(model?.efforts ?? []).map(effort => ({ value: effort.id, label: effort.name, description: effort.description })),
      ], reasoningEffort => onChange({ reasoningEffort })) : null,
    ) : null,
    select('Agent 预设', settings.preset, [{ value: '', label: defaultPresetLabel(catalog.presets) }, ...catalog.presets.map(preset => ({
      value: preset.id, label: preset.name, disabled: preset.broken !== undefined, description: preset.broken ?? preset.description,
    }))], preset => onChange({ preset })),
    select('工作区', settings.cwd, [{ value: '', label: '机器人默认目录' }, ...workspaces.map(workspace => ({
      value: workspace.path, label: workspace.title === 'default-workspace' ? '默认工作区' : workspace.title || workspace.path,
      description: workspace.path,
    })), ...(settings.cwd && !workspaces.some(workspace => workspace.path === settings.cwd)
      ? [{ value: settings.cwd, label: settings.cwd, description: '已配置的工作目录' }] : []),
    ...(addWorkspace ? [{ value: ADD_WORKSPACE, label: '＋ 添加工作区（选择文件夹…）' }] : [])], cwd => {
      setWorkspaceError('');
      if (cwd === ADD_WORKSPACE) void pickWorkspace();
      else onChange({ cwd });
    }, adding),
    workspaceError ? h('p', { className: 'imqb-error', role: 'alert' }, workspaceError) : null,
    !placementOnly ? select('执行权限', settings.tools === undefined ? settings.permission : CUSTOM_TOOLS, [
      ...baseOptions, { value: CUSTOM_TOOLS, label: '自定义工具', disabled: customBase === undefined }, ...otherOptions,
      { value: '', label: permissionLabel ? `DSH 默认 · ${permissionLabel}` : 'DSH 默认权限' },
    ], permission => {
      if (permission === CUSTOM_TOOLS) {
        if (customBase) onChange({ permission: customBase, tools: settings.tools ?? [] });
      } else onChange({ permission, tools: undefined });
    }) : null,
    !placementOnly && settings.tools !== undefined ? h('div', { className: 'imqw-agent-fields' },
      select('基础权限', settings.permission, baseOptions, permission => onChange({ permission })),
      h(WorkbenchToolPicker, { tools: settings.tools, preset: settings.preset, disabled, onChange: tools => onChange({ tools }) }),
      h('p', { className: 'imqw-muted' }, '只开放已选工具，仍须遵守原生权限和审批。若当前原生权限高于基础权限，工具暂停使用。'),
    ) : null,
  );
}

export function WorkbenchReplyFields({ settings, scope, disabled, onChange }: AgentFieldsProps & { scope?: ChatScope }): ReactNode {
  return h('div', { className: 'imqw-agent-fields' },
    ...(['group', 'c2c'] as const).filter(kind => !scope || kind === scope).map(kind => {
      const key = kind === 'group' ? 'groupPrompt' : 'directPrompt';
      return h('label', { className: 'imqw-field', key },
        h('span', null, kind === 'group' ? '群聊补充提示词' : '私聊补充提示词'),
        h('textarea', { value: settings[key], rows: 3, maxLength: 80_000, disabled,
          onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange({ [key]: event.currentTarget.value }),
        }));
    }),
    ...([
      ['streaming', '私聊流式输出', '仅被动回复支持流式'],
      ['showToolResults', '显示工具调用结果', '关闭后仍提示工具错误'],
    ] as const).filter(([key]) => key !== 'streaming' || scope !== 'group').map(([key, label, hint]) =>
      h('div', { className: 'imqw-receiving', key },
        h('span', { title: hint }, label),
        h(Switch, { label, checked: settings[key], disabled, onChange: value => onChange({ [key]: value }) }),
      )),
  );
}
