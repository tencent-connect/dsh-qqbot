import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BindPanelBody } from './bind-page.ts';
import { QQAccountOwners } from './conversation-panel.ts';
import { testT } from './qq-locale.ts';
import { QQSessionStore } from './qq-session-store.ts';

afterEach(() => vi.unstubAllGlobals());
describe('QQ account controls', () => {
  it('renders the pairing claim panel for owners with a generate button and hint', () => {
    const store = new QQSessionStore({ openSession: () => {} });
    const markup = renderToStaticMarkup(h(QQAccountOwners, { store }));
    expect(markup).toContain('斜杠命令超管');
    expect(markup.match(/>斜杠命令超管</g)).toHaveLength(1);
    expect(markup).toContain('添加');
    expect(markup).toContain('直接给机器人发送这个码');
    expect(markup).not.toContain('/claim');
    expect(markup).not.toContain('每行一个'); // 旧的 openid 手填 textarea 已移除
  });
  it.each([undefined, testT])('explains the global QQ slash-command rule without changing button permissions (%s)', t => {
    const store = new QQSessionStore({ openSession: () => {} });
    const markup = renderToStaticMarkup(h(QQAccountOwners, { store, t }));
    expect(markup).toContain('所有 QQ 斜杠命令仅限此名单中的全局超管使用');
    expect(markup).toContain('不开放额外工具');
    expect(markup).toContain('已启用且获准接入');
    expect(markup).toContain('审批和提问按钮仍按原权限处理');
    expect(markup).toContain('DSH 网页斜杠命令不受此名单限制');
    expect(markup).not.toContain('<textarea');
  });
  it('renders registry-provided command names, aliases and superadmin scope in the global card', () => {
    const store = new QQSessionStore({ openSession: () => {} });
    store.accept({ conversations: [], tools: [], ownerIds: [], commands: [
      { name: 'registry-agent', aliases: ['ra'], description: '通用命令', category: 'agent', scope: 'owner' },
      { name: 'bot-me', aliases: ['whoami'], description: 'QQ 身份', category: 'qqbot', scope: 'owner' },
      { name: 'hidden', aliases: [], description: '隐藏命令', category: 'qqbot', scope: 'owner', hidden: true },
    ] });
    const markup = renderToStaticMarkup(h(QQAccountOwners, { store }));
    expect(markup).toContain('查看支持的斜杠命令（2 个）');
    expect(markup).toContain('/registry-agent');
    expect(markup).toContain('/ra');
    expect(markup).toContain('/bot-me');
    expect(markup).toContain('/whoami');
    expect(markup.match(/>仅超管</g)).toHaveLength(2);
    expect(markup).not.toContain('/hidden');
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
