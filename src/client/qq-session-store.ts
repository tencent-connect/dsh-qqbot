import { useSyncExternalStore } from 'react';
import { SessionId } from '@deepseek-ai/dsh-session/types';
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client';
import type { ConversationAction, ConversationActionResult, ConversationSnapshot, ConversationView, DeliveryRecord } from '../shared/conversation-protocol.ts';
import { RUNTIME_STATE_PATH, type RuntimeStateWire } from '../shared/runtime-protocol.ts';
import { CONVERSATIONS_PATH } from '../shared/conversation-protocol.ts';
import { conversationAction, sendConversationAnswer } from './conversation-api.ts';
import { conversationName } from './conversation-state.ts';
import { fetchJson } from './http.ts';

/** 侧栏浏览态的 localStorage 键（展开/收起/选中/折叠）。 */
const SIDEBAR_STORAGE_KEY = 'im-qqbot/sidebar/v1';

export type QQDrawerTab = 'settings' | 'messages';
export interface QQDrawerTarget { readonly key: string; readonly sessionId: string | null; readonly name: string; readonly tab: QQDrawerTab }
export interface QQAnswerPreview { readonly key: string; readonly sessionId: string; readonly messageId: string; readonly name: string; readonly text: string; readonly operationId: string }
export interface QQNavigationIntent { readonly current: () => boolean; readonly cancel: () => void }
export interface QQOperationTarget {
  readonly kind: 'newSession'; readonly key: string; readonly name: string; readonly sessionId: string | null;
  readonly workspaceId: string | null; readonly policyVersion: number; readonly presetId: string | null;
}
interface QQSessionSelectionOptions { readonly preserveVisibleFilter?: boolean; /** 选中历史会话时是否自动展开该 peer 的全部历史（用户主动点击= true；恢复/程序选中= false）。 */ readonly revealHistory?: boolean }
type QQOverlay = { readonly kind: 'drawer'; readonly target: QQDrawerTarget } | { readonly kind: 'answer'; readonly preview: QQAnswerPreview } | { readonly kind: 'operation'; readonly target: QQOperationTarget };
export type QQScope = ConversationView['scope'];
export interface QQSidebarState {
  readonly sidebarMode: 'workspace' | 'qq';
  readonly selectedSessionId: string | null;
  readonly expandedPeers: readonly string[];
  readonly collapsedScopes: readonly QQScope[];
  /** 已展开完整历史会话列表的 peer（对应会话列表底部的"收起历史"）。 */
  readonly showAllPeers: readonly string[];
  readonly search: string;
}
export interface QQSessionState {
  readonly directory: ConversationSnapshot | null;
  readonly runtime: RuntimeStateWire | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly overlay: QQOverlay | null;
  readonly deliveryRevision: number;
  readonly deliveries: Readonly<Record<string, readonly DeliveryRecord[]>>;
  readonly sidebar: QQSidebarState;
}

