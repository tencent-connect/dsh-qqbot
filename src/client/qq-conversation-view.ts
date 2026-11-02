import { createElement as h, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { SessionId } from '@deepseek-ai/dsh-session/types';
import { Button, Input, MarkdownText, SegmentedTabs, type MarkdownLabels, type SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ConversationView, TimelineEntry, TimelinePage } from '../shared/conversation-protocol.ts';
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types';
import type {} from '@deepseek-ai/dsh-permission-presets/types';
import type { SelectorSource } from './host-selectors.ts';
import type { QQTranslate } from './qq-locale.ts';
import { QQSessionStore, useQQSessionStore, type QQDrawerTab } from './qq-session-store.ts';
import { QQPeerSettings } from './qq-peer-settings.ts';
import { conversationName } from './conversation-state.ts';
import { deliveryExplanation, deliverySummary, passiveReplyFeedback } from './delivery-feedback.ts';
import { mergeTimeline, timelineIdentity, timelineMatches } from './qq-timeline-state.ts';

type ViewTab = 'settings' | 'messages';
function tabFor(tab: QQDrawerTab | undefined): ViewTab { return tab === 'messages' ? 'messages' : 'settings'; }
const tabs: [SegmentedTab<ViewTab>, ...SegmentedTab<ViewTab>[]] = [
  { value: 'settings', label: '会话设置', id: 'qq-settings-tab', panelId: 'qq-settings-panel' },
  { value: 'messages', label: '消息记录', id: 'qq-messages-tab', panelId: 'qq-messages-panel' },
];
const TIMELINE_MARKDOWN_LABELS: MarkdownLabels = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '脚注' };
/** 按附件类型渲染：图片/视频/语音内嵌，文件给下载链接；无 url 时退化为类型徽标+文件名。 */
function renderAttachment(att: { name: string; type: string; url?: string; kind?: 'image' | 'video' | 'voice' | 'file' }, index: number): ReactNode {
  const label = att.name || att.type || '附件';
  const kind = att.kind ?? (att.type.startsWith('image/') ? 'image' : att.type.startsWith('video/') ? 'video' : att.type.startsWith('audio/') ? 'voice' : 'file');
  if (!att.url) return h('span', { key: index, className: 'imqc-attachChip' }, `[${kind === 'image' ? '图片' : kind === 'video' ? '视频' : kind === 'voice' ? '语音' : '文件'}] ${label}`);
  if (kind === 'image') return h('img', { key: index, className: 'imqc-attachImage', src: att.url, alt: label, loading: 'lazy' });
  if (kind === 'video') return h('video', { key: index, className: 'imqc-attachVideo', src: att.url, controls: true, preload: 'metadata' });
  if (kind === 'voice') return h('audio', { key: index, className: 'imqc-attachAudio', src: att.url, controls: true, preload: 'metadata' });
  return h('a', { key: index, className: 'imqc-attachFile', href: att.url, target: '_blank', rel: 'noreferrer noopener' }, `📎 ${label}`);
}
export function QQConversationView({ sessionId, store, selectorSource, t, useSessions, useWorkspaces, useProjection, conversationKey, initialTab, defaultWorkspaceName }: {
  sessionId: string | null; store: QQSessionStore; selectorSource: SelectorSource; t: QQTranslate; conversationKey?: string; initialTab?: QQDrawerTab;
  useSessions?: PropsRuntime<'conversation.view'>['useSessions']; useWorkspaces?: PropsRuntime<'conversation.view'>['useWorkspaces']; useProjection?: PropsRuntime<'conversation.view'>['useProjection']; defaultWorkspaceName?: string;
}): ReactNode {
  const state = useQQSessionStore(store);
  const workspaceItems = useWorkspaces?.(snapshot => snapshot.items) ?? [];
  const workspaceChoices = workspaceItems.map(item => ({ workspaceId: String(item.workspaceId), title: item.title, path: item.path }));
  const summaries = useSessions?.(snapshot => snapshot.byId) ?? {};
  const projectedPreset = useProjection?.('agentPreset');
  const projectedPermissions = useProjection?.('permissions');
  const summary = sessionId ? summaries[SessionId(sessionId)] : undefined;
  const nativePreset = projectedPreset !== undefined ? projectedPreset : summary?.projectionValues?.agentPreset;
  const nativePermission = (projectedPermissions ?? summary?.projectionValues?.permissions)?.currentValue;
  const rootRef = useRef<HTMLElement | null>(null);
  const entry = conversationKey ? store.conversation(conversationKey) : sessionId ? store.entry(sessionId) : undefined;
  const [tab, setTab] = useState<ViewTab>(() => tabFor(initialTab));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unarchive, setUnarchive] = useState(false);
  const activeKey = useRef(entry?.key);
  activeKey.current = entry?.key;
  useEffect(() => { setTab(tabFor(initialTab)); setError(''); setUnarchive(false); }, [sessionId, conversationKey, initialTab]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.scrollTop = 0;
    const view = root.ownerDocument.defaultView;
    for (let parent = root.parentElement; parent; parent = parent.parentElement) {
      const overflow = view?.getComputedStyle(parent).overflowY;
      if (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden') parent.scrollTop = 0;
    }
  }, [sessionId, conversationKey, entry?.key]);
  if (!entry) return h('section', { ref: rootRef, className: 'imqc imqc-full' }, h('p', { role: 'status' }, '正在读取 QQ 对话…'));
  const historical = sessionId !== null && entry.currentSessionId !== sessionId;
  const restore = (): void => {
    if (busy || !entry.currentSessionId) return;
    const key = entry.key;
    setBusy(true); setError('');
    void store.perform({ action: 'unarchive', key, sessionId: entry.currentSessionId }).then(() => { if (activeKey.current === key) setUnarchive(false); })
      .catch((cause: unknown) => { if (activeKey.current === key) setError(cause instanceof Error ? cause.message : '取消归档失败'); })
      .finally(() => { if (activeKey.current === key) setBusy(false); });
  };
  return h('section', { ref: rootRef, className: 'imqc imqc-settingsView', 'aria-label': t('view.settings.title') },
    h('header', { className: 'imqc-viewHeading' }, h('h3', null, conversationName(entry)), h('span', { className: 'imqc-hint' }, entry.scope === 'group' ? 'QQ 群聊' : 'QQ 私聊')),
    h(SegmentedTabs<ViewTab>, { className: 'imqc-tabs', label: 'QQ 会话设置类别', value: tab, items: tabs, size: 'sm', onChange: setTab }),
    error ? h('p', { className: 'imqc-error', role: 'alert' }, error) : null,
    state.directory?.errors?.map(message => h('p', { key: message, role: 'alert', className: 'imqc-error' }, message)),
    h('div', { id: `qq-${tab}-panel`, role: 'tabpanel', 'aria-labelledby': `qq-${tab}-tab` },
      tab === 'settings' ? historical
        ? h('div', { className: 'imqc-banner', role: 'status' }, h('strong', null, '这是历史会话，设置只读'),
          h('p', null, '历史会话的实际配置以原生轨迹为准。QQ 新消息进入当前会话。'),
          h('p', { className: 'imqc-hint' }, `此会话 Agent 预设：${nativePreset === undefined ? '未读取' : nativePreset ?? '未配置'}；权限：${nativePermission ?? '未读取'}。`),
          entry.currentSessionId ? h(Button, { variant: 'outline', size: 'sm', onClick: () => store.openSession(entry.currentSessionId ?? '') }, '返回当前会话') : null)
        : h('div', null,
          entry.archived ? h('div', { className: 'imqc-banner', role: 'status' }, h('strong', null, '当前 QQ 会话已归档'), h('p', null, '取消归档后继续接收，或新建会话。'),
            h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => setUnarchive(true) }, '取消归档继续…'),
            unarchive ? h('div', { className: 'imqc-actions' }, h('p', null, '确认取消归档并让 QQ 消息继续进入此会话？'), h(Button, { variant: 'primary', size: 'sm', disabled: busy, onClick: restore }, '确认取消归档'), h(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => setUnarchive(false) }, '取消')) : null) : null,
          h(QQPeerSettings, { key: entry.key, entry, store, tools: state.directory?.tools ?? [], commands: state.directory?.commands ?? [], selectorSource, t, workspaces: workspaceChoices, defaultWorkspaceName, defaultCwd: state.directory?.defaultCwd })) : null,
      tab === 'messages' ? h(QQMessageTimeline, { key: entry.key, entry, store }) : null));
}
export function QQMessageTimeline({ entry, store }: { entry: ConversationView; store: QQSessionStore }): ReactNode {
  const [query, setQuery] = useState(''); const [search, setSearch] = useState('');
  const [items, setItems] = useState<TimelineEntry[]>([]); const [page, setPage] = useState<TimelinePage | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const generation = useRef(0); const pending = useRef(false); const cursor = useRef<number | undefined>(undefined);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = (): void => { const value = Date.now(); setNow(value); const deadline = entry.passiveReply?.expiresAt; if (deadline !== null && deadline !== undefined && deadline > value) timer = setTimeout(tick, Math.min(1000, deadline - value)); };
    tick(); return () => { if (timer !== undefined) clearTimeout(timer); };
  }, [entry.passiveReply?.expiresAt]);
  useEffect(() => {
    const request = ++generation.current; let active = true; pending.current = false; cursor.current = undefined;
    setItems([]); setPage(null); setError('');
    const load = async (): Promise<void> => {
      if (pending.current) return; pending.current = true; setBusy(true);
      try {
        const result = await store.perform({ action: 'timeline', key: entry.key, query: search, ...(cursor.current === undefined ? {} : { after: cursor.current }) });
        if (!active || generation.current !== request) return;
        if (!result.timeline) throw new Error('消息记录返回格式无效');
        const next = result.timeline;
        // 记录被清空（clear-records 会重置时间线游标）：snapshot 回退说明游标已失效，
        // 丢弃本地行并以全新分页重拉，否则增量 after 永远追不上重编号后的 change。
        if (cursor.current !== undefined && page && next.snapshot < page.snapshot) {
          cursor.current = undefined; setItems([]); setPage(null);
          void load(); return;
        }
        setItems(previous => mergeTimeline(previous, next.items, search));
        if (cursor.current === undefined) setPage(next);
        cursor.current = next.nextAfter ?? next.snapshot; setError('');
      } catch (cause) { if (active && generation.current === request) setError(cause instanceof Error ? cause.message : '无法读取消息记录'); }
      finally { if (active && generation.current === request) { pending.current = false; setBusy(false); } }
    };
    void load(); const timer = setInterval(() => { void load(); }, 5000);
    return () => { active = false; generation.current += 1; clearInterval(timer); };
  }, [entry.key, search, store]);
  const older = (): void => {
    if (pending.current || !page?.hasMore || page.nextBefore === undefined) return;
    const request = generation.current; pending.current = true; setBusy(true); setError('');
    void store.perform({ action: 'timeline', key: entry.key, query: search, before: page.nextBefore, snapshot: page.snapshot }).then(result => {
      if (generation.current !== request) return;
      if (!result.timeline) throw new Error('消息记录返回格式无效');
      setItems(previous => mergeTimeline(previous, result.timeline?.items ?? [], search)); setPage(result.timeline);
    }).catch((cause: unknown) => { if (generation.current === request) setError(cause instanceof Error ? cause.message : '无法读取更早记录'); })
      .finally(() => { if (generation.current === request) { pending.current = false; setBusy(false); } });
  };
  const feedback = passiveReplyFeedback(entry.passiveReply, now);
  const visible = items.filter(item => timelineMatches(item, search) && (item.direction === 'inbound' ? item.message.bodyState : item.delivery.bodyState) !== 'expired');
  return h('section', { className: 'imqc-timeline', 'aria-label': 'QQ 消息记录', 'aria-busy': busy },
    h('p', { className: 'imqc-hint' }, '收到的 QQ 消息在左，机器人回复在右；点每条右侧 ↗ 可在原生会话中查看该轮。'),
    feedback.summary ? h('p', { className: 'imqc-hint imqc-timelineFeedback' }, feedback.summary) : null,
    h('form', { className: 'imqc-inline', onSubmit: (event: FormEvent) => { event.preventDefault(); setSearch(query.trim()); } }, h(Input, { type: 'search', value: query, 'aria-label': '搜索消息记录', placeholder: '搜索已保存的消息正文…', onChange: (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value) }), h(Button, { type: 'submit', variant: 'outline', size: 'sm' }, '查询')),
    error ? h('p', { role: 'alert', className: 'imqc-error' }, error) : null,
    page?.hasMore ? h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: older }, '读取更早记录') : null,
    h('div', { className: 'imqc-timelineRows' }, ...visible.map(item => {
      const incoming = item.direction === 'inbound';
      const record = incoming ? item.message : item.delivery;
      const session = incoming ? item.message.sessionId : item.delivery.sourceSessionId;
      const body = record.bodyState === 'expired' ? '正文已过期' : record.bodyState === 'disabled' ? '正文未记录' : record.text || '无文本内容';
      const provenance = record.provenance === 'web' ? '网页显式发送' : record.provenance === 'automatic' ? 'QQ 自动回复' : record.provenance === 'command' ? 'QQ 命令' : record.provenance === 'interaction' ? 'QQ 交互' : record.provenance === 'legacy' ? '历史记录' : 'QQ';
      const failed = !incoming && (item.delivery.state === 'failed' || item.delivery.state === 'unknown');
      return h('article', { key: timelineIdentity(item), className: 'imqc-timelineMessage', 'data-direction': item.direction, 'data-failed': failed || undefined },
        h('div', { className: 'imqc-messageBody' },
          h('div', { className: 'imqc-messageMeta' }, h('span', { className: 'imqc-messageWho' }, incoming ? (item.message.senderName || item.message.senderId.slice(-8)) : '机器人'), h('span', { className: 'imqc-messageWhen' }, new Date(record.at).toLocaleString())),
          body ? h(MarkdownText, { text: body, labels: TIMELINE_MARKDOWN_LABELS, variant: 'compact' }) : null,
          incoming && item.message.attachments.length ? h('div', { className: 'imqc-attachRow' }, ...item.message.attachments.map((att, i) => renderAttachment(att, i))) : null,
          failed ? h('p', { className: 'imqc-error imqc-messageWarn', role: 'alert' }, item.delivery.state === 'failed' ? '发送失败' : '结果未知（可能部分已发出，请核对 QQ）') : null),
        h('div', { className: 'imqc-messageAside' },
          // 只在发送失败/结果未知时提供诊断详情（成功消息无需技术信息）。
          failed ? h('details', { className: 'imqc-msgInfo' }, h('summary', { title: '发送详情', 'aria-label': '发送详情' }, 'ⓘ'),
            h('div', { className: 'imqc-msgInfoBody' },
              h('p', { className: 'imqc-hint' }, deliverySummary(item.delivery)),
              h('p', { className: 'imqc-hint' }, deliveryExplanation(item.delivery)),
              h('p', { className: 'imqc-hint' }, `来源：${provenance}`),
              ...item.delivery.parts.map(part => h('p', { key: part.index, className: 'imqc-hint' }, `分段 ${part.index + 1}：${part.state}`)),
              item.delivery.error ? h('p', { role: 'alert', className: 'imqc-error' }, item.delivery.error) : null)) : null,
          ((): ReactNode => {
            // 跳转到包含该消息的原生会话；若该 session 不在当前目录（历史被裁剪等），回退到该对话的当前会话，避免落到无 QQ 设置视图的孤儿 session。
            const target = session && store.entry(session) ? session : entry.currentSessionId;
            return target ? h(Button, { variant: 'ghost', size: 'sm', className: 'imqc-jumpTurn', 'aria-label': '在原生会话中查看此消息', title: '在原生会话中查看此消息', onClick: () => store.openSession(target) }, '↗') : null;
          })()));
    })),
    page && visible.length === 0 ? h('p', { className: 'imqc-hint' }, '没有匹配的消息记录。开启记录后，仅保存机器人实际收到的 QQ 消息与投递。') : null);
}
