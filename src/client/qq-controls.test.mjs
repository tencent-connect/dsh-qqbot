import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QQSelect, qqWorkspaceTitle } from './qq-controls.ts';

describe('QQ shared host controls', () => {
  it('preserves a missing saved selection visibly without replacing its value', () => {
    const markup = renderToStaticMarkup(h(QQSelect, { label: '权限', value: 'removed-setting', options: [{ value: 'read-only', label: '只读' }], onChange: () => { throw new Error('render must not change the draft'); } }));
    expect(markup).toContain('removed-setting（当前值不可用）');
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).not.toContain('<select');
  });
  it('shows a supplied unavailable label and disables a pending selector', () => {
    const markup = renderToStaticMarkup(h(QQSelect, { label: '模型', value: 'saved', options: [{ value: 'saved', label: '已移除模型（不可用）', disabled: true }], disabled: true, onChange: () => {} }));
    expect(markup).toContain('已移除模型（不可用）');
    expect(markup).toContain('disabled=""');
  });
  it('uses the public default workspace title rule while preserving custom titles', () => {
    expect(qqWorkspaceTitle('default-workspace', '/path/default-workspace', '默认工作区')).toBe('默认工作区');
    expect(qqWorkspaceTitle('default-workspace', '/path/default-workspace', 'Default workspace')).toBe('Default workspace');
    expect(qqWorkspaceTitle('我的项目', '/path/project', '默认工作区')).toBe('我的项目');
  });
});
