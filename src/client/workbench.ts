import { createElement as h, Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Button, IconChevronDownOutlineRegular, IconEllipsisOutlineRegular, IconSettingsOutlineRegular, Input, Menu, Modal, SegmentedControl, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import {
  WORKBENCH_CONVERSATIONS_PATH,
  WORKBENCH_NEW_SESSION_PATH,
  type WorkbenchConversation,
  type WorkbenchConversationPatch,
  type WorkbenchNewSession,
  type WorkbenchSession,
} from '../shared/workbench-conversation-protocol.ts';
import type { WorkbenchRobot } from '../shared/workbench-protocol.ts';
import { fetchJson, HttpError } from './http.ts';
import { accountName, RobotAccounts, ROBOT_STATE_LABELS, type RobotAccountsProps } from './robot-accounts.ts';
import { QqTimelineView } from './workbench-timeline.ts';
import { useWorkbenchLayout } from './workbench-layout.ts';
import { WORKBENCH_STYLES } from './workbench-styles.ts';
import { WorkbenchAgentFields, WorkbenchReplyFields, type AgentFormSource } from './workbench-agent-form.ts';
import { readDefaults, WorkbenchDefaultsForm } from './workbench-defaults.ts';
import type { WorkbenchAgentSettings } from '../shared/workbench-agent-settings.ts';

type Filter = 'all' | WorkbenchConversation['scope'];
type SmallPage = 'list' | 'conversation' | 'settings';
type EditableSettings = Pick<WorkbenchConversation, 'alias' | 'receiving' | 'recording' | 'agent'>;

interface Draft extends EditableSettings {
  baseline: EditableSettings & Pick<WorkbenchConversation, 'revision'>;
}

interface Navigation {
  appId?: string;
  collapsed: boolean;
  peerSettingsOpen: boolean;
  smallPage: SmallPage;
}

const lastNavigation: Navigation = { collapsed: false, peerSettingsOpen: true, smallPage: 'list' };
const peerSelections = new Map<string, string>();
const expandedPeers = new Set<string>();
const showAllSessions = new Set<string>();
const peerDrafts = new Map<string, Draft>();
const filters = [
  { value: 'all', label: '全部' }, { value: 'group', label: '群聊' }, { value: 'c2c', label: '私聊' },
] satisfies Array<{ value: Filter; label: string }>;
const sessionPreviewLimit = 5;
const timeFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });

function conversationKey({ scope, openId }: WorkbenchConversation): string {
  return scope + ':' + openId;
}

function scopedKey(appId: string, peer: WorkbenchConversation): string {
  return JSON.stringify([appId, peer.scope, peer.openId]);
}

function peerName(peer: WorkbenchConversation): string {
  return peer.alias || peer.name || `${peer.scope === 'group' ? '群聊' : '私聊'} ${peer.openId.slice(-8)}`;
}

function sessionDate(session: WorkbenchSession): string {
  const time = new Date(session.createdAt);
  return Number.isFinite(time.valueOf()) ? timeFormat.format(time) : '';
}

function workspaceName(cwd: string | undefined): string {
  return cwd?.split(/[\\/]/).filter(Boolean).at(-1) || cwd || '';
}

function receivingLabel(robot: WorkbenchRobot, peer: WorkbenchConversation): string {
  if (!robot.enabled) return '机器人已停用';
  if (!peer.admitted) return '未获准接入';
  if (!peer.receiving) return '已暂停接收';
  if (robot.state !== 'connected') return ROBOT_STATE_LABELS[robot.state];
  return peer.currentSessionId ? '当前接收' : '等待首个 Session';
}

function accessLabel(robot: WorkbenchRobot, peer: WorkbenchConversation): string {
  const mode = peer.scope === 'group' ? robot.access.groupMode : robot.access.c2cMode;
  return { open: '所有人', allowlist: '白名单', disabled: '关闭' }[mode];
}

function selectDraft(peer: WorkbenchConversation): Draft {
  const { alias, receiving, recording, agent, revision } = peer;
  return { alias, receiving, recording, agent, baseline: { alias, receiving, recording, agent, revision } };
}

