import { createElement as h, useState, type ChangeEvent, type ReactNode } from 'react';
import { Button, Input, Modal, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import type { QQAgentSettings, QQExecutionSettings } from '../shared/agent-settings.ts';
import type { ConversationSandboxMode, SlashCommandDescriptor, ToolCatalogEntry } from '../shared/conversation-protocol.ts';
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { defaultModelLabel, defaultPresetLabel, findModel, modelChoiceId, modelLabel, presetLabel } from './host-selectors.ts';
import type { QQAgentCatalog } from './qq-agent-catalog.ts';
import { QQSelect, WorkspaceCwdSelect, type QQSelectOption } from './qq-controls.ts';
import { SlashCommandList } from './slash-command-list.ts';

const PERMISSIONS: ReadonlyArray<{ value: ConversationSandboxMode; label: string }> = [
  { value: 'read-only', label: '仅可查看' },
  { value: 'workspace-write', label: '工作区内修改' },
  { value: 'danger-full-access', label: '完全权限' },
];
const CATEGORIES: Record<ToolCatalogEntry['category'], string> = { file: '文件', search: '搜索', network: '联网', execution: '命令与代码', mcp: 'MCP', attachment: '附件与交付', other: '其他' };

/** 只读工具模板：只勾选"不会改动文件/不执行命令"的只读工具，且仅对当前目录实际可用的工具生效。 */
const TOOL_PRESETS: ReadonlyArray<{ id: string; label: string; tools: readonly string[] }> = [
  { id: 'read-files', label: '只读：文件与搜索', tools: ['skill', 'read', 'read_image', 'grep', 'glob', 'qqbot_group_history'] },
  { id: 'read-web', label: '只读 + 网页', tools: ['skill', 'read', 'read_image', 'grep', 'glob', 'qqbot_group_history', 'web_search', 'web_fetch'] },
];

/** 用户自建模板的本地存储键（按 store 维度不可用，模板是纯客户端偏好，存储在 localStorage）。 */
const CUSTOM_PRESETS_KEY = 'im-qqbot/tool-presets/v1';
interface CustomPreset { id: string; label: string; tools: string[] }
function loadCustomPresets(): CustomPreset[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(CUSTOM_PRESETS_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): CustomPreset[] => {
      if (item === null || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      if (typeof record.id !== 'string' || typeof record.label !== 'string' || !Array.isArray(record.tools)) return [];
      return [{ id: record.id, label: record.label, tools: record.tools.filter((tool): tool is string => typeof tool === 'string') }];
    });
  } catch { return []; }
}
function saveCustomPresets(items: CustomPreset[]): boolean {
  try { if (typeof localStorage !== 'undefined') { localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(items)); return true; } } catch { /* storage disabled */ }
  return false;
}

export interface QQAgentSettingsFormProps {
  readonly settings: QQAgentSettings;
  readonly tools: readonly ToolCatalogEntry[];
  readonly catalog: QQAgentCatalog;
  readonly disabled?: boolean;
  readonly askTools?: readonly string[];
  readonly onChange: (settings: QQAgentSettings) => void;
  readonly onRefreshCatalog: () => void;
  /** Slash-command metadata from the registry (single source of truth); omitted hides the list. */
  readonly commands?: readonly SlashCommandDescriptor[];
  /** Open the Host directory picker to fill the working directory; omitted hides the browse button. */
  readonly onPickDirectory?: () => Promise<string | null>;
  /** Existing DSH workspaces to offer in the working-directory selector. */
  readonly workspaces?: ReadonlyArray<{ workspaceId: string; title: string; path: string }>;
  /** Adopt a picked folder as a real workspace (native-aligned add flow). */
  readonly onCreateWorkspace?: (path: string) => Promise<{ workspaceId: string; title: string; path: string }>;
  /** Host default workspace name for display. */
  readonly defaultWorkspaceName?: string;
  /** QQ default working directory (shown when cwd is empty). */
  readonly defaultCwd?: string;
  /** Which surface hosts this shared form; only changes tool-area copy. Defaults to 'conversation'. */
  readonly scope?: 'defaults' | 'conversation';
  /** The chat scope of the conversation this form edits (group vs c2c); drives which extra-prompt field shows. */
  readonly chatScope?: 'group' | 'c2c';
}

