import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const runtime = await vi.hoisted(async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const host = createRequire(require.resolve('@deepseek-ai/dsh-client-ui-primitives'));
  const { JSDOM } = host('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement, HTMLIFrameElement: dom.window.HTMLIFrameElement,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true });
  return { dom };
});
import { act, createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QQAgentSettingsForm } from './qq-agent-settings-form.ts';
import { QQDefaultsSettings } from './qq-defaults-settings.ts';
import { QQPeerSettings } from './qq-peer-settings.ts';
import { testT } from './qq-locale.ts';
import { QQSessionStore, useQQSessionStore } from './qq-session-store.ts';
import { defaultPolicy } from '../policy/validation.ts';
import { QQ_EXTRA_PROMPT_MAX_CHARS } from '../shared/agent-settings.ts';

let root, container, sequence = 0;
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const tools = [
  { id: 'read', name: '读取文件', description: 'read files', category: 'file', constraint: 'read-path', available: true },
  { id: 'write', name: '修改文件', description: 'write files', category: 'file', constraint: 'write-path', available: true },
  { id: 'search', name: '搜索网页', description: 'search web', category: 'network', constraint: 'none', available: true },
];
const catalog = { loading: false, errors: [], presets: [{ id: 'minimal', name: '精简 Agent' }], models: { groups: [{ id: 'fixture', name: '测试提供方', models: [{ provider: 'fixture', model: 'model', name: '测试模型' }] }], failures: [], defaultModel: undefined } };
const selectors = {
  modelCatalog: async () => ({ ok: true, value: { groups: catalog.models.groups.map(group => ({ ...group, models: group.models.map(model => ({ id: model.model, name: model.name })) })), failures: [] } }),
  listAgentPresets: async () => ({ ok: true, value: { presets: catalog.presets } }),
};
function settings(change = {}) { return { preset: '', model: null, promptGroup: '', promptDirect: '', cwd: '', execution: { kind: 'native', permission: 'read-only' }, slashCommands: true, ...change }; }
function entry(change = {}) {
  return { key: `settings-${++sequence}`, appId: 'app', scope: 'group', peerId: 'peer', name: '测试群', alias: '', currentSessionId: 'current', sessions: [], members: [],
    policy: { ...defaultPolicy('custom', '/project'), nativeTools: true, receiveEnabled: true }, settings: settings(),
    recording: { version: 1, enabled: true, since: 1, retentionDays: 0 },
    lastActivity: 1, observedAllMessages: false, admitted: true, running: false, currentModel: null, currentPreset: null, nextPreset: null, deliveryState: null, ...change };
}
function setup(value = entry(), defaults = { version: 1, settings: settings() }) {
  const store = new QQSessionStore({ openSession: vi.fn() });
  store.accept({ conversations: [value], tools, ownerIds: [], defaults });
  return { store, value, perform: vi.spyOn(store, 'perform') };
}
function button(label) { const found = [...document.querySelectorAll('button')].find(item => item.textContent === label); if (!found) throw new Error(`Missing button ${label}`); return found; }
async function click(label) { await act(async () => button(label).click()); }
function field(label) { const found = document.querySelector(`[aria-label="${label}"]`); if (!found) throw new Error(`Missing field ${label}`); return found; }
async function edit(label, value) {
  const control = field(label);
  await act(async () => {
    const prototype = control.tagName === 'TEXTAREA' ? runtime.dom.window.HTMLTextAreaElement.prototype : runtime.dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, value);
    control.dispatchEvent(new runtime.dom.window.Event('input', { bubbles: true }));
  });
}
async function choose(label, name) {
  const trigger = container.querySelector(`[aria-label^="${label}："]`); if (!trigger) throw new Error(`Missing selector ${label}`);
  await act(async () => trigger.click());
  const option = [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent.includes(name));
  if (!option) throw new Error(`Missing option ${name}`);
  await act(async () => option.click());
}
async function toggle(label) {
  const checkbox = container.querySelector(`input[aria-label="${label}"]`) ?? [...container.querySelectorAll('label')].find(item => item.textContent === label)?.querySelector('input');
  if (!checkbox) throw new Error(`Missing toggle ${label}`);
  await act(async () => checkbox.click());
}
function peer(store, value) { return h(QQPeerSettings, { store, entry: value, tools, selectorSource: selectors, t: testT }); }
function snapshot(store, value, defaults = store.getSnapshot().directory.defaults) { return { snapshot: { conversations: [value], tools, ownerIds: [], defaults } }; }

