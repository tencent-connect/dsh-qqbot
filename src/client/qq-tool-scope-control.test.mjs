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
  return { require };
});
import { readFileSync } from 'node:fs';
import { act, createElement as h, useSyncExternalStore } from 'react';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives';
import { createRoot } from 'react-dom/client';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
import { createQQPermissionControl, installQQToolScopeControl } from './qq-tool-scope-control.ts';
import { QQSessionStore } from './qq-session-store.ts';
import { defaultQQAgentSettings } from '../shared/agent-settings.ts';
import { defaultPolicy } from '../policy/validation.ts';

function source(initial) {
  let state = initial;
  const listeners = new Set();
  return { getSnapshot: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    set(value) { state = value; for (const fn of listeners) fn(); }, size: () => listeners.size };
}

// Load the public browser artifact through its normal module-loader/apply protocol.
// Only its process-level catalog source is a fixture; Native and its risk dialog are stock code.
function stockPermissionEntry() {
  let exports, captured;
  const disposers = [], dictionaries = {};
  const dependencies = { react: React, 'react/jsx-runtime': jsxRuntime,
    '@deepseek-ai/dsh-client-ui-primitives': primitives, '@deepseek-ai/dsh-client-store': { createSnapshotStore: source } };
  window.__ModuleLoader__ = { load: ({ factory }) => { exports = factory(name => {
    if (!(name in dependencies)) throw new Error(`Unexpected public browser dependency ${name}`);
    return dependencies[name];
  }); } };
  const path = runtime.require.resolve('@deepseek-ai/dsh-client-ui-permission-presets/client');
  Function('window', 'document', readFileSync(path, 'utf8'))(window, document);
  delete window.__ModuleLoader__;
  const originalSelect = vi.fn(async () => ({ ok: true, value: { matched: true } }));
  const commandUi = { dismiss: vi.fn(), decorate: () => () => {} };
  const connection = { generation: source(undefined) };
  const ctx = {
    get: name => name === 'commandUi' ? commandUi : connection,
    sessions: { binding: () => ({ session: { command: originalSelect } }) },
    remote: { $on: () => () => {} }, configForms: { describe: () => ({}) },
    locale: { register: (namespace, langs) => { dictionaries[namespace] = langs.zh; return () => {}; },
      bind: namespace => (key, params = {}) => Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), dictionaries[namespace]?.[key] ?? key) },
    effect: fn => { const stop = fn(); if (typeof stop === 'function') disposers.push(stop); return stop; },
    slots: { inject: (_name, fn) => fn(), register: (options, component) => { if (options.name === 'conversation.input.permission') captured = { options, component }; return () => {}; } },
  };
  exports.apply(ctx);
  return { ...captured, t: ctx.locale.bind('permission.access'), originalSelect,
    dispose: () => disposers.reverse().forEach(stop => stop()) };
}

