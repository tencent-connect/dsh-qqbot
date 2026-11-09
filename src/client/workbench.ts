import { createElement as h, Fragment, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, IconChevronDownOutlineRegular, Input, SegmentedControl, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import {
  WORKBENCH_CONVERSATIONS_PATH,
  type WorkbenchConversation,
  type WorkbenchConversationPatch,
  type WorkbenchSession,
} from '../shared/workbench-conversation-protocol.ts';
import type { WorkbenchRobot } from '../shared/workbench-protocol.ts';
import { fetchJson, HttpError } from './http.ts';
import { accountName, RobotAccounts, ROBOT_STATE_LABELS, type RobotAccountsProps } from './robot-accounts.ts';
import { WORKBENCH_STYLES } from './workbench-styles.ts';

type Filter = 'all' | WorkbenchConversation['scope'];
type SmallPage = 'list' | 'conversation' | 'settings';
type SettingsPanel = 'peer' | 'robot' | 'legacy' | 'closed';
type EditableSettings = Pick<WorkbenchConversation, 'alias' | 'receiving'>;

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
  const { alias, receiving, revision } = peer;
  return { alias, receiving, baseline: { alias, receiving, revision } };
}

function changes(draft: Draft): Partial<EditableSettings> {
  return {
    ...(draft.alias !== draft.baseline.alias ? { alias: draft.alias } : {}),
    ...(draft.receiving !== draft.baseline.receiving ? { receiving: draft.receiving } : {}),
  };
}

interface SessionNavigation {
  openSession?: (id: string) => void;
  sessionTitle?: (id: string) => string | undefined;
  workspaceTitle?: (id: string, cwd?: string) => string | undefined;
}

export interface QQWorkbenchProps extends SessionNavigation {
  legacySettings: ReactNode;
}

export function QQWorkbench({ legacySettings, ...sessionNavigation }: QQWorkbenchProps): ReactNode {
  const [nav, setNav] = useState(() => ({ ...lastNavigation }));
  const [panel, setPanel] = useState<SettingsPanel>(() => nav.peerSettingsOpen ? 'peer' : 'closed');

  const navigate = (patch: Partial<Navigation>): void => {
    Object.assign(lastNavigation, patch);
    setNav({ ...lastNavigation });
  };
  const showPanel = (next: SettingsPanel): void => {
    setPanel(next);
    navigate({
      ...(next === 'peer' || next === 'closed' ? { peerSettingsOpen: next === 'peer' } : {}),
      smallPage: next === 'closed' ? 'conversation' : 'settings',
    });
  };
  const selectRobot = (appId: string): void => {
    if (nav.appId === appId) return;
    setPanel(nav.peerSettingsOpen ? 'peer' : 'closed');
    navigate({ appId, smallPage: 'list' });
  };

  return h<RobotAccountsProps>(RobotAccounts, {
    selectedAppId: nav.appId,
    onSelect: selectRobot,
    workbench: {
      collapsed: nav.collapsed,
      onToggleCollapse: () => navigate({ collapsed: !nav.collapsed }),
      onOpenSettings: appId => {
        navigate({ appId, smallPage: 'settings' });
        setPanel('robot');
      },
      onCloseSettings: () => showPanel('closed'),
      render: ({ robots, unavailable, rail, accountSettings }) => {
        if (unavailable) return h('div', { className: 'imqb-pluginPage' },
          h('div', { className: 'imqb-pluginPageContent' }, legacySettings));
        const robot = robots?.find(candidate => candidate.appId === nav.appId) ?? robots?.[0];
        const visiblePanel = panel === 'robot' && accountSettings === null ? 'closed' : panel;
        const settings = visiblePanel === 'robot'
          ? h(Fragment, null, accountSettings, robot?.primary ? h('div', { className: 'imqw-legacy' }, legacySettings) : null)
          : legacySettings;
        return h('div', { className: 'imqw-root' },
          h('style', null, WORKBENCH_STYLES),
          h('div', {
            className: 'imqw-layout', 'data-collapsed': nav.collapsed, 'data-settings': Boolean(robot && visiblePanel !== 'closed'),
            'data-page': nav.smallPage === 'settings' && visiblePanel === 'closed' ? 'conversation' : nav.smallPage,
            'data-empty': !robot || undefined,
          },
            h('aside', { className: 'imqw-robots', 'aria-label': '机器人列表' }, rail),
            robot
              ? h(RobotConversations, {
                  key: robot.appId, robot, panel: visiblePanel, settings, ...sessionNavigation,
                  onShowPanel: showPanel, onSmallPage: page => navigate({ smallPage: page }),
                })
              : h('section', { className: 'imqw-empty' },
                  robots?.length === 0 ? legacySettings : h('p', { role: 'status' }, rail ? '机器人列表暂不可用' : '正在读取机器人…')),
          ),
        );
      },
    },
  });
}

