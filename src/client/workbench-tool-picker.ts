import { t, type QqLocaleKey } from './qq-locale.ts';
import styles from './workbench.module.css';
import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { WORKBENCH_TOOL_LIMIT, WORKBENCH_TOOLS_PATH, type WorkbenchToolChoice } from '../shared/workbench-agent-settings.ts';
import { fetchJson } from './http.ts';
import { QQSelect, type QQSelectOption } from './qq-select.ts';
import {
  BUILT_IN_TOOL_COMBINATIONS, applyToolCombination, readToolCombinations, writeToolCombinations, type ToolCombination,
} from './workbench-tool-combinations.ts';

const categories: ReadonlyArray<{ id: string; label: QqLocaleKey; names: readonly string[] }> = [
  { id: 'file', label: '文件', names: ['read', 'read_image', 'write', 'edit'] },
  { id: 'search', label: '搜索', names: ['grep', 'glob', 'qqbot_group_history'] },
  { id: 'network', label: '联网', names: ['web_search', 'web_fetch', 'fetch', 'search'] },
  { id: 'execution', label: '命令与代码', names: ['bash', 'run_code', 'python', 'exec_command'] },
  { id: 'mcp', label: 'MCP', names: [] },
  { id: 'attachment', label: '附件与交付', names: ['qqbot_send_file', 'present'] },
  { id: 'other', label: '其他', names: [] },
  { id: 'unavailable', label: '当前不可用', names: [] },
];

function categoryOf(name: string): string {
  return name.startsWith('mcp__') ? 'mcp' : categories.find(category => category.names.includes(name))?.id ?? 'other';
}

function browserCombinations(): ToolCombination[] {
  try {
    return readToolCombinations(window.localStorage);
  } catch {
    return [];
  }
}

interface ToolPickerProps {
  initialPermission: string;
  initialTools: readonly string[];
  permissions: readonly QQSelectOption[];
  preset: string;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: (permission: string, tools: string[]) => void;
}

interface AppliedCombination {
  key: string;
  label: string;
  added: readonly string[];
  removed: readonly string[];
  skipped: readonly string[];
}