function changes(draft: Draft): Partial<EditableSettings> {
  return {
    ...(draft.alias !== draft.baseline.alias ? { alias: draft.alias } : {}),
    ...(draft.receiving !== draft.baseline.receiving ? { receiving: draft.receiving } : {}),
    ...(draft.recording !== draft.baseline.recording ? { recording: draft.recording } : {}),
    ...(JSON.stringify(draft.agent) !== JSON.stringify(draft.baseline.agent) ? { agent: draft.agent } : {}),
  };
}

function mergeDraft(peer: WorkbenchConversation, draft: Draft, edited: Partial<EditableSettings>): Draft {
  const latest = selectDraft(peer);
  const next = { ...latest, ...edited };
  const { agent } = edited;
  const baseline = draft.baseline.agent;
  if (latest.agent && agent && baseline) {
    const merged: WorkbenchAgentSettings = { ...latest.agent };
    const copyIfChanged = <K extends keyof WorkbenchAgentSettings>(key: K): void => {
      if (JSON.stringify(agent[key]) !== JSON.stringify(baseline[key])) merged[key] = agent[key];
    };
    for (const key of Object.keys(merged) as Array<keyof WorkbenchAgentSettings>) copyIfChanged(key);
    next.agent = merged;
  }
  return next;
}

interface SessionNavigation {
  openSession?: (id: string) => void;
  sessionTitle?: (id: string) => string | undefined;
  workspaceTitle?: (id: string, cwd?: string) => string | undefined;
}

export interface QQWorkbenchProps extends SessionNavigation {
  primarySettings: ReactNode;
  primaryAccountSettings: ReactNode;
  agentSource?: AgentFormSource;
}