interface RobotConversationsProps extends SessionNavigation {
  robot: WorkbenchRobot;
  panel: SettingsPanel;
  settings: ReactNode;
  onShowPanel: (next: SettingsPanel) => void;
  onSmallPage: (page: SmallPage) => void;
}

function RobotConversations({ robot, panel, settings, openSession, sessionTitle, workspaceTitle, onShowPanel, onSmallPage }: RobotConversationsProps): ReactNode {
  const { appId } = robot;
  const [peers, setPeers] = useState<WorkbenchConversation[] | null>(null);
  const [selection, setSelection] = useState(() => peerSelections.get(appId));
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [reload, setReload] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [openError, setOpenError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [busyKey, setBusyKey] = useState<string>();
  const [feedback, setFeedback] = useState<{ key: string; message: string }>();
  const [, redraw] = useState(0);
  const mutation = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const filterId = useId();

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
    if (panel === 'robot' || panel === 'legacy') onShowPanel('peer');
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
    h('section', { className: 'imqw-conversation', 'aria-label': '当前 QQ 会话' },
      h('header', { className: 'imqw-column-head imqw-main-head' },
        h('div', null,
          h('h2', { title: peer && peerName(peer) }, peer ? peerName(peer) : accountName(robot)),
          h('p', { className: 'imqw-muted' }, peer ? `${peer.scope === 'group' ? '群聊' : '私聊'} · ${label}` : '请从会话列表选择对话')),
        h('div', { className: 'imqw-actions' },
          current ? h(Button, { size: 'sm', variant: 'primary', disabled: !openSession, onClick: () => openNative(current.id) }, '打开当前 Session') : null,
          peer ? h(Button, {
            size: 'sm', variant: 'outline', 'aria-expanded': panel === 'peer', onClick: () => onShowPanel('peer'),
          }, '会话设置') : null,
          robot.primary ? h(Button, { size: 'sm', variant: 'ghost', onClick: () => onShowPanel('legacy') }, '绑定与原设置') : null,
        ),
      ),
      openError ? h('p', { className: 'imqb-error', role: 'alert' }, openError) : null,
      peer ? h('div', { className: 'imqw-summary' },
        h('h3', null, '当前 Session'),
        current ? h(SessionDetails, { session: current, title: sessionTitle?.(current.id), workspace: workspaceTitle?.(current.id, current.cwd) })
          : h('p', { className: 'imqw-muted' }, '此 QQ 会话尚无正在接收的 Session。'),
        current && !openSession ? h('p', { className: 'imqw-muted' }, '当前宿主未提供原生 Session 导航。') : null,
        h('p', { className: 'imqw-note' }, '此处暂未接入 QQ 消息记录。请打开原生 Session 查看已进入 DSH 的消息。'),
      ) : null,
    ),
    panel !== 'closed' ? h('aside', { className: 'imqw-settings', 'aria-label': panel === 'peer' ? '会话设置' : '机器人设置' },
      h('header', { className: 'imqw-column-head' },
        h('h2', null, panel === 'peer' ? '会话设置' : panel === 'robot' ? '机器人设置' : '绑定与原设置'),
        h(Button, {
          size: 'sm', variant: 'ghost', 'aria-label': '收起设置栏', onClick: () => onShowPanel('closed'),
        }, '收起')),
      h('p', { className: 'imqw-muted imqw-tree-caption' }, panel === 'peer' && peer ? peerName(peer) : accountName(robot)),
      panel === 'peer'
        ? peer && peerKey ? h(ConversationSettings, {
            key: peerKey, robot, peer, workspace: current && workspaceTitle?.(current.id, current.cwd), draft: peerDrafts.get(peerKey) ?? selectDraft(peer),
            busy: busyKey === peerKey, feedback: feedback?.key === peerKey ? feedback : undefined,
            onEdit: draft => {
              if (Object.keys(changes(draft)).length > 0) peerDrafts.set(peerKey, draft);
              else peerDrafts.delete(peerKey);
              redraw(value => value + 1);
              setFeedback(undefined);
            },
            onSave: draft => { void save(peer, draft); },
          }) : h('p', { className: 'imqw-muted' }, '选择群聊或联系人后可以编辑。')
        : settings,
    ) : null,
    h('nav', { className: 'imqw-small-nav', 'aria-label': '工作台页面' },
      h(Button, { variant: 'outline', size: 'sm', onClick: () => onSmallPage('list') }, '会话列表'),
      h(Button, { variant: 'outline', size: 'sm', onClick: () => onSmallPage('conversation') }, '会话'),
      h(Button, {
        variant: 'outline', size: 'sm', disabled: !peer && panel === 'closed',
        onClick: () => panel === 'closed' ? onShowPanel('peer') : onSmallPage('settings'),
      }, '设置'),
    ),
  );
}

