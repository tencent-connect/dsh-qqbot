import { describe, expect, it, vi } from 'vitest';
import { applyToolCombination, readToolCombinations, writeToolCombinations } from './workbench-tool-combinations.ts';

describe('QQ tool combinations', () => {
  it('reads and updates the #6 browser storage entry', () => {
    const old = { id: 'u123', label: '旧组合', tools: ['read', 'mcp__fixture__search'] };
    const getItem = vi.fn(() => JSON.stringify([old, null, { id: 'bad', label: 1, tools: [] }]));
    const setItem = vi.fn();
    const storage = { getItem, setItem };

    const loaded = readToolCombinations(storage);
    expect(loaded).toEqual([old]);
    expect(getItem).toHaveBeenCalledWith('im-qqbot/tool-presets/v1');
    const next = { id: 'u456', label: '新组合', tools: ['grep'] };
    writeToolCombinations(storage, [...loaded, next]);
    expect(setItem).toHaveBeenCalledWith('im-qqbot/tool-presets/v1', JSON.stringify([old, next]));
  });

  it('recovers from corrupt browser data and reports storage write failures', () => {
    expect(readToolCombinations({ getItem: () => 'garbled' })).toEqual([]);
    expect(readToolCombinations({ getItem: () => { throw new Error('unavailable'); } })).toEqual([]);
    expect(() => writeToolCombinations({ setItem: () => { throw new Error('unavailable'); } }, [])).toThrow();
  });

  it('applies exact names from the current catalog and reports skipped tools', () => {
    expect(applyToolCombination(
      ['read', 'grep', 'run_code', 'read', 'mcp__fixture__Search'],
      new Set(['read', 'grep', 'mcp__fixture__search']),
    )).toEqual({ tools: ['grep', 'read'], skipped: 2 });
  });
});
