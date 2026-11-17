import { t } from './qq-locale.ts';
import { createElement as h, Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { Button, IconChevronDownOutlineRegular, IconRefreshOutlineRegular, IconSettingsOutlineRegular, Input, Modal, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives';
import { WORKBENCH_CONVERSATIONS_PATH, WORKBENCH_NEW_SESSION_PATH, type WorkbenchConversation, type WorkbenchConversationPatch, type WorkbenchNewSession } from '../shared/workbench-conversation-protocol.ts';
import { WORKBENCH_TIMELINE_CLEAR_PATH } from '../shared/workbench-timeline-protocol.ts';
import type { WorkbenchRobot } from '../shared/workbench-protocol.ts';
import { QQ_HISTORY_VIEW_ID, type QqWorkbenchSettingsSection, type QqWorkbenchView } from '../shared/workbench-extension.ts';
import type { WorkbenchAgentSettings } from '../shared/workbench-agent-settings.ts';
import { fetchJson, HttpError } from './http.ts';
import { accountName } from './robot-accounts.ts';
import { extensionSettingsProps } from './workbench-extensions.ts';
import { WorkbenchAgentFields, type AgentFormSource } from './workbench-agent-form.ts';
import { changes, conversationKey, draftRetentionPolicy, scopedKey, selectDraft, type Draft, type SessionNavigation, type SmallPage, type WorkbenchState } from './workbench-state.ts';
import { peerName, receivingLabel, sessionDate, workspaceName } from './workbench-labels.ts';
import { ConversationSettings } from './workbench-conversation-settings.ts';
import styles from './workbench.module.css';

type Filter = 'all' | WorkbenchConversation['scope'];
const sessionPreviewLimit = 5;
interface RobotConversationsProps extends SessionNavigation {
  views: readonly QqWorkbenchView[];
  state: WorkbenchState;
  settingsSections: readonly QqWorkbenchSettingsSection[];
  robot: WorkbenchRobot;
  agentSource?: AgentFormSource;
  settingsOpen: boolean;
  settingsVisible: boolean;
  singlePage: boolean;
  treeDivider: ReactNode;
  settingsDivider: ReactNode;
  onToggleSettings: (open: boolean) => void;
  onSmallPage: (page: SmallPage) => void;
}

export function RobotConversations({ state, robot, agentSource, views, settingsSections, settingsOpen, settingsVisible, singlePage, treeDivider, settingsDivider, openSession, prepareSession, restoreSession, archivedSessionIds, sessionTitle, workspaceTitle, onToggleSettings, onSmallPage }: RobotConversationsProps): ReactNode {
  const { appId } = robot;
  const filters = [
    { value: 'all', label: t("全部") }, { value: 'group', label: t("群聊") }, { value: 'c2c', label: t("私聊") },
  ] satisfies Array<{ value: Filter; label: string }>;
  const { peerSelections, expandedPeers, showAllSessions, peerDrafts, sessionOrigins } = state;
  const [openViewId, setOpenViewId] = useState<string>();
  const selectedView = views.find(view => view.id === openViewId);
  const activeView = selectedView ?? views.find(view => view.id === QQ_HISTORY_VIEW_ID);
  const [viewRefreshKey, setViewRefreshKey] = useState(0);
  useEffect(() => {
    if (!selectedView) setOpenViewId(undefined);
  }, [selectedView]);
  const [summaries, setPeers] = useState<WorkbenchConversation[] | null>(null);
  const [history, setHistory] = useState<ReadonlyMap<string, WorkbenchConversation>>(new Map());
  const historyReads = useRef(new Map<string, AbortController>());
  const peers = summaries?.map(item => {
    const stored = history.get(conversationKey(item));
    if (!stored) return item;
    const sessions = new Map([...stored.sessions, ...item.sessions].map(session => [session.id, session]));
    return { ...item, sessions: [...sessions.values()] };
  }) ?? null;
  useEffect(() => {
    for (const item of summaries ?? []) {
      if (expandedPeers.has(scopedKey(appId, item))) void readHistory(item);
    }
  }, [appId, summaries]);
  useEffect(() => () => {
    for (const controller of historyReads.current.values()) controller.abort();
    historyReads.current.clear();
  }, [appId]);
  const [selection, setSelection] = useState(() => peerSelections.get(appId));
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [reload, setReload] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [openError, setOpenError] = useState('');
  const [restoring, setRestoring] = useState<string>();
  const [restoreError, setRestoreError] = useState<{ id: string; message: string }>();
  const [sessionNotice, setSessionNotice] = useState<{ key: string; text: string }>();
  const [newSession, setNewSession] = useState<{ peer: WorkbenchConversation; settings: WorkbenchAgentSettings }>();
  const [createError, setCreateError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [busyKey, setBusyKey] = useState<string>();
  const [feedback, setFeedback] = useState<{ key: string; message: string }>();
  const [, redraw] = useState(0);
  const mutation = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const opening = useRef(0);
  const filterId = useId();
  const settingsId = useId();
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const settingsClose = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  useLayoutEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (settingsVisible ? settingsClose.current : settingsTrigger.current)?.focus({ preventScroll: true });
  }, [settingsVisible]);
  const toggleSettings = (): void => {
    moveFocus.current = singlePage;
    onToggleSettings(!settingsVisible);
  };
  const closeSettings = (): void => {
    moveFocus.current = true;
    onToggleSettings(false);
  };
  const closeButton = h(Button, {
    ref: settingsClose, type: 'button', size: 'sm', variant: 'ghost',
    'aria-label': t("收起设置栏"), onClick: closeSettings,
  }, t("收起"));

  useLayoutEffect(() => () => { opening.current++; }, []);
  useEffect(() => () => { mutation.current?.abort(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async (): Promise<void> => {
      const started = generation.current;
      const current = (): boolean => !controller.signal.aborted && !mutation.current && started === generation.current;
      try {
        const params = new URLSearchParams({ appId, summary: '1' });
        const response = await fetchJson<{ conversations: WorkbenchConversation[] }>(`${WORKBENCH_CONVERSATIONS_PATH}?${params}`, {
          cache: 'no-store', signal: controller.signal,
        });
        if (!current()) return;
        setPeers(response.conversations);
        setUnavailable(false);
        setLoadError('');
      } catch (error) {
        if (!current()) return;
        if (error instanceof HttpError && error.status === 404) setUnavailable(true);
        else setLoadError(error instanceof Error ? error.message : t("无法读取 QQ 会话"));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => { void read(); }, 4000);
      }
    };
    void read();
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [appId, reload]);

  const peer = peers?.find(item => conversationKey(item) === selection) ?? peers?.[0];
  const peerKey = peer ? scopedKey(appId, peer) : undefined;
  const current = peer?.sessions.find(session => session.id === peer.currentSessionId);
  const isArchived = (id?: string): boolean => id !== undefined && archivedSessionIds?.includes(id) === true;
  const currentArchived = isArchived(current?.id);
  const label = peer ? receivingLabel(robot, peer, currentArchived) : '';

  async function readHistory(item: WorkbenchConversation): Promise<void> {
    const key = conversationKey(item);
    const stored = history.get(key);
    if (stored && stored.currentSessionId === item.currentSessionId && stored.sessionCount === item.sessionCount) return;
    if (historyReads.current.has(key)) return;
    const controller = new AbortController();
    const { signal } = controller;
    historyReads.current.set(key, controller);
    const query = new URLSearchParams({ appId, scope: item.scope, openId: item.openId });
    try {
      const { conversations: [found] } = await fetchJson<{ conversations: WorkbenchConversation[] }>(
        `${WORKBENCH_CONVERSATIONS_PATH}?${query}`, { signal },
      );
      if (found && !signal.aborted) setHistory(previous => new Map(previous).set(key, found));
    } catch (error) {
      if (!signal.aborted) setLoadError(error instanceof Error ? error.message : t("无法读取历史 Session。"));
    } finally {
      if (historyReads.current.get(key) === controller) historyReads.current.delete(key);
    }
  }

  const restoreCurrent = async (): Promise<void> => {
    if (!current || !currentArchived || !restoreSession || restoring || mutation.current) return;
    setRestoreError(undefined);
    setRestoring(current.id);
    try {
      await restoreSession(current.id);
    } catch (error) {
      setRestoreError({ id: current.id, message: error instanceof Error ? error.message : t("无法恢复原会话。") });
    } finally {
      setRestoring(undefined);
    }
  };

  const save = async (target: WorkbenchConversation, draft: Draft, confirmRetention?: true): Promise<void> => {
    const policy = draftRetentionPolicy(draft.retention);
    if (mutation.current || policy === undefined) return;
    const key = scopedKey(appId, target);
    const { retention, ...edited } = changes({ ...draft, retention: policy });
    if (retention === undefined && Object.keys(edited).length === 0) {
      peerDrafts.delete(key);
      redraw(value => value + 1);
      return;
    }
    const controller = new AbortController();
    const patch: WorkbenchConversationPatch = {
      appId, scope: target.scope, openId: target.openId, revision: draft.baseline.revision,
      defaultsRevision: draft.baseline.defaultsRevision, ...edited,
      retention: retention === undefined ? undefined : policy, confirmRetention,
    };
    mutation.current = controller;
    generation.current++;
    setBusyKey(key);
    setFeedback(undefined);
    try {
      const result = await fetchJson<{ conversation: WorkbenchConversation }>(WORKBENCH_CONVERSATIONS_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch), signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (result.conversation.scope !== target.scope || result.conversation.openId !== target.openId) {
        throw new Error(t("会话标识不一致，请刷新后重试。"));
      }
      peerDrafts.delete(key);
      setPeers(rows => rows?.map(item => conversationKey(item) === conversationKey(target) ? result.conversation : item) ?? null);
      if (patch.retention !== undefined) setViewRefreshKey(value => value + 1);
    } catch (error) {
      if (controller.signal.aborted) return;
      setFeedback({
        key,
        message: error instanceof Error ? error.message : t("无法保存会话设置。"),
      });
      if (error instanceof HttpError && error.status === 409) setReload(value => value + 1);
    } finally {
      if (!controller.signal.aborted) {
        generation.current++;
        mutation.current = null;
        setBusyKey(undefined);
      }
    }
  };

  const clearRecords = async (target: WorkbenchConversation): Promise<void> => {
    if (mutation.current) return;
    const key = scopedKey(appId, target);
    const controller = new AbortController();
    mutation.current = controller;
    setBusyKey(key);
    setFeedback(undefined);
    try {
      await fetchJson(WORKBENCH_TIMELINE_CLEAR_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ appId, scope: target.scope, openId: target.openId, revision: target.revision, confirmed: true }),
      });
      if (controller.signal.aborted) return;
      setViewRefreshKey(value => value + 1);
      setSessionNotice({ key, text: t("已清空此对话的本机 QQ 消息记录。") });
    } catch (error) {
      if (controller.signal.aborted) return;
      setFeedback({ key, message: error instanceof Error ? error.message : t("无法清空本机 QQ 消息记录。") });
      if (error instanceof HttpError && error.status === 409) setReload(value => value + 1);
    } finally {
      if (!controller.signal.aborted) {
        mutation.current = null;
        setBusyKey(undefined);
      }
    }
  };

  const createSession = async (): Promise<void> => {
    if (!newSession || mutation.current) return;
    const { peer: target, settings } = newSession;
    const key = scopedKey(appId, target);
    const controller = new AbortController();
    const input: WorkbenchNewSession = {
      appId, scope: target.scope, openId: target.openId, revision: target.revision,
      currentSessionId: target.currentSessionId ?? null, cwd: settings.cwd, preset: settings.preset,
    };
    mutation.current = controller;
    generation.current++;
    setBusyKey(key);
    setCreateError('');
    try {
      const result = await fetchJson<{ sessionId: string }>(WORKBENCH_NEW_SESSION_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: controller.signal,
      }, 30_000);
      if (controller.signal.aborted) return;
      if (typeof result.sessionId !== 'string' || !result.sessionId) throw new Error(t("未能确认新 Session，请刷新会话列表。"));
      expandedPeers.add(key);
      setNewSession(undefined);
      setSessionNotice({ key, text: t("新 Session 已创建。下一条 QQ 消息会进入这个 Session。") });
    } catch (error) {
      if (controller.signal.aborted) return;
      setCreateError(error instanceof Error ? error.message : t("无法新建 QQ Session。"));
    } finally {
      if (!controller.signal.aborted) {
        generation.current++;
        mutation.current = null;
        setBusyKey(undefined);
        setReload(value => value + 1);
      }
    }
  };

  const openNewSession = (): void => {
    if (!peer?.agent) return;
    setCreateError('');
    setSessionNotice(undefined);
    setNewSession({ peer, settings: peer.agent });
  };

  const openNative = async (id: string, from: WorkbenchConversation): Promise<boolean> => {
    if (!openSession) return false;
    const attempt = ++opening.current;
    setOpenError('');
    try {
      await prepareSession?.(id);
      if (attempt !== opening.current) return false;
      const previous = sessionOrigins.get(id);
      sessionOrigins.set(id, { appId, peerKey: conversationKey(from) });
      try { openSession(id); }
      catch (error) {
        if (previous) sessionOrigins.set(id, previous);
        else sessionOrigins.delete(id);
        throw error;
      }
      return true;
    } catch (error) {
      if (attempt === opening.current) {
        setOpenError(error instanceof Error ? error.message : t("无法打开原生 Session，请稍后重试。"));
      }
      return false;
    }
  };
  const selectPeer = (item: WorkbenchConversation): void => {
    opening.current++;
    const key = conversationKey(item);
    peerSelections.set(appId, key);
    setSelection(key);
    setOpenError('');
    onSmallPage('conversation');
  };
  const visiblePeers = (peers ?? []).filter(item => {
    const needle = query.trim().toLowerCase();
    return (filter === 'all' || filter === item.scope)
      && [peerName(item), item.name, item.openId].some(value => value.toLowerCase().includes(needle));
  });
  const sessionCaption = current && [sessionTitle?.(current.id),
    workspaceTitle?.(current.id, current.cwd) || workspaceName(current.cwd), current.preset].filter(Boolean).join(' · ');

  return h(Fragment, null,
    h('aside', { className: 'imqw-tree', 'aria-label': t("QQ 会话列表") },
      h('header', { className: 'imqw-column-head' },
        h('h2', null, t("QQ 会话")),
        h(Button, {
          type: 'button', variant: 'ghost', size: 'sm', className: 'imqw-icon-action',
          'aria-label': t("刷新会话列表"), title: t("刷新会话列表"), onClick: () => setReload(value => value + 1),
        }, h(IconRefreshOutlineRegular, { size: 14 }))),
      h('p', { className: 'imqw-muted imqw-tree-caption' }, accountName(robot)),
      h(Input, {
        type: 'search', value: query, onChange: event => setQuery(event.currentTarget.value),
        placeholder: t("搜索会话"), 'aria-label': t("搜索 QQ 会话"),
      }),
      h(SegmentedControl<Filter>, { id: filterId, value: filter, options: filters, onChange: setFilter, label: t("会话类型") }),
      loadError ? h('p', { className: 'imqb-error', role: 'alert' }, loadError) : null,
      unavailable ? h('p', { className: 'imqw-muted' }, t("此宿主暂不提供 QQ 会话列表。")) : null,
      !peers && !loadError && !unavailable ? h('p', { className: 'imqw-muted', role: 'status' }, t("正在读取会话…")) : null,
      peers && visiblePeers.length === 0 ? h('p', { className: 'imqw-muted' }, peers.length ? t("没有符合条件的会话。") : t("暂无 QQ 会话。")) : null,
      peers?.length === 0 && robot.state === 'connected' ? h('ol', { className: 'imqw-muted' },
        h('li', null, t("在获准接入的 QQ 对话中发送 /bot-ping，确认收到 pong。群聊请先 @ 机器人。")),
        h('li', null, t("再发一条普通消息，确认模型回复，并在这里打开创建的 Session。")),
      ) : null,
      ...filters.filter(kind => kind.value !== 'all').map(kind => {
        const group = visiblePeers.filter(item => item.scope === kind.value);
        if (!group.length) return null;
        return h('section', { className: 'imqw-group', key: kind.value, 'aria-label': kind.label },
          h('h3', { className: 'imqw-muted' }, kind.label, h('span', null, group.length)),
          group.map(item => {
            const key = scopedKey(appId, item);
            const expanded = expandedPeers.has(key);
            const history = item.sessions.filter(session => session.id !== item.currentSessionId)
              .sort((a, b) => b.createdAt - a.createdAt);
            const active = item.sessions.find(session => session.id === item.currentSessionId);
            const ordered = active ? [active, ...history] : history;
            const showAll = showAllSessions.has(key);
            const list = showAll ? ordered : ordered.slice(0, sessionPreviewLimit);
            const hiddenCount = ordered.length - sessionPreviewLimit;
            return h('div', { className: 'imqw-peer', key, 'data-scope': item.scope, 'data-selected': item === peer || undefined },
              h('div', { className: 'imqw-peer-row' },
                h(Button, {
                  variant: 'ghost', size: 'sm', className: 'imqw-chevron',
                  disabled: !(item.sessionCount ?? item.sessions.length), 'aria-expanded': expanded,
                  'aria-label': t("{0} {1} 的 Session", expanded ? t("收起") : t("展开"), peerName(item)),
                  onClick: () => {
                    if (expanded) expandedPeers.delete(key);
                    else {
                      expandedPeers.add(key);
                      void readHistory(item);
                    }
                    redraw(value => value + 1);
                  },
                }, h(IconChevronDownOutlineRegular, { size: 14 })),
                h('button', {
                  className: 'imqw-peer-select', type: 'button', 'aria-pressed': item === peer, onClick: () => selectPeer(item),
                }, h('strong', { title: peerName(item) }, peerName(item)), h('span', { className: 'imqw-muted' }, receivingLabel(robot, item, isArchived(item.currentSessionId)))),
              ),
              expanded ? h('ul', { className: 'imqw-sessions' },
                list.map(session => {
                  const activeSession = session.id === item.currentSessionId;
                  const title = sessionTitle?.(session.id)?.trim() || `Session ${session.id.slice(-8)}`;
                  return h('li', { key: session.id }, h('button', {
                    className: 'imqw-session', type: 'button', 'data-session-id': session.id, disabled: !openSession,
                    onClick: () => openNative(session.id, item), title: session.cwd || title,
                  },
                    h('span', { className: 'imqw-session-title' }, title),
                    h('span', { className: 'imqw-muted' }, [
                      activeSession ? receivingLabel(robot, item, isArchived(session.id)) : isArchived(session.id) ? t("已归档") : t("历史"),
                      workspaceTitle?.(session.id, session.cwd) || workspaceName(session.cwd), sessionDate(session),
                    ].filter(Boolean).join(' · ')),
                  ));
                }),
                hiddenCount > 0 ? h('li', null, h(Button, {
                  size: 'sm', variant: 'ghost', onClick: () => {
                    if (showAllSessions.has(key)) showAllSessions.delete(key);
                    else showAllSessions.add(key);
                    redraw(value => value + 1);
                  },
                }, showAll ? t("收起历史") : t("另有 {0} 个 Session", hiddenCount))) : null,
              ) : null,
            );
          }),
        );
      }),
    ),
    treeDivider,
    h('section', { className: 'imqw-conversation', 'aria-label': t("当前 QQ 会话") },
      h('header', { className: 'imqw-column-head imqw-main-head' },
        h('div', { className: 'imqw-main-title' },
          h('h2', { title: peer && peerName(peer) }, peer ? peerName(peer) : accountName(robot)),
          h('p', { className: 'imqw-muted' }, peer ? `${peer.scope === 'group' ? t("群聊") : t("私聊")} · ${label}` : t("请从会话列表选择对话"))),
        h('div', { className: 'imqw-actions' },
          peer ? views.filter(view => view.id !== QQ_HISTORY_VIEW_ID).map(view => h(Button, {
            key: view.id, type: 'button', size: 'sm', variant: 'outline',
            'aria-expanded': activeView === view,
            onClick: () => setOpenViewId(activeView === view ? undefined : view.id),
          }, `${activeView === view ? t("收起") : t("查看")} ${view.title}`)) : null,
          peer ? h(Fragment, null,
            currentArchived ? h(Button, {
              type: 'button', size: 'sm', variant: 'outline',
              disabled: !restoreSession || !!busyKey || !!restoring, onClick: () => { void restoreCurrent(); },
            }, restoring === current?.id ? t("恢复中…") : t("恢复当前 Session")) : h(Button, {
              type: 'button', size: 'sm', variant: 'outline', disabled: !current || !openSession,
              title: current ? sessionCaption || t("打开当前 Session") : t("尚未创建 Session"),
              onClick: () => { if (current) void openNative(current.id, peer); },
            }, t("当前 Session")),
            h(Button, {
              type: 'button', size: 'sm', variant: 'outline', onClick: openNewSession,
              disabled: !!peer.executionBlocked || !peer.agent || !peer.admitted || !peer.receiving || !robot.enabled || robot.state !== 'connected' || !!busyKey || !!restoring,
            }, t("新建 Session")),
            activeView?.refreshable ? h(Button, {
              type: 'button', size: 'sm', variant: 'ghost', className: 'imqw-icon-action',
              'aria-label': t("刷新消息"), title: t("刷新消息"), onClick: () => setViewRefreshKey(value => value + 1),
            }, h(IconRefreshOutlineRegular, { size: 14 })) : null,
            h(Button, {
              ref: settingsTrigger, size: 'sm', variant: 'outline',
              className: 'imqw-icon-action imqw-settings-trigger', 'aria-controls': settingsId,
              'aria-label': t("会话设置"), title: t("会话设置"), 'aria-expanded': settingsVisible, onClick: toggleSettings,
            }, h(IconSettingsOutlineRegular, { size: 14 })),
          ) : null,
        ),
      ),
      currentArchived ? h('p', { className: 'imqw-muted', role: 'status' },
        restoreSession ? t("恢复原会话可继续原有上下文。也可以新建 Session 接收后续消息。")
          : t("请在 DSH 工作区取消归档，或新建 Session 接收后续消息。")) : null,
      current && restoreError?.id === current.id ? h('p', { className: 'imqb-error', role: 'alert' }, restoreError.message) : null,
      openError ? h('p', { className: 'imqb-error', role: 'alert' }, openError) : null,
      sessionNotice && sessionNotice.key === peerKey ? h('p', { className: 'imqw-muted', role: 'status' }, sessionNotice.text) : null,
      peer && !activeView ? h('p', { className: 'imqw-muted', role: 'status' },
        t("QQ 消息记录组件未加载。请在插件详情中启用它，或重新安装 QQ 机器人。")) : null,
      peer && activeView ? h(activeView.component, { key: `${activeView.id}:${peerKey}`, appId, peer, robotName: accountName(robot), openSession: openSession && ((id: string) => openNative(id, peer)),
        refreshKey: activeView.refreshable ? viewRefreshKey : undefined,
        disabledReason: peer.executionBlocked ?? (!robot.enabled || robot.state !== 'connected' ? t("机器人未连接")
          : !peer.admitted ? t("此会话未获准接入") : !peer.receiving ? t("此会话已暂停") : undefined) }) : null,
    ),
    settingsDivider,
    h('aside', { id: settingsId, className: 'imqw-settings', 'aria-label': t("会话设置"), hidden: !settingsOpen },
      peer && peerKey ? h(Fragment, null, h(ConversationSettings, {
            key: peerKey, robot, peer, agentSource, closeButton, archived: currentArchived,
            workspace: current && workspaceTitle?.(current.id, current.cwd), draft: peerDrafts.get(peerKey) ?? selectDraft(peer),
            openCurrent: current && !currentArchived && openSession ? () => openNative(current.id, peer) : undefined,
            busy: busyKey === peerKey, feedback: feedback?.key === peerKey ? feedback : undefined,
            onEdit: draft => {
              if (Object.keys(changes(draft)).length > 0) peerDrafts.set(peerKey, draft);
              else peerDrafts.delete(peerKey);
              redraw(value => value + 1);
              setFeedback(undefined);
            },
            onSave: (draft, confirmed) => { void save(peer, draft, confirmed); },
            onClearRecords: () => { void clearRecords(peer); },
          }), settingsVisible ? settingsSections.map(section =>
            h(ExtensionSettingsGroup, {
              key: `${peerKey}:${section.id}`, section, appId, scope: peer.scope, openId: peer.openId,
            })) : null) : h(Fragment, null,
            h('header', { className: 'imqw-column-head' }, h('h2', null, t("会话设置")), closeButton),
            h('p', { className: 'imqw-muted' }, t("选择群聊或联系人后可以编辑。"))),
    ),
    newSession ? h(Modal, {
      open: true, title: t("新建 QQ Session"), closeLabel: t("关闭"),
      className: styles.dialog,
      description: t("{0} · {1}。创建成功后，QQ 新消息会进入新 Session，原有记录可从历史打开。", accountName(robot), peerName(newSession.peer)),
      onClose: () => { if (!mutation.current) setNewSession(undefined); },
      footer: h(Fragment, null,
        h(Button, { type: 'button', variant: 'ghost', disabled: !!busyKey, onClick: () => setNewSession(undefined) }, t("取消")),
        h(Button, { type: 'button', variant: 'primary', disabled: !!busyKey, onClick: () => { void createSession(); } },
          busyKey ? t("正在创建…") : t("创建并切换")),
      ),
    }, h(WorkbenchAgentFields, {
      source: agentSource, settings: newSession.settings, disabled: !!busyKey, placementOnly: true,
      onChange: patch => setNewSession(current => current && { ...current, settings: { ...current.settings, ...patch } }),
    }), createError ? h('p', { className: 'imqb-error', role: 'alert' }, createError) : null) : null,
    h('nav', { className: 'imqw-small-nav', 'aria-label': t("工作台页面") },
      h(Button, { variant: 'outline', size: 'sm', onClick: () => onSmallPage('list') }, t("会话列表")),
      h(Button, { variant: 'outline', size: 'sm', onClick: () => onSmallPage('conversation') }, t("会话")),
      h(Button, {
        variant: 'outline', size: 'sm', disabled: !peer,
        className: 'imqw-settings-trigger', 'aria-controls': settingsId,
        'aria-expanded': settingsVisible, onClick: toggleSettings,
      }, t("会话设置")),
    ),
  );
}

function ExtensionSettingsGroup({ section, appId, scope, openId }: {
  section: QqWorkbenchSettingsSection;
  appId: string;
  scope: WorkbenchConversation['scope'];
  openId: string;
}): ReactNode {
  const [opened, setOpened] = useState(false);
  const [props] = useState(() => extensionSettingsProps(section.id, { appId, scope, openId }));
  return h('details', {
    className: 'imqw-settings-group imqw-extension-settings',
    onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => { if (event.currentTarget.open) setOpened(true); },
  },
    h('summary', null, h(IconChevronDownOutlineRegular, { size: 14 }), h('strong', null, section.title)),
    opened ? h('div', { className: 'imqw-settings-group-body' }, h(section.component, props)) : null,
  );
}
