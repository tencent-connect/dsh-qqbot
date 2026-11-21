/**
 * 组合框的纯逻辑（无 React / DOM 依赖，便于单测）。
 */

export interface ComboboxOption {
  value: string;
  /** 主展示文案（通常为 name） */
  label: string;
  /** 次展示（通常为 id 或说明） */
  hint?: string;
  /** 分组标题（如模型提供方名）；相邻同组选项只渲染一次标题 */
  group?: string;
  disabled?: boolean;
  /** 禁用后缀说明（如 preset broken） */
  disabledReason?: string;
}

/** 按输入过滤选项：label / value / hint 大小写不敏感包含匹配 */
export function filterComboboxOptions(options: readonly ComboboxOption[], query: string): ComboboxOption[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...options];
  return options.filter(option => `${option.label} ${option.value} ${option.hint ?? ''}`.toLowerCase().includes(q));
}

/** 高亮位移（循环、跳过禁用项）；无可选项返回 -1 */
export function moveHighlight(options: readonly ComboboxOption[], current: number, delta: 1 | -1): number {
  const enabled = options.flatMap((option, index) => (option.disabled === true ? [] : [index]));
  if (enabled.length === 0) return -1;
  if (current < 0) return delta === 1 ? enabled[0]! : enabled[enabled.length - 1]!;
  const position = enabled.indexOf(current);
  const next = position < 0 ? 0 : (position + delta + enabled.length) % enabled.length;
  return enabled[next]!;
}

/**
 * 展开时的可见行。
 *
 * `query === null` 表示本次展开用户尚未输入——显示全部选项（含「继承」空项），
 * 高亮定位当前值；只有主动输入后才按输入过滤。避免"选完值再次展开只剩该项"。
 */
export function comboboxRows(
  options: readonly ComboboxOption[],
  inheritLabel: string | undefined,
  query: string | null,
): ComboboxOption[] {
  const all: ComboboxOption[] = inheritLabel === undefined
    ? [...options]
    : [{ value: '', label: inheritLabel }, ...options];
  return query === null ? all : filterComboboxOptions(all, query);
}