/** One directory subscription serves the directory, row decorations and Session actions. */
export class QQSessionStore {
  private state: QQSessionState = { directory: null, runtime: null, loading: true, error: null, overlay: null, deliveryRevision: 0, deliveries: {},
    sidebar: { sidebarMode: 'workspace', selectedSessionId: null, expandedPeers: [], collapsedScopes: [], showAllPeers: [], search: '' } };
  private readonly listeners = new Set<() => void>();
  private readonly sessions = new Map<string, ConversationView>();
  private request = 0;
  private refreshDirectory: (() => void) | undefined;
  private navigate: ((sessionId: string) => void) | undefined;
  private navigationGeneration = 0;
  constructor(private readonly navigation: Pick<UiWorkspace, 'openSession'>) {
    this.state = { ...this.state, sidebar: { ...this.state.sidebar, ...this.loadSidebar() } };
  }
  /** 读取持久化的侧栏浏览态（刷新后保留展开/收起/选中/折叠/搜索）。 */
  private loadSidebar(): Partial<QQSidebarState> {
    try {
      const raw = globalThis.localStorage?.getItem(SIDEBAR_STORAGE_KEY);
      if (!raw) return {};
      const value = JSON.parse(raw) as Partial<QQSidebarState>;
      return {
        ...(Array.isArray(value.expandedPeers) ? { expandedPeers: value.expandedPeers.filter(x => typeof x === 'string') } : {}),
        ...(Array.isArray(value.collapsedScopes) ? { collapsedScopes: value.collapsedScopes.filter(x => x === 'group' || x === 'c2c') } : {}),
        ...(Array.isArray(value.showAllPeers) ? { showAllPeers: value.showAllPeers.filter(x => typeof x === 'string') } : {}),
        ...(typeof value.selectedSessionId === 'string' || value.selectedSessionId === null ? { selectedSessionId: value.selectedSessionId } : {}),
      };
    } catch { return {}; }
  }
  private saveSidebar(): void {
    try {
      const s = this.state.sidebar;
      globalThis.localStorage?.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify({ expandedPeers: s.expandedPeers, collapsedScopes: s.collapsedScopes, showAllPeers: s.showAllPeers, selectedSessionId: s.selectedSessionId }));
    } catch { /* storage 不可用则忽略 */ }
  }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = (): QQSessionState => this.state;
  private update(change: Partial<QQSessionState>): void { this.state = { ...this.state, ...change }; for (const listener of this.listeners) listener(); }
  private updateSidebar(change: Partial<QQSidebarState>): void { this.update({ sidebar: { ...this.state.sidebar, ...change } }); this.saveSidebar(); }
  setSidebarMode(sidebarMode: QQSidebarState['sidebarMode']): void {
    if (this.state.sidebar.sidebarMode !== sidebarMode) { this.cancelNavigation(); this.updateSidebar({ sidebarMode }); }
  }
  cancelNavigation(): void { this.navigationGeneration += 1; }
  navigationIntent(): QQNavigationIntent {
    const generation = this.navigationGeneration;
    let active = true;
    return { current: () => active && generation === this.navigationGeneration, cancel: () => { active = false; } };
  }
  openActionResult(intent: QQNavigationIntent, result: ConversationActionResult, key: string): 'opened' | 'unavailable' | 'superseded' {
    if (!intent.current()) return 'superseded';
    const id = result.sessionId ?? result.snapshot?.conversations.find((entry) => entry.key === key)?.currentSessionId;
    if (!id) return 'unavailable';
    this.openSession(id);
    return 'opened';
  }
  selectSession(sessionId: string, options: QQSessionSelectionOptions = {}): void {
    const entry = this.entry(sessionId);
    if (!entry) return;
    const sidebar = this.state.sidebar;
    const historical = sessionId !== entry.currentSessionId;
    // 恢复/程序选中（revealHistory === false）不改写用户手动展开/收起的历史态。
    const reveal = historical && options.revealHistory !== false;
    this.updateSidebar({ selectedSessionId: sessionId,
      expandedPeers: reveal && !sidebar.expandedPeers.includes(entry.key) ? [...sidebar.expandedPeers, entry.key] : sidebar.expandedPeers,
      search: historical && sessionId !== sidebar.selectedSessionId && !options.preserveVisibleFilter ? '' : sidebar.search,
      collapsedScopes: sidebar.collapsedScopes.filter((scope) => scope !== entry.scope) });
  }
  resumeSessionId(): string | null {
    const selected = this.state.sidebar.selectedSessionId;
    if (selected && this.entry(selected)) return selected;
    return [...(this.state.directory?.conversations ?? [])].sort((a, b) => b.lastActivity - a.lastActivity)
      .find((entry) => entry.admitted && entry.currentSessionId)?.currentSessionId ?? null;
  }
  /** 最近可继续的会话及其对话名称（欢迎页"继续会话"入口用，便于显示跳到哪个群/私聊）。 */
  resumeTarget(): { sessionId: string; name: string } | null {
    const sessionId = this.resumeSessionId();
    if (!sessionId) return null;
    const entry = this.entry(sessionId);
    return entry ? { sessionId, name: conversationName(entry) } : null;
  }
  togglePeer(key: string): void { this.updateSidebar({ expandedPeers: toggleValue(this.state.sidebar.expandedPeers, key) }); }
  toggleScope(scope: QQScope): void { this.updateSidebar({ collapsedScopes: toggleValue(this.state.sidebar.collapsedScopes, scope) }); }
  /** 切换某 peer 的完整历史会话列表展开/收起（列表底部按钮）。 */
  showAllSessions(key: string): void { this.updateSidebar({ showAllPeers: toggleValue(this.state.sidebar.showAllPeers, key) }); }
  setSearch(search: string): void { this.updateSidebar({ search }); }
  installNavigation(navigate: (sessionId: string) => void): () => void {
    this.navigate = navigate;
    return () => { if (this.navigate === navigate) this.navigate = undefined; };
  }
  entry(sessionId: string): ConversationView | undefined { return this.sessions.get(sessionId); }
  conversation(key: string): ConversationView | undefined { return this.state.directory?.conversations.find((entry) => entry.key === key); }
  accept(directory: ConversationSnapshot): void {
    this.request += 1;
    this.sessions.clear();
    for (const entry of directory.conversations) {
      for (const session of entry.sessions) this.sessions.set(session.sessionId, entry);
      if (entry.currentSessionId) this.sessions.set(entry.currentSessionId, entry);
    }
    this.update({ directory, loading: false, error: null });
  }
  refresh = (): void => { this.refreshDirectory?.(); };
  start(): () => void {
    const controller = new AbortController();
    const read = async (): Promise<void> => {
      const request = ++this.request;
      this.update({ loading: true });
      try {
        const [directory, runtime] = await Promise.all([
          fetchJson<ConversationSnapshot>(CONVERSATIONS_PATH, { cache: 'no-store', signal: controller.signal }),
          fetchJson<RuntimeStateWire>(RUNTIME_STATE_PATH, { cache: 'no-store', signal: controller.signal }).catch(() => null),
        ]);
        if (!Array.isArray(directory.conversations) || !Array.isArray(directory.tools) || !Array.isArray(directory.ownerIds)) throw new Error('会话目录返回格式无效');
        if (!controller.signal.aborted && request === this.request) { this.accept(directory); if (runtime) this.update({ runtime }); }
      } catch (cause) {
        if (controller.signal.aborted || request !== this.request) return;
        const message = cause instanceof Error ? cause.message : '无法读取 QQ 会话';
        // 未绑定态该路由未注册（HTTP 404）：当作"暂无对话"，不显示红色错误。
        if (/404/.test(message)) { this.accept({ conversations: [], tools: [], ownerIds: [] }); return; }
        this.update({ loading: false, error: message });
      }
    };
    this.refreshDirectory = () => { void read(); };
    void read();
    const timer = setInterval(() => { void read(); }, 10_000);
    return () => { controller.abort(); this.request += 1; this.refreshDirectory = undefined; clearInterval(timer); };
  }
  open(entry: ConversationView): void {
    if (entry.admitted && entry.currentSessionId) this.openSession(entry.currentSessionId);
    else this.openDrawer(entry);
  }
  openSession(sessionId: string, options: QQSessionSelectionOptions = {}): void {
    if (!sessionId) return;
    this.cancelNavigation();
    this.selectSession(sessionId, options);
    if (this.navigate) this.navigate(sessionId);
    else this.navigation.openSession(SessionId(sessionId));
  }
  openDrawer(entry: ConversationView, tab: QQDrawerTab = 'settings', sessionId = entry.currentSessionId): void {
    this.cancelNavigation();
    this.update({ overlay: { kind: 'drawer', target: { key: entry.key, sessionId, name: conversationName(entry), tab } } });
  }
  closeDrawer = (): void => { this.cancelNavigation(); this.update({ overlay: null }); };
  openOperation(entry: ConversationView, kind: 'newSession' | 'workspace' | 'new' | 'preset' | 'alias' = 'newSession'): void {
    if (kind === 'alias') { this.openDrawer(entry); return; }
    this.cancelNavigation();
    const target: QQOperationTarget = { kind: 'newSession', key: entry.key, name: conversationName(entry), sessionId: entry.currentSessionId,
      workspaceId: entry.currentWorkspace?.id ?? entry.workspaceId ?? null, policyVersion: entry.policy.version, presetId: entry.nextPreset ?? entry.currentPreset };
    this.update({ overlay: { kind: 'operation', target } });
  }
  previewAnswer(sessionId: string, messageId: string, text: string): void {
    const entry = this.entry(sessionId);
    if (!entry?.admitted || entry.currentSessionId !== sessionId || !text.trim()) return;
    this.cancelNavigation();
    this.update({ overlay: { kind: 'answer', preview: { key: entry.key, sessionId, messageId, name: conversationName(entry), text, operationId: crypto.randomUUID() } } });
  }
  closePreview = (): void => { this.update({ overlay: null }); };
  canSend(preview: QQAnswerPreview): boolean {
    const entry = this.conversation(preview.key);
    return Boolean(entry?.admitted && entry.currentSessionId === preview.sessionId);
  }
  async sendAnswer(preview: QQAnswerPreview): Promise<ConversationActionResult> {
    if (!this.canSend(preview)) throw new Error('此 QQ 会话的授权或当前映射已变化');
    const result = await sendConversationAnswer({ action: 'send', key: preview.key, operationId: preview.operationId, text: preview.text, sourceSessionId: preview.sessionId, sourceMessageId: preview.messageId });
    if (result.delivery) this.acceptDelivery(result.delivery);
    if (result.snapshot) this.accept(result.snapshot);
    else this.refresh();
    return result;
  }
  async perform(action: ConversationAction): Promise<ConversationActionResult> {
    const result = await conversationAction(action);
    if (action.action === 'deliveries' && result.deliveries) this.update({ deliveries: { ...this.state.deliveries, [action.key]: result.deliveries } });
    if (result.snapshot) this.accept(result.snapshot);
    else if (action.action !== 'deliveries' && action.action !== 'messages' && action.action !== 'timeline') this.refresh();
    return result;
  }
  private acceptDelivery(delivery: DeliveryRecord): void {
    const previous = this.state.deliveries[delivery.key] ?? [];
    this.update({ deliveryRevision: this.state.deliveryRevision + 1, deliveries: { ...this.state.deliveries,
      [delivery.key]: [delivery, ...previous.filter((item) => item.id !== delivery.id)] } });
  }
}
function toggleValue<T>(values: readonly T[], value: T): T[] { return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; }
export function useQQSessionStore(store: QQSessionStore): QQSessionState { return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot); }
