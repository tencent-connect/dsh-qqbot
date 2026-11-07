import { describe, it, expect } from 'vitest';
import { renderCmdInput } from './cmd-input.ts';

describe('renderCmdInput（QQ 官方 urlencode + 100 字符约束）', () => {
  it('text/show 均 urlencode，空格、中文、引号、&、+、% 不进入原始属性', () => {
    const rendered = renderCmdInput('/sessions new 1', '含空格 "A&B+C% 中文');
    expect(rendered).toContain('text="%2Fsessions%20new%201"');
    expect(rendered).toContain(encodeURIComponent('含空格 "A&B+C% 中文'));
    expect(rendered).not.toContain('show="在');
    expect(rendered).not.toContain('A&B+C%');
  });

  it('show 按编码后长度截断到 <=100，不切断 emoji（兼容官方长度口径歧义）', () => {
    const rendered = renderCmdInput('/permission read-only', '😀'.repeat(120));
    const match = /show="([^"]*)"/.exec(rendered);
    expect(match).not.toBeNull();
    expect(match![1]!.length).toBeLessThanOrEqual(100);
    const decoded = decodeURIComponent(match![1]!);
    expect(decoded.endsWith('…')).toBe(true);
  });

  it('text 超过 100 字符时退化为转义纯文本，不生成不可执行标签', () => {
    const rendered = renderCmdInput('x'.repeat(101), '<按钮>');
    expect(rendered).toBe('&lt;按钮&gt;');
    expect(rendered).not.toContain('<qqbot-cmd-input');
    // 原始值未超 100，但 urlencode 后超限时同样不得生成标签
    expect(renderCmdInput('中'.repeat(20), '按钮')).toBe('按钮');
  });
});
