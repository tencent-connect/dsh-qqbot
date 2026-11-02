import { createElement as h, useEffect, useState, type ReactNode } from 'react';
import { Button, IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives';
import { workspaceDisplayTitle } from '@deepseek-ai/dsh-api-workspace-controller/default-workspace';

export interface QQSelectOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
}
export interface QQSelectProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly QQSelectOption[];
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly onOpen?: () => void;
}

/** Public host menu and button semantics, shared by all QQ settings selectors. */
export function QQSelect({ label, value, onChange, options, placeholder = '请选择', disabled = false, onOpen }: QQSelectProps): ReactNode {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const selected = options.find((option) => option.value === value);
  const missing = value !== '' && selected === undefined;
  const visible = selected?.label ?? (missing ? `${value}（当前值不可用）` : placeholder);
  const choices = missing ? [{ value, label: visible, disabled: true }, ...options] : options;
  return h(Menu, {
    open: open && !disabled, onClose: () => setOpen(false),
    portal: true, autoFocus: true, minWidthFromAnchor: true,
    className: 'imqq-selectAnchor', listClassName: 'imqq-selectMenu',
    selectedId: `option:${value}`,
    items: choices.length ? choices.map((option) => ({ id: `option:${option.value}`, disabled: option.disabled, label: h('span', { className: 'imqq-selectChoice' }, h('span', null, option.label), option.description ? h('span', { className: 'imqq-selectDescription' }, option.description) : null) })) : [{ id: 'empty', label: '暂无可选项', disabled: true }],
    onSelect: (id) => {
      const option = options.find((item) => `option:${item.value}` === id);
      if (disabled || option === undefined || option.disabled) return;
      onChange(option.value); setOpen(false);
    },
    anchor: h(Button, {
      variant: 'outline', size: 'sm', className: 'imqq-select', disabled,
      'aria-label': `${label}：${visible}`, 'aria-haspopup': 'menu', 'aria-expanded': open && !disabled,
      title: visible,
      onClick: () => { if (!open) onOpen?.(); setOpen((current) => !current); },
    }, h('span', { className: 'imqq-selectValue' }, visible), h(IconChevronDownOutlineRegular, { size: 14 })),
  });
}

/** Callers supply common t('workspace.defaultName') from the standard locale seat. */
export function qqWorkspaceTitle(title: string, path: string, localizedDefault: string): string {
  return workspaceDisplayTitle(title, localizedDefault) || path;
}

/** 工作区/工作目录选项来源（统一的 cwd 选择器共用）。 */
export interface WorkspaceCwdOption { workspaceId: string; title: string; path: string }
export interface WorkspaceCwdSelectProps {
  /** 当前值：工作区路径；空字符串表示"留空使用 QQ 默认工作目录"。 */
  value: string;
  /** 可选工作区（含 DSH 原生默认工作区，作为普通选项）。 */
  workspaces: ReadonlyArray<WorkspaceCwdOption>;
  /** "留空"时使用的 QQ 默认工作目录。 */
  defaultCwd?: string;
  /** DSH 默认工作区名（本地化）。 */
  defaultWorkspaceName?: string;
  disabled?: boolean;
  label?: string;
  /** 选择"+ 添加工作区（选择文件夹…)"时回调；未提供则不显示该项。 */
  onAddWorkspace?: () => void;
  /** 选中某工作区或"留空"时回调（path；""=留空）。 */
  onChange: (path: string) => void;
}
/** 统一的"工作目录"选择器：留空默认 → 各 DSH 工作区 → 添加工作区。三处（会话设置/新对话默认值/新建会话）共用。 */
export function WorkspaceCwdSelect({ value, workspaces, defaultCwd, defaultWorkspaceName = '默认工作区', disabled = false, label = '工作目录', onAddWorkspace, onChange }: WorkspaceCwdSelectProps): ReactNode {
  const ADD = '::add-workspace';
  const options: QQSelectOption[] = [
    { value: '', label: '不指定工作区（QQ 临时目录）', description: defaultCwd },
    ...workspaces.map(ws => ({ value: ws.path, label: qqWorkspaceTitle(ws.title, ws.path, defaultWorkspaceName), description: ws.path })),
    ...(onAddWorkspace ? [{ value: ADD, label: '＋ 添加工作区（选择文件夹…）' }] : []),
  ];
  const visible = value === '' || workspaces.some(ws => ws.path === value) ? value : '';
  return h('div', { className: 'imqc-field' },
    h('span', null, label),
    h(QQSelect, { label, value: visible, disabled, placeholder: '选择工作区', options, onChange: id => {
      if (id === ADD) { onAddWorkspace?.(); return; }
      onChange(id);
    } }));
}
