import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BindPanelBody } from './bind-page.ts';
import { QQAccountOwners } from './conversation-panel.ts';
import { QQSessionStore } from './qq-session-store.ts';

afterEach(() => vi.unstubAllGlobals());
describe('QQ account controls', () => {
  it('renders the pairing claim panel for owners with a generate button and hint', () => {
    const store = new QQSessionStore({ openSession: () => {} });
    const markup = renderToStaticMarkup(h(QQAccountOwners, { store }));
    expect(markup).toContain('斜杠命令超管');
    expect(markup).toContain('添加');
    expect(markup).toContain('直接给机器人发送这个码');
    expect(markup).not.toContain('/claim');
    expect(markup).not.toContain('每行一个'); // 旧的 openid 手填 textarea 已移除
  });
  it('explains slash-command superadmin authority without openid text field', () => {
    const store = new QQSessionStore({ openSession: () => {} });
    const markup = renderToStaticMarkup(h(QQAccountOwners, { store }));
    expect(markup).toContain('不开放工具');
    expect(markup).not.toContain('<textarea');
  });
  it('preserves direct credential and unbind entry points without performing either action', () => {
    const fetch = vi.fn(() => { throw new Error('render must not request account mutations'); });
    vi.stubGlobal('fetch', fetch);
    const markup = renderToStaticMarkup(h(BindPanelBody, { state: { phase: 'bound', appId: 'fixture-app' }, recheck: () => {} }));
    expect(markup).toContain('更换凭据');
    expect(markup).toContain('解绑');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('labels a binding status read retry as a read', () => {
    const markup = renderToStaticMarkup(h(BindPanelBody, { state: null, error: '读取失败', recheck: () => {} }));
    expect(markup).toContain('重试读取绑定状态');
  });
});