export function WorkbenchToolPicker({ initialPermission, initialTools, permissions, preset, disabled, onCancel, onConfirm }: ToolPickerProps): ReactNode {
  const [permission, setPermission] = useState(initialPermission);
  const [tools, setTools] = useState<string[]>(() => [...initialTools]);
  const [catalog, setCatalog] = useState<WorkbenchToolChoice[]>();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [combinations, setCombinations] = useState(browserCombinations);
  const [creating, setCreating] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const [combinationName, setCombinationName] = useState('');
  const [combinationError, setCombinationError] = useState('');
  const [applied, setApplied] = useState<AppliedCombination>();

  useEffect(() => { if (creating) nameInput.current?.focus(); }, [creating]);

  useEffect(() => {
    const controller = new AbortController();
    setCatalog(undefined);
    setError('');
    void fetchJson<{ tools: WorkbenchToolChoice[] }>(`${WORKBENCH_TOOLS_PATH}?${new URLSearchParams({ preset })}`, {
      cache: 'no-store', signal: controller.signal,
    }).then(result => {
      if (!controller.signal.aborted) setCatalog(result.tools);
    }, cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t("无法读取工具目录。"));
    });
    return () => controller.abort();
  }, [preset, attempt]);

  const selected = new Set(tools);
  const available = new Set(catalog?.map(tool => tool.name));
  const choices = catalog ? [
    ...catalog.map(tool => ({ ...tool, category: categoryOf(tool.name) })),
    ...tools.filter(name => !available.has(name)).map(name => ({ name, description: t("当前 Agent 预设未提供"), category: 'unavailable' })),
  ] : [];
  const availableCategories: Array<{ id: string; label: QqLocaleKey }> = [
    { id: '', label: '全部' }, ...categories.filter(group => choices.some(tool => tool.category === group.id)),
  ];
  const term = query.trim().toLocaleLowerCase();
  const matching = choices.filter(tool => (!category || tool.category === category)
    && (!onlySelected || selected.has(tool.name))
    && `${tool.name} ${tool.description ?? ''}`.toLocaleLowerCase().includes(term));
  const visibleNames = matching.map(tool => tool.name);
  const ready = !disabled && catalog !== undefined;
  const exceedsLimit = tools.length > WORKBENCH_TOOL_LIMIT;

  const updateSelection = (names: readonly string[], checked: boolean): void => {
    setApplied(undefined);
    setTools(previous => {
      if (checked) return [...new Set([...previous, ...names.filter(name => available.has(name))])].sort();
      const removed = new Set(names);
      return previous.filter(name => !removed.has(name));
    });
  };
  const bulk = (names: readonly string[], selectLabel: string, removeLabel: string) => {
    const allSelected = names.every(name => selected.has(name));
    return h(Button, {
      type: 'button', size: 'sm', variant: 'ghost', disabled: !ready || names.length === 0,
      onClick: () => updateSelection(names, !allSelected),
    }, allSelected && names.length ? removeLabel : selectLabel);
  };
  const combinationButton = (combination: ToolCombination, origin: 'built-in' | 'personal') => {
    const key = `${origin}:${combination.id}`;
    return h(Button, {
      key, type: 'button', size: 'sm', variant: 'outline', disabled: !ready,
      title: t("{0} · {1} 项", combination.label, combination.tools.length),
      'aria-pressed': applied?.key === key,
      onClick: () => {
        const { tools, added, removed, skipped } = applyToolCombination(combination.tools, available, selected);
        setTools(tools);
        setApplied({ key, label: combination.label, added, removed, skipped });
      },
    }, combination.label);
  };
  const updateCombinations = (change: (previous: ToolCombination[]) => ToolCombination[]): boolean => {
    try {
      const storage = window.localStorage;
      const next = change(readToolCombinations(storage));
      writeToolCombinations(storage, next);
      setCombinations(next);
      setCombinationError('');
      return true;
    } catch {
      setCombinationError(t("本浏览器无法保存工具组合。"));
      return false;
    }
  };
  const closeCreate = (): void => {
    setCreating(false);
    setCombinationName('');
    setCombinationError('');
  };
  const saveCombination = (): void => {
    const label = combinationName.trim();
    if (!ready || !tools.length || exceedsLimit || !label) return;
    if (combinations.some(combination => combination.label === label)) {
      setCombinationError(t("已有同名组合。"));
      return;
    }
    const id = globalThis.crypto.randomUUID?.() ?? `u${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (updateCombinations(previous => [...previous, { id, label, tools }])) closeCreate();
  };

  return h(Modal, {
    open: true, title: t("自定义工具"), closeLabel: t("关闭工具选择"), onClose: onCancel,
    className: styles.dialog + ' imqw-tools-modal', contentClassName: 'imqw-tools-content',
    footer: h('div', { className: 'imqw-tools-footer' },
      h(Button, { type: 'button', size: 'sm', variant: 'ghost', onClick: onCancel }, t("取消")),
      h(Button, {
        type: 'button', size: 'sm', variant: 'primary',
        disabled: !ready || exceedsLimit || !permissions.some(option => option.value === permission),
        onClick: () => onConfirm(permission, tools),
      }, t("确认选择"))),
  }, h('div', { className: 'imqw-tools-editor' },
    h('div', { className: 'imqw-field' },
      h('span', null, t("权限上限")),
      h(QQSelect, { label: t("权限上限"), value: permission, options: permissions, disabled, onChange: setPermission }),
      h('p', { className: 'imqw-muted' }, t("当前 Session 的原生权限高于上限时，所选工具会暂停使用。"))),
    h('div', { className: 'imqw-tools-templates' },
      h('div', { className: 'imqw-actions' },
        h('span', { className: 'imqw-muted' }, t("内置模板")),
        ...BUILT_IN_TOOL_COMBINATIONS.map(combination => combinationButton({ ...combination, label: t(combination.label) }, 'built-in'))),
      h('section', { className: 'imqw-tools-combinations', 'aria-label': t("我的组合") },
        h('div', { className: 'imqw-tools-section-head' },
          h('strong', null, t("我的组合")),
          !creating ? h(Button, {
            type: 'button', size: 'sm', variant: 'outline', disabled,
            onClick: () => { setCombinationError(''); setCreating(true); },
          }, t("新建组合")) : null),
        combinations.length ? h('div', { className: 'imqw-actions imqw-combination-list' },
          ...combinations.map(combination => h('div', { className: 'imqw-tools-combination', key: combination.id },
            combinationButton(combination, 'personal'), h(Button, {
              type: 'button', size: 'sm', variant: 'ghost', disabled,
              'aria-label': t("删除组合 {0}", combination.label),
              onClick: () => {
                if (updateCombinations(previous => previous.filter(item => item.id !== combination.id))
                  && applied?.key === `personal:${combination.id}`) setApplied(undefined);
              },
            }, '×')))) : null,
        creating ? h('div', { className: 'imqw-tools-combination-input' },
          h(Input, {
            ref: nameInput,
            value: combinationName, maxLength: 64, placeholder: t("输入组合名称"), 'aria-label': t("组合名称"),
            disabled, onChange: event => { setCombinationName(event.currentTarget.value); setCombinationError(''); },
            onKeyDown: event => { if (event.key === 'Enter') { event.preventDefault(); saveCombination(); } },
          }),
          h(Button, { type: 'button', size: 'sm', variant: 'ghost', onClick: closeCreate }, t("取消新建")),
          h(Button, {
            type: 'button', size: 'sm', variant: 'primary',
            disabled: !ready || !tools.length || exceedsLimit || !combinationName.trim(), onClick: saveCombination,
          }, t("保存组合")),
          h('span', { className: 'imqw-muted imqw-tools-combination-hint' },
            tools.length ? t("保存下方已选的 {0} 项工具。", tools.length) : t("在下方勾选要保存的工具。"))) : null,
        combinationError ? h('p', { className: 'imqb-error', role: 'alert' }, combinationError) : null)),
    h('section', { className: 'imqw-tools-selected', 'aria-label': t("已选工具") },
      h('div', { className: 'imqw-tools-section-head' },
        h('strong', null, t("已选工具（{0}）", tools.length)),
        h(Button, {
          type: 'button', size: 'sm', variant: 'ghost', disabled: !ready || !tools.length,
          onClick: () => updateSelection(tools, false),
        }, t("清空选择"))),
      tools.length ? h('ul', { className: 'imqw-selected-list' }, ...tools.map(name => h('li', { key: name },
        h('code', null, name),
        catalog && !available.has(name) ? h('small', { className: 'imqw-muted' }, t("不可用")) : null,
        h(Button, {
          type: 'button', size: 'sm', variant: 'ghost', disabled: !ready,
          'aria-label': t("移除已选工具 {0}", name), onClick: () => updateSelection([name], false),
        }, '×')))) : h('p', { className: 'imqw-muted' }, t("尚未选择工具。")),
      applied ? h('div', { className: 'imqw-tool-changes', role: 'status', 'aria-label': t("组合变更") },
        h('p', null, t("已套用「{0}」", applied.label)),
        ...[{ label: t("新增"), names: applied.added }, { label: t("移除"), names: applied.removed },
          { label: t("跳过（当前不可用）"), names: applied.skipped }].filter(change => change.names.length)
          .map(change => h('p', { key: change.label, className: 'imqw-muted' },
            h('span', null, t("{0} {1} 项 ", change.label, change.names.length)), h('code', null, change.names.join('、'))))) : null),
    h('div', { className: 'imqw-tools-filters' },
      h(Input, {
        type: 'search', value: query, placeholder: t("搜索工具名称或描述"), 'aria-label': t("搜索工具"),
        'data-modal-autofocus': true, disabled, onChange: event => setQuery(event.currentTarget.value),
      }),
      h('label', { className: 'imqw-tool-check' }, h('input', {
        type: 'checkbox', checked: onlySelected, disabled, onChange: event => setOnlySelected(event.currentTarget.checked),
      }), t("仅看已选"))),
    catalog ? h('div', { className: 'imqw-tools-categories', role: 'group', 'aria-label': t("工具分类") },
      ...availableCategories.map(group => h(Button, {
          key: group.id, type: 'button', size: 'sm', variant: group.id === category ? 'outline' : 'ghost',
          'aria-pressed': group.id === category, disabled, onClick: () => setCategory(group.id),
        }, t(group.label)))) : null,
    catalog ? h('div', { className: 'imqw-tools-bulk' },
      bulk(visibleNames, t("全选当前筛选"), t("取消当前筛选的勾选"))) : null,
    error ? h('div', { className: 'imqw-actions' },
      h('p', { className: 'imqb-error', role: 'alert' }, error),
      h(Button, { type: 'button', size: 'sm', variant: 'outline', disabled, onClick: () => setAttempt(value => value + 1) }, t("重试"))) : null,
    !catalog && !error ? h('p', { className: 'imqw-muted', role: 'status' }, t("正在读取工具…")) : null,
    catalog && !matching.length ? h('p', { className: 'imqw-muted' }, t("没有匹配的工具。")) : null,
    matching.length ? h('div', { className: 'imqw-tool-list', role: 'region', 'aria-label': t("工具列表") },
      ...categories.map(group => {
        const entries = matching.filter(tool => tool.category === group.id);
        if (!entries.length) return null;
        const names = entries.map(tool => tool.name);
        return h('section', { key: group.id, 'aria-label': t(group.label), className: 'imqw-tool-group' },
          h('div', { className: 'imqw-tool-group-head' }, h('strong', null, t(group.label)),
            bulk(names, t("全选本组"), t("取消本组勾选"))),
          ...entries.map(({ name, description }) => h('label', { key: name, title: description, className: 'imqw-tool-check' },
            h('input', {
              type: 'checkbox', checked: selected.has(name), disabled: !ready, 'aria-label': name,
              onChange: event => updateSelection([name], event.currentTarget.checked),
            }),
            h('span', null, name, description ? h('small', null, description) : null))));
      })) : null,
    exceedsLimit ? h('p', { className: 'imqb-error', role: 'alert' }, t("最多可选 {0} 项工具。", WORKBENCH_TOOL_LIMIT)) : null,
    h('p', { className: 'imqw-muted' }, tools.length ? t("回到设置页保存后生效。") : t("保存空名单后，Session 无法调用工具。")),
  ));
}
