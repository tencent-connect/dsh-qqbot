import { createElement as h, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import { Button, Input, Menu, Modal, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular,
  IconChevronLeftOutlineRegular, IconSettingsOutlineRegular, IconSearchOutlineRegular, IconUsersOutlineRegular,
  IconUserOutlineRegular, IconRefreshOutlineRegular, IconPlusOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import type { ConversationView } from '../shared/conversation-protocol.ts';
import { QQSessionStore, useQQSessionStore, type QQNavigationIntent } from './qq-session-store.ts';
import { qqScopeCollapsed, qqSidebarPeers, visibleQQSessions, type QQSidebarPeer, type QQSidebarSession } from './qq-sidebar-model.ts';
import type { QQTranslate } from './qq-locale.ts';
import { QQNativeCatalogRehydrator, type QQNativeCatalogSource } from './qq-native-catalog.ts';

type SidebarDialog = { readonly kind: 'rename'; readonly sessionId: string; readonly title: string };
export interface QQSidebarActions {
  readonly onExit: () => void;
  readonly onOpenSettings: () => void;
  readonly renameSession: (sessionId: string, title: string) => Promise<void>;
  readonly nativeCatalog: QQNativeCatalogSource;
}

export function QQSidebar({ store, actions, t, defaultWorkspaceName, wide, expandSidebar, useSessions, useWorkspaces }: PropsRuntime<'sidebar.workspaces'> & {
  store: QQSessionStore; actions: QQSidebarActions; t: QQTranslate; defaultWorkspaceName: string;
}): ReactNode {
  const state = useQQSessionStore(store);
  const native = useSessions((snapshot) => snapshot);
  const workspaces = useWorkspaces((snapshot) => snapshot.items);
  const [dialog, setDialog] = useState<SidebarDialog | null>(null);
  const [catalog] = useState(() => new QQNativeCatalogRehydrator(actions.nativeCatalog));
  useEffect(() => { void catalog.update(state.directory?.conversations ?? [], native.byId, native.phase)?.catch(() => {}); }, [catalog, state.directory, native.byId, native.phase]);
  const sidebar = state.sidebar;
  const peers = qqSidebarPeers(state.directory?.conversations ?? [], native.byId, workspaces, sidebar.search, defaultWorkspaceName);
  const refresh = (): void => { store.refresh(); void actions.nativeCatalog.refresh().catch(() => {}); };
  if (!wide) return h('div', { className: 'imqq-sidebar imqq-rail' },
    h(Button, { variant: 'ghost', size: 'sm', onClick: expandSidebar, 'aria-label': '展开 QQ 会话导航', title: '展开 QQ 会话导航' }, h(IconUsersOutlineRegular, { size: 18 })),
    h(Button, { variant: 'ghost', size: 'sm', onClick: actions.onExit, 'aria-label': '返回工作区', title: '返回工作区' }, h(IconChevronLeftOutlineRegular, { size: 18 })));
  return h('section', { className: 'imqq-sidebar', 'aria-label': 'QQ 会话导航' },
    h('header', { className: 'imqq-heading' },
      h(Button, { variant: 'outline', size: 'sm', className: 'imqq-back', onClick: actions.onExit, icon: h(IconChevronLeftOutlineRegular, { size: 14 }), title: '返回原生工作区导航' }, '工作区'),
      h('span', { className: 'imqq-headingTitle' }, 'QQ 会话'),
      h(Button, { variant: 'ghost', size: 'sm', onClick: actions.onOpenSettings, 'aria-label': 'QQ 账号设置', title: 'QQ 账号设置' }, h(IconSettingsOutlineRegular, { size: 16 }))),
    h('div', { className: 'imqq-search' }, h(Input, { type: 'search', value: sidebar.search, placeholder: '搜索 QQ 或会话标题', 'aria-label': '搜索 QQ 名称、备注或会话标题', icon: h(IconSearchOutlineRegular, { size: 14 }), onChange: (event: ChangeEvent<HTMLInputElement>) => store.setSearch(event.target.value) })),
    state.error ? h('p', { className: 'imqq-error', role: 'alert' }, state.error) : null,
    h('div', { className: 'imqq-tree' }, ...(['group', 'c2c'] as const).map((scope) => {
      const scoped = peers.filter((peer) => peer.entry.scope === scope);
      const collapsed = qqScopeCollapsed(scope, sidebar.collapsedScopes, sidebar.search);
      const title = scope === 'group' ? '群聊' : '私聊';
      return h('section', { key: scope, className: 'imqq-scope', 'aria-label': title },
        h('button', { type: 'button', className: 'imqq-scopeToggle', 'aria-expanded': !collapsed, onClick: () => store.toggleScope(scope) },
          h(collapsed ? IconChevronRightOutlineRegular : IconChevronDownOutlineRegular, { size: 12 }), h('span', null, title), h('span', { className: 'imqq-count' }, scoped.length)),
        !collapsed ? scoped.length ? scoped.map((peer) => h(PeerRow, { key: peer.entry.key, peer, store, t,
          expanded: Boolean(sidebar.search.trim()) || sidebar.expandedPeers.includes(peer.entry.key),
          showAll: sidebar.showAllPeers.includes(peer.entry.key),
          selectedSessionId: sidebar.selectedSessionId,
          onDialog: setDialog })) : h('p', { className: 'imqq-empty' }, state.loading && !state.directory ? '正在读取…' : sidebar.search ? '无匹配结果' : scope === 'group' ? '尚未发现群聊' : '尚未发现联系人') : null);
    })),
    h('footer', { className: 'imqq-footer' }, h('span', { role: 'status' }, state.runtime?.phase === 'ready' ? 'QQ 已连接' : state.runtime?.phase === 'unbound' ? '等待绑定' : state.runtime?.phase === 'failed' ? '连接失败' : 'QQ 连接状态待确认'),
      h(Button, { variant: 'ghost', size: 'sm', onClick: refresh, disabled: state.loading, 'aria-label': '刷新 QQ 会话', title: '刷新 QQ 会话' }, h(IconRefreshOutlineRegular, { size: 14 }))),
    dialog ? h(SidebarEditDialog, { key: dialog.sessionId, target: dialog, store, actions, onClose: () => setDialog(null) }) : null);
}

function PeerRow({ peer, store, t, expanded, showAll, selectedSessionId, onDialog }: {
  peer: QQSidebarPeer; store: QQSessionStore; t: QQTranslate; expanded: boolean; showAll: boolean; selectedSessionId: string | null; onDialog: (dialog: SidebarDialog) => void;
}): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false);
  const { entry, name, currentSession } = peer;
  const selected = currentSession !== null && currentSession.sessionId === selectedSessionId;
  const sessions = visibleQQSessions(peer, showAll);
  const hasHistory = peer.historySessions.length > 0;
  // 只有存在历史会话时才显示展开箭头；仅一条当前会话时点整行即可，无需 chevron，避免与分组头的 chevron 混淆。
  const expandable = hasHistory;
  const currentTooltip = [name, entry.alias && entry.name ? entry.name : '', currentSession?.title, currentSession?.workspace, currentSession?.path].filter(Boolean).join('\n');
  return h('div', { className: 'imqq-peer' },
    h('div', { className: 'imqq-peerRow', 'data-selected': selected },
      expandable ? h('button', { type: 'button', className: 'imqq-toggle', 'aria-label': `${expanded ? '收起' : '展开'}${name}的会话`, 'aria-expanded': expanded, onClick: () => store.togglePeer(entry.key) }, h(expanded ? IconChevronDownOutlineRegular : IconChevronRightOutlineRegular, { size: 12 })) : h('span', { className: 'imqq-toggleSpace', 'aria-hidden': true }),
      h('button', { type: 'button', className: 'imqq-peerOpen', 'aria-current': selected ? 'page' : undefined, onClick: () => store.open(entry), title: currentTooltip },
        h(entry.scope === 'group' ? IconUsersOutlineRegular : IconUserOutlineRegular, { size: 15 }),
        h('span', { className: 'imqq-peerText' }, h('span', { className: 'imqq-peerName' }, name), peer.currentSummary ? h('span', { className: 'imqq-peerSummary' }, peer.currentSummary) : null),
        !entry.admitted ? h('span', { className: 'imqq-tag' }, '待授权') : !currentSession ? h('span', { className: 'imqq-tag' }, '未开始')
          : entry.running ? h('span', { className: 'imqq-running', title: t('sidebar.receiving'), 'aria-label': t('sidebar.receiving') }) : null),
      h(Button, { variant: 'ghost', size: 'sm', className: 'imqq-quickAdd', 'aria-label': t('sidebar.newSession.aria', { name }), title: t('sidebar.newSession'), disabled: !entry.admitted || entry.running, onClick: () => store.openOperation(entry) }, h(IconPlusOutlineRegular, { size: 14 })),
      h(Menu, { open: menuOpen, onClose: () => setMenuOpen(false), portal: true, align: 'end', compact: true,
        anchor: h(Button, { variant: 'ghost', size: 'sm', className: 'imqq-menuTrigger', 'aria-label': `管理${name}`, 'aria-haspopup': 'menu', 'aria-expanded': menuOpen, onClick: () => setMenuOpen(!menuOpen) }, '···'),
        items: [{ type: 'label', id: 'current-label', text: '当前会话' },
          { id: 'rename', label: '重命名当前会话…', disabled: !currentSession },
          { id: 'settings', label: '当前会话设置…' },
          { type: 'separator', id: 'qq-separator' }, { type: 'label', id: 'qq-label', text: entry.scope === 'group' ? 'QQ 群聊' : 'QQ 联系人' },
          { id: 'messages', label: '消息记录…' }],
        onSelect: (id) => {
          setMenuOpen(false);
          if (id === 'rename' && currentSession) onDialog({ kind: 'rename', sessionId: currentSession.sessionId, title: currentSession.nativeTitle ?? '' });
          else store.openDrawer(entry, id === 'messages' ? 'messages' : 'settings');
        } })),
    expanded && (hasHistory || currentSession) ? h('div', { className: 'imqq-sessions', 'aria-label': `${name}的会话` },
      currentSession ? h(SessionRow, { key: currentSession.sessionId, session: currentSession, entry, store, t, selected: selectedSessionId === currentSession.sessionId, current: true, onDialog }) : null,
      ...sessions.map((session) => h(SessionRow, { key: session.sessionId, session, entry, store, t, selected: selectedSessionId === session.sessionId, onDialog })),
      // 会话列表折叠：超过 N 条时可展开全部；展开后底部可"收起历史"。
      showAll && peer.historySessions.length > 0 ? h('button', { type: 'button', className: 'imqq-more', 'aria-expanded': true, onClick: () => store.showAllSessions(entry.key) }, '收起历史') : null,
      !showAll && peer.historySessions.length > sessions.length ? h('button', { type: 'button', className: 'imqq-more', 'aria-expanded': false, onClick: () => store.showAllSessions(entry.key) }, `查看更多历史 · 还有 ${peer.historySessions.length - sessions.length} 条`) : null) : null);
}

