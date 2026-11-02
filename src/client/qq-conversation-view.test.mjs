import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const runtime = await vi.hoisted(async () => {
  const { createRequire } = await import('node:module'); const require = createRequire(import.meta.url);
  const host = createRequire(require.resolve('@deepseek-ai/dsh-client-ui-primitives'));
  const { JSDOM } = host('jsdom'); const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement, HTMLInputElement: dom.window.HTMLInputElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement, HTMLIFrameElement: dom.window.HTMLIFrameElement,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true });
  return { dom };
});
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { QQConversationView, QQMessageTimeline } from './qq-conversation-view.ts';
import { QQSessionStore } from './qq-session-store.ts';
import { testT } from './qq-locale.ts';
import { defaultPolicy } from '../policy/validation.ts';
let root, container, sequence = 0;
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
function fixture(change = {}) {
  return { key: `view-${++sequence}`, appId: 'app', scope: 'group', peerId: 'group', name: '测试群', alias: '', currentSessionId: 'current',
    sessions: [{ sessionId: 'current', startedAt: 2 }, { sessionId: 'old', startedAt: 1 }], members: [], policy: defaultPolicy('custom', '/project'),
    settings: { preset: '', model: null, prompt: '', cwd: '', execution: { kind: 'native', permission: 'read-only' }, slashCommands: true },
    recording: { version: 1, enabled: true, since: 1, retentionDays: 0 }, lastActivity: 2, observedAllMessages: false,
    admitted: true, running: false, currentModel: null, currentPreset: 'standard', currentPermission: 'workspace-write', nextPreset: 'standard', deliveryState: null,
    currentWorkspace: { id: 'workspace', title: '项目', path: '/project' }, ...change };
}
function setup(entry) {
  const store = new QQSessionStore({ openSession: vi.fn() }); store.accept({ conversations: [entry], tools: [], ownerIds: [] });
  const perform = vi.spyOn(store, 'perform').mockResolvedValue({});
  return { store, perform };
}
function button(label) { const value = [...document.querySelectorAll('button')].find(item => item.textContent === label); if (!value) throw new Error(`Missing ${label}`); return value; }
async function click(label) { await act(async () => button(label).click()); }
const selectors = { modelCatalog: async () => ({ ok: true, value: { groups: [], failures: [] } }), listAgentPresets: async () => ({ ok: true, value: { presets: [] } }), permissionCatalog: async () => ({ ok: true, value: { options: [{ value: 'read-only', name: '只读' }, { value: 'workspace-write', name: '工作区可写' }] } }) };
function view(store, sessionId = 'current') { return h(QQConversationView, { store, sessionId, t: testT, selectorSource: selectors,
  useSessions: select => select({ byId: { current: { title: '当前任务', cwd: '/project', updatedAt: 2, projectionValues: { agentPreset: 'standard', permissions: { currentValue: 'workspace-write' } } }, old: { title: '旧任务', cwd: '/archive', updatedAt: 1 } } }),
  useWorkspaces: select => select({ items: [{ workspaceId: 'workspace', title: '项目', path: '/project', sessionIds: ['current'] }, { workspaceId: 'old-space', title: '归档资料', path: '/archive', sessionIds: ['old'] }] }) }); }
