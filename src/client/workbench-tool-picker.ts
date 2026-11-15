import { createElement as h, useEffect, useState, type ReactNode } from 'react';
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { WORKBENCH_TOOL_LIMIT, WORKBENCH_TOOLS_PATH, type WorkbenchToolChoice } from '../shared/workbench-agent-settings.ts';
import { fetchJson } from './http.ts';
import { QQSelect, type QQSelectOption } from './qq-select.ts';
import {
  BUILT_IN_TOOL_COMBINATIONS, applyToolCombination, readToolCombinations, writeToolCombinations, type ToolCombination,
} from './workbench-tool-combinations.ts';

const categories = [
  { id: 'file', label: '文件', names: ['read', 'read_image', 'write', 'edit'] },
  { id: 'search', label: '搜索', names: ['grep', 'glob', 'qqbot_group_history'] },
  { id: 'network', label: '联网', names: ['web_search', 'web_fetch', 'fetch', 'search'] },
  { id: 'execution', label: '命令与代码', names: ['bash', 'run_code', 'python', 'exec_command'] },
  { id: 'mcp', label: 'MCP', names: [] },
  { id: 'attachment', label: '附件与交付', names: ['qqbot_send_file', 'present'] },
  { id: 'other', label: '其他', names: [] },
  { id: 'unavailable', label: '当前不可用', names: [] },
] satisfies ReadonlyArray<{ id: string; label: string; names: readonly string[] }>;

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
  const [combinationName, setCombinationName] = useState('');
  const [combinationError, setCombinationError] = useState('');
  const [templateNotice, setTemplateNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setCatalog(undefined);
    setError('');
    void fetchJson<{ tools: WorkbenchToolChoice[] }>(`${WORKBENCH_TOOLS_PATH}?${new URLSearchParams({ preset })}`, {
      cache: 'no-store', signal: controller.signal,
    }).then(result => {
      if (!controller.signal.aborted) setCatalog(result.tools);
    }, cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '无法读取工具目录。');
    });
    return () => controller.abort();
  }, [preset, attempt]);

  const selected = new Set(tools);
  const available = new Set(catalog?.map(tool => tool.name));
  const choices = catalog ? [
    ...catalog.map(tool => ({ ...tool, category: categoryOf(tool.name) })),
    ...tools.filter(name => !available.has(name)).map(name => ({ name, description: '当前 Agent 预设未提供', category: 'unavailable' })),
  ] : [];
  const term = query.trim().toLocaleLowerCase();
  const matching = choices.filter(tool => (!category || tool.category === category)
    && (!onlySelected || selected.has(tool.name))
    && `${tool.name} ${tool.description ?? ''}`.toLocaleLowerCase().includes(term));
  const visibleNames = matching.map(tool => tool.name);
  const ready = !disabled && catalog !== undefined;
  const exceedsLimit = tools.length > WORKBENCH_TOOL_LIMIT;

  const updateSelection = (names: readonly string[], checked: boolean): void => {
    setTemplateNotice('');
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
  const apply = (combination: ToolCombination): void => {
    const next = applyToolCombination(combination.tools, available);
    setTools(next.tools);
    setTemplateNotice(next.skipped ? `已套用「${combination.label}」，跳过 ${next.skipped} 项当前不可用的工具。` : '');
  };
  const useCombination = (combination: ToolCombination) => h(Button, {
    key: combination.id, type: 'button', size: 'sm', variant: 'outline', disabled: !ready, onClick: () => apply(combination),
  }, combination.label);
  const updateCombinations = (change: (previous: ToolCombination[]) => ToolCombination[]): boolean => {
    try {
      const storage = window.localStorage;
      const next = change(readToolCombinations(storage));
      writeToolCombinations(storage, next);
      setCombinations(next);
      setCombinationError('');
      return true;
    } catch {
      setCombinationError('本浏览器无法保存工具组合。');
      return false;
    }
  };
  const saveCombination = (): void => {
    const label = combinationName.trim();
    if (!label) return;
    const id = globalThis.crypto.randomUUID?.() ?? `u${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (updateCombinations(previous => [...previous, { id, label, tools }])) setCombinationName('');
  };

  return h(Modal, {
    open: true, title: '自定义工具', closeLabel: '关闭工具选择', onClose: onCancel,
    className: 'imqw-tools-modal', contentClassName: 'imqw-tools-content',
    footer: h('div', { className: 'imqw-tools-footer' },
      h('span', { className: 'imqw-muted', role: 'status' }, `已选 ${tools.length} 项`),
      h(Button, { type: 'button', size: 'sm', variant: 'ghost', onClick: onCancel }, '取消'),
      h(Button, {
        type: 'button', size: 'sm', variant: 'primary',
        disabled: !ready || exceedsLimit || !permissions.some(option => option.value === permission),
        onClick: () => onConfirm(permission, tools),
      }, '确认选择')),
  }, h('div', { className: 'imqw-tools-editor' },
    h('div', { className: 'imqw-field' },
      h('span', null, '权限上限'),
      h(QQSelect, { label: '权限上限', value: permission, options: permissions, disabled, onChange: setPermission }),
      h('p', { className: 'imqw-muted' }, '当前 Session 的原生权限高于上限时，所选工具会暂停使用。')),
    h('div', { className: 'imqw-tools-templates' },
      h('div', { className: 'imqw-actions' },
        h('span', { className: 'imqw-muted' }, '内置模板'), ...BUILT_IN_TOOL_COMBINATIONS.map(useCombination)),
      h('details', { className: 'imqw-tools-combinations' },
        h('summary', null, `我的组合（${combinations.length}）`),
        combinations.length ? h('div', { className: 'imqw-actions' }, ...combinations.map(combination => h('div', {
          className: 'imqw-tools-combination', key: combination.id,
        }, useCombination(combination), h(Button, {
          type: 'button', size: 'sm', variant: 'ghost', disabled,
          'aria-label': `删除组合 ${combination.label}`,
          onClick: () => updateCombinations(previous => previous.filter(item => item.id !== combination.id)),
        }, '×')))) : null,
        h('div', { className: 'imqw-tools-combination-input' },
          h(Input, {
            value: combinationName, maxLength: 64, placeholder: '输入组合名称', 'aria-label': '组合名称',
            disabled, onChange: event => setCombinationName(event.currentTarget.value),
          }),
          h(Button, {
            type: 'button', size: 'sm', variant: 'outline',
            disabled: !ready || !tools.length || exceedsLimit || !combinationName.trim(), onClick: saveCombination,
          }, '存为组合')),
        combinationError ? h('p', { className: 'imqb-error', role: 'alert' }, combinationError) : null),
      templateNotice ? h('p', { className: 'imqw-muted', role: 'status' }, templateNotice) : null),
    h('div', { className: 'imqw-tools-filters' },
      h(Input, {
        type: 'search', value: query, placeholder: '搜索工具名称或描述', 'aria-label': '搜索工具',
        'data-modal-autofocus': true, disabled, onChange: event => setQuery(event.currentTarget.value),
      }),
      h('label', { className: 'imqw-tool-check' }, h('input', {
        type: 'checkbox', checked: onlySelected, disabled, onChange: event => setOnlySelected(event.currentTarget.checked),
      }), '仅看已选')),
    catalog ? h('div', { className: 'imqw-tools-categories', role: 'group', 'aria-label': '工具分类' },
      ...[{ id: '', label: '全部' }, ...categories.filter(group => choices.some(tool => tool.category === group.id))]
        .map(group => h(Button, {
          key: group.id, type: 'button', size: 'sm', variant: group.id === category ? 'outline' : 'ghost',
          'aria-pressed': group.id === category, disabled, onClick: () => setCategory(group.id),
        }, group.label))) : null,
    catalog ? h('div', { className: 'imqw-tools-bulk' },
      bulk(visibleNames, '全选当前筛选', '取消当前筛选的勾选'),
      h(Button, {
        type: 'button', size: 'sm', variant: 'ghost', disabled: !ready || !tools.length,
        onClick: () => updateSelection(tools, false),
      }, '清空选择')) : null,
    error ? h('div', { className: 'imqw-actions' },
      h('p', { className: 'imqb-error', role: 'alert' }, error),
      h(Button, { type: 'button', size: 'sm', variant: 'outline', disabled, onClick: () => setAttempt(value => value + 1) }, '重试')) : null,
    !catalog && !error ? h('p', { className: 'imqw-muted', role: 'status' }, '正在读取工具…') : null,
    catalog && !matching.length ? h('p', { className: 'imqw-muted' }, '没有匹配的工具。') : null,
    matching.length ? h('div', { className: 'imqw-tool-list', role: 'region', 'aria-label': '工具列表' },
      ...categories.map(group => {
        const entries = matching.filter(tool => tool.category === group.id);
        if (!entries.length) return null;
        const names = entries.map(tool => tool.name);
        return h('section', { key: group.id, 'aria-label': group.label, className: 'imqw-tool-group' },
          h('div', { className: 'imqw-tool-group-head' }, h('strong', null, group.label),
            bulk(names, '全选本组', '取消本组勾选')),
          ...entries.map(({ name, description }) => h('label', { key: name, title: description, className: 'imqw-tool-check' },
            h('input', {
              type: 'checkbox', checked: selected.has(name), disabled: !ready, 'aria-label': name,
              onChange: event => updateSelection([name], event.currentTarget.checked),
            }),
            h('span', null, name, description ? h('small', null, description) : null))));
      })) : null,
    exceedsLimit ? h('p', { className: 'imqb-error', role: 'alert' }, `最多可选 ${WORKBENCH_TOOL_LIMIT} 项工具。`) : null,
    h('p', { className: 'imqw-muted' }, tools.length ? '回到设置页保存后生效。' : '保存空名单后，Session 无法调用工具。'),
  ));
}
