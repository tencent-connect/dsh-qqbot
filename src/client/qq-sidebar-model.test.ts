import { describe, expect, it, vi } from 'vitest';
import { SessionId } from '@deepseek-ai/dsh-session/types';
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client';
import type { ConversationView } from '../shared/conversation-protocol.ts';
import { qqScopeCollapsed, qqSidebarPeers, qqWorkspaceName, visibleQQSessions } from './qq-sidebar-model.ts';
import { QQSessionStore } from './qq-session-store.ts';

function peer(overrides: Partial<ConversationView> = {}): ConversationView {
  return { key: 'group', appId: 'app', scope: 'group', peerId: 'peer', name: '讨论群', alias: '', currentSessionId: 'current',
    sessions: [{ sessionId: 'current', startedAt: 1 }, ...Array.from({ length: 6 }, (_, index) => ({ sessionId: `old-${index}`, startedAt: index + 2 }))],
    members: [], lastActivity: 100, observedAllMessages: false, admitted: true, running: false, currentModel: null, currentPreset: null, nextPreset: null, deliveryState: null,
    policy: { version: 1, template: 'chat', name: '聊天', role: { description: '', tone: '', world: '', prompt: '' }, tools: {},
      resources: { readRoots: [], writeRoots: [], sendRoots: [], executionEnabled: false, sandbox: 'read-only', networkDomains: [], maxFiles: 1, maxFileMB: 10 },
      controllers: [], approvers: [], allowedModels: [], allowedPresets: [], allowedPermissions: ['read-only'], permission: 'read-only', cwd: '/new', requireMention: true,
      context: { mode: 'recent', maxMessages: 10, maxAgeMinutes: 10, maxChars: 4000, retentionDays: 7 } }, ...overrides };
}