function SessionRow({ session, entry, store, t, selected, current = false, onDialog }: {
  session: QQSidebarSession; entry: ConversationView; store: QQSessionStore; t: QQTranslate; selected: boolean; current?: boolean; onDialog: (dialog: SidebarDialog) => void;
}): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copySessionId = (): void => {
    const text = session.sessionId;
    const done = (): void => { setCopied(true); setTimeout(() => setCopied(false), 1500); };
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) { void navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done)); }
      else fallbackCopy(text, done);
    } catch { fallbackCopy(text, done); }
  };
  return h('div', { className: 'imqq-sessionRow', 'data-selected': selected, 'data-current': current },
    h('button', { type: 'button', className: 'imqq-sessionOpen', 'aria-current': selected ? 'page' : undefined, onClick: () => store.openSession(session.sessionId, { preserveVisibleFilter: true }), title: `${session.title}\n${current ? '当前生效会话' : '历史会话'}\n${session.workspace}${session.path && session.path !== session.workspace ? `\n${session.path}` : ''}` },
      h('span', { className: 'imqq-sessionTitle' }, h('span', { className: 'imqq-sessionTitleText', title: session.title }, session.title), current ? h('span', { className: 'imqq-sessionCurrent', title: t('sidebar.current.title') }, t('sidebar.current')) : null),
      h('span', { className: 'imqq-sessionMeta' }, h('span', { className: 'imqq-workspace' }, session.workspace), copied ? h('span', { className: 'imqq-copied' }, '已复制') : null)),
    h(Menu, { open: menuOpen, onClose: () => setMenuOpen(false), portal: true, align: 'end', compact: true,
      anchor: h(Button, { variant: 'ghost', size: 'sm', className: 'imqq-menuTrigger', 'aria-label': `会话菜单 ${session.title}`, 'aria-haspopup': 'menu', 'aria-expanded': menuOpen, onClick: () => setMenuOpen(!menuOpen) }, '···'),
      items: [{ type: 'label', id: 'history-label', text: '此历史会话' }, { id: 'rename', label: '重命名历史会话…' }, { id: 'copyId', label: '复制 Session ID' },
        { type: 'separator', id: 'current-separator' }, { id: 'newSession', label: '新建会话…', disabled: !entry.admitted || entry.running }],
      onSelect: (id) => { setMenuOpen(false); if (id === 'rename') onDialog({ kind: 'rename', sessionId: session.sessionId, title: session.nativeTitle ?? '' }); else if (id === 'copyId') copySessionId(); else if (id === 'newSession') store.openOperation(entry); } }));
}

