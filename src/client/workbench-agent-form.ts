import { t } from './qq-locale.ts';
import { createElement as h, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, SegmentedControl, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import type { ChatScope } from '../types.ts';
import {
  WORKBENCH_BASE_PERMISSIONS, type WorkbenchAgentSettings,
} from '../shared/workbench-agent-settings.ts';
import {
  defaultModelLabel, defaultPresetLabel, findModel, modelChoiceId,
  parseAgentPresets, parseModelCatalog, parsePermissionCatalog, sessionModelLabel,
  type ModelDirectory, type PermissionDirectory, type PresetChoice, type SelectorSource,
} from './host-selectors.ts';
import { QQSelect, type QQSelectOption } from './qq-select.ts';
import { PromptEditor } from './prompt-editor.ts';
import { WorkbenchToolPicker } from './workbench-tool-picker.ts';

export interface AgentFormSource extends SelectorSource {
  sessionModels?: SessionModelSource;
  workspaces(): readonly { path: string; title: string }[];
  addWorkspace?(): Promise<string | null>;
  openPromptFile?(path: string): Promise<void>;
  localizePreset?(id: string): string | undefined;
  localizePermission?(id: string, name: string): string | undefined;
}

export interface SessionModelSource {
  subscribe(listener: () => void): () => void;
  read(id: string): unknown;
  refresh(id: string): Promise<void> | undefined;
}

const noModelSubscription = () => () => {};

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
      setCatalog(current => ({ ...current, loading: false, errors: [t("DSH 目录加载超时。")] }));
    }, 10_000);
    setCatalog(current => ({ ...current, loading: true, errors: [] }));
    const read = async (method?: () => Promise<unknown>): Promise<unknown> => {
      if (!method) throw new Error(t("此宿主的目录暂不可用。"));
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
          ...(models.status === 'fulfilled' ? models.value?.failures ?? [] : [t("模型目录不可用")]),
          ...(presets.status === 'fulfilled' ? [] : [t("Agent 预设目录不可用")]),
          ...(permissions.status === 'fulfilled' ? [] : [t("权限目录不可用")]),
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

export function WorkbenchAgentFields({ settings, source, disabled, onChange, placementOnly = false, conversationDefaults = false, currentSession }: AgentFieldsProps & {
  source?: AgentFormSource;
  placementOnly?: boolean;
  conversationDefaults?: boolean;
  currentSession?: { id: string; placement: string; archived: boolean; open?: () => void };
}): ReactNode {
  const [catalog, retry] = useCatalog(source, placementOnly);
  const modelSource = source?.sessionModels;
  const sessionId = currentSession?.id;
  const projection = useSyncExternalStore(
    modelSource && sessionId ? modelSource.subscribe : noModelSubscription,
    () => sessionId ? modelSource?.read(sessionId) : undefined,
  );
  useEffect(() => {
    if (sessionId) void modelSource?.refresh(sessionId)?.catch(() => {});
  }, [modelSource, sessionId]);
  const [adding, setAdding] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [toolPickerOpen, setToolPickerOpen] = useState(false);
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
      setWorkspaceError(error instanceof Error ? error.message : t("无法添加工作区。"));
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
  const capLabel = baseOptions.find(option => option.value === settings.permission)?.label ?? settings.permission;
  const customLabel = settings.tools === undefined ? t("自定义工具")
    : t("自定义工具 · 上限 {0} · 已选 {1} 项", capLabel, settings.tools.length);
  const select = (label: string, value: string, options: readonly QQSelectOption[], onSelect: (value: string) => void, pending = false) =>
    h('div', { className: 'imqw-field' }, h('span', null, label),
      h(QQSelect, { label, value, options, disabled: disabled || pending, onChange: onSelect }));
  return h('div', { className: 'imqw-agent-fields' },
    currentSession ? h('div', { className: 'imqw-current-session' },
      h('strong', null, currentSession.archived ? t("当前 Session（已归档）") : t("当前 Session")),
      h('p', { className: 'imqw-muted' }, sessionModelLabel(projection, catalog.models) ?? t("模型与推理强度请在原生会话查看")),
      currentSession.placement ? h('p', { className: 'imqw-muted' }, currentSession.placement) : null,
      currentSession.open ? h(Button, { type: 'button', size: 'sm', variant: 'outline', onClick: currentSession.open }, t("在原生会话中调整")) : null,
    ) : null,
    conversationDefaults ? h('div', { className: 'imqw-agent-default-heading' },
      h('strong', null, t("新建 Session 默认值")),
      h('p', { className: 'imqw-muted' }, t("模型、推理强度、预设、工作区和原生权限在新建时应用。自定义工具限制保存后生效。")),
    ) : null,
    catalog.loading ? h('p', { className: 'imqw-muted', role: 'status' }, t("正在读取 DSH 目录…")) : null,
    catalog.errors.length ? h('div', { className: 'imqw-actions' }, h('p', { className: 'imqb-error', role: 'alert' }, catalog.errors.join(' · ')),
      h(Button, { type: 'button', variant: 'outline', size: 'sm', onClick: retry }, t("重试目录"))) : null,
    !placementOnly ? h('div', { className: 'imqw-model-fields' },
      select(t("模型"), settings.model ? modelChoiceId(settings.model) : '', [{ value: '', label: defaultModelLabel(catalog.models) }, ...models.map(entry => entry.option)], id => {
        const choice = models.find(entry => entry.option.value === id)?.model;
        onChange({ model: choice ? { provider: choice.provider, model: choice.model } : null, reasoningEffort: '' });
      }),
      model?.efforts.length || settings.reasoningEffort ? select(t("推理强度"), settings.reasoningEffort, [
        { value: '', label: defaultEffortName ? t("模型默认 · {0}", defaultEffortName) : t("模型默认") },
        ...(model?.efforts ?? []).map(effort => ({ value: effort.id, label: effort.name, description: effort.description })),
      ], reasoningEffort => onChange({ reasoningEffort })) : null,
    ) : null,
    select(t("Agent 预设"), settings.preset, [{ value: '', label: defaultPresetLabel(catalog.presets) }, ...catalog.presets.map(preset => ({
      value: preset.id, label: preset.name, disabled: preset.broken !== undefined, description: preset.broken ?? preset.description,
    }))], preset => onChange({ preset })),
    select(t("工作区"), settings.cwd, [{ value: '', label: t("机器人默认目录") }, ...workspaces.map(workspace => ({
      value: workspace.path, label: workspace.title === 'default-workspace' ? t("默认工作区") : workspace.title || workspace.path,
      description: workspace.path,
    })), ...(settings.cwd && !workspaces.some(workspace => workspace.path === settings.cwd)
      ? [{ value: settings.cwd, label: settings.cwd, description: t("已配置的工作目录") }] : []),
    ...(addWorkspace ? [{ value: ADD_WORKSPACE, label: t("＋ 添加工作区（选择文件夹…）") }] : [])], cwd => {
      setWorkspaceError('');
      if (cwd === ADD_WORKSPACE) void pickWorkspace();
      else onChange({ cwd });
    }, adding),
    workspaceError ? h('p', { className: 'imqb-error', role: 'alert' }, workspaceError) : null,
    !placementOnly ? select(t("执行权限"), settings.tools === undefined ? settings.permission : CUSTOM_TOOLS, [
      ...baseOptions, { value: CUSTOM_TOOLS, label: customLabel, description: t("设置权限上限和允许的工具"), disabled: customBase === undefined }, ...otherOptions,
      { value: '', label: permissionLabel ? t("DSH 默认 · {0}", permissionLabel) : t("DSH 默认权限") },
    ], permission => {
      if (permission === CUSTOM_TOOLS) {
        setToolPickerOpen(true);
      } else onChange({ permission, tools: undefined });
    }) : null,
    !placementOnly && toolPickerOpen && customBase ? h(WorkbenchToolPicker, {
      key: settings.preset, initialPermission: customBase, initialTools: settings.tools ?? [],
      permissions: baseOptions, preset: settings.preset, disabled,
      onCancel: () => setToolPickerOpen(false),
      onConfirm: (permission, tools) => {
        onChange({ permission, tools });
        setToolPickerOpen(false);
      },
    }) : null,
  );
}


export function WorkbenchReplyFields({ settings, scope, disabled, source, onChange }: AgentFieldsProps & {
  scope?: ChatScope; source?: AgentFormSource;
}): ReactNode {
  const scopeId = useId();
  const [promptScope, setPromptScope] = useState<ChatScope>('group');
  const promptScopes = [{ value: 'group', label: t("群聊") }, { value: 'c2c', label: t("私聊") }] as const;
  const activeScope = scope ?? promptScope;
  const key = activeScope === 'group' ? 'groupPrompt' : 'directPrompt';
  const label = activeScope === 'group' ? t("群聊补充提示词") : t("私聊补充提示词");
  const title = scope ? label : t("补充提示词");
  const editor = h(PromptEditor, {
    key, label, value: settings[key], disabled, openPromptFile: source?.openPromptFile, onChange: value => onChange({ [key]: value }),
    hint: scope ? t("保存后，下次组装模型请求时读取。") : undefined,
  });
  return h('div', { className: 'imqw-agent-fields' },
    h('section', { className: 'imqw-prompt-editor', 'aria-label': title },
      h('div', { className: 'imqw-prompt-toolbar' },
        h('h3', null, title),
        scope ? null : h(SegmentedControl<ChatScope>, {
          id: scopeId, label: t("补充提示词场景"), value: promptScope, onChange: setPromptScope, options: promptScopes,
        }),
      ),
      scope ? editor : promptScopes.map(({ value }) => h('div', {
        key: value, role: 'tabpanel', id: `${scopeId}-${value}-panel`, 'aria-labelledby': `${scopeId}-${value}`, hidden: value !== promptScope,
      }, value === promptScope ? editor : null)),
    ),
    scope !== 'c2c' ? h('p', { className: 'imqw-receiving imqw-muted' }, t("群聊生成完成后发送整条回复。")) : null,
    ...([
      ['streaming', t("私聊流式输出"), t("保存后下一轮生效，仅限被动回复。")],
      ['showToolResults', t("显示私聊工具成功结果"), t("群聊只发送最终答复。")],
    ] as const).filter(() => scope !== 'group').map(([key, label, hint]) =>
      h('div', { className: 'imqw-receiving', key },
        h('div', null, h('span', null, label), h('p', { className: 'imqw-muted' }, hint)),
        h(Switch, { label, checked: settings[key], disabled, onChange: value => onChange({ [key]: value }) }),
      )),
  );
}