describe('shared Agent settings draft form', () => {
  it.each([
    ['group', '群聊补充提示词', '私聊补充提示词', 'promptGroup'],
    ['c2c', '私聊补充提示词', '群聊补充提示词', 'promptDirect'],
  ])('allows the complete 80,000-character prompt for %s and leaves the other scope unchanged', async (chatScope, label, hiddenLabel, key) => {
    const changes = vi.fn();
    function Form() { const [draft, update] = useState(settings({ promptGroup: 'original group', promptDirect: 'original direct' })); return h(QQAgentSettingsForm, { settings: draft, tools, catalog, chatScope, onRefreshCatalog: vi.fn(), onChange: next => { update(next); changes(next); } }); }
    await act(async () => root.render(h(Form)));
    expect(field(label).maxLength).toBe(QQ_EXTRA_PROMPT_MAX_CHARS);
    expect(container.querySelector(`[aria-label="${hiddenLabel}"]`)).toBeNull();
    const tail = 'FINAL_INSTRUCTION';
    const prompt = 'x'.repeat(QQ_EXTRA_PROMPT_MAX_CHARS - tail.length) + tail;
    await edit(label, prompt);
    expect(field(label).value).toBe(prompt);
    expect(changes.mock.calls.at(-1)[0]).toEqual(settings({ promptGroup: 'original group', promptDirect: 'original direct', [key]: prompt }));
  });
  it('uses the same prompt limit for both global default fields', async () => {
    await act(async () => root.render(h(QQAgentSettingsForm, { settings: settings(), tools, catalog, scope: 'defaults', onRefreshCatalog: vi.fn(), onChange: vi.fn() })));
    expect(field('群聊补充提示词').maxLength).toBe(QQ_EXTRA_PROMPT_MAX_CHARS);
    expect(field('私聊补充提示词').maxLength).toBe(QQ_EXTRA_PROMPT_MAX_CHARS);
  });
  it('uses native permission labels, keeps the custom base visible, and updates stable tool IDs', async () => {
    const changes = vi.fn();
    function Form() { const [draft, update] = useState(settings()); return h(QQAgentSettingsForm, { settings: draft, tools, catalog, askTools: ['read'], onRefreshCatalog: vi.fn(), onChange: next => { update(next); changes(next); } }); }
    await act(async () => root.render(h(Form)));
    expect(container.querySelector('input[type="search"]')).toBeNull();
    expect(container.querySelector('select')).toBeNull();
    await choose('执行权限', '自定义工具');
    expect(container.querySelector('[aria-label^="自定义工具的基础权限：仅可查看"]')).not.toBeNull();
    expect(document.querySelector('input[type="search"]')).toBeNull();
    await click('选择工具（已选 0 项）');
    await edit('搜索工具', '文件'); await click('全选当前筛选');
    expect(changes.mock.calls.at(-1)[0].execution).toEqual({ kind: 'custom', permission: 'read-only', tools: ['read', 'write'] });
    expect(document.body.textContent).toContain('需额外审批');
    await click('完成选择');
    await choose('自定义工具的基础权限', '工作区内修改');
    expect(changes.mock.calls.at(-1)[0].execution.permission).toBe('workspace-write');
    await click('选择工具（已选 2 项）');
    await click('清空选择'); expect(changes.mock.calls.at(-1)[0].execution.tools).toEqual([]);
    await click('完成选择');
  });
  it('shows reasoning effort for the inherited default model and stores it at top level', async () => {
    const changes = vi.fn();
    const effortCatalog = { loading: false, errors: [], presets: [], models: { groups: [{ id: 'p', name: 'P', models: [
      { provider: 'p', model: 'm', name: 'M', description: undefined, efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' },
    ] }], failures: [], defaultModel: { provider: 'p', model: 'm' } } };
    function Form() { const [draft, update] = useState(settings({ model: null })); return h(QQAgentSettingsForm, { settings: draft, tools, catalog: effortCatalog, onRefreshCatalog: vi.fn(), onChange: next => { update(next); changes(next); } }); }
    await act(async () => root.render(h(Form)));
    // inherit mode (model null) still shows effort, seeded from the default model's defaultEffort
    expect(container.querySelector('[aria-label^="推理强度："]')).not.toBeNull();
    expect(container.querySelector('[aria-label^="推理强度："]').textContent).toContain('Low');
    await choose('推理强度', 'High');
    const selected = changes.mock.calls.at(-1)[0];
    expect(selected.model).toBeNull();
    expect(selected.reasoningEffort).toBe('high');
  });
  it('selects the actual Agent preset independently of model and permission', async () => {
    const changes = vi.fn();
    function Form() { const [draft, update] = useState(settings()); return h(QQAgentSettingsForm, { settings: draft, tools, catalog, onRefreshCatalog: vi.fn(), onChange: next => { update(next); changes(next); } }); }
    await act(async () => root.render(h(Form)));
    await choose('Agent 预设', '精简 Agent');
    await choose('模型', '测试提供方 / 测试模型');
    const selected = changes.mock.calls.at(-1)[0];
    expect(selected).toMatchObject({ preset: 'minimal', model: { provider: 'fixture', model: 'model' }, execution: { kind: 'native', permission: 'read-only' } });
    await choose('Agent 预设', 'DSH 默认');
    expect(changes.mock.calls.at(-1)[0].preset).toBe('');
    expect(changes.mock.calls.at(-1)[0].model).toEqual(selected.model);
  });
});

describe('peer settings persistence', () => {
  it('saves shared settings without a message-count field or creating a Session/turn', async () => {
    const { store, value, perform } = setup();
    perform.mockImplementation(async action => {
      const result = snapshot(store, { ...value, alias: action.alias, settings: action.settings, policy: { ...value.policy, version: 2 } });
      store.accept(result.snapshot);
      return result;
    });
    function LivePeer() { const state = useQQSessionStore(store); return peer(store, state.directory.conversations[0]); }
    await act(async () => root.render(h(LivePeer)));
    const tail = 'FINAL_SAVED_INSTRUCTION';
    const prompt = 'x'.repeat(QQ_EXTRA_PROMPT_MAX_CHARS - tail.length) + tail;
    await edit('QQ 备注', '新备注'); await edit('群聊补充提示词', prompt);
    await click('保存会话设置');
    expect(perform).toHaveBeenCalledExactlyOnceWith({ action: 'settings', key: value.key, expectedVersion: 1, alias: '新备注', receiveEnabled: true,
      settings: { ...value.settings, promptGroup: prompt } });
    expect(container.textContent).toContain('补充提示词立即生效');
    expect(container.textContent).toContain('Agent 预设与工作目录在下次新会话生效');
    expect(field('群聊补充提示词').value).toBe(prompt);
    expect(store.getSnapshot().overlay).toBeNull();
    // 记录默认全部保留：不再有"保留消息记录条数"输入，改为"清空消息记录"入口。
    expect(container.textContent).not.toContain('保留消息记录条数');
    expect(container.textContent).toContain('清空消息记录');
    expect(container.textContent).not.toContain('新建会话');
    expect(perform).toHaveBeenCalledTimes(1);
  });
  it('clears message records through a confirm-gated action', async () => {
    const { store, value, perform } = setup();
    perform.mockResolvedValue({ notice: '消息记录已清空。' });
    runtime.dom.window.confirm = () => true;
    await act(async () => root.render(peer(store, value)));
    await click('清空消息记录');
    expect(perform).toHaveBeenCalledExactlyOnceWith({ action: 'clear-records', key: value.key, expectedRecordingVersion: value.recording.version });
  });
  it('applies an execution-permission change directly without a legacy confirmation step', async () => {
    const { store, value, perform } = setup();
    perform.mockResolvedValue(snapshot(store, { ...value, policy: { ...value.policy, version: 3, nativeTools: true }, settings: { ...value.settings, execution: { kind: 'native', permission: 'danger-full-access' } } }));
    await act(async () => root.render(peer(store, value)));
    await choose('执行权限', '完全权限');
    expect(button('保存会话设置').disabled).toBe(false);
    expect(container.textContent).not.toContain('旧版资源限制');
    await click('保存会话设置');
    const action = perform.mock.calls[0][0];
    expect(action).toMatchObject({ action: 'settings', expectedVersion: 1, settings: { execution: { kind: 'native', permission: 'danger-full-access' } } });
    expect(action.confirmNativeTransition).toBeUndefined();
  });
  it('retains a dirty draft across remount and stops stale-version saves', async () => {
    const { store, value, perform } = setup();
    await act(async () => root.render(peer(store, value))); await edit('群聊补充提示词', 'local draft');
    await act(async () => root.unmount()); root = createRoot(container);
    const newer = { ...value, policy: { ...value.policy, version: 2 }, settings: { ...value.settings, promptGroup: 'remote' } };
    await act(async () => root.render(peer(store, newer)));
    expect(field('群聊补充提示词').value).toBe('local draft'); expect(button('保存会话设置').disabled).toBe(true);
    expect(container.textContent).toContain('设置已在其他位置更新'); expect(perform).not.toHaveBeenCalled();
    await click('放弃修改'); expect(field('群聊补充提示词').value).toBe('remote');
  });
  it('keeps an unconfirmed failed save draft and isolates late success from another peer', async () => {
    const { store, value, perform } = setup();
    let resolve; perform.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await act(async () => root.render(peer(store, value))); await edit('QQ 备注', 'peer one'); await click('保存会话设置');
    const other = entry({ alias: 'peer two' });
    await act(async () => root.render(peer(store, other)));
    await act(async () => resolve(snapshot(store, { ...value, alias: 'peer one', policy: { ...value.policy, version: 2 } })));
    expect(field('QQ 备注').value).toBe('peer two');
    expect([...container.querySelectorAll('[role="status"]')].some(item => item.textContent.startsWith('会话设置已保存。'))).toBe(false);
    perform.mockRejectedValueOnce(new Error('partial fixture error'));
    await edit('QQ 备注', 'retained peer two'); await click('保存会话设置');
    expect(container.textContent).toContain('partial fixture error');
    expect(field('QQ 备注').value).toBe('retained peer two');
  });
});

describe('global new-peer defaults', () => {
  it('saves guarded defaults through the directory API without a profile write', async () => {
    const { store, value, perform } = setup(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    perform.mockResolvedValue(snapshot(store, value, { version: 2, settings: settings({ promptGroup: 'new peers only' }) }));
    await act(async () => root.render(h(QQDefaultsSettings, { store, selectorSource: selectors, t: testT })));
    await edit('群聊补充提示词', 'new peers only'); await click('保存默认设置（即时生效）');
    expect(perform).toHaveBeenCalledExactlyOnceWith({ action: 'defaults', expectedVersion: 1, settings: settings({ promptGroup: 'new peers only' }) });
    expect(fetch).not.toHaveBeenCalled(); expect(store.conversation(value.key).settings.promptGroup).toBe('');
    expect(container.textContent).toContain('已接入的对话保持各自设置');
  });
  it('preserves a conflicting defaults draft, then reloads only after discard', async () => {
    const { store, value, perform } = setup();
    await act(async () => root.render(h(QQDefaultsSettings, { store, selectorSource: selectors, t: testT })));
    await edit('群聊补充提示词', '/local');
    await act(async () => store.accept(snapshot(store, value, { version: 2, settings: settings({ promptGroup: '/remote' }) }).snapshot));
    expect(field('群聊补充提示词').value).toBe('/local'); expect(button('保存默认设置（即时生效）').disabled).toBe(true);
    expect(perform).not.toHaveBeenCalled(); await click('放弃默认设置修改'); expect(field('群聊补充提示词').value).toBe('/remote');
  });
});
