import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
import type { ILayout, MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client';
import { SessionId } from '@deepseek-ai/dsh-session/types';
import type { QQSessionStore } from './qq-session-store.ts';

// The client registers this identity in both the main and panel-list slots.
export const QQ_MAIN_PANEL_ID = 'im-qqbot' as MainPanelId;
type CurrentSessionSource = HostObservable<{ readonly key?: string }>;

/** Own navigation keeps QQ browsing active; a native navigation restores the workspace browser. */
export function installQQSidebarNavigation({ store, layout, currentSession, navigation, mountSidebar }: {
  store: QQSessionStore;
  layout: ILayout;
  currentSession: CurrentSessionSource;
  navigation: Pick<UiWorkspace, 'openSession'>;
  mountSidebar: () => () => void;
}): { enter: (restore?: boolean) => void; exit: () => void; dispose: () => void; openSettings: () => void } {
  let disposed = false;
  let ownNavigation = false;
  let pendingRestore = false;
  let stopLease: (() => void) | undefined;
  let stopSidebar: (() => void) | undefined;
  let currentKey = currentSession.getSnapshot().key;
  let panelId = layout.panelInfo.getSnapshot().activePanelId;
  const disarm = (): void => { stopLease?.(); stopLease = undefined; };
  const exit = (): void => { pendingRestore = false; disarm(); store.cancelNavigation(); store.setSidebarMode('workspace'); };
  const arm = (): void => {
    disarm();
    if (layout.panelInfo.getSnapshot().activePanelId !== null) return;
    const signal = layout.beginNavigation();
    signal.addEventListener('abort', exit, { once: true });
    stopLease = () => signal.removeEventListener('abort', exit);
  };
  const showQQ = (): void => { store.setSidebarMode('qq'); };
  const openSession = (sessionId: string): void => {
    pendingRestore = false;
    disarm(); ownNavigation = true;
    try {
      showQQ();
      navigation.openSession(SessionId(sessionId));
    } finally { ownNavigation = false; }
    arm();
  };
  const enter = (restore = true): void => {
    if (disposed) return;
    pendingRestore = restore && store.getSnapshot().directory === null;
    showQQ();
    const id = restore ? store.resumeSessionId() : null;
    if (id) store.openSession(id, { revealHistory: false });
    else arm();
  };
  const openSettings = (): void => {
    pendingRestore = false;
    store.cancelNavigation();
    disarm(); ownNavigation = true;
    try { showQQ(); layout.selectPanel(QQ_MAIN_PANEL_ID); }
    finally { ownNavigation = false; }
    arm();
  };
  const stopNavigation = store.installNavigation(openSession);
  const syncSidebar = (): void => {
    if (store.getSnapshot().sidebar.sidebarMode === 'qq') stopSidebar ??= mountSidebar();
    else { stopSidebar?.(); stopSidebar = undefined; }
    if (pendingRestore && store.getSnapshot().directory) {
      pendingRestore = false;
      const id = store.resumeSessionId();
      if (id && store.getSnapshot().sidebar.sidebarMode === 'qq') store.openSession(id, { revealHistory: false });
    }
  };
  const stopStore = store.subscribe(syncSidebar);
  const stopPanel = layout.panelInfo.subscribe(() => {
    const id = layout.panelInfo.getSnapshot().activePanelId;
    if (id === panelId) return;
    const previous = panelId;
    panelId = id;
    if (ownNavigation) return;
    if (id === QQ_MAIN_PANEL_ID) enter();
    else if (id !== null || previous === QQ_MAIN_PANEL_ID) exit();
  });
  const stopCurrent = currentSession.subscribe(() => {
    const next = currentSession.getSnapshot().key;
    if (next === currentKey) return;
    currentKey = next;
    if (ownNavigation) return;
    store.cancelNavigation();
    // The host replaces the current binding before revealing its Conversation.
    queueMicrotask(() => {
      if (disposed || currentSession.getSnapshot().key !== next || layout.panelInfo.getSnapshot().activePanelId !== null) return;
      if (next && store.entry(next)) { store.selectSession(next, { revealHistory: false }); enter(false); }
      else exit();
    });
  });
  syncSidebar();
  if (layout.panelInfo.getSnapshot().activePanelId === QQ_MAIN_PANEL_ID) enter();
  return { enter, exit, openSettings, dispose: () => {
    disposed = true; store.cancelNavigation(); disarm(); stopCurrent(); stopPanel(); stopStore(); stopNavigation(); stopSidebar?.(); stopSidebar = undefined;
    store.setSidebarMode('workspace');
  } };
}