const catalog = {
  options: [{ value: 'read-only', name: '仅可查看' }, { value: 'workspace-write', name: '工作区内修改' }, { value: 'danger-full-access', name: '完全权限' }],
  defaultOptions: [{ value: 'read-only', name: '仅可查看' }], defaultPreset: 'read-only',
};
let root, container, fixture, sequence = 0;
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); fixture = stockPermissionEntry(); });
afterEach(async () => { await act(async () => root.unmount()); fixture.dispose(); container.remove(); });
function setup({ custom = false, extra = false, Native = fixture.component } = {}) {
  const entry = { key: `permission-${++sequence}`, appId: 'app', scope: 'group', peerId: 'peer', name: 'QQ 群', alias: '', currentSessionId: 'current', sessions: [{ sessionId: 'old', startedAt: 1 }], members: [],
    policy: { ...defaultPolicy('custom', '/project'), nativeTools: !custom, receiveEnabled: true }, settings: { ...defaultQQAgentSettings(), execution: custom ? { kind: 'custom', permission: 'read-only', tools: ['read'] } : { kind: 'native', permission: 'read-only' } },
    recording: { version: 1, enabled: true, since: 1, retentionDays: 0 }, lastActivity: 1, observedAllMessages: false, admitted: true, running: false,
    currentPermission: 'read-only', currentModel: null, currentPreset: null, nextPreset: null, deliveryState: null };
  const store = new QQSessionStore({ openSession: vi.fn() });
  store.accept({ conversations: [entry], tools: [], ownerIds: [] });
  const injected = fixture.options.inject('current');
  injected.hooks.permissionCatalog.set({ value: extra ? { ...catalog, options: [...catalog.options, { value: 'host-review', name: 'Host 审查' }] } : catalog });
  const projections = source({ permissions: { currentValue: 'read-only' }, title: '原生标题' });
  const props = { sessionId: 'current', locked: false, t: fixture.t, select: injected.select,
    usePermissionCatalog: (selector, equal) => selector(useSyncExternalStore(injected.hooks.permissionCatalog.subscribe, injected.hooks.permissionCatalog.getSnapshot)),
    useProjection: (key, selector) => { const value = useSyncExternalStore(projections.subscribe, projections.getSnapshot)[key]; return selector ? selector(value) : value; } };
  const Control = createQQPermissionControl(store, Native);
  const perform = vi.spyOn(store, 'perform').mockImplementation(async action => {
    const previous = store.conversation(entry.key), patch = action.patch;
    const execution = { ...patch.toolScope, permission: patch.nativePermission ?? previous.currentPermission };
    const saved = { ...previous, currentPermission: patch.nativePermission ?? previous.currentPermission, policy: { ...previous.policy, version: previous.policy.version + 1 }, settings: { ...previous.settings, execution } };
    if (patch.nativePermission) projections.set({ ...projections.getSnapshot(), permissions: { currentValue: patch.nativePermission } });
    const snapshot = { conversations: [saved], tools: [], ownerIds: [] };
    store.accept(snapshot);
    return { snapshot };
  });
  return { store, entry, props, Control, perform, projections, catalogSource: injected.hooks.permissionCatalog };
}
function button(label) { const found = [...document.querySelectorAll('button')].find(item => item.textContent === label); if (!found) throw new Error(`Missing button ${label}`); return found; }
async function click(label) { await act(async () => button(label).click()); }
async function openMenu() { await act(async () => container.querySelector('button[aria-label^="访问模式"]').click()); }
async function pick(label) { await openMenu(); const item = [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === label); if (!item) throw new Error(`Missing option ${label}`); await act(async () => item.click()); }
const optionLabels = () => [...document.querySelectorAll('[role="menuitem"]')].map(item => item.textContent);

