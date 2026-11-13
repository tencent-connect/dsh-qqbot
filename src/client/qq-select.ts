import { createElement as h, useEffect, useState, type ReactNode } from 'react';
import { Button, IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives';

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