describe('QQ sidebar peer and native Session projection', () => {
  it('keeps current separate, orders history by native activity, and shows five historical Sessions until expanded', () => {
    const projected = qqSidebarPeers([peer()], { 'old-0': { title: '最近工作', updatedAt: 999 } }, [], '');
    const group = projected[0];
    if (!group) throw new Error('missing peer');
    expect(group.currentSession?.sessionId).toBe('current');
    expect(group.historySessions.map((session) => session.sessionId)).toEqual(['old-0', 'old-5', 'old-4', 'old-3', 'old-2', 'old-1']);
    expect(visibleQQSessions(group, true)).toHaveLength(6); // showAll=全部
    expect(group.historySessions[0]?.title).toBe('最近工作');
  });
  it('searches platform names, remarks, and native Session titles without renaming the peer', () => {
    const entry = peer({ alias: '设计讨论' });
    const summaries = { 'old-0': { title: 'Review DESIGN SPEC', updatedAt: 10 } };
    expect(qqSidebarPeers([entry], summaries, [], '讨论群')[0]?.historySessions).toHaveLength(6);
    expect(qqSidebarPeers([entry], summaries, [], '设计')[0]?.name).toBe('设计讨论');
    const matched = qqSidebarPeers([entry], summaries, [], 'design spec')[0];
    expect(matched?.historySessions.map((session) => session.sessionId)).toEqual(['old-0']);
    expect(matched?.currentSession?.sessionId).toBe('current');
    expect(entry.alias).toBe('设计讨论');
  });
  it('shows each historical Session workspace and never borrows the current directory for unknown history', () => {
    const entry = peer({ currentWorkspace: { id: 'new', title: '新项目', path: '/new' } });
    const projected = qqSidebarPeers([entry], { 'old-0': { title: '旧项目会话', cwd: '/old', updatedAt: 10 } }, [
      { workspaceId: 'old-workspace' as WorkspaceId, title: '旧工作区', path: '/old', sessionIds: [SessionId('old-0')], createdAt: '', updatedAt: '' },
    ], '');
    const sessions = projected[0]?.historySessions;
    expect(projected[0]?.currentSession).toMatchObject({ workspace: '新项目', path: '/new' });
    expect(sessions?.find((session) => session.sessionId === 'old-0')).toMatchObject({ workspace: '旧工作区', path: '/old' });
    expect(sessions?.find((session) => session.sessionId === 'old-1')).toMatchObject({ workspace: '工作目录未知', path: null });
  });
  it('falls back to a readable creation date rather than exposing a Session id as the title', () => {
    const entry = peer({ currentSessionId: 'secret-looking-id', sessions: [{ sessionId: 'secret-looking-id', startedAt: 1_700_000_000_000 }] });
    const projected = qqSidebarPeers([entry], {}, [], '');
    expect(projected[0]?.currentSession?.title).toMatch(/^会话 · /);
    expect(projected[0]?.currentSession?.title).not.toContain('secret-looking-id');
  });
  it('keeps the durable native title and current summary when only a historical title matches search', () => {
    const entry = peer({ currentWorkspace: { id: 'new', title: '当前项目', path: '/new' } });
    const titles = { current: { title: '  本周排期  ', updatedAt: 10 }, 'old-0': { title: '历史报告', updatedAt: 1 } };
    const projected = qqSidebarPeers([entry], titles, [], '历史报告')[0];
    expect(projected?.currentSession).toMatchObject({ sessionId: 'current', nativeTitle: '  本周排期  ', title: '本周排期' });
    expect(projected?.currentSummary).toBe('本周排期 · 当前项目');
    expect(projected?.historySessions.map((session) => session.sessionId)).toEqual(['old-0']);
    expect(titles.current.title).toBe('  本周排期  ');
  });
  it.each(['讨论群', 'QQ · 讨论群', 'QQ·讨论群'])('omits the redundant current title %s without renaming it', (title) => {
    const projected = qqSidebarPeers([peer()], { current: { title, cwd: '/Users/example/projects/service', updatedAt: 1 } }, [], '')[0];
    expect(projected?.currentSummary).toBe('service');
    expect(projected?.currentSession).toMatchObject({ nativeTitle: title, title, path: '/Users/example/projects/service', workspace: 'service' });
  });
  it('uses a short workspace label but preserves the exact native cwd when workspace membership disagrees', () => {
    const entry = peer({ currentWorkspace: { id: 'new', title: '其他项目', path: '/configured' } });
    const projected = qqSidebarPeers([entry], { current: { title: '工作', cwd: '/actual/runtime', updatedAt: 1 } }, [
      { workspaceId: 'wrong' as WorkspaceId, title: '过时工作区', path: '/configured', sessionIds: [SessionId('current')], createdAt: '', updatedAt: '' },
    ], '')[0];
    expect(projected?.currentSession).toMatchObject({ path: '/actual/runtime', workspace: 'runtime' });
    expect(projected?.currentSummary).toBe('工作 · runtime');
    expect(qqWorkspaceName('/Users/example/project', '/Users/example/project')).toBe('project');
    expect(qqWorkspaceName('', 'C:\\Users\\example\\project')).toBe('project');
  });
  it('keeps a peer with only a matching current title and no historical matches', () => {
    const projected = qqSidebarPeers([peer()], { current: { title: '当前排期', updatedAt: 1 } }, [], '当前排期')[0];
    expect(projected?.currentSession?.sessionId).toBe('current');
    expect(projected?.historySessions).toEqual([]);
  });
  it('temporarily opens a collapsed scope for search and restores the same fold preference when cleared', () => {
    const collapsedScopes = ['group', 'c2c'] as const;
    expect(qqScopeCollapsed('group', collapsedScopes, '')).toBe(true);
    expect(qqScopeCollapsed('group', collapsedScopes, '最近工作')).toBe(false);
    expect(qqSidebarPeers([peer()], { 'old-0': { title: '最近工作', updatedAt: 999 } }, [], '最近工作')).toHaveLength(1);
    expect(qqScopeCollapsed('group', collapsedScopes, '  ')).toBe(true);
    expect(collapsedScopes).toEqual(['group', 'c2c']);
  });
});