/** Clipboard fallback for browsers/contexts without the async Clipboard API. */
function fallbackCopy(text: string, done: () => void): void {
  try {
    const area = document.createElement('textarea');
    area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.appendChild(area); area.select();
    document.execCommand('copy'); document.body.removeChild(area); done();
  } catch { /* copy unavailable */ }
}

function SidebarEditDialog({ target, store, actions, onClose }: {
  target: SidebarDialog; store: QQSessionStore; actions: QQSidebarActions; onClose: () => void;
}): ReactNode {
  const [value, setValue] = useState(target.title);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const intent = useRef<QQNavigationIntent | null>(null);
  useEffect(() => () => intent.current?.cancel(), []);
  const close = (): void => { intent.current?.cancel(); onClose(); };
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (busy || !value.trim() || submitting.current) return;
    submitting.current = true; setBusy(true); setError(null);
    const navigation = store.navigationIntent(); intent.current = navigation;
    void actions.renameSession(target.sessionId, value.trim()).then(() => { if (navigation.current()) close(); })
      .catch((cause: unknown) => { if (navigation.current()) setError(cause instanceof Error ? cause.message : '保存失败'); })
      .finally(() => { submitting.current = false; setBusy(false); });
  };
  return h(Modal, { open: true, onClose: close, title: '重命名会话', closeLabel: '关闭', className: 'imqq-editModal', children:
    h('form', { className: 'imqq-editForm', onSubmit: submit },
      h(Input, { value, disabled: busy, 'aria-label': '会话标题', ...{ 'data-modal-autofocus': true }, maxLength: 200, onChange: (event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value) }),
      error ? h('p', { className: 'imqq-error', role: 'alert' }, error) : null,
      h('div', { className: 'imqq-dialogActions' }, h(Button, { variant: 'ghost', size: 'sm', onClick: close }, '取消'), h(Button, { type: 'submit', variant: 'primary', size: 'sm', disabled: busy || !value.trim() }, busy ? '保存中…' : '保存'))) });
}
