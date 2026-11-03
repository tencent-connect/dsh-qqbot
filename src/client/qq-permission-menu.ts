import { createElement as h, Fragment, useEffect, useState, type ReactNode } from 'react';
import {
  IconChevronDownOutlineRegular, IconSlidersTwoOutlineRegular, Menu, RiskConfirmation,
  PermissionIconAutoReviewRegular, PermissionIconFullAccessRegular, PermissionIconReadOnlyRegular, PermissionIconWorkspaceWriteRegular,
} from '@deepseek-ai/dsh-client-ui-primitives';
import type { PermissionCatalog } from '@deepseek-ai/dsh-permission-presets/client';
import type { PermissionSelectProps } from '@deepseek-ai/dsh-client-ui-permission-presets/client';

const glyphs = new Map<string, ReactNode>([
  ['read-only', h(PermissionIconReadOnlyRegular)], ['workspace-write', h(PermissionIconWorkspaceWriteRegular)],
  ['danger-full-access', h(PermissionIconFullAccessRegular)], ['auto', h(PermissionIconAutoReviewRegular)],
]);
const labels = [
  { value: 'read-only', name: 'Read Only', key: 'preset.readOnly' },
  { value: 'workspace-write', name: 'Workspace Write', key: 'preset.workspaceWrite' },
  { value: 'danger-full-access', name: 'Full access', key: 'preset.fullAccess' },
] satisfies ReadonlyArray<{ value: string; name: string; key: 'preset.readOnly' | 'preset.workspaceWrite' | 'preset.fullAccess' }>;

/** QQ owns the fourth option; the shared primitives own icons, menu behavior and risk confirmation. */
export function QQPermissionMenu({ catalog, currentValue, customValue, locked, select, t }: {
  catalog: PermissionCatalog; currentValue: string; customValue: string;
} & Pick<PermissionSelectProps, 'locked' | 'select' | 't'>): ReactNode {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<'danger-full-access' | 'auto' | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const options = [...catalog.options, { value: customValue, name: '自定义工具', description: '选择此 QQ 对话允许的工具，基础权限沿用当前原生设置。' }];
  const icon = (value: string): ReactNode => value === customValue ? h(IconSlidersTwoOutlineRegular) : glyphs.get(value);
  const label = (value: string, name: string): string => {
    if (value === 'auto') return t('auto.label');
    const builtin = labels.find(option => option.value === value);
    if (builtin && (name === value || name === builtin.name)) return t(builtin.key);
    return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) ? name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : name;
  };
  const value = pending !== null && options.some(option => option.value === pending) ? pending : currentValue;
  const current = options.find(option => option.value === value);
  const currentLabel = label(value, current?.name ?? value);
  const closeConfirmation = (): void => { setAcknowledged(false); setConfirmation(null); };
  useEffect(() => {
    if (locked || (confirmation !== null && !catalog.options.some(option => option.value === confirmation))) {
      setOpen(false); setAcknowledged(false); setConfirmation(null);
    }
  }, [locked, catalog, confirmation]);
  const submit = (id: string): void => {
    setPending(id);
    void select(id).catch(() => false).finally(() => setPending(null));
  };
  const choose = (id: string): void => {
    setOpen(false);
    if (locked || pending !== null || id === currentValue) return;
    if (id === 'danger-full-access' || id === 'auto') { setAcknowledged(false); setConfirmation(id); }
    else submit(id);
  };
  const automatic = confirmation === 'auto';
  return h(Fragment, null,
    h(Menu, { open, items: options.map(option => ({ id: option.value, icon: icon(option.value),
      label: option.value === 'auto' ? h('span', { className: 'imqq-permissionOption' }, label(option.value, option.name), h('span', { className: 'imqq-permissionBadge' }, t('auto.badge'))) : label(option.value, option.name) })),
      selectedId: value, onSelect: choose, onClose: () => setOpen(false), side: 'top', portal: true,
      anchor: h('button', { type: 'button', className: 'imqq-permissionTrigger', 'aria-label': t('mode', { name: currentLabel }),
        title: current?.value === 'auto' ? t('auto.description') : current?.description, disabled: locked || pending !== null || confirmation !== null, onClick: () => setOpen(!open) },
      icon(value) ? h('span', { className: 'imqq-permissionIcon', 'aria-hidden': true }, icon(value)) : null,
      h('span', { className: 'imqq-permissionLabel' }, currentLabel),
      h('span', { className: 'imqq-permissionChevron', 'data-open': open || undefined, 'aria-hidden': true }, h(IconChevronDownOutlineRegular))) }),
    confirmation === null ? null : h(RiskConfirmation, { open: true,
      title: t(automatic ? 'auto.confirm.title' : 'confirm.title'), description: t(automatic ? 'auto.confirm.description' : 'confirm.description'),
      acknowledgeLabel: t(automatic ? 'auto.confirm.acknowledge' : 'confirm.acknowledge'), confirmLabel: t(automatic ? 'auto.confirm.enable' : 'confirm.enable'),
      cancelLabel: t('confirm.cancel'), closeLabel: t('close'), acknowledged, disabled: locked, onAcknowledgedChange: setAcknowledged,
      onCancel: closeConfirmation, onConfirm: () => { if (acknowledged && !locked) { const id = confirmation; closeConfirmation(); submit(id); } } }));
}