describe('independent QQ sidebar state', () => {
  it('keeps a selected historical Session and browsing state across polling and current rotation', () => {
    const openSession = vi.fn();
    const store = new QQSessionStore({ openSession });
    const entry = peer();
    store.accept({ conversations: [entry], tools: [], ownerIds: [] });
    store.setSidebarMode('qq'); store.openSession('old-0'); store.setSearch('工作'); store.toggleScope('c2c');
    const before = store.getSnapshot().sidebar;
    store.accept({ conversations: [{ ...entry, currentSessionId: 'new-current', alias: '改名' }], tools: [], ownerIds: [] });
    expect(store.getSnapshot().sidebar).toBe(before);
    expect(store.getSnapshot().sidebar).toMatchObject({ sidebarMode: 'qq', selectedSessionId: 'old-0', expandedPeers: ['group'], search: '工作', collapsedScopes: ['c2c'] });
    expect(store.resumeSessionId()).toBe('old-0');
    // resumeTarget also resolves the conversation name so the welcome entry can show which chat it continues.
    expect(store.resumeTarget()).toMatchObject({ sessionId: 'old-0' });
    expect(store.resumeTarget()?.name).toBeTruthy();
    expect(openSession).toHaveBeenCalledExactlyOnceWith('old-0');
  });
  it('has no navigation or creation side effect for group expansion, searching, or a missing Session', () => {
    const openSession = vi.fn(); const store = new QQSessionStore({ openSession });
    store.accept({ conversations: [peer({ currentSessionId: null, sessions: [] })], tools: [], ownerIds: [] });
    store.togglePeer('group'); store.toggleScope('group'); store.setSearch('讨论群');
    expect(openSession).not.toHaveBeenCalled(); expect(store.resumeSessionId()).toBeNull(); expect(store.resumeTarget()).toBeNull();
  });
  it('reveals a selected older Session beyond the default five while leaving an unselected peer at five', () => {
    const store = new QQSessionStore({ openSession: vi.fn() });
    const entry = peer(); store.accept({ conversations: [entry], tools: [], ownerIds: [] });
    const projected = qqSidebarPeers([entry], {}, [], '')[0];
    if (!projected) throw new Error('missing peer');
    expect(visibleQQSessions(projected, true)).toHaveLength(6);
    store.openSession('old-0');
    const visible = visibleQQSessions(projected, true);
    expect(visible.some((session) => session.sessionId === store.getSnapshot().sidebar.selectedSessionId)).toBe(true);
    expect(visible).toHaveLength(6);
  });
  it('opens a peer current without expanding history and only expands when an old Session is selected', () => {
    const openSession = vi.fn(); const store = new QQSessionStore({ openSession });
    const entry = peer(); store.accept({ conversations: [entry], tools: [], ownerIds: [] });
    store.open(entry);
    expect(store.getSnapshot().sidebar).toMatchObject({ selectedSessionId: 'current', expandedPeers: [] });
    store.setSearch('does not match selected history'); store.toggleScope('group'); store.openSession('old-0');
    expect(store.getSnapshot().sidebar).toMatchObject({ selectedSessionId: 'old-0', expandedPeers: ['group'], collapsedScopes: [], search: '' });
    expect(openSession.mock.calls.map(([id]) => id)).toEqual(['current', 'old-0']);
    store.open(entry);
    expect(store.getSnapshot().sidebar).toMatchObject({ selectedSessionId: 'current', expandedPeers: ['group'] });
  });
  it('preserves a matching history search when its visible result opens and the native selection is observed', () => {
    const store = new QQSessionStore({ openSession: vi.fn() }); const entry = peer();
    const summaries = { 'old-0': { title: '历史报告', updatedAt: 999 } };
    store.accept({ conversations: [entry], tools: [], ownerIds: [] }); store.setSearch('报告');
    const result = qqSidebarPeers([entry], summaries, [], store.getSnapshot().sidebar.search)[0]?.historySessions[0];
    if (!result) throw new Error('missing matching history result');
    store.openSession(result.sessionId, { preserveVisibleFilter: true });
    expect(store.getSnapshot().sidebar).toMatchObject({ selectedSessionId: 'old-0', search: '报告', expandedPeers: ['group'] });
    store.selectSession('old-0');
    expect(store.getSnapshot().sidebar.search).toBe('报告');
    expect(qqSidebarPeers([entry], summaries, [], store.getSnapshot().sidebar.search)[0]?.historySessions.map((session) => session.sessionId)).toEqual(['old-0']);
  });
  it('preserves search on same historical Session reentry and reveals a different historical target from outside the list', () => {
    const store = new QQSessionStore({ openSession: vi.fn() }); const entry = peer();
    store.accept({ conversations: [entry], tools: [], ownerIds: [] }); store.openSession('old-0'); store.setSearch('报告');
    const resume = store.resumeSessionId();
    if (!resume) throw new Error('missing historical Session to resume');
    store.openSession(resume);
    expect(store.getSnapshot().sidebar.search).toBe('报告');
    store.openSession('old-5');
    expect(store.getSnapshot().sidebar).toMatchObject({ selectedSessionId: 'old-5', search: '', expandedPeers: ['group'] });
  });
});