describe('QQ settings and message pages', () => {
  it('has only settings and messages and never creates a task on open', async () => {
    const { store, perform } = setup(fixture());
    await act(async () => root.render(view(store)));
    expect([...document.querySelectorAll('[role="tab"]')].map(item => item.textContent)).toEqual(['会话设置', '消息记录']);
    expect(container.querySelector('.imqc-peerSettings')).not.toBeNull();
    // 斜杠命令清单是唯一新增的可折叠区（来自命令注册表）
    expect(container.querySelectorAll('details').length).toBe(1);
    expect(container.querySelector('details.imqc-cmdList')).not.toBeNull();
    // 记录默认全部保留：无"保留条数"输入，改为"清空消息记录"按钮。
    expect(container.querySelector('input[aria-label="保留消息记录条数"]')).toBeNull();
    expect(container.textContent).toContain('清空消息记录');
    expect(container.textContent).not.toContain('自动换新');
    expect(perform).not.toHaveBeenCalled();
  });
  it('shows only the historical native selections and no current policy form', async () => {
    const entry = fixture(); const { store, perform } = setup(entry); const open = vi.spyOn(store, 'openSession');
    await act(async () => root.render(h(QQConversationView, { store, sessionId: 'old', t: testT, selectorSource: selectors,
      useProjection: key => key === 'permissions' ? { currentValue: 'workspace-write' } : 'historical-agent' })));
    expect(container.textContent).toContain('这是历史会话，设置只读');
    expect(container.textContent).toContain('此会话 Agent 预设：historical-agent；权限：workspace-write');
    expect(container.querySelector('.imqc-peerSettings')).toBeNull();
    expect(container.textContent).not.toContain('对话现行策略');
    await click('返回当前会话'); expect(open).toHaveBeenCalledWith('current'); expect(perform).not.toHaveBeenCalled();
  });
  it('does not infer historical selections from the current policy', async () => {
    const { store } = setup(fixture());
    await act(async () => root.render(view(store, 'old')));
    expect(container.textContent).toContain('Agent 预设：未读取；权限：未读取');
    expect(container.querySelector('.imqc-agentSettings')).toBeNull();
  });
  it('restores the native header and content scroll origins when opening settings', async () => {
    const shell = document.createElement('div'); shell.style.overflowY = 'hidden';
    document.body.append(shell); shell.append(container);
    container.style.overflowY = 'auto'; container.scrollTop = 240; shell.scrollTop = 76;
    try {
      const { store } = setup(fixture()); await act(async () => root.render(view(store)));
      expect(container.scrollTop).toBe(0); expect(shell.scrollTop).toBe(0);
      expect(container.querySelector('.imqc-settingsView').scrollTop).toBe(0);
    } finally { shell.remove(); }
  });
  it('requires an explicit confirmation to unarchive the current mapping', async () => {
    const entry = fixture({ archived: true }); const { store, perform } = setup(entry);
    await act(async () => root.render(view(store))); expect(perform).not.toHaveBeenCalled();
    await click('取消归档继续…'); expect(perform).not.toHaveBeenCalled();
    await click('确认取消归档'); expect(perform).toHaveBeenCalledExactlyOnceWith({ action: 'unarchive', key: entry.key, sessionId: 'current' });
  });
});
describe('QQ timeline behavior', () => {
  it('starts delta polling at the first snapshot and clears expired search results in the rendered view', async () => {
    vi.useFakeTimers(); const entry = fixture(); const { store, perform } = setup(entry);
    const row = { direction: 'inbound', order: 1, change: 1, message: { id: 'private', senderId: 'user', senderName: '小明', at: 1, text: 'needle-private-body', mentioned: true, attachments: [] } };
    const expired = { ...row, change: 2, message: { ...row.message, senderName: '', text: '', bodyState: 'expired' } };
    perform.mockImplementation(async action => ({ timeline: action.after === undefined
      ? { items: [row], snapshot: 1, hasMore: false }
      : { items: [expired], snapshot: 2, nextAfter: 2, hasMore: false } }));
    await act(async () => root.render(h(QQMessageTimeline, { entry, store })));
    const input = container.querySelector('input[type="search"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(runtime.dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'needle');
      input.dispatchEvent(new runtime.dom.window.Event('input', { bubbles: true }));
    });
    await click('查询');
    expect(perform.mock.calls.at(-1)[0]).toMatchObject({ query: 'needle' });
    expect(container.textContent).toContain('needle-private-body');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(perform.mock.calls.at(-1)[0]).toMatchObject({ query: 'needle', after: 1 });
    expect(container.textContent).not.toContain('needle-private-body');
    expect(container.querySelectorAll('.imqc-timelineMessage')).toHaveLength(0);
  });
  it('renders message bodies as markdown and shows media attachments', async () => {
    vi.useFakeTimers(); const entry = fixture(); const { store, perform } = setup(entry);
    const inbound = { direction: 'inbound', order: 1, change: 1, message: { id: 'm1', senderId: 'user', senderName: '小明', at: 1, mentioned: true,
      text: '## 标题\n\n- 一\n- 二\n\n**加粗** 与 `code`', attachments: [
        { name: 'pic.png', type: 'image/png', url: 'https://example.com/pic.png', kind: 'image' },
        { name: 'clip.mp4', type: 'video/mp4', url: 'https://example.com/clip.mp4', kind: 'video' },
        { name: 'doc.pdf', type: 'application/pdf', url: 'https://example.com/doc.pdf', kind: 'file' },
      ] } };
    perform.mockResolvedValueOnce({ timeline: { items: [inbound], snapshot: 1, hasMore: false } });
    await act(async () => root.render(h(QQMessageTimeline, { entry, store })));
    const msg = container.querySelector('.imqc-timelineMessage');
    expect(msg.querySelector('h2')?.textContent).toBe('标题');
    expect(msg.querySelectorAll('li')).toHaveLength(2);
    expect(msg.querySelector('strong')?.textContent).toBe('加粗');
    expect(msg.querySelector('img.imqc-attachImage')?.getAttribute('src')).toBe('https://example.com/pic.png');
    expect(msg.querySelector('video.imqc-attachVideo')?.getAttribute('src')).toBe('https://example.com/clip.mp4');
    expect(msg.querySelector('a.imqc-attachFile')?.getAttribute('href')).toBe('https://example.com/doc.pdf');
  });
  it('removes count-evicted rows after applying their tombstones', async () => {
    vi.useFakeTimers(); const entry = fixture(); const { store, perform } = setup(entry);
    const row = { direction: 'inbound', order: 1, change: 1, message: { id: 'evicted', senderId: 'user', senderName: '小明', at: 1, text: 'old body', mentioned: true, attachments: [] } };
    perform.mockResolvedValueOnce({ timeline: { items: [row], snapshot: 1, hasMore: false } })
      .mockResolvedValueOnce({ timeline: { items: [{ ...row, change: 2, message: { ...row.message, text: '', bodyState: 'expired' } }], snapshot: 2, hasMore: false, nextAfter: 2 } });
    await act(async () => root.render(h(QQMessageTimeline, { entry, store })));
    expect(container.querySelectorAll('.imqc-timelineMessage')).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(container.querySelectorAll('.imqc-timelineMessage')).toHaveLength(0);
    expect(container.textContent).not.toContain('old body');
    expect(container.textContent).not.toContain('正文已过期');
  });
  it('loads old pages, polls incremental changes, and preserves failed part errors', async () => {
    vi.useFakeTimers(); const entry = fixture(); const { store, perform } = setup(entry);
    const inbound = { direction: 'inbound', order: 2, change: 2, message: { id: 'in', senderId: 'user', senderName: '小明', at: 2, text: '你好', mentioned: true, attachments: [] } };
    const outbound = { direction: 'outbound', order: 3, change: 3, delivery: { id: 'out', key: entry.key, text: '回复', at: 3, updatedAt: 3, state: 'sending', parts: [{ index: 0, state: 'pending' }], provenance: 'web', sourceSessionId: 'current' } };
    perform.mockResolvedValueOnce({ timeline: { items: [outbound, inbound], snapshot: 3, hasMore: true, nextBefore: 2 } })
      .mockResolvedValueOnce({ timeline: { items: [{ ...inbound, order: 1, change: 1, message: { ...inbound.message, id: 'old', text: '旧消息' } }], snapshot: 3, nextAfter: 3, hasMore: false } })
      .mockResolvedValueOnce({ timeline: { items: [{ ...outbound, change: 4, delivery: { ...outbound.delivery, state: 'failed', updatedAt: 4, parts: [{ index: 0, state: 'failed' }], error: 'QQ 40034025: msg_id expired' } }], snapshot: 4, nextAfter: 4, hasMore: false } });
    await act(async () => root.render(h(QQMessageTimeline, { entry, store })));
    expect(container.querySelectorAll('.imqc-timelineMessage')).toHaveLength(2);
    // 健康投递不再显示技术详情（provenance/接口接受等）；只保留正文。
    expect(container.textContent).not.toContain('网页显式发送');
    await click('读取更早记录'); expect(perform.mock.calls[1][0]).toMatchObject({ before: 2, snapshot: 3 });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(perform.mock.calls[2][0]).toMatchObject({ after: 3 }); expect(container.querySelectorAll('.imqc-timelineMessage')).toHaveLength(3);
    expect(container.textContent).toContain('QQ 40034025: msg_id expired'); expect(container.textContent).toContain('不会自动重发');
    expect([...container.querySelectorAll('.imqc-timelineMessage')].map(item => item.dataset.direction)).toEqual(['inbound', 'inbound', 'outbound']);
  });
});
