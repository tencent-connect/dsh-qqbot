import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
await vi.hoisted(async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const hostRequire = createRequire(require.resolve('@deepseek-ai/dsh-client-ui-primitives'));
  const { JSDOM } = hostRequire('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Node: dom.window.Node,
    Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLIFrameElement: dom.window.HTMLIFrameElement,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true });
});
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { QQOperationDialog } from './qq-operation-dialog.ts';
import { QQSessionStore } from './qq-session-store.ts';

let root, container;
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
function conversation(allowedPresets, selectablePresets) {
  return { key: 'group-operation', scope: 'group', peerId: 'group', name: '测试群', alias: '', currentSessionId: 'current', sessions: [], members: [],
    policy: { version: 1, allowedPresets }, workspaceId: 'workspace', currentPreset: 'standard', admitted: true, running: false, selectablePresets };
}
async function mount(entry) {
  const store = new QQSessionStore({ openSession: () => {} });
  store.accept({ conversations: [entry], tools: [], ownerIds: [] });
  const perform = vi.spyOn(store, 'perform').mockResolvedValue({ sessionId: 'new' });
  const target = { kind: 'newSession', key: entry.key, name: entry.name, sessionId: 'current', workspaceId: 'workspace', presetId: null, policyVersion: 1 };
  const selectorSource = { listAgentPresets: async () => ({ ok: true, value: { presets: [{ id: 'standard', name: '标准模式' }, { id: 'minimal', name: '精简模式' }] } }) };
  await act(async () => root.render(h(QQOperationDialog, { target, store, workspaces: [{ workspaceId: 'workspace', title: '项目', path: '/project', sessionIds: ['current'] }], selectorSource, defaultWorkspaceName: '默认工作区' })));
  await act(async () => document.querySelector('[aria-label^="新 QQ 会话的 Agent 预设"]').click());
  return perform;
}
function option(name) {
  const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(element => element.textContent.includes(name));
  if (!item) throw new Error(`Missing menu option ${name}`);
  return item;
}
function submit() { return Array.from(document.querySelectorAll('button')).find(element => element.type === 'submit'); }
describe('QQ preset operation authorization', () => {
  it('explains an empty workspace directory without presenting an empty popup', async () => {
    const entry = conversation(['standard'], ['standard']);
    const store = new QQSessionStore({ openSession: () => {} });
    store.accept({ conversations: [entry], tools: [], ownerIds: [] });
    const perform = vi.spyOn(store, 'perform');
    const target = { kind: 'newSession', key: entry.key, name: entry.name, sessionId: 'current', workspaceId: null, presetId: null, policyVersion: 1 };
    await act(async () => root.render(h(QQOperationDialog, { target, store, workspaces: [], selectorSource: { listAgentPresets: async () => ({ ok: true, value: { presets: [] } }) }, defaultWorkspaceName: '默认工作区' })));
    expect(document.body.textContent).toContain('可使用 QQ 临时目录，也可添加 DSH 工作区');
    // 空工作区时仍提供「添加工作区（选择文件夹…）」入口，对齐原生 picker。
    await act(async () => document.querySelector('[aria-haspopup="menu"]').click());
    expect(option('＋ 添加工作区（选择文件夹…）').disabled).toBe(false);
    expect(submit().disabled).toBe(true);
    expect(perform).not.toHaveBeenCalled();
  });
  it('disables unauthorized catalog entries and submits only a permitted selection', async () => {
    const perform = await mount(conversation(['standard'], ['standard']));
    expect(option('精简模式').disabled).toBe(true);
    await act(async () => option('精简模式').click());
    expect(submit().disabled).toBe(true);
    await act(async () => option('标准模式').click());
    await act(async () => submit().click());
    expect(perform).toHaveBeenCalledWith({ action: 'create-session', key: 'group-operation', operationId: expect.any(String), expectedCurrentSessionId: 'current', expectedPolicyVersion: 1, workspaceId: 'workspace', presetId: 'standard' });
  });
  it('treats an empty policy allowlist as unrestricted (all presets selectable)', async () => {
    await mount(conversation([], []));
    expect(option('标准模式').disabled).toBe(false);
    expect(option('精简模式').disabled).toBe(false);
  });
  it('keeps an explicit allowlist usable with a legacy snapshot', async () => {
    await mount(conversation(['standard']));
    expect(option('标准模式').disabled).toBe(false);
    expect(option('精简模式').disabled).toBe(true);
  });
  it('treats an empty allowlist without selectablePresets as unrestricted', async () => {
    await mount(conversation([]));
    expect(document.body.textContent).not.toContain('请刷新 QQ 目录后重试');
    expect(option('标准模式').disabled).toBe(false);
    expect(option('精简模式').disabled).toBe(false);
  });
});