describe('QQ native permission menu extension', () => {
  it('uses the shared menu with four leading icons and one trigger, respecting lock props', async () => {
    const Native = vi.fn(props => h(fixture.component, props));
    const { props, Control } = setup({ Native });
    await act(async () => root.render(h(Control, { ...props, marker: 'preserved' })));
    expect(container.querySelectorAll('button[aria-label^="访问模式"]')).toHaveLength(1);
    expect(Native).not.toHaveBeenCalled();
    await openMenu();
    expect(optionLabels()).toEqual(['仅可查看', '工作区内修改', '完全权限', '自定义工具']);
    for (const item of document.querySelectorAll('[role="menuitem"]')) expect(item.firstElementChild.querySelector('svg')).not.toBeNull();
    await act(async () => root.render(h(Control, { ...props, locked: true })));
    expect(container.querySelector('button[aria-label^="访问模式"]').disabled).toBe(true);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it.each(['ordinary', 'old'])('leaves the real native menu and writer intact for %s sessions', async sessionId => {
    const { props, Control, perform } = setup({ custom: true });
    await act(async () => root.render(h(Control, { ...props, sessionId })));
    await openMenu(); expect(optionLabels()).toEqual(['仅可查看', '工作区内修改', '完全权限']);
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === '工作区内修改');
    await act(async () => item.click());
    expect(fixture.originalSelect).toHaveBeenCalledWith('/permission workspace-write'); expect(perform).not.toHaveBeenCalled();
  });

  it('selects custom locally, preserves native permission and opens QQ settings after the saved snapshot', async () => {
    const { props, Control, perform, store, entry } = setup();
    await act(async () => root.render(h(Control, props)));
    await pick('自定义工具');
    expect(perform).toHaveBeenCalledExactlyOnceWith({ action: 'peer-settings', key: entry.key, expectedVersion: 1, patch: { toolScope: { kind: 'custom', tools: [] } } });
    expect(container.textContent).toBe('自定义工具');
    expect(container.querySelector('.imqq-permissionIcon svg')).not.toBeNull();
    expect(store.conversation(entry.key).currentPermission).toBe('read-only');
    expect(store.getSnapshot().overlay).toMatchObject({ kind: 'drawer', target: { key: entry.key, tab: 'settings', sessionId: 'current' } });
    expect(fixture.originalSelect).not.toHaveBeenCalled();
  });

  it('leaves custom mode atomically even when the chosen native mode equals the actual native projection', async () => {
    const { props, Control, perform, entry, store } = setup({ custom: true });
    await act(async () => root.render(h(Control, props)));
    expect(container.textContent).toBe('自定义工具');
    await pick('仅可查看');
    expect(perform).toHaveBeenCalledExactlyOnceWith({ action: 'peer-settings', key: entry.key, expectedVersion: 1, patch: { nativePermission: 'read-only', expectedPermission: 'read-only', toolScope: { kind: 'native' } } });
    expect(store.conversation(entry.key).settings.execution.kind).toBe('native'); expect(container.textContent).toBe('仅可查看');
  });

  it('keeps the stock Full access risk confirmation before submitting the atomic QQ write', async () => {
    const { props, Control, perform, entry } = setup({ custom: true });
    await act(async () => root.render(h(Control, props)));
    await pick('完全权限');
    expect(perform).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('确认启用完全权限？');
    expect(button('启用完全权限').disabled).toBe(true);
    const acknowledge = document.querySelector('input[type="checkbox"]');
    await act(async () => acknowledge.click());
    await click('启用完全权限');
    expect(perform).toHaveBeenCalledExactlyOnceWith({ action: 'peer-settings', key: entry.key, expectedVersion: 1, patch: { nativePermission: 'danger-full-access', expectedPermission: 'read-only', toolScope: { kind: 'native' } } });
  });

  it('keeps the Auto review risk gate and native custom names when the catalog contains them', async () => {
    const { props, Control, catalogSource, perform } = setup({ custom: true });
    catalogSource.set({ value: { ...catalog, options: [{ value: 'read-only', name: '项目只读' }, ...catalog.options.slice(1), { value: 'auto', name: 'auto' }] } });
    await act(async () => root.render(h(Control, props)));
    await openMenu();
    expect(optionLabels()).toEqual(['项目只读', '工作区内修改', '完全权限', '自动审查EXP', '自定义工具']);
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === '自动审查EXP');
    await act(async () => item.click());
    expect(perform).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('确认启用自动审查（实验）？');
    expect(button('启用自动审查').disabled).toBe(true);
    await act(async () => document.querySelector('input[type="checkbox"]').click());
    await click('启用自动审查');
    expect(perform.mock.calls[0][0].patch.nativePermission).toBe('auto');
  });

  it('preserves extra host catalog modes and sends their real ID through nativePermission', async () => {
    const { props, Control, perform, entry } = setup({ custom: true, extra: true });
    await act(async () => root.render(h(Control, props)));
    await pick('Host 审查');
    expect(perform).toHaveBeenCalledExactlyOnceWith({ action: 'peer-settings', key: entry.key, expectedVersion: 1, patch: { nativePermission: 'host-review', expectedPermission: 'read-only', toolScope: { kind: 'native' } } });
  });

  it('shows a failed QQ write without claiming a mode change, and clears the error on a Session switch', async () => {
    const { props, Control, perform } = setup();
    perform.mockRejectedValueOnce(new Error('原生权限已变化'));
    await act(async () => root.render(h(Control, props)));
    await pick('自定义工具');
    expect(container.querySelector('[role="alert"]').textContent).toBe('原生权限已变化');
    expect(container.querySelector('button[aria-label^="访问模式"]').textContent).toBe('仅可查看');
    await act(async () => root.render(h(Control, { ...props, sessionId: 'ordinary' })));
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('does not open a stale QQ drawer when a pending custom selection settles after switching Sessions', async () => {
    const { props, Control, perform, store, entry } = setup();
    let resolve;
    perform.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await act(async () => root.render(h(Control, props)));
    await pick('自定义工具');
    await act(async () => root.render(h(Control, { ...props, sessionId: 'ordinary' })));
    const saved = { ...entry, settings: { ...entry.settings, execution: { kind: 'custom', permission: 'read-only', tools: [] } } };
    await act(async () => resolve({ snapshot: { conversations: [saved], tools: [], ownerIds: [] } }));
    expect(store.getSnapshot().overlay).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('falls back to native when catalog is absent or incompatible and recovers through the original hook', async () => {
    const { props, Control, catalogSource } = setup({ custom: true });
    catalogSource.set({ value: null });
    await act(async () => root.render(h(Control, props))); expect(container.textContent).toBe('');
    await act(async () => catalogSource.set({ value: { options: catalog.options } }));
    await openMenu(); expect(optionLabels()).toEqual(['仅可查看', '工作区内修改', '完全权限']);
    await act(async () => catalogSource.set({ value: catalog }));
    expect(container.querySelector('button[aria-label^="访问模式"]').textContent).toBe('自定义工具');
  });

  it('refreshes native changes once without altering the actual projection or losing the custom icon', async () => {
    const { props, Control, store, projections, entry } = setup({ custom: true });
    const refresh = vi.spyOn(store, 'refresh');
    await act(async () => root.render(h(Control, props)));
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => root.render(h(Control, props)));
    expect(projections.getSnapshot()).toEqual({ permissions: { currentValue: 'read-only' }, title: '原生标题' });
    await act(async () => projections.set({ ...projections.getSnapshot(), permissions: { currentValue: 'workspace-write' }, title: '原生标题' }));
    expect(refresh).toHaveBeenCalledTimes(1); expect(store.conversation(entry.key).settings.execution.tools).toEqual(['read']);
    expect(container.querySelector('button[aria-label^="访问模式"]').textContent).toBe('自定义工具');
    expect(container.querySelector('.imqq-permissionIcon svg')).not.toBeNull();
  });
});

function slotFixture() {
  const core = new SlotCore();
  core.register({ name: 'root', children: { 'conversation.input.permission': { kind: 'single', scope: 'session' } } }, () => null);
  const store = new QQSessionStore({ openSession: vi.fn() });
  const addNative = (change = {}) => core.register({ name: 'conversation.input.permission', locale: 'permission.access', inject: fixture.options.inject, ...change }, fixture.component);
  return { core, store, addNative };
}
const flush = () => act(async () => { await Promise.resolve(); });
describe('QQ native permission entry lifecycle', () => {
  it('handles late native registration, preserves inject/locale, ignores itself and releases on native removal', async () => {
    const { core, store, addNative } = slotFixture();
    const stop = installQQToolScopeControl({ slots: core, store });
    expect(core.entries('conversation.input.permission')).toHaveLength(0);
    const removeNative = addNative(); await flush();
    expect(core.entries('conversation.input.permission')).toHaveLength(2);
    const winner = core.entriesOfSlot('conversation.input.permission')[0];
    expect(winner.locale).toBe('permission.access'); expect(winner.inject).toBe(fixture.options.inject); expect(winner.options.priority).toBe(-30);
    await flush(); expect(core.entries('conversation.input.permission')).toHaveLength(2);
    removeNative(); await flush(); expect(core.entries('conversation.input.permission')).toHaveLength(0);
    const removeAgain = addNative(); await flush(); expect(core.entries('conversation.input.permission')).toHaveLength(2);
    stop(); await flush(); expect(core.entries('conversation.input.permission')).toHaveLength(1);
    removeAgain();
  });

  it('yields to competing plugin winners and resumes only after their removal', async () => {
    const { core, store, addNative } = slotFixture(); const removeNative = addNative();
    const stop = installQQToolScopeControl({ slots: core, store }); await flush();
    const Other = () => null;
    const removeOther = core.register({ name: 'conversation.input.permission', priority: -10 }, Other); await flush();
    expect(core.entries('conversation.input.permission')).toHaveLength(2);
    expect(core.entriesOfSlot('conversation.input.permission')[0].component).toBe(Other);
    removeOther(); await flush(); expect(core.entries('conversation.input.permission')).toHaveLength(2);
    expect(core.entriesOfSlot('conversation.input.permission')[0].options.priority).toBe(-30);
    stop(); removeNative();
  });

  it('does not capture a mismatched children protocol or two competing permission entries', async () => {
    const { core, store, addNative } = slotFixture();
    const removeNative = addNative();
    const removeOther = addNative({ priority: -10 });
    const stop = installQQToolScopeControl({ slots: core, store }); await flush();
    expect(core.entries('conversation.input.permission')).toHaveLength(2);
    removeOther(); await flush(); expect(core.entries('conversation.input.permission')).toHaveLength(2);
    stop(); removeNative();
    // The source guard rejects ownership-bearing entries before wrapping.
    const children = core.register({ name: 'conversation.input.permission', locale: 'permission.access', inject: fixture.options.inject, children: {} }, fixture.component);
    const stopChildren = installQQToolScopeControl({ slots: core, store }); await flush();
    expect(core.entries('conversation.input.permission')).toHaveLength(1);
    stopChildren(); children();
  });
});