export function QQWorkbench({ primarySettings, primaryAccountSettings, agentSource, ...sessionNavigation }: QQWorkbenchProps): ReactNode {
  const [nav, setNav] = useState(() => ({ ...lastNavigation }));
  const [robotSettings, setRobotSettings] = useState(false);
  const [robotPage, setRobotPage] = useState('account');
  const robotTabsId = useId();
  const layout = useWorkbenchLayout(nav.collapsed, !robotSettings, nav.peerSettingsOpen);

  const navigate = (patch: Partial<Navigation>): void => {
    Object.assign(lastNavigation, patch);
    setNav({ ...lastNavigation });
  };
  const selectRobot = (appId: string): void => {
    setRobotSettings(false);
    if (nav.appId === appId) return;
    navigate({ appId, smallPage: 'list' });
  };

  return h<RobotAccountsProps>(RobotAccounts, {
    selectedAppId: nav.appId,
    onSelect: selectRobot,
    workbench: {
      collapsed: layout.iconsOnly,
      compact: layout.compact,
      onToggleCollapse: () => navigate({ collapsed: !nav.collapsed }),
      onOpenSettings: appId => {
        if (nav.appId !== appId) navigate({ appId });
        setRobotPage('account');
        setRobotSettings(true);
      },
      render: ({ robots, unavailable, rail, accountSettings }) => {
        if (unavailable) return h('div', { className: 'imqb-pluginPage' },
          h('div', { className: 'imqb-pluginPageContent' }, primarySettings));
        const robot = robots?.find(candidate => candidate.appId === nav.appId) ?? robots?.[0];
        const showRobotSettings = Boolean(robotSettings && robot && accountSettings);
        return h('div', { className: 'imqw-root', ref: layout.root },
          h('style', null, WORKBENCH_STYLES),
          h('div', {
            className: 'imqw-layout', 'data-collapsed': layout.iconsOnly, 'data-single-page': layout.singlePage,
            style: {
              '--imqw-rail': `${layout.railWidth}px`, '--imqw-tree': `${layout.treeWidth}px`,
              '--imqw-settings': `${layout.settingsWidth}px`,
            } as CSSProperties,
          },
            h('aside', { className: 'imqw-robots', 'aria-label': '机器人列表' }, rail),
            layout.divider('robots'),
            h('div', { className: 'imqw-content' },
              robot ? h('div', {
                className: 'imqw-conversation-grid', hidden: showRobotSettings,
                'data-settings': nav.peerSettingsOpen, 'data-page': nav.smallPage,
              }, h(RobotConversations, {
                key: robot.appId, robot, agentSource, settingsOpen: nav.peerSettingsOpen,
                settingsVisible: nav.peerSettingsOpen && (!layout.singlePage || nav.smallPage === 'settings'),
                singlePage: layout.singlePage, ...sessionNavigation,
                treeDivider: layout.divider('tree'), settingsDivider: layout.divider('settings'),
                onToggleSettings: open => navigate({ peerSettingsOpen: open, smallPage: open ? 'settings' : 'conversation' }),
                onSmallPage: page => navigate({ smallPage: page }),
              })) : h('section', { className: 'imqw-empty' },
                robots?.length === 0 ? primarySettings : h('p', { role: 'status' }, rail ? '机器人列表暂不可用' : '正在读取机器人…')),
              showRobotSettings && robot ? h('section', { className: 'imqw-robot-settings', 'aria-label': '机器人设置' },
                h('div', { className: 'imqw-robot-settings-inner' },
                  h('header', { className: 'imqw-column-head imqw-robot-settings-head' },
                    h('div', null, h('h2', null, '机器人设置'),
                      h('p', { className: 'imqw-muted' }, `${accountName(robot)} · ${ROBOT_STATE_LABELS[robot.state]}`)),
                    h(Button, { size: 'sm', variant: 'outline', onClick: () => setRobotSettings(false) }, '返回会话')),
                  h(SegmentedControl, { id: robotTabsId, label: '机器人设置页面', value: robotPage,
                    options: [{ value: 'account', label: '账号与权限' }, { value: 'defaults', label: '新会话默认设置' }],
                    onChange: setRobotPage,
                  }),
                  h('div', { className: 'imqw-robot-tab', role: 'tabpanel', id: `${robotTabsId}-account-panel`, 'aria-labelledby': `${robotTabsId}-account`, hidden: robotPage !== 'account' },
                    accountSettings,
                    robot.primary ? h('section', { className: 'imqw-primary-settings', 'aria-label': '凭据与访问' },
                      h('h3', null, '凭据与访问'),
                      primaryAccountSettings,
                    ) : null),
                  h('div', { className: 'imqw-robot-tab', role: 'tabpanel', id: `${robotTabsId}-defaults-panel`, 'aria-labelledby': `${robotTabsId}-defaults`, hidden: robotPage !== 'defaults' },
                    h(WorkbenchDefaultsForm, { key: robot.appId, appId: robot.appId, source: agentSource })),
                ),
              ) : null,
            ),
          ),
        );
      },
    },
  });
}

interface RobotConversationsProps extends SessionNavigation {
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

function RobotConversations({ robot, agentSource, settingsOpen, settingsVisible, singlePage, treeDivider, settingsDivider, openSession, sessionTitle, workspaceTitle, onToggleSettings, onSmallPage }: RobotConversationsProps): ReactNode {
  const { appId } = robot;
  const [peers, setPeers] = useState<WorkbenchConversation[] | null>(null);
  const [selection, setSelection] = useState(() => peerSelections.get(appId));
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [reload, setReload] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [openError, setOpenError] = useState('');
  const [sessionNotice, setSessionNotice] = useState<{ key: string; text: string }>();
  const [newSession, setNewSession] = useState<{ peer: WorkbenchConversation; settings: WorkbenchAgentSettings }>();
  const [createError, setCreateError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [busyKey, setBusyKey] = useState<string>();
  const [feedback, setFeedback] = useState<{ key: string; message: string }>();
  const [, redraw] = useState(0);
  const mutation = useRef<AbortController | null>(null);
  const generation = useRef(0);
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
    'aria-label': '收起设置栏', onClick: closeSettings,
  }, '收起');

