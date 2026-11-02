import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client';
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client';
import type { ConversationView } from '../shared/conversation-protocol.ts';
import { workspaceDisplayTitle } from '@deepseek-ai/dsh-api-workspace-controller/default-workspace';
import { conversationName } from './conversation-state.ts';

export interface QQSidebarSession {
  readonly sessionId: string;
  readonly nativeTitle: string | null;
  readonly title: string;
  readonly activity: number;
  readonly workspace: string;
  readonly path: string | null;
}
export interface QQSidebarPeer {
  readonly entry: ConversationView;
  readonly name: string;
  readonly currentSession: QQSidebarSession | null;
  readonly currentSummary: string | null;
  readonly historySessions: readonly QQSidebarSession[];
}
export type QQNativeSessions = Readonly<Record<string, Pick<SessionSummary, 'title' | 'cwd' | 'updatedAt'>>>;

export function qqSidebarPeers(entries: readonly ConversationView[], summaries: QQNativeSessions, workspaces: WorkspaceSnapshot['items'], query: string, defaultWorkspaceName = '默认工作区'): QQSidebarPeer[] {
  const term = query.trim().toLocaleLowerCase();
  return [...entries].sort((a, b) => b.lastActivity - a.lastActivity || a.key.localeCompare(b.key)).flatMap((entry) => {
    const name = conversationName(entry);
    const history = new Map(entry.sessions.map((session) => [session.sessionId, session]));
    if (entry.currentSessionId && !history.has(entry.currentSessionId)) history.set(entry.currentSessionId, { sessionId: entry.currentSessionId, startedAt: entry.lastActivity });
    const sessions = [...history.values()].map((session): QQSidebarSession => {
      const native = summaries[session.sessionId];
      const current = session.sessionId === entry.currentSessionId;
      const workspace = workspaces.find((item) => item.sessionIds.some((id) => id === session.sessionId));
      const path = native?.cwd || workspace?.path || (current ? entry.currentWorkspace?.path : null) || null;
      const workspaceTitle = (workspace?.path === path ? workspace?.title : '') || (current && path === entry.currentWorkspace?.path ? entry.currentWorkspace?.title : '');
      const nativeTitle = native?.title?.trim() ? native.title : null;
      return { sessionId: session.sessionId, nativeTitle, title: nativeTitle?.trim() || sessionDateTitle(session.startedAt),
        activity: native?.updatedAt ?? session.startedAt, workspace: qqWorkspaceName(workspaceTitle, path, defaultWorkspaceName), path };
    }).sort((a, b) => b.activity - a.activity || a.sessionId.localeCompare(b.sessionId));
    const currentSession = sessions.find((session) => session.sessionId === entry.currentSessionId) ?? null;
    const historySessions = sessions.filter((session) => session.sessionId !== entry.currentSessionId);
    const peerMatches = `${entry.name} ${entry.alias} ${entry.peerId}`.toLocaleLowerCase().includes(term);
    const matching = !term || peerMatches ? historySessions : historySessions.filter((session) => session.title.toLocaleLowerCase().includes(term));
    const currentMatches = currentSession?.title.toLocaleLowerCase().includes(term);
    const currentTitle = currentSession?.nativeTitle?.trim();
    const redundantTitle = currentTitle && [name, entry.name, entry.alias].filter(Boolean).some((label) =>
      currentTitle === label || currentTitle.replace(/^QQ\s*[·•.]\s*/i, '') === label);
    const currentSummary = currentSession ? [currentTitle && !redundantTitle ? currentTitle : '', currentSession.workspace].filter(Boolean).join(' · ') : null;
    return !term || peerMatches || currentMatches || matching.length ? [{ entry, name, currentSession, currentSummary, historySessions: matching }] : [];
  });
}

export function sessionDateTitle(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '未命名会话';
  return `会话 · ${new Date(timestamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}

/** 会话列表折叠：默认显示前 5 条；showAll=true 时列出全部（底部"收起历史"可收回）。 */
export const QQ_SESSIONS_PREVIEW = 5;
export function visibleQQSessions(peer: QQSidebarPeer, showAll: boolean): readonly QQSidebarSession[] {
  return showAll ? peer.historySessions : peer.historySessions.slice(0, QQ_SESSIONS_PREVIEW);
}

export function qqWorkspaceName(title: string | null | undefined, path: string | null | undefined, defaultWorkspaceName = '默认工作区'): string {
  const label = title?.trim();
  if (label && !/[\\/]/.test(label)) return workspaceDisplayTitle(label, defaultWorkspaceName);
  const parts = (path || label || '').split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || (path ? '根目录' : '工作目录未知');
}

export function qqScopeCollapsed(scope: ConversationView['scope'], collapsedScopes: readonly ConversationView['scope'][], query: string): boolean { return !query.trim() && collapsedScopes.includes(scope); }