function SessionDetails({ session, title, workspace }: { session: WorkbenchSession; title?: string; workspace?: string }): ReactNode {
  return h('dl', { className: 'imqw-details' },
    title ? h(Fragment, null, h('dt', null, '标题'), h('dd', null, title)) : null,
    h('dt', null, '工作区'), h('dd', { title: session.cwd }, workspace || workspaceName(session.cwd) || '未记录'),
    h('dt', null, 'Agent 预设'), h('dd', null, session.preset || '未记录'),
    h('dt', null, '创建时间'), h('dd', null, sessionDate(session) || '未记录'),
  );
}

interface ConversationSettingsProps {
  robot: WorkbenchRobot;
  peer: WorkbenchConversation;
  workspace?: string;
  draft: Draft;
  busy: boolean;
  feedback?: { message: string };
  onEdit: (draft: Draft) => void;
  onSave: (draft: Draft) => void;
}

function ConversationSettings({ robot, peer, workspace, draft, busy, feedback, onEdit, onSave }: ConversationSettingsProps): ReactNode {
  const edited = changes(draft);
  const dirty = Object.keys(edited).length > 0;
  const stale = dirty && draft.baseline.revision !== peer.revision;
  const current = peer.sessions.find(session => session.id === peer.currentSessionId);

  return h('form', { className: 'imqw-form', onSubmit: (event: FormEvent) => {
    event.preventDefault();
    if (dirty && !stale && !busy) onSave(draft);
  } },
    h('label', { className: 'imqw-field' },
      h('span', null, '会话备注'),
      h(Input, {
        value: draft.alias, maxLength: 120, placeholder: peer.name || '未设置备注', disabled: busy,
        onChange: event => onEdit({ ...draft, alias: event.currentTarget.value }),
      })),
    h('div', { className: 'imqw-receiving' },
      h('div', null, h('strong', null, '接收 QQ 消息'),
        h('p', { className: 'imqw-muted' }, '保存后影响此会话的消息接收，仍受机器人接入规则限制。')),
      h(Switch, {
        checked: draft.receiving, label: '接收 QQ 消息', disabled: busy,
        onChange: receiving => onEdit({ ...draft, receiving }),
      })),
    h('dl', { className: 'imqw-details' },
      h('dt', null, '机器人接入规则'), h('dd', null, accessLabel(robot, peer)),
      h('dt', null, '当前状态'), h('dd', null, receivingLabel(robot, peer)),
      h('dt', null, 'OpenID'), h('dd', null, h('code', null, peer.openId)),
    ),
    current ? h('section', { className: 'imqw-session-settings' },
      h('h3', null, '当前 Session'),
      h(SessionDetails, { session: current, workspace }),
    ) : null,
    stale ? h('div', { className: 'imqw-conflict' },
      h('p', { className: 'imqb-error', role: 'alert' }, '会话设置已更新。请确认是否将草稿中的改动合并到最新设置。'),
      h(Button, {
        type: 'button', size: 'sm', variant: 'outline', disabled: busy,
        onClick: () => onEdit({ ...selectDraft(peer), ...edited }),
      }, '合并草稿')) : null,
    feedback ? h('p', { className: 'imqb-error', role: 'alert' }, feedback.message) : null,
    h('footer', { className: 'imqw-actions' },
      h(Button, { type: 'button', size: 'sm', variant: 'ghost', disabled: busy || !dirty, onClick: () => onEdit(selectDraft(peer)) }, '放弃修改'),
      h(Button, { type: 'submit', size: 'sm', variant: 'primary', disabled: busy || !dirty || stale }, busy ? '保存中…' : '保存更改'),
    ),
  );
}
