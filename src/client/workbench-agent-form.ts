import { createElement as h, useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import type { ChatScope } from '../types.ts';
import type { WorkbenchAgentSettings } from '../shared/workbench-agent-settings.ts';
import {
  defaultModelLabel, defaultPresetLabel, findModel, modelChoiceId,
  parseAgentPresets, parseModelCatalog, parsePermissionCatalog,
  type ModelDirectory, type PermissionChoice, type PresetChoice, type SelectorSource,
} from './host-selectors.ts';
import { QQSelect } from './qq-select.ts';

export interface AgentFormSource extends SelectorSource {
  workspaces(): readonly { path: string; title: string }[];
}

interface Catalog {
  models: ModelDirectory | null;
  presets: PresetChoice[];
  permissions: PermissionChoice[];
  errors: string[];
  loading: boolean;
}

const empty: Catalog = { models: null, presets: [], permissions: [], errors: [], loading: true };

function useCatalog(source?: AgentFormSource): [Catalog, () => void] {
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
      read(source?.modelCatalog).then(parseModelCatalog),
      read(source?.listAgentPresets).then(parseAgentPresets),
      read(source?.permissionCatalog).then(parsePermissionCatalog),
    ]).then(([models, presets, permissions]) => {
      if (!active) return;
      clearTimeout(timeout);
      setCatalog(current => ({
        loading: false,
        models: models.status === 'fulfilled' ? models.value : current.models,
        presets: presets.status === 'fulfilled' ? presets.value : current.presets,
        permissions: permissions.status === 'fulfilled' ? permissions.value : current.permissions,
        errors: [
          ...(models.status === 'fulfilled' ? models.value.failures : ['模型目录不可用']),
          ...(presets.status === 'fulfilled' ? [] : ['Agent 预设目录不可用']),
          ...(permissions.status === 'fulfilled' ? [] : ['权限目录不可用']),
        ],
      }));
    });
    return () => { active = false; clearTimeout(timeout); };
  }, [source, attempt]);
  return [catalog, () => setAttempt(value => value + 1)];
}

interface AgentFieldsProps {
  settings: WorkbenchAgentSettings;
  source?: AgentFormSource;
  scope?: ChatScope;
  disabled: boolean;
  onChange: (next: WorkbenchAgentSettings) => void;
}

export function WorkbenchAgentFields({ settings, source, scope, disabled, onChange }: AgentFieldsProps): ReactNode {
  const [catalog, retry] = useCatalog(source);
  const patch = (change: Partial<WorkbenchAgentSettings>) => onChange({ ...settings, ...change });
  const models = catalog.models?.groups.flatMap(group => group.models.map(model => ({
    model, option: { value: modelChoiceId(model), label: `${group.name} / ${model.name}` },
  }))) ?? [];
  const route = settings.model ?? catalog.models?.defaultModel;
  const model = route && findModel(catalog.models, route);
  const workspaces = source?.workspaces() ?? [];
  const select = (label: string, value: string, options: Parameters<typeof QQSelect>[0]['options'], onChange: (value: string) => void) =>
    h('div', { className: 'imqw-field' }, h('span', null, label), h(QQSelect, { label, value, options, disabled, onChange }));
  return h('div', { className: 'imqw-agent-fields' },
    h('section', { className: 'imqw-session-settings', 'aria-label': 'Agent 与工作区' },
      h('h3', null, 'Agent 与工作区'),
      scope ? h('p', { className: 'imqw-muted' }, '模型、推理强度、预设、工作区和执行权限在下次新建 DSH Session 时生效。当前 Session 可在 DSH 原生页面操作。') : null,
      catalog.loading ? h('p', { className: 'imqw-muted', role: 'status' }, '正在读取 DSH 目录…') : null,
      catalog.errors.length ? h('div', { className: 'imqw-actions' }, h('p', { className: 'imqb-error', role: 'alert' }, catalog.errors.join(' · ')),
        h(Button, { type: 'button', variant: 'outline', size: 'sm', onClick: retry }, '重试目录')) : null,
      h('div', { className: 'imqw-agent-grid' },
        select('模型', settings.model ? modelChoiceId(settings.model) : '', [{ value: '', label: defaultModelLabel(catalog.models) }, ...models.map(entry => entry.option)], id => {
          const choice = models.find(entry => entry.option.value === id)?.model;
          patch({ model: choice ? { provider: choice.provider, model: choice.model } : null, reasoningEffort: '' });
        }),
        select('推理强度', settings.reasoningEffort, [
          { value: '', label: '模型默认' },
          ...(model?.efforts ?? []).map(effort => ({ value: effort.id, label: effort.name, description: effort.description })),
        ], reasoningEffort => patch({ reasoningEffort })),
        select('Agent 预设', settings.preset, [{ value: '', label: defaultPresetLabel(catalog.presets) }, ...catalog.presets.map(preset => ({
          value: preset.id, label: preset.name, disabled: preset.broken !== undefined, description: preset.broken ?? preset.description,
        }))], preset => patch({ preset })),
        select('工作区', settings.cwd, [{ value: '', label: '机器人默认目录' }, ...workspaces.map(workspace => ({
          value: workspace.path, label: workspace.title === 'default-workspace' ? '默认工作区' : workspace.title || workspace.path,
          description: workspace.path,
        })), ...(settings.cwd && !workspaces.some(workspace => workspace.path === settings.cwd)
          ? [{ value: settings.cwd, label: settings.cwd, description: '已配置的工作目录' }] : [])], cwd => patch({ cwd })),
        select('执行权限', settings.permission, [{ value: '', label: 'DSH 默认权限' }, ...catalog.permissions.map(permission => ({
          value: permission.value, label: permission.name, description: permission.description,
        }))], permission => patch({ permission })),
      ),
    ),
    h('section', { className: 'imqw-session-settings', 'aria-label': '提示词与 QQ 回复' },
      h('h3', null, '提示词与 QQ 回复'),
      scope ? h('p', { className: 'imqw-muted' }, '补充提示词在后续请求组装时读取。QQ 输出选项从下一轮回复开始使用。') : null,
      ...(['group', 'c2c'] as const).filter(kind => !scope || kind === scope).map(kind => {
        const key = kind === 'group' ? 'groupPrompt' : 'directPrompt';
        return h('label', { className: 'imqw-field', key },
          h('span', null, kind === 'group' ? '群聊补充提示词' : '私聊补充提示词'),
          h('textarea', { value: settings[key], rows: 3, maxLength: 80_000, disabled,
            onChange: (event: ChangeEvent<HTMLTextAreaElement>) => patch({ [key]: event.currentTarget.value }),
          }));
      }),
      ...([
        ['streaming', '流式输出', '仅带有效回复目标的 QQ 私聊使用流式。'],
        ['showToolResults', '显示工具调用结果', '控制 QQ 上的成功结果预览，工具错误仍会提示。'],
      ] as const).filter(([key]) => key !== 'streaming' || scope !== 'group').map(([key, label, hint]) =>
        h('div', { className: 'imqw-receiving', key },
          h('div', null, h('strong', null, label), h('p', { className: 'imqw-muted' }, hint)),
          h(Switch, { label, checked: settings[key], disabled, onChange: value => patch({ [key]: value }) }),
        )),
    ),
  );
}
