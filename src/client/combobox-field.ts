/**
 * 可输入 + 下拉建议的组合框（设置页的模型 / Agent 预设）。
 *
 * 与纯 select 的区别：宿主目录只是建议（catalog membership is advisory），
 * 任意 id 手输合法，因此输入值不受选项限制，下拉只负责快速选择。
 *
 * 交互：点击或输入展开；↑↓ 移动高亮（跳过禁用项、循环）；Enter / Tab 选中
 * 高亮项；Esc 或点击外部关闭；高亮行自动滚入视区。
 */
import {
  createElement,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Input } from '@deepseek-ai/dsh-client-ui-primitives';
import { comboboxRows, moveHighlight, type ComboboxOption } from './combobox-logic.ts';

/** 点击面板外部关闭（与宿主浮层一致的指针语义；不依赖宿主内部 hook 的版本） */
function useDismissOnOutsidePointer(
  root: RefObject<HTMLElement | null>,
  open: boolean,
  setOpen: (open: boolean) => void,
): void {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && root.current?.contains(event.target) !== true) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [root, open, setOpen]);
}

export type { ComboboxOption } from './combobox-logic.ts';
export { comboboxRows, filterComboboxOptions, moveHighlight } from './combobox-logic.ts';

export interface ComboboxFieldProps {
  id: string;
  label: string;
  value: string;
  options: readonly ComboboxOption[];
  placeholder: string;
  /** 空值选项文案（如「继承 DSH 默认」）；缺省则不提供空项 */
  inheritLabel?: string;
  loading?: boolean;
  disabled?: boolean;
  help?: ReactNode;
  /** 面板顶部提示（如候选加载失败），仅展开时可见 */
  panelNotice?: string;
  onChange: (value: string) => void;
}

export function ComboboxField({
  id,
  label,
  value,
  options,
  placeholder,
  inheritLabel,
  loading = false,
  disabled = false,
  help,
  panelNotice,
  onChange,
}: ComboboxFieldProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  /** 用户主动移动过高亮：Tab 才在本字段内结算，否则保持原生焦点前进 */
  const [moved, setMoved] = useState(false);
  /** 本次展开的过滤词；null = 尚未输入，显示全部选项（不按已填值过滤） */
  const [query, setQuery] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useDismissOnOutsidePointer(rootRef, open, setOpen);

  const rows = useMemo(() => comboboxRows(options, inheritLabel, query), [inheritLabel, options, query]);

  // 展开时定位到当前值（便于改选）；输入过滤后当前值不在列表则落回第一个可选项
  useEffect(() => {
    if (!open) {
      setActive(-1);
      setMoved(false);
      setQuery(null);
      return;
    }
    const current = rows.findIndex(row => row.value === value && row.disabled !== true);
    setActive(current >= 0 ? current : moveHighlight(rows, -1, 1));
  }, [open, rows, value]);

  // 虚拟高亮不移动焦点，浏览器不会自动滚动，这里补一次
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const select = useCallback((row: ComboboxOption): void => {
    if (row.disabled === true) return;
    onChange(row.value);
    setQuery(null);
    setOpen(false);
  }, [onChange]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setOpen(true);
        setMoved(true);
        setActive(current => moveHighlight(rows, current, 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setOpen(true);
        setMoved(true);
        setActive(current => moveHighlight(rows, current, -1));
        return;
      case 'Enter': {
        const row = rows[active];
        if (open && row !== undefined && row.disabled !== true) {
          event.preventDefault();
          select(row);
          return;
        }
        setOpen(false);
        return;
      }
      case 'Tab': {
        // 只有主动移动过高亮才在本字段结算；否则关闭面板并保持原生焦点前进
        const row = rows[active];
        if (open && moved && row !== undefined && row.disabled !== true) {
          event.preventDefault();
          select(row);
        } else if (open) {
          setOpen(false);
        }
        return;
      }
      case 'Escape':
        if (open) {
          event.preventDefault();
          setOpen(false);
        }
        return;
      default:
    }
  }, [active, moved, open, rows, select]);

  return createElement('div', { className: 'imqb-cfg-field' },
    createElement('label', { className: 'imqb-cfg-label', htmlFor: id }, label),
    createElement('div', { className: 'imqb-combo', ref: rootRef },
      createElement(Input, {
        id,
        value,
        placeholder,
        disabled,
        className: 'imqb-combo-input',
        autoComplete: 'off',
        role: 'combobox',
        'aria-expanded': open,
        'aria-controls': `${id}-listbox`,
        'aria-autocomplete': 'list',
        'aria-activedescendant': open && active >= 0 ? `${id}-opt-${active}` : undefined,
        onClick: () => setOpen(true),
        onChange: (event: { target: { value: string } }) => {
          onChange(event.target.value);
          setQuery(event.target.value);
          setOpen(true);
        },
        onKeyDown,
      }),
      open
        ? createElement('div', {
          className: 'imqb-combo-panel',
          id: `${id}-listbox`,
          role: 'listbox',
          ref: listRef,
        },
        panelNotice === undefined ? null : createElement('div', { className: 'imqb-combo-notice', role: 'status' }, panelNotice),
        loading
          ? createElement('div', { className: 'imqb-combo-empty' }, '加载中…')
          : rows.length === 0
            ? createElement('div', { className: 'imqb-combo-empty' }, '无可选项，可直接输入')
            : rows.map((row, index) => createElement(Fragment, { key: row.value === '' ? '\u0000inherit' : row.value },
              // 相邻同组只渲染一次标题；「继承」空项无 group，不会被标题打断
              row.group !== undefined && row.group !== '' && row.group !== rows[index - 1]?.group
                ? createElement('div', { className: 'imqb-combo-group', role: 'presentation' }, row.group)
                : null,
              createElement('div', {
                id: `${id}-opt-${index}`,
                role: 'option',
                'aria-selected': index === active,
                'data-active': index === active ? 'true' : undefined,
                className: [
                  'imqb-combo-option',
                  index === active ? 'imqb-combo-option--active' : '',
                  row.disabled === true ? 'imqb-combo-option--disabled' : '',
                ].filter(Boolean).join(' '),
                onMouseEnter: () => { setMoved(true); setActive(index); },
                onMouseDown: (event: { preventDefault(): void }) => event.preventDefault(),
                onClick: () => select(row),
              },
              createElement('span', { className: 'imqb-combo-option-main' },
                createElement('span', { className: 'imqb-combo-option-label' }, row.label),
                row.hint !== undefined && row.hint !== '' && row.hint !== row.label
                  ? createElement('span', { className: 'imqb-combo-option-hint' }, row.hint)
                  : null,
              ),
              row.disabled === true
                ? createElement('span', { className: 'imqb-combo-option-badge' }, row.disabledReason ?? '不可用')
                : row.value === value
                  ? createElement('span', { className: 'imqb-combo-option-check', 'aria-hidden': 'true' }, '✓')
                  : null,
              ),
            )),
        )
        : null,
    ),
    help === undefined ? null : createElement('p', { className: 'imqb-cfg-hint' }, help),
  );
}
