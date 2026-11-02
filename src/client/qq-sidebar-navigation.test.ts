import { describe, expect, it, vi } from 'vitest';
import { LayoutController, type PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/src/client/service.ts';
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionTarget } from '@deepseek-ai/dsh-api-session-controller/client';
import type { ConversationView } from '../shared/conversation-protocol.ts';
import { QQSessionStore } from './qq-session-store.ts';
import { installQQSidebarNavigation, QQ_MAIN_PANEL_ID } from './qq-sidebar-navigation.ts';

function source<T>(initial: T): HostObservable<T> & { set: (value: T) => void } {
  let value = initial;
  const listeners = new Set<() => void>();
  return { getSnapshot: () => value, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    set: (next) => { value = next; for (const listener of listeners) listener(); } };
}
function setup() {
  const panel = source<PanelInfo>({ activePanelId: null });
  const current = source<{ readonly key?: string }>({});
  const layout = new LayoutController({
    selectPanel: (id) => { if (panel.getSnapshot().activePanelId !== id) panel.set({ activePanelId: id }); },
    retainMainPanels: () => {}, setSidebar: () => {}, toggleSidebar: () => {}, setViewportWidth: () => {},
    setRightbar: () => {}, openRightbar: () => {}, closeRightbar: () => {},
  }, () => true, panel);
  const openSession = vi.fn((target: SessionTarget) => { if (typeof target !== 'string') throw new Error('test only opens direct Sessions'); current.set({ key: target }); layout.selectPanel(null); });
  const store = new QQSessionStore({ openSession });
  const stopSidebar = vi.fn(); const mountSidebar = vi.fn(() => stopSidebar);
  const controller = installQQSidebarNavigation({ store, layout, currentSession: current, navigation: { openSession }, mountSidebar });
  return { panel, current, layout, store, controller, openSession, mountSidebar, stopSidebar };
}

describe('QQ sidebar navigation against the stock LayoutController', () => {
  it('keeps own native Conversation navigation in QQ mode and restores the stock browser on exit', () => {
    const app = setup();
    app.controller.enter(false);
    app.store.openSession('qq-session');
    expect(app.panel.getSnapshot().activePanelId).toBeNull();
    expect(app.store.getSnapshot().sidebar.sidebarMode).toBe('qq');
    expect(app.mountSidebar).toHaveBeenCalledOnce(); expect(app.stopSidebar).not.toHaveBeenCalled();
    app.controller.exit(); expect(app.stopSidebar).toHaveBeenCalledOnce();
    expect(app.store.getSnapshot().sidebar.sidebarMode).toBe('workspace');
    app.controller.dispose();
  });
  it('exits as soon as native New Session begins, including failure or blank reuse with unchanged selection', () => {
    const app = setup();
    app.controller.enter(false); app.store.openSession('qq-session');
    const nativeNavigation = app.layout.beginNavigation();
    expect(app.store.getSnapshot().sidebar.sidebarMode).toBe('workspace');
    expect(app.stopSidebar).toHaveBeenCalledOnce();
    expect(nativeNavigation.aborted).toBe(false);
    expect(app.current.getSnapshot().key).toBe('qq-session');
    app.controller.dispose();
  });
  it('does not rearm or alter an outside panel navigation after its lease aborts', () => {
    const app = setup();
    app.controller.enter(false);
    app.layout.selectPanel(null);
    expect(app.store.getSnapshot().sidebar.sidebarMode).toBe('workspace');
    expect(app.openSession).not.toHaveBeenCalled();
    app.layout.selectPanel(QQ_MAIN_PANEL_ID);
    expect(app.store.getSnapshot().sidebar.sidebarMode).toBe('qq');
    app.controller.dispose();
  });
  it('holds an explicit first restore until directory arrival, then stops following mapping refreshes', () => {
    const app = setup();
    app.layout.selectPanel(QQ_MAIN_PANEL_ID);
    const entry: ConversationView = { key: 'group', appId: 'app', scope: 'group', peerId: 'peer', name: '', alias: '', currentSessionId: 'current', sessions: [{ sessionId: 'current', startedAt: 1 }],
      members: [], lastActivity: 2, observedAllMessages: false, admitted: true, running: false, currentModel: null, currentPreset: null, nextPreset: null, deliveryState: null,
      policy: { version: 1, template: 'chat', name: '', role: { description: '', tone: '', world: '', prompt: '' }, tools: {},
        resources: { readRoots: [], writeRoots: [], sendRoots: [], executionEnabled: false, sandbox: 'read-only', networkDomains: [], maxFiles: 1, maxFileMB: 10 },
        controllers: [], approvers: [], allowedModels: [], allowedPresets: [], allowedPermissions: [], permission: 'read-only', cwd: '', requireMention: true,
        context: { mode: 'recent', maxMessages: 10, maxAgeMinutes: 10, maxChars: 4000, retentionDays: 7 } } };
    app.store.accept({ conversations: [entry], tools: [], ownerIds: [] });
    expect(app.openSession).toHaveBeenCalledExactlyOnceWith('current');
    app.store.accept({ conversations: [{ ...entry, currentSessionId: 'rotated' }], tools: [], ownerIds: [] });
    expect(app.openSession).toHaveBeenCalledOnce();
    app.controller.dispose();
  });
  it('keeps the QQ welcome on a repeated QQ entry and on a failed native creation with no page change', () => {
    const app = setup();
    app.layout.selectPanel(QQ_MAIN_PANEL_ID);
    app.layout.selectPanel(QQ_MAIN_PANEL_ID);
    expect(app.store.getSnapshot().sidebar.sidebarMode).toBe('qq');
    expect(app.mountSidebar).toHaveBeenCalledOnce();
    const pending = app.layout.beginNavigation();
    expect(pending.aborted).toBe(false);
    expect(app.store.getSnapshot().sidebar.sidebarMode).toBe('qq');
    expect(app.openSession).not.toHaveBeenCalled();
    app.layout.selectPanel(null);
    expect(app.store.getSnapshot().sidebar.sidebarMode).toBe('workspace');
    expect(app.stopSidebar).toHaveBeenCalledOnce();
    app.controller.dispose();
  });
  it('keeps account settings in QQ mode until an outside navigation commits its target', () => {
    const app = setup();
    app.controller.enter(false); app.store.openSession('qq-session');
    app.controller.openSettings();
    expect(app.panel.getSnapshot().activePanelId).toBe(QQ_MAIN_PANEL_ID);
    const pending = app.layout.beginNavigation();
    expect(pending.aborted).toBe(false);
    expect(app.store.getSnapshot().sidebar.sidebarMode).toBe('qq');
    app.layout.selectPanel(QQ_MAIN_PANEL_ID);
    expect(app.store.getSnapshot().sidebar.sidebarMode).toBe('qq');
    app.layout.selectPanel(null);
    expect(app.store.getSnapshot().sidebar.sidebarMode).toBe('workspace');
    app.controller.dispose();
  });
  it('disposes the dynamic provider and navigation subscriptions without affecting later host navigation', () => {
    const app = setup(); app.controller.enter(false); app.controller.dispose();
    const nativeNavigation = app.layout.beginNavigation();
    expect(nativeNavigation.aborted).toBe(false); expect(app.stopSidebar).toHaveBeenCalledOnce();
    app.layout.selectPanel(QQ_MAIN_PANEL_ID); expect(app.mountSidebar).toHaveBeenCalledOnce();
  });
});
