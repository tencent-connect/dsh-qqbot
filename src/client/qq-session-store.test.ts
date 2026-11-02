import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSnapshot, ConversationView } from '../shared/conversation-protocol.ts';
import { QQSessionStore } from './qq-session-store.ts';

function entry(key: string, sessionId: string | null): ConversationView {
  return { key, appId: 'app', scope: 'group', peerId: key, name: key, alias: '', currentSessionId: sessionId,
    sessions: sessionId ? [{ sessionId, startedAt: 1 }, { sessionId: `${sessionId}-old`, startedAt: 0 }] : [], members: [],
    policy: { version: 1, template: 'chat', name: '聊天', role: { description: '', tone: '', world: '', prompt: '' }, tools: {},
      resources: { readRoots: [], writeRoots: [], sendRoots: [], executionEnabled: false, sandbox: 'read-only', networkDomains: [], maxFiles: 1, maxFileMB: 10 },
      controllers: [], approvers: [], allowedModels: [], allowedPresets: [], allowedPermissions: ['read-only'], permission: 'read-only', cwd: '', requireMention: true,
      context: { mode: 'recent', maxMessages: 10, maxAgeMinutes: 10, maxChars: 4000, retentionDays: 7 } },
    lastActivity: 1, observedAllMessages: false, admitted: true, running: false, currentModel: null, currentPreset: null, nextPreset: null, deliveryState: null };
}
function answerPreview(store: QQSessionStore) { const overlay = store.getSnapshot().overlay; return overlay?.kind === 'answer' ? overlay.preview : null; }
const snapshot = (...conversations: ConversationView[]): ConversationSnapshot => ({ conversations, tools: [], ownerIds: [] });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('QQ navigation and fixed answer targets', () => {
  it('shares a fixed new-session form target and routes alias editing to inline settings', () => {
    const store = new QQSessionStore({ openSession: vi.fn() });
    const current = entry('group-a', 'session-a');
    current.workspaceId = 'workspace-a';
    store.accept(snapshot(current));
    store.openOperation(current, 'workspace');
    const workspace = store.getSnapshot().overlay;
    expect(workspace).toMatchObject({ kind: 'operation', target: { kind: 'newSession', key: 'group-a', sessionId: 'session-a', workspaceId: 'workspace-a' } });
    store.accept(snapshot({ ...current, currentSessionId: 'new-session', workspaceId: 'workspace-b' }));
    expect(workspace).toMatchObject({ target: { sessionId: 'session-a', workspaceId: 'workspace-a' } });
    store.openOperation(current, 'alias');
    const alias = store.getSnapshot().overlay;
    current.policy.version = 2;
    expect(alias).toMatchObject({ kind: 'drawer', target: { key: 'group-a', tab: 'settings' } });
    expect(workspace).toMatchObject({ target: { policyVersion: 1 } });
  });
  it('uses saved next-session Agent defaults before the current Session preset', () => {
    const store = new QQSessionStore({ openSession: vi.fn() });
    const current = { ...entry('next-agent', 'current'), currentPreset: 'old-agent', nextPreset: 'new-agent' };
    store.accept(snapshot(current)); store.openOperation(current);
    expect(store.getSnapshot().overlay).toMatchObject({ kind: 'operation', target: { presetId: 'new-agent' } });
  });
  it('publishes explicit deliveries to subscribers and refreshes records without refreshing the directory', async () => {
    const delivery = { id: 'operation-a', key: 'group-a', text: 'answer', state: 'accepted', at: 1, updatedAt: 2, parts: [{ index: 0, state: 'accepted' }] };
    const fetch = vi.fn(async () => new Response(JSON.stringify({ deliveries: [delivery] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const store = new QQSessionStore({ openSession: vi.fn() });
    const listener = vi.fn(); store.subscribe(listener);
    await store.perform({ action: 'deliveries', key: 'group-a' });
    expect(store.getSnapshot().deliveries['group-a']).toEqual([delivery]);
    expect(listener).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('opens authorized current Sessions in the main page without submitting or creating a task', () => {
    const openSession = vi.fn(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const store = new QQSessionStore({ openSession }); const current = entry('group-a', 'session-a');
    store.accept(snapshot(current)); store.open(current);
    expect(openSession).toHaveBeenCalledExactlyOnceWith('session-a');
    expect(fetch).not.toHaveBeenCalled(); expect(store.getSnapshot().overlay).toBeNull();
  });
  it('opens management for missing or unauthorized mappings and never navigates an empty id', () => {
    const openSession = vi.fn(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const store = new QQSessionStore({ openSession }); const missing = entry('pending', null);
    store.open(missing); expect(store.getSnapshot().overlay).toMatchObject({ kind: 'drawer', target: { key: 'pending', sessionId: null } });
    store.open({ ...entry('revoked', 'session-b'), admitted: false });
    expect(store.getSnapshot().overlay).toMatchObject({ kind: 'drawer', target: { key: 'revoked', sessionId: 'session-b' } });
    expect(openSession).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('freezes preview identity and content while navigation or display names change', async () => {
    const store = new QQSessionStore({ openSession: vi.fn() }); const a = entry('group-a', 'session-a'); const b = entry('group-b', 'session-b');
    store.accept(snapshot(a, b)); store.previewAnswer('session-a', 'answer-a', '最终回答');
    const preview = answerPreview(store);
    if (!preview) throw new Error('missing preview');
    store.open(b); store.accept(snapshot({ ...a, alias: '改名后' }, b));
    expect(preview).toMatchObject({ key: 'group-a', sessionId: 'session-a', messageId: 'answer-a', name: 'group-a', text: '最终回答' });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ delivery: { id: 'delivery', state: 'accepted' } }), { status: 200 })); vi.stubGlobal('fetch', fetch);
    await store.sendAnswer(preview);
    expect(fetch).toHaveBeenCalledWith('/qqbot/im-qqbot/conversations', expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'send', key: 'group-a', operationId: preview.operationId, text: '最终回答', sourceSessionId: 'session-a', sourceMessageId: 'answer-a' }) }));
  });
  it('revokes confirmation after rotation or admission changes and omits historical answer actions', async () => {
    const store = new QQSessionStore({ openSession: vi.fn() }); const a = entry('group-a', 'session-a');
    store.accept(snapshot(a)); store.previewAnswer('session-a-old', 'old-answer', '旧回答');
    expect(answerPreview(store)).toBeNull();
    store.previewAnswer('session-a', 'answer-a', '最终回答'); const preview = answerPreview(store);
    if (!preview) throw new Error('missing preview');
    store.accept(snapshot({ ...a, currentSessionId: 'session-new' }));
    expect(store.canSend(preview)).toBe(false); await expect(store.sendAnswer(preview)).rejects.toThrow('已变化');
    store.accept(snapshot({ ...a, admitted: false })); expect(store.canSend(preview)).toBe(false);
  });
  it('does not let an older directory response restore a retired mapping after an action', async () => {
    vi.useFakeTimers();
    let complete: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => { complete = resolve; });
    vi.stubGlobal('fetch', vi.fn((path: string) => path.endsWith('/runtime') ? Promise.resolve(new Response(JSON.stringify({ phase: 'ready' }), { status: 200 })) : pending));
    const store = new QQSessionStore({ openSession: vi.fn() }); const stop = store.start();
    store.accept(snapshot(entry('group-a', 'new-session')));
    complete?.(new Response(JSON.stringify(snapshot(entry('group-a', 'old-session'))), { status: 200 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.conversation('group-a')?.currentSessionId).toBe('new-session');
    expect(store.entry('old-session')).toBeUndefined();
    stop();
  });
  it('shares one directory poll across every subscriber and stops on plugin disposal', async () => {
    vi.useFakeTimers(); const fetch = vi.fn(async (path: string) => new Response(JSON.stringify(path.endsWith('/runtime') ? { phase: 'ready', updatedAt: 1, lastReceivedAt: null, lastSentAt: null, lastError: null } : snapshot(entry('group-a', 'session-a'))), { status: 200 })); vi.stubGlobal('fetch', fetch);
    const store = new QQSessionStore({ openSession: vi.fn() });
    const unsubscribe = Array.from({ length: 30 }, () => store.subscribe(vi.fn()));
    const stop = store.start(); await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2); expect(store.getSnapshot().runtime?.phase).toBe('ready'); expect(store.entry('session-a-old')?.key).toBe('group-a');
    await vi.advanceTimersByTimeAsync(10_000); expect(fetch).toHaveBeenCalledTimes(4);
    stop(); unsubscribe.forEach((dispose) => dispose()); await vi.advanceTimersByTimeAsync(30_000); expect(fetch).toHaveBeenCalledTimes(4);
  });
  it.each((['workspace', 'reset'] as const).flatMap((action) => (['cancel', 'close', 'exit', 'another-session'] as const).map((supersession) => ({ action, supersession }))))('keeps a completed $action action from navigating after $supersession', async ({ action, supersession }) => {
    let respond: ((response: Response) => void) | undefined;
    const pendingResponse = new Promise<Response>((resolve) => { respond = resolve; });
    vi.stubGlobal('fetch', vi.fn(() => pendingResponse));
    const openSession = vi.fn(); const store = new QQSessionStore({ openSession }); const current = entry('group-a', 'session-a');
    store.accept(snapshot(current)); store.setSidebarMode('qq'); store.openDrawer(current);
    const intent = store.navigationIntent();
    const pending = store.perform(action === 'workspace' ? { action, key: current.key, sessionId: 'session-a', workspaceId: 'new-workspace' } : { action, key: current.key, sessionId: 'session-a' })
      .then((result) => store.openActionResult(intent, result, current.key));
    if (supersession === 'cancel') intent.cancel();
    else if (supersession === 'close') store.closeDrawer();
    else if (supersession === 'exit') store.setSidebarMode('workspace');
    else store.openSession('session-a-old');
    respond?.(new Response(JSON.stringify({ sessionId: 'new-session', snapshot: snapshot({ ...current, currentSessionId: 'new-session' }) }), { status: 200 }));
    expect(await pending).toBe('superseded');
    expect(store.conversation(current.key)?.currentSessionId).toBe('new-session');
    expect(openSession.mock.calls.map(([id]) => id)).toEqual(supersession === 'another-session' ? ['session-a-old'] : []);
  });
  it.each(['workspace', 'reset'] as const)('opens a normally completed %s action once while preserving its directory update', async (action) => {
    let respond: ((response: Response) => void) | undefined;
    const pendingResponse = new Promise<Response>((resolve) => { respond = resolve; });
    vi.stubGlobal('fetch', vi.fn(() => pendingResponse));
    const openSession = vi.fn(); const store = new QQSessionStore({ openSession }); const current = entry('group-a', 'session-a');
    store.accept(snapshot(current)); store.setSidebarMode('qq');
    const intent = store.navigationIntent();
    const pending = store.perform(action === 'workspace' ? { action, key: current.key, sessionId: 'session-a', workspaceId: 'new-workspace' } : { action, key: current.key, sessionId: 'session-a' })
      .then((result) => store.openActionResult(intent, result, current.key));
    respond?.(new Response(JSON.stringify({ sessionId: 'new-session', snapshot: snapshot({ ...current, currentSessionId: 'new-session' }) }), { status: 200 }));
    expect(await pending).toBe('opened');
    expect(store.conversation(current.key)?.currentSessionId).toBe('new-session');
    expect(openSession).toHaveBeenCalledExactlyOnceWith('new-session');
  });
  it.each(['workspace', 'reset'] as const)('preserves selection and current mapping after a failed %s action', async (action) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: '服务拒绝操作' }), { status: 409 })));
    const openSession = vi.fn(); const store = new QQSessionStore({ openSession }); const current = entry('group-a', 'session-a');
    store.accept(snapshot(current)); store.openSession('session-a-old');
    const intent = store.navigationIntent();
    const pending = store.perform(action === 'workspace' ? { action, key: current.key, sessionId: 'session-a', workspaceId: 'new-workspace' } : { action, key: current.key, sessionId: 'session-a' })
      .then((result) => store.openActionResult(intent, result, current.key));
    await expect(pending).rejects.toThrow();
    expect(store.getSnapshot().sidebar.selectedSessionId).toBe('session-a-old');
    expect(store.conversation(current.key)?.currentSessionId).toBe('session-a');
    expect(openSession).toHaveBeenCalledExactlyOnceWith('session-a-old');
  });
});
