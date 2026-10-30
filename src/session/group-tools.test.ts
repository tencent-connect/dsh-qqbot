import { describe, it, expect, vi } from 'vitest';
import { applyGroupToolAllow, resolveGroupToolAllow } from './group-tools.ts';
import type { ToolScopeLike } from './types.ts';

describe('resolveGroupToolAllow', () => {
  it('私聊不收敛（undefined）', () => {
    expect(resolveGroupToolAllow('c2c', ['bash'])).toBeUndefined();
  });

  it('群聊但名单为空：不收敛，保持原行为', () => {
    expect(resolveGroupToolAllow('group', [])).toBeUndefined();
    expect(resolveGroupToolAllow('group', undefined)).toBeUndefined();
  });

  it('全是空白的名单视同为空', () => {
    expect(resolveGroupToolAllow('group', ['', '   '])).toBeUndefined();
  });

  it('去空白、去重，保持首次出现顺序', () => {
    expect(resolveGroupToolAllow('group', [' web_search ', 'bash', 'web_search', 'bash'])).toEqual([
      'web_search',
      'bash',
    ]);
  });
});

describe('applyGroupToolAllow', () => {
  it('把名单交给 ctx.tools.restrict', () => {
    const restrict = vi.fn();
    const ctx = { tools: { restrict } as ToolScopeLike };
    const onWarn = vi.fn();
    expect(applyGroupToolAllow(ctx, ['web_search'], onWarn)).toBe(true);
    expect(restrict).toHaveBeenCalledWith({ allow: ['web_search'] });
    expect(onWarn).not.toHaveBeenCalled();
  });

  it('宿主没有 ctx.tools：告警但不抛，返回 false', () => {
    const onWarn = vi.fn();
    expect(applyGroupToolAllow({}, ['web_search'], onWarn)).toBe(false);
    expect(applyGroupToolAllow(undefined, ['web_search'], onWarn)).toBe(false);
    expect(onWarn).toHaveBeenCalledTimes(2);
    expect(String(onWarn.mock.calls[0]?.[0])).toContain('ctx.tools');
  });

  it('restrict 抛错：告警并返回 false，不把会话带崩', () => {
    const onWarn = vi.fn();
    const ctx = {
      tools: {
        restrict: () => {
          throw new Error('scope disposed');
        },
      } as ToolScopeLike,
    };
    expect(applyGroupToolAllow(ctx, ['web_search'], onWarn)).toBe(false);
    expect(String(onWarn.mock.calls[0]?.[0])).toContain('scope disposed');
  });
});
