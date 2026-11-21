import { describe, expect, it } from 'vitest';
import { comboboxRows, filterComboboxOptions, moveHighlight, type ComboboxOption } from './combobox-logic.ts';

const OPTIONS: ComboboxOption[] = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'pi-ai', label: 'Pi AI', disabled: true },
  { value: 'other', label: 'Other', hint: 'third-party' },
];

describe('combobox helpers', () => {
  it('空查询返回全部；查询按 label/value/hint 匹配；无命中返回空', () => {
    expect(filterComboboxOptions(OPTIONS, '')).toHaveLength(3);
    expect(filterComboboxOptions(OPTIONS, '  ')).toHaveLength(3);
    expect(filterComboboxOptions(OPTIONS, 'pi')).toEqual([OPTIONS[1]]);
    expect(filterComboboxOptions(OPTIONS, 'DEEP')).toEqual([OPTIONS[0]]);
    expect(filterComboboxOptions(OPTIONS, 'third')).toEqual([OPTIONS[2]]);
    expect(filterComboboxOptions(OPTIONS, 'nope')).toEqual([]);
  });

  it('高亮移动循环并跳过禁用项', () => {
    expect(moveHighlight(OPTIONS, -1, 1)).toBe(0);
    expect(moveHighlight(OPTIONS, 0, 1)).toBe(2);
    expect(moveHighlight(OPTIONS, 2, 1)).toBe(0);
    expect(moveHighlight(OPTIONS, 0, -1)).toBe(2);
    expect(moveHighlight(OPTIONS, 2, -1)).toBe(0);
  });

  it('全部禁用或空列表时无高亮', () => {
    expect(moveHighlight([{ value: 'x', label: 'x', disabled: true }], -1, 1)).toBe(-1);
    expect(moveHighlight([], -1, 1)).toBe(-1);
  });

  it('未输入时展开显示全部（含继承空项），不按已填值过滤', () => {
    const rows = comboboxRows(OPTIONS, '继承 DSH 默认', null);
    expect(rows.map(row => row.value)).toEqual(['', 'deepseek', 'pi-ai', 'other']);
  });

  it('主动输入后按输入过滤（空项不匹配时隐藏）', () => {
    expect(comboboxRows(OPTIONS, '继承 DSH 默认', 'deep').map(row => row.value)).toEqual(['deepseek']);
    expect(comboboxRows(OPTIONS, '继承 DSH 默认', '继承').map(row => row.value)).toEqual(['']);
    expect(comboboxRows(OPTIONS, undefined, null).map(row => row.value)).toEqual(['deepseek', 'pi-ai', 'other']);
  });

  it('过滤后保留分组信息，同组相邻顺序不变', () => {
    const grouped: ComboboxOption[] = [
      { value: 'a/1', label: 'DeepSeek-V4', group: 'DeepSeek 账号' },
      { value: 'a/2', label: 'DeepSeek-R1', group: 'DeepSeek 账号' },
      { value: 'b/1', label: 'DeepSeek-V4', group: 'DeepSeek' },
      { value: 'c/1', label: 'gemini-3-flash', group: 'QQAI' },
    ];
    expect(filterComboboxOptions(grouped, 'deepseek').map(row => row.group))
      .toEqual(['DeepSeek 账号', 'DeepSeek 账号', 'DeepSeek']);
    expect(comboboxRows(grouped, undefined, null).map(row => row.group))
      .toEqual(['DeepSeek 账号', 'DeepSeek 账号', 'DeepSeek', 'QQAI']);
  });
});
