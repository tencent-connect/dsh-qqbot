import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const runtime = await vi.hoisted(async () => {
  const { createRequire } = await import('node:module');
  const pluginRequire = createRequire(import.meta.url);
  const hostRequire = createRequire(pluginRequire.resolve('@deepseek-ai/dsh-client-ui-primitives'));
  const { JSDOM } = hostRequire('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Node: dom.window.Node,
    Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    HTMLIFrameElement: dom.window.HTMLIFrameElement, IS_REACT_ACT_ENVIRONMENT: true });
  return { dom };
});
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { QQConversationOverlay } from './conversation-panel.ts';
import { QQSessionStore } from './qq-session-store.ts';
import { testT } from './qq-locale.ts';

let root;
let container;
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function entry() {
  return { key: 'group-notice', appId: 'app', scope: 'group', peerId: 'group', name: '测试群', alias: '', currentSessionId: null, sessions: [], members: [],
    settings: { preset: '', model: null, prompt: '', cwd: '', execution: { kind: 'native', permission: 'read-only' } },
    policy: { version: 1, template: 'chat', name: '聊天', role: { description: '', tone: '', world: '', prompt: '' }, tools: {},
      resources: { readRoots: [], writeRoots: [], sendRoots: [], executionEnabled: false, sandbox: 'read-only', networkDomains: [], maxFiles: 1, maxFileMB: 10 },
      controllers: [], approvers: [], allowedModels: [], allowedPresets: [], allowedPermissions: ['read-only'], permission: 'read-only', cwd: '', requireMention: true,
      context: { mode: 'recent', maxMessages: 10, maxAgeMinutes: 10, maxChars: 4000, retentionDays: 7 } },
    lastActivity: 1, observedAllMessages: false, admitted: false, running: false, currentModel: null, currentPreset: null, nextPreset: null, deliveryState: null };
}
function admissionButton() {
  const button = Array.from(document.querySelectorAll('button')).find((element) => element.textContent === '启用此对话并加入访问名单');
  if (!button) throw new Error('missing admission button');
  return button;
}
function overlay(store) {
  return h(QQConversationOverlay, { store, t: testT, selectorSource: { modelCatalog: async () => ({ ok: true, value: { groups: [], failures: [] } }), listAgentPresets: async () => ({ ok: true, value: { presets: [] } }) }, defaultWorkspaceName: '默认工作区', useWorkspaces: (select) => select({ items: [] }) });
}
function previewStore(passiveReply) {
  const value = { ...entry(), admitted: true, currentSessionId: 'current-session', passiveReply };
  const store = new QQSessionStore({ openSession: () => {} });
  store.accept({ conversations: [value], tools: [], ownerIds: [] });
  store.previewAnswer(value.currentSessionId, 'answer-message', '最终回答');
  return { store, value };
}
function sendButton(label) {
  const button = Array.from(document.querySelectorAll('button')).find((element) => element.textContent === label);
  if (!button) throw new Error(`missing send button: ${label}`);
  return button;
}
describe('QQ drawer action feedback', () => {
  it('shows the actual saved-but-reload-pending notice and clears it for the next local action', async () => {
    const value = entry(); const store = new QQSessionStore({ openSession: () => {} });
    store.accept({ conversations: [value], tools: [], ownerIds: [] }); store.openDrawer(value);
    const notice = '准入规则已保存；等待连接重载后开始接收 QQ 消息。';
    const perform = vi.spyOn(store, 'perform').mockResolvedValueOnce({ notice }).mockResolvedValueOnce({});
    await act(async () => root.render(h(QQConversationOverlay, { store, t: testT, selectorSource: { modelCatalog: async () => ({ ok: true, value: { groups: [], failures: [] } }), listAgentPresets: async () => ({ ok: true, value: { presets: [] } }) }, defaultWorkspaceName: '默认工作区', useWorkspaces: (select) => select({ items: [] }) })));
    await act(async () => admissionButton().click());
    expect(perform).toHaveBeenCalledWith({ action: 'admit', key: value.key, enabled: true });
    expect(Array.from(document.querySelectorAll('[role="status"]')).some((element) => element.textContent === notice)).toBe(true);
    expect(document.body.textContent).not.toContain('网关已生效');
    await act(async () => admissionButton().click());
    expect(document.body.textContent).not.toContain(notice);
    expect(admissionButton().disabled).toBe(false);
  });
});
describe('QQ explicit send feedback', () => {
  it('updates an open preview at the deadline without a directory poll or a send request', async () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { store } = previewStore({ expiresAt: 102_500 });
    const directory = store.getSnapshot().directory;
    await act(async () => root.render(overlay(store)));
    expect(document.body.textContent).toContain('被动回复窗口剩余 0 分 3 秒');
    expect(sendButton('确认发送到 QQ').disabled).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(document.body.textContent).toContain('被动回复窗口剩余 0 分 1 秒');
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(document.body.textContent).toContain('被动回复窗口已过期');
    expect(document.body.textContent).toContain('是否允许取决于机器人权限');
    expect(sendButton('尝试主动发送到 QQ').disabled).toBe(false);
    expect(store.getSnapshot().directory).toBe(directory);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not infer a live or expired window from an older directory snapshot', async () => {
    const { store } = previewStore(undefined);
    await act(async () => root.render(overlay(store)));
    expect(document.body.textContent).toContain('被动回复窗口状态未知');
    expect(document.body.textContent).not.toContain('被动回复窗口剩余');
    expect(document.body.textContent).not.toContain('被动回复窗口已过期');
    expect(sendButton('确认发送到 QQ').disabled).toBe(false);
  });
  it.each(['accepted', 'failed', 'unknown'])('keeps a submitted %s result locked and preserves the platform error', async (state) => {
    const { store, value } = previewStore({ expiresAt: null });
    const platformError = 'QQ 拒绝：not allowed to send active message（QQ 错误码 40034105；HTTP 400）';
    const delivery = { id: 'delivery', key: value.key, text: '最终回答', at: 1, updatedAt: 2, state,
      parts: [{ index: 0, state: state === 'accepted' ? 'accepted' : state }], ...(state === 'accepted' ? {} : { error: platformError }) };
    const fetch = vi.fn(async () => new Response(JSON.stringify({ delivery }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await act(async () => root.render(overlay(store)));
    expect(document.body.textContent).toContain('暂无可用的被动回复来源');
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => { const button = sendButton('尝试主动发送到 QQ'); button.click(); button.click(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ action: 'send', key: value.key, sourceSessionId: value.currentSessionId, sourceMessageId: 'answer-message', text: '最终回答' });
    expect(sendButton('本次发送已提交').disabled).toBe(true);
    if (state !== 'accepted') {
      expect(document.body.textContent).toContain(platformError);
      expect(document.body.textContent).toContain('不会自动重发');
    }
    await act(async () => { store.accept({ conversations: [{ ...value, passiveReply: { expiresAt: Date.now() + 300_000 } }], tools: [], ownerIds: [] }); });
    expect(sendButton('本次发送已提交').disabled).toBe(true);
    await act(async () => sendButton('本次发送已提交').click());
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps the platform error without a send-window explanation in read-only records', async () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    const { store, value } = previewStore({ expiresAt: 100_500 });
    store.closePreview(); store.openDrawer(value, 'messages');
    const platformError = 'QQ 拒绝：msg_id expired（QQ 错误码 40034025；HTTP 400）';
    const delivery = { id: 'delivery', key: value.key, text: '最终回答', at: 1, updatedAt: 2, state: 'failed', parts: [{ index: 0, state: 'failed' }], error: platformError };
    const fetch = vi.fn(async () => new Response(JSON.stringify({ timeline: { items: [{ direction: 'outbound', order: 1, change: 1, delivery }], snapshot: 1, hasMore: false, nextAfter: 1 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await act(async () => root.render(overlay(store)));
    expect(document.body.textContent).not.toContain('被动回复窗口');
    expect(document.body.textContent).toContain(platformError);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(document.body.textContent).not.toContain('被动回复窗口');
    expect(document.body.textContent).not.toContain('是否允许取决于机器人权限');
    expect(document.body.textContent).toContain(platformError);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ action: 'timeline', key: value.key, query: '' });
  });
});