  useEffect(() => () => { mutation.current?.abort(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async (): Promise<void> => {
      const started = generation.current;
      const current = (): boolean => !controller.signal.aborted && !mutation.current && started === generation.current;
      try {
        const params = new URLSearchParams({ appId });
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
        else setLoadError(error instanceof Error ? error.message : '无法读取 QQ 会话');
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
  const label = peer ? receivingLabel(robot, peer) : '';

  const save = async (target: WorkbenchConversation, draft: Draft): Promise<void> => {
    if (mutation.current) return;
    const key = scopedKey(appId, target);
    const controller = new AbortController();
    const patch: WorkbenchConversationPatch = {
      appId, scope: target.scope, openId: target.openId, revision: draft.baseline.revision, ...changes(draft),
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
        throw new Error('会话标识不一致，请刷新后重试。');
      }
      peerDrafts.delete(key);
      setPeers(rows => rows?.map(item => conversationKey(item) === conversationKey(target) ? result.conversation : item) ?? null);
    } catch (error) {
      if (controller.signal.aborted) return;
      setFeedback({
        key,
        message: error instanceof Error ? error.message : '无法保存会话设置。',
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
      if (typeof result.sessionId !== 'string' || !result.sessionId) throw new Error('未能确认新 Session，请刷新会话列表。');
      expandedPeers.add(key);
      setNewSession(undefined);
      setSessionNotice({ key, text: '新 Session 已创建。下一条 QQ 消息会进入这个 Session。' });
    } catch (error) {
      if (controller.signal.aborted) return;
      setCreateError(error instanceof Error ? error.message : '无法新建 QQ Session。');
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

  const openNative = (id: string): void => {
    setOpenError('');
    try { openSession?.(id); }
    catch (error) { setOpenError(error instanceof Error ? error.message : '无法打开原生 Session，请稍后重试。'); }
  };
  const selectPeer = (item: WorkbenchConversation): void => {
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

  return h(Fragment, null,
    h('aside', { className: 'imqw-tree', 'aria-label': 'QQ 会话列表' },
      h('header', { className: 'imqw-column-head' },
        h('h2', null, 'QQ 会话'),
        h(Button, { variant: 'ghost', size: 'sm', onClick: () => setReload(value => value + 1) }, '刷新')),
      h('p', { className: 'imqw-muted imqw-tree-caption' }, accountName(robot)),
      h(Input, {
        type: 'search', value: query, onChange: event => setQuery(event.currentTarget.value),
        placeholder: '搜索会话', 'aria-label': '搜索 QQ 会话',
      }),
      h(SegmentedControl<Filter>, { id: filterId, value: filter, options: filters, onChange: setFilter, label: '会话类型' }),
      loadError ? h('p', { className: 'imqb-error', role: 'alert' }, loadError) : null,
      unavailable ? h('p', { className: 'imqw-muted' }, '此宿主暂不提供 QQ 会话列表。') : null,
      !peers && !loadError && !unavailable ? h('p', { className: 'imqw-muted', role: 'status' }, '正在读取会话…') : null,
      peers && visiblePeers.length === 0 ? h('p', { className: 'imqw-muted' }, peers.length ? '没有符合条件的会话。' : '暂无 QQ 会话。') : null,
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
                  disabled: !item.sessions.length, 'aria-expanded': expanded,
                  'aria-label': `${expanded ? '收起' : '展开'} ${peerName(item)} 的 Session`,
                  onClick: () => {
                    if (expanded) expandedPeers.delete(key);
                    else expandedPeers.add(key);
                    redraw(value => value + 1);
                  },
                }, h(IconChevronDownOutlineRegular, { size: 14 })),
                h('button', {
                  className: 'imqw-peer-select', type: 'button', 'aria-pressed': item === peer, onClick: () => selectPeer(item),
                }, h('strong', { title: peerName(item) }, peerName(item)), h('span', { className: 'imqw-muted' }, receivingLabel(robot, item))),
              ),
              expanded ? h('ul', { className: 'imqw-sessions' },
                list.map(session => {
                  const activeSession = session.id === item.currentSessionId;
                  const title = sessionTitle?.(session.id)?.trim() || `Session ${session.id.slice(-8)}`;
                  return h('li', { key: session.id }, h('button', {
                    className: 'imqw-session', type: 'button', 'data-session-id': session.id, disabled: !openSession,
                    onClick: () => openNative(session.id), title: session.cwd || title,
                  },
                    h('span', { className: 'imqw-session-title' }, title),
                    h('span', { className: 'imqw-muted' }, [
                      activeSession ? receivingLabel(robot, item) : '历史',
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
                }, showAll ? '收起历史' : `另有 ${hiddenCount} 个 Session`)) : null,
              ) : null,
            );
          }),
        );
      }),
    ),
    treeDivider,
    h('section', { className: 'imqw-conversation', 'aria-label': '当前 QQ 会话' },
      h('header', { className: 'imqw-column-head imqw-main-head' },
        h('div', null,
          h('h2', { title: peer && peerName(peer) }, peer ? peerName(peer) : accountName(robot)),
          h('p', { className: 'imqw-muted' }, peer ? `${peer.scope === 'group' ? '群聊' : '私聊'} · ${label}` : '请从会话列表选择对话')),
        h('div', { className: 'imqw-actions' },
          current ? h(Button, { size: 'sm', variant: 'outline', disabled: !openSession, onClick: () => openNative(current.id) }, '打开当前 Session') : null,
          peer ? h(Button, {
            size: 'sm', variant: 'outline', type: 'button',
            disabled: !peer.agent || !peer.admitted || !peer.receiving || !robot.enabled || robot.state !== 'connected' || !!busyKey,
            onClick: openNewSession,
          }, '新建 Session') : null,
          peer ? h(Button, {
            ref: settingsTrigger, size: 'sm', variant: 'outline',
            className: 'imqw-settings-trigger', 'aria-controls': settingsId,
            'aria-expanded': settingsVisible, onClick: toggleSettings,
          }, h(IconSettingsOutlineRegular, { size: 14 }), '会话设置') : null,
        ),
      ),
      openError ? h('p', { className: 'imqb-error', role: 'alert' }, openError) : null,
      sessionNotice && sessionNotice.key === peerKey ? h('p', { className: 'imqw-muted', role: 'status' }, sessionNotice.text) : null,
      current ? h('p', { className: 'imqw-muted imqw-session-caption' }, [
        sessionTitle?.(current.id),
        workspaceTitle?.(current.id, current.cwd) || workspaceName(current.cwd),
        current.preset,
      ].filter(Boolean).join(' · ')) : null,
      peer ? h(QqTimelineView, { key: peerKey, appId, peer, robotName: accountName(robot), openSession: openSession && openNative,
        disabledReason: !robot.enabled || robot.state !== 'connected' ? '机器人未连接'
          : !peer.admitted ? '此会话未获准接入' : !peer.receiving ? '此会话已暂停' : undefined }) : null,
    ),
    settingsDivider,
    h('aside', { id: settingsId, className: 'imqw-settings', 'aria-label': '会话设置', hidden: !settingsOpen },
      peer && peerKey ? h(ConversationSettings, {
            key: peerKey, robot, peer, agentSource, closeButton,
            workspace: current && workspaceTitle?.(current.id, current.cwd), draft: peerDrafts.get(peerKey) ?? selectDraft(peer),
            busy: busyKey === peerKey, feedback: feedback?.key === peerKey ? feedback : undefined,
            onEdit: draft => {
              if (Object.keys(changes(draft)).length > 0) peerDrafts.set(peerKey, draft);
              else peerDrafts.delete(peerKey);
              redraw(value => value + 1);
              setFeedback(undefined);
            },
            onSave: draft => { void save(peer, draft); },
          }) : h(Fragment, null,
            h('header', { className: 'imqw-column-head' }, h('h2', null, '会话设置'), closeButton),
            h('p', { className: 'imqw-muted' }, '选择群聊或联系人后可以编辑。')),
    ),
    newSession ? h(Modal, {
      open: true, title: '新建 QQ Session', closeLabel: '关闭',
      description: `${accountName(robot)} · ${peerName(newSession.peer)}。创建成功后，QQ 新消息会进入新 Session，原有记录可从历史打开。`,
      onClose: () => { if (!mutation.current) setNewSession(undefined); },
      footer: h(Fragment, null,
        h(Button, { type: 'button', variant: 'ghost', disabled: !!busyKey, onClick: () => setNewSession(undefined) }, '取消'),
        h(Button, { type: 'button', variant: 'primary', disabled: !!busyKey, onClick: () => { void createSession(); } },
          busyKey ? '正在创建…' : '创建并切换'),
      ),
    }, h(WorkbenchAgentFields, {
      source: agentSource, settings: newSession.settings, disabled: !!busyKey, placementOnly: true,
      onChange: patch => setNewSession(current => current && { ...current, settings: { ...current.settings, ...patch } }),
    }), createError ? h('p', { className: 'imqb-error', role: 'alert' }, createError) : null) : null,
    h('nav', { className: 'imqw-small-nav', 'aria-label': '工作台页面' },
      h(Button, { variant: 'outline', size: 'sm', onClick: () => onSmallPage('list') }, '会话列表'),
      h(Button, { variant: 'outline', size: 'sm', onClick: () => onSmallPage('conversation') }, '会话'),
      h(Button, {
        variant: 'outline', size: 'sm', disabled: !peer,
        className: 'imqw-settings-trigger', 'aria-controls': settingsId,
        'aria-expanded': settingsVisible, onClick: toggleSettings,
      }, '会话设置'),
    ),
  );
}

function SettingsGroup({ title, hint, defaultOpen, children }: { title: string; hint?: string; defaultOpen?: boolean; children: ReactNode }): ReactNode {
  return h('details', { className: 'imqw-settings-group', open: defaultOpen },
    h('summary', null, h(IconChevronDownOutlineRegular, { size: 14 }), h('strong', null, title),
      hint ? h('span', { className: 'imqw-muted' }, hint) : null),
    h('div', { className: 'imqw-settings-group-body' }, children));
}

interface ConversationSettingsProps {
  robot: WorkbenchRobot;
  peer: WorkbenchConversation;
  agentSource?: AgentFormSource;
  closeButton: ReactNode;
  workspace?: string;
  draft: Draft;
  busy: boolean;
  feedback?: { message: string };
  onEdit: (draft: Draft) => void;
  onSave: (draft: Draft) => void;
}

function ConversationSettings({ robot, peer, agentSource, closeButton, workspace, draft, busy, feedback, onEdit, onSave }: ConversationSettingsProps): ReactNode {
  const [adoptError, setAdoptError] = useState('');
  const [reading, setReading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const edited = changes(draft);
  const dirty = Object.keys(edited).length > 0;
  const stale = dirty && draft.baseline.revision !== peer.revision;
  const current = peer.sessions.find(session => session.id === peer.currentSessionId);
  const agent = draft.agent;
  const disabled = busy || reading;
  const fields = agent ? {
    settings: agent, disabled,
    onChange: (patch: Partial<WorkbenchAgentSettings>) => onEdit({ ...draft, agent: { ...agent, ...patch } }),
  } : undefined;
  const adopt = async (): Promise<void> => {
    setReading(true);
    setAdoptError('');
    try {
      const { settings } = await readDefaults(robot.appId);
      if (!agent) return;
      onEdit({ ...draft, agent: {
        ...settings,
        ...(peer.scope === 'group' ? { directPrompt: agent.directPrompt, streaming: agent.streaming } : { groupPrompt: agent.groupPrompt }),
      } });
    } catch (error) {
      setAdoptError(error instanceof Error ? error.message : '无法读取机器人默认设置。');
    } finally {
      setReading(false);
    }
  };

  return h('form', { className: 'imqw-form', onSubmit: (event: FormEvent) => {
    event.preventDefault();
    if (dirty && !stale && !busy && !reading) onSave(draft);
  } },
    h('header', { className: 'imqw-column-head' },
      h('div', null, h('h2', null, '会话设置'), h('p', { className: 'imqw-muted', title: peerName(peer) }, peerName(peer))),
      h('div', { className: 'imqw-actions' },
        agent ? h(Menu, {
          open: menuOpen, onClose: () => setMenuOpen(false), portal: true, autoFocus: true,
          items: [{ id: 'adopt-defaults', label: '采用机器人当前默认值', disabled }],
          onSelect: () => { setMenuOpen(false); if (!disabled) void adopt(); },
          anchor: h(Button, { type: 'button', size: 'sm', variant: 'ghost', disabled,
            'aria-label': '更多会话设置', 'aria-haspopup': 'menu', 'aria-expanded': menuOpen,
            onClick: () => setMenuOpen(open => !open),
          }, h(IconEllipsisOutlineRegular, { size: 16 })),
        }) : null,
        closeButton)),
    h(SettingsGroup, { title: '概览与接收', defaultOpen: true, children: h(Fragment, null,
      h('label', { className: 'imqw-field' },
        h('span', null, '会话备注'),
        h(Input, {
          value: draft.alias, maxLength: 120, placeholder: peer.name || '未设置备注', disabled,
          onChange: event => onEdit({ ...draft, alias: event.currentTarget.value }),
        })),
      h('div', { className: 'imqw-receiving' },
        h('span', null, '接收 QQ 消息'),
        h(Switch, {
          checked: draft.receiving, label: '接收 QQ 消息', disabled,
          onChange: receiving => onEdit({ ...draft, receiving }),
        })),
      !peer.admitted ? h('p', { className: 'imqw-muted' }, '此对话未获机器人接入许可。') : null,
      h('details', { className: 'imqw-settings-meta' },
        h('summary', null, '对话详情'),
        h('dl', { className: 'imqw-details' },
          h('dt', null, '接入规则'), h('dd', null, accessLabel(robot, peer)),
          h('dt', null, 'OpenID'), h('dd', null, h('code', null, peer.openId)),
        )),
    ) }),
    fields ? h(Fragment, null,
      h(SettingsGroup, { title: 'Agent 基本设置', children: h(Fragment, null,
        current ? h('p', { className: 'imqw-muted' }, ['当前 Session', workspace || workspaceName(current.cwd), current.preset].filter(Boolean).join(' · ')) : null,
        h('p', { className: 'imqw-muted' }, 'Agent 选项用于下次新建；工具限制保存即生效。'),
        h(WorkbenchAgentFields, { ...fields, source: agentSource }),
      ) }),
      h(SettingsGroup, { title: 'QQ 回复', hint: '后续回复生效', children: h(WorkbenchReplyFields, { ...fields, scope: peer.scope }) }),
    ) : null,
    h(SettingsGroup, { title: '消息记录', children: h('div', { className: 'imqw-receiving' },
      h('div', null, h('span', null, '保存 QQ 消息'),
        !draft.recording ? h('p', { className: 'imqw-muted' }, '已有记录保留。') : null),
      h(Switch, { checked: draft.recording, label: '保存 QQ 消息', disabled, onChange: recording => onEdit({ ...draft, recording }) }),
    ) }),
    reading ? h('p', { className: 'imqw-muted', role: 'status' }, '正在读取默认值…') : null,
    adoptError ? h('p', { className: 'imqb-error', role: 'alert' }, adoptError) : null,
    stale ? h('div', { className: 'imqw-conflict' },
      h('p', { className: 'imqb-error', role: 'alert' }, '会话设置已更新。请确认是否将草稿中的改动合并到最新设置。'),
      h(Button, {
        type: 'button', size: 'sm', variant: 'outline', disabled,
        onClick: () => onEdit(mergeDraft(peer, draft, edited)),
      }, '合并草稿')) : null,
    feedback ? h('p', { className: 'imqb-error', role: 'alert' }, feedback.message) : null,
    h('footer', { className: 'imqw-actions imqw-savebar' },
      h(Button, { type: 'button', size: 'sm', variant: 'ghost', disabled: disabled || !dirty, onClick: () => onEdit(selectDraft(peer)) }, '放弃修改'),
      h(Button, { type: 'submit', size: 'sm', variant: 'primary', disabled: disabled || !dirty || stale }, busy ? '保存中…' : '保存更改'),
    ),
  );
}