/** Draft fields only. The parent owns persistence, versions and conflict handling. */
export function QQAgentSettingsForm({ settings, tools, catalog, disabled = false, askTools = [], commands = [], onPickDirectory, workspaces = [], onCreateWorkspace, defaultWorkspaceName = '默认工作区', defaultCwd, scope = 'conversation', chatScope = 'group', onChange, onRefreshCatalog }: QQAgentSettingsFormProps): ReactNode {
  const [cwdBusy, setCwdBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  // 首次进入"自定义工具"时的一次性引导（本组件实例内记忆，不写库）。
  const [toolGuideDismissed, setToolGuideDismissed] = useState(false);
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>(() => loadCustomPresets());
  const [presetName, setPresetName] = useState('');
  const execution = settings.execution;
  const model = settings.model;
  const modelOptions: QQSelectOption[] = [{ value: 'inherit', label: defaultModelLabel(catalog.models) }];
  if (model && !findModel(catalog.models, model)) modelOptions.push({ value: modelChoiceId(model), label: modelLabel(catalog.models, model), disabled: true });
  for (const group of catalog.models?.groups ?? []) for (const choice of group.models) modelOptions.push({ value: modelChoiceId(choice), label: `${group.name} / ${choice.name}`, description: choice.description });
  const presetOptions: QQSelectOption[] = [{ value: '', label: defaultPresetLabel(catalog.presets === null ? null : [...catalog.presets]) }];
  if (settings.preset && !catalog.presets?.some(preset => preset.id === settings.preset)) presetOptions.push({ value: settings.preset, label: presetLabel(catalog.presets === null ? null : [...catalog.presets], settings.preset), disabled: true });
  for (const preset of catalog.presets ?? []) presetOptions.push({ value: preset.id, label: `${preset.name}${preset.broken ? '（不可用）' : ''}`, description: preset.broken ?? preset.description, disabled: Boolean(preset.broken) });
  const selected = new Set(execution.kind === 'custom' ? execution.tools : []);
  const search = query.trim().toLocaleLowerCase();
  const available: ToolCatalogEntry[] = [...tools, ...[...selected].filter(id => !tools.some(tool => tool.id === id)).map(id => ({ id, name: id, description: '当前目录不可用，已保留原选择。', category: 'other', constraint: 'none', available: false } satisfies ToolCatalogEntry))];
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [onlySelected, setOnlySelected] = useState(false);
  const [collapsedCats, setCollapsedCats] = useState<ReadonlySet<string>>(() => new Set());
  const base0 = available.filter(tool => `${tool.name} ${tool.id} ${tool.description}`.toLocaleLowerCase().includes(search));
  const visible = base0.filter(tool => (categoryFilter === null || tool.category === categoryFilter) && (!onlySelected || selected.has(tool.id)));
  const categoryCounts = new Map<string, { total: number; chosen: number }>();
  for (const tool of base0) {
    const entry = categoryCounts.get(tool.category) ?? { total: 0, chosen: 0 };
    entry.total += 1; if (selected.has(tool.id)) entry.chosen += 1;
    categoryCounts.set(tool.category, entry);
  }
  const toggleCategory = (category: string): void => {
    const groupIds = available.filter(tool => tool.category === category && tool.available).map(tool => tool.id);
    const allChosen = groupIds.length > 0 && groupIds.every(id => selected.has(id));
    setTools(allChosen ? [...selected].filter(id => !groupIds.includes(id)) : [...selected, ...groupIds]);
  };
  const toggleCollapsed = (category: string): void => setCollapsedCats(prev => { const next = new Set(prev); if (next.has(category)) next.delete(category); else next.add(category); return next; });
  const setExecution = (next: QQExecutionSettings): void => onChange({ ...settings, execution: next });
  const setTools = (values: Iterable<string>): void => setExecution({ kind: 'custom', permission: execution.permission, tools: [...new Set(values)].sort() });
  const persistCustomPresets = (next: CustomPreset[]): void => { setCustomPresets(next); saveCustomPresets(next); };
  // 选中的具体模型；未选（继承默认）时退回宿主默认模型，用它的 efforts 也能配推理强度。
  const currentChoice = model ? findModel(catalog.models, model) : (catalog.models?.defaultModel ? findModel(catalog.models, catalog.models.defaultModel) : undefined);
  const effortOptions: QQSelectOption[] = (currentChoice?.efforts ?? []).map(effort => ({ value: effort.id, label: effort.name, ...(effort.description === undefined ? {} : { description: effort.description }) }));
  const showEffort = effortOptions.length > 0;
  // 具体模型读 model.reasoningEffort；继承默认时读顶层的 settings.reasoningEffort。
  const selectedEffort = (model ? model.reasoningEffort : settings.reasoningEffort) ?? currentChoice?.defaultEffort ?? effortOptions[0]?.value ?? '';
  const setModelWithEffort = (next: QQAgentSettings['model']): void => {
    if (next === null) { onChange({ ...settings, model: null }); return; }
    const choice = findModel(catalog.models, next);
    const efforts = choice?.efforts ?? [];
    const effort = next.reasoningEffort ?? choice?.defaultEffort ?? efforts[0]?.id;
    onChange({ ...settings, model: { provider: next.provider, model: next.model, ...(effort ? { reasoningEffort: effort as ReasoningEffortId } : {}) } });
  };
  const setEffort = (effort: string): void => {
    if (model) onChange({ ...settings, model: { ...model, reasoningEffort: effort as ReasoningEffortId } });
    else onChange({ ...settings, reasoningEffort: effort as ReasoningEffortId });
  };
  return h('div', { className: 'imqc-agentSettings' },
    h('div', { className: 'imqc-field' }, h('span', null, '模型'), h(QQSelect, { label: '模型', value: model ? modelChoiceId(model) : 'inherit', options: modelOptions, disabled, onOpen: onRefreshCatalog, onChange: value => {
      if (value === 'inherit') { onChange({ ...settings, model: null }); return; }
      const choice = catalog.models?.groups.flatMap(group => group.models).find(candidate => modelChoiceId(candidate) === value);
      if (choice) setModelWithEffort({ provider: choice.provider, model: choice.model });
    } })),
    showEffort ? h('div', { className: 'imqc-field' }, h('span', null, '推理强度'), h(QQSelect, { label: '推理强度', value: selectedEffort, options: effortOptions, disabled, onChange: setEffort })) : null,
    h('div', { className: 'imqc-field' }, h('span', null, 'Agent 预设'), h(QQSelect, { label: 'Agent 预设', value: settings.preset, options: presetOptions, disabled, onOpen: onRefreshCatalog, onChange: preset => onChange({ ...settings, preset }) })),
    h('p', { className: 'imqc-hint' }, 'Agent 预设决定使用哪个 Agent；执行权限决定该 Agent 可执行的操作。'),
    h('div', { className: 'imqc-field' }, h('span', null, '执行权限'), h(QQSelect, { label: '执行权限', value: execution.kind === 'custom' ? 'custom' : execution.permission, disabled, options: [...PERMISSIONS, { value: 'custom', label: '自定义工具' }], onChange: value => {
      if (value === 'custom') { setExecution({ kind: 'custom', permission: execution.permission, tools: [] }); return; }
      const permission = PERMISSIONS.find(item => item.value === value)?.value;
      if (permission) setExecution({ kind: 'native', permission });
    } })),
    execution.kind === 'native' ? h('p', { className: 'imqc-hint' }, '使用所选 Agent 的实际工具，并遵循 DSH 原生权限。') : h('section', { className: 'imqc-fieldset imqc-customTools', 'aria-label': scope === 'defaults' ? '允许的工具（新对话默认）' : '本对话允许的工具' },
      h('div', { className: 'imqc-fieldsetTitle' }, scope === 'defaults' ? '允许的工具（新对话默认）' : '本对话允许的工具'),
      !toolGuideDismissed ? h('div', { className: 'imqc-toolGuide' }, h('p', null, scope === 'defaults' ? '这里的勾选只决定之后新接入对话的初始工具；已接入的对话各自独立。' : '这里的勾选只对当前这个群/联系人生效，其它群各自独立。'),
        h(Button, { variant: 'ghost', size: 'sm', onClick: () => setToolGuideDismissed(true) }, '知道了')) : null,
      h('p', { className: 'imqc-hint' }, '只开放下方勾选的工具；基础权限是这些工具之上的上限，文件、命令和网络操作仍受其限制，已有额外审批规则保留。'),
      h('div', { className: 'imqc-presets' }, h('span', { className: 'imqc-hint' }, '快速模板：'),
        h('div', { className: 'imqc-inline' },
          ...TOOL_PRESETS.map(preset => h(Button, { key: preset.id, variant: 'outline', size: 'sm', disabled,
            onClick: () => setTools(preset.tools.filter(id => available.some(tool => tool.id === id && tool.available))) }, preset.label)),
          ...customPresets.map(preset => h('span', { className: 'imqc-presetUser', key: preset.id },
            h(Button, { variant: 'outline', size: 'sm', disabled, onClick: () => setTools(preset.tools.filter(id => available.some(tool => tool.id === id && tool.available))) }, preset.label),
            h('button', { type: 'button', className: 'imqc-presetDel', 'aria-label': `删除模板 ${preset.label}`, disabled, onClick: () => persistCustomPresets(customPresets.filter(item => item.id !== preset.id)) }, '×')))),
        h('div', { className: 'imqc-inline imqc-presetSave' },
          h(Input, { value: presetName, disabled, placeholder: '把当前选择存为模板…', 'aria-label': '新模板名称', onChange: (event: ChangeEvent<HTMLInputElement>) => setPresetName(event.target.value) }),
          h(Button, { variant: 'outline', size: 'sm', disabled: disabled || selected.size === 0 || presetName.trim() === '', onClick: () => {
            const label = presetName.trim();
            if (!label) return;
            persistCustomPresets([...customPresets, { id: `u${Date.now()}`, label, tools: [...selected].sort() }]);
            setPresetName('');
          } }, '存为模板'))),
      h('div', { className: 'imqc-field' }, h('span', null, '基础上限'), h(QQSelect, { label: '自定义工具的基础权限', value: execution.permission, options: PERMISSIONS, disabled, onChange: value => { const permission = PERMISSIONS.find(item => item.value === value)?.value; if (permission) setExecution({ ...execution, permission }); } })),
      h('div', { className: 'imqc-field' }, h('span', null, `已允许的工具（${selected.size}）`),
        selected.size === 0
          ? h('p', { className: 'imqc-hint' }, '尚未允许任何工具。点“选择工具”勾选。')
          : h('div', { className: 'imqc-toolGrid imqc-selectedTools' }, ...available.filter(tool => selected.has(tool.id)).map(tool => h('div', { className: 'imqc-toolRow imqc-toolRowStatic', key: tool.id, title: tool.description || undefined },
              h('span', { className: 'imqc-toolRowBody' },
                h('span', { className: 'imqc-toolRowName' }, tool.name, tool.id !== tool.name ? h('small', { className: 'imqc-hint' }, tool.id) : null),
                tool.description ? h('span', { className: 'imqc-toolRowDesc' }, tool.description) : null),
              h(Button, { variant: 'ghost', size: 'sm', className: 'imqc-toolRemove', disabled, 'aria-label': `移除${tool.name}`, onClick: () => setTools([...selected].filter(id => id !== tool.id)) }, '移除'))))),
      h(Button, { variant: 'outline', size: 'sm', disabled, onClick: () => setToolsOpen(true) }, `选择工具（已选 ${selected.size} 项）`),
      toolsOpen ? h(Modal, { open: true, title: '选择可用工具', closeLabel: '关闭工具选择', className: 'imqc-toolModal', onClose: () => setToolsOpen(false), children: h('div', { className: 'imqc imqc-toolPicker' },
      h('div', { className: 'imqc-toolPickerBar' },
        h(Input, { type: 'search', value: query, disabled, placeholder: '搜索工具名称或标识', 'aria-label': '搜索工具', onChange: (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value) }),
        h('div', { className: 'imqc-inline' }, h('span', { className: 'imqc-hint' }, `已选 ${selected.size} 项`),
          h(Button, { variant: 'ghost', size: 'sm', disabled: disabled || !visible.some(tool => tool.available), onClick: () => setTools([...selected, ...visible.filter(tool => tool.available).map(tool => tool.id)]) }, '全选当前筛选'),
          h(Button, { variant: 'ghost', size: 'sm', disabled: disabled || selected.size === 0, onClick: () => setTools([]) }, '清空选择'))),
      h('div', { className: 'imqc-chips' }, h('span', { className: 'imqc-hint' }, '分类：'),
        ...Object.entries(CATEGORIES).filter(([category]) => (categoryCounts.get(category)?.total ?? 0) > 0).map(([category, label]) => {
          const count = categoryCounts.get(category);
          return h('button', { type: 'button', key: category, className: 'imqc-chip', 'data-active': categoryFilter === category || undefined, onClick: () => setCategoryFilter(categoryFilter === category ? null : category) }, `${label} ${count?.chosen ?? 0}/${count?.total ?? 0}`);
        }),
        h('label', { className: 'imqc-onlySelected' }, h('input', { type: 'checkbox', checked: onlySelected, disabled, onChange: (event: ChangeEvent<HTMLInputElement>) => setOnlySelected(event.target.checked) }), h('span', null, '仅看已选'))),
      h('div', { className: 'imqc-toolChoices' }, ...Object.entries(CATEGORIES).map(([category, label]) => ({ category, label, tools: visible.filter(tool => tool.category === category) })).filter(group => group.tools.length).map(group => h('section', { key: group.category, className: 'imqc-toolGroup' }, h('div', { className: 'imqc-toolGroupHead' },
          h('button', { type: 'button', className: 'imqc-toolGroupToggle', 'aria-expanded': !collapsedCats.has(group.category), onClick: () => toggleCollapsed(group.category) }, collapsedCats.has(group.category) ? '▸' : '▾', h('strong', null, group.label)),
          h('button', { type: 'button', className: 'imqc-toolGroupAll', disabled, onClick: () => toggleCategory(group.category) }, '全选本类')),
        !collapsedCats.has(group.category) ? h('div', { className: 'imqc-toolGrid' }, ...group.tools.map(tool => {
          const isOn = selected.has(tool.id);
          return h('label', { className: 'imqc-toolRow', key: tool.id, 'data-on': isOn || undefined, 'data-off': !tool.available && !isOn || undefined, title: tool.description || undefined },
            h('input', { type: 'checkbox', className: 'imqc-toolRowInput', checked: isOn, disabled: disabled || (!tool.available && !isOn), onChange: (event: ChangeEvent<HTMLInputElement>) => setTools(event.target.checked ? [...selected, tool.id] : [...selected].filter(id => id !== tool.id)) }),
            h('span', { className: 'imqc-toolRowBody' },
              h('span', { className: 'imqc-toolRowName' }, tool.name, tool.id !== tool.name ? h('small', { className: 'imqc-hint' }, tool.id) : null),
              tool.description ? h('span', { className: 'imqc-toolRowDesc' }, tool.description) : null,
              (!tool.available ? h('small', { className: 'imqc-hint' }, tool.reason ?? '当前不可用') : null) ?? null,
              askTools.includes(tool.id) ? h('small', { className: 'imqc-hint' }, '需额外审批') : null));
        })) : null))),
      visible.length === 0 ? h('p', { className: 'imqc-hint' }, onlySelected ? '还没有勾选任何工具。' : '没有匹配的工具。') : null,
      h('div', { className: 'imqc-actions imqc-toolPickerFoot' }, h(Button, { variant: 'primary', size: 'sm', onClick: () => setToolsOpen(false) }, '完成选择'))) }) : null),
    // 工作目录：统一共享选择器（留空默认 → 各 DSH 工作区 → 添加），三处一致。
    (() => {
      const pickFolder = (): void => {
        if (!onPickDirectory) return;
        setCwdBusy(true);
        void onPickDirectory().then(async path => {
          if (!path) return;
          if (onCreateWorkspace) { try { const ws = await onCreateWorkspace(path); onChange({ ...settings, cwd: ws.path }); return; } catch { /* 无法建区则退回纯路径 */ } }
          onChange({ ...settings, cwd: path });
        }).catch(() => { /* 选择器被取消或宿主异常：保持现状 */ }).finally(() => setCwdBusy(false));
      };
      return h(WorkspaceCwdSelect, {
        value: settings.cwd, workspaces, defaultCwd, defaultWorkspaceName, disabled: disabled || cwdBusy,
        onAddWorkspace: (onPickDirectory || onCreateWorkspace) ? pickFolder : undefined,
        onChange: path => onChange({ ...settings, cwd: path }),
      });
    })(),
    ((): ReactNode => {
      // 补充提示词按 scope 分离：会话设置只显示当前 scope；新对话默认值两个都显示。
      const field = (key: 'promptGroup' | 'promptDirect', label: string): ReactNode => h('label', { className: 'imqc-field', key }, h('span', null, label), h('textarea', { rows: 4, value: settings[key], disabled, maxLength: 20_000, 'aria-label': label, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange({ ...settings, [key]: event.target.value }) }));
      return scope === 'defaults' ? [field('promptGroup', '群聊补充提示词'), field('promptDirect', '私聊补充提示词')] : (chatScope === 'group' ? field('promptGroup', '群聊补充提示词') : field('promptDirect', '私聊补充提示词'));
    })(),
    h('div', { className: 'imqc-inline' }, h('span', null, '斜杠命令'), h(Switch, { label: '斜杠命令', checked: settings.slashCommands, disabled, onChange: slashCommands => onChange({ ...settings, slashCommands }) })),
    h('p', { className: 'imqc-hint' }, '关闭后，普通用户的 / 命令返回停用提示；机器人所有者仍可使用命令。'),
    h(SlashCommandList, { commands }),
    catalog.loading ? h('p', { role: 'status', className: 'imqc-hint' }, '正在读取宿主模型和 Agent 预设目录…') : null,
    [...catalog.errors, ...(catalog.models?.failures ?? [])].map((error, index) => h('p', { key: index, role: 'alert', className: 'imqc-error' }, error)),
    catalog.errors.length ? h(Button, { variant: 'ghost', size: 'sm', disabled: disabled || catalog.loading, onClick: onRefreshCatalog }, '重试读取宿主目录') : null);
}