describe('unified new-session operation', () => {
  const selectorSource = { listAgentPresets: async () => ({ ok: true, value: { presets: [{ id: 'standard', name: '标准模式' }] } }) };
  const workspaces = [{ workspaceId: 'workspace', title: '项目', path: '/project', sessionIds: ['current'] }];
  it('submits the QQ default directory when no DSH workspace exists', async () => {
    const entry = conversation(['standard'], ['standard']); delete entry.workspaceId;
    const store = new QQSessionStore({ openSession: vi.fn() });
    store.accept({ conversations: [entry], tools: [], ownerIds: [] }); store.openOperation(entry);
    const perform = vi.spyOn(store, 'perform').mockResolvedValue({ sessionId: 'new' });
    await act(async () => root.render(h(QQOperationDialog, { target: store.getSnapshot().overlay.target, store, workspaces: [], selectorSource, defaultWorkspaceName: '默认工作区' })));
    expect(submit().disabled).toBe(false);
    await act(async () => submit().click());
    expect(perform.mock.calls[0][0]).toMatchObject({ workspaceId: '', presetId: 'standard' });
  });
  it('uses public workspace membership for a legacy conversation without a stored workspace id', async () => {
    const entry = conversation(['standard'], ['standard']); delete entry.workspaceId;
    const store = new QQSessionStore({ openSession: vi.fn() });
    store.accept({ conversations: [entry], tools: [], ownerIds: [] }); store.openOperation(entry);
    const perform = vi.spyOn(store, 'perform').mockResolvedValue({ sessionId: 'new' });
    await act(async () => root.render(h(QQOperationDialog, { target: store.getSnapshot().overlay.target, store, workspaces, selectorSource, defaultWorkspaceName: '默认工作区' })));
    expect(submit().disabled).toBe(false);
    await act(async () => submit().click());
    expect(perform.mock.calls[0][0]).toMatchObject({ workspaceId: 'workspace', presetId: 'standard' });
  });
  async function currentForm(performResult) {
    const entry = conversation(['standard'], ['standard']); const store = new QQSessionStore({ openSession: vi.fn() });
    store.accept({ conversations: [entry], tools: [], ownerIds: [] }); store.openOperation(entry);
    const target = store.getSnapshot().overlay.target;
    const perform = vi.spyOn(store, 'perform'); if (performResult) perform.mockImplementation(performResult); else perform.mockResolvedValue({ sessionId: 'new' });
    await act(async () => root.render(h(QQOperationDialog, { target, store, workspaces, selectorSource, defaultWorkspaceName: '默认工作区' })));
    return { entry, store, perform };
  }
  it('submits an empty workspace id when the user switches from a workspace to the QQ default directory', async () => {
    const { perform } = await currentForm();
    await act(async () => document.querySelector('[aria-label^="工作区"]').click());
    await act(async () => option('不指定工作区（QQ 临时目录）').click());
    await act(async () => submit().click());
    expect(perform.mock.calls[0][0]).toMatchObject({ workspaceId: '', presetId: 'standard' });
  });
  it('defaults both selectors to the current values and collapses duplicate clicks', async () => {
    let resolve;
    const { perform } = await currentForm(() => new Promise(done => { resolve = done; }));
    expect(submit().disabled).toBe(false);
    await act(async () => { submit().click(); submit().click(); }); expect(perform).toHaveBeenCalledTimes(1);
    expect(perform.mock.calls[0][0]).toMatchObject({ action: 'create-session', expectedCurrentSessionId: 'current', expectedPolicyVersion: 1, workspaceId: 'workspace', presetId: 'standard' });
    await act(async () => resolve({ sessionId: 'new' }));
  });
  it('keeps the same operation identity when a failed request is retried', async () => {
    let calls = 0; const { perform } = await currentForm(async () => { if (++calls === 1) throw new Error('网络中断'); return { sessionId: 'new' }; });
    await act(async () => submit().click()); expect(document.body.textContent).toContain('网络中断');
    await act(async () => submit().click()); expect(perform).toHaveBeenCalledTimes(2);
    expect(perform.mock.calls[1][0]).toEqual(perform.mock.calls[0][0]);
  });
  it.each(['mapping', 'version'])('blocks an unsubmitted form when the %s changes', async kind => {
    const { store, entry, perform } = await currentForm();
    const next = kind === 'mapping' ? { ...entry, currentSessionId: 'elsewhere' } : { ...entry, policy: { ...entry.policy, version: 2 } };
    await act(async () => store.accept({ conversations: [next], tools: [], ownerIds: [] }));
    expect(submit().disabled).toBe(true); expect(document.body.textContent).toContain('当前 QQ 会话或策略已变化'); expect(perform).not.toHaveBeenCalled();
  });
});
