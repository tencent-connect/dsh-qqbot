import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrefsStore } from '../model/prefs-store.ts';
import { WORKBENCH_CONVERSATIONS_PATH, type WorkbenchConversation } from '../shared/workbench-conversation-protocol.ts';
import { ConversationSettingsStore, peerKey, registerWorkbenchConversations } from './workbench-conversations.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qq-conversation-tests-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const url = `http://dsh.internal${WORKBENCH_CONVERSATIONS_PATH}`;
type TestRoute = { path: string; methods: string[]; fetch(request: Request): Promise<Response> };
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

async function fixture(withPersistence = true) {
  const prefs = new PrefsStore(undefined, { path: join(dir, 'prefs.json') });
  const settingsPath = join(dir, 'settings.json');
  const conversationSettings = new ConversationSettingsStore(settingsPath);
  const access = { c2cMode: 'allowlist' as const, c2cAllow: ['same'], groupMode: 'disabled' as const, groupAllow: [] };
  const account = { access, liveSessionId: () => undefined, peerName: () => '' };
  const stat = vi.fn(async (id: string) => id === 'reserved' || id.startsWith('qqbot-') ? undefined : ({
    header: { id, cwd: '/test/workspace', agentPreset: 'test-preset', createdAt: 5 },
  }));
  const ctx = new Context();
  let registered: TestRoute | undefined;
  const host = ctx.plugin(scope => {
    if (withPersistence) scope.provide('sessionPersistence', { stat });
    scope.provide('connection', { fetch: { register: (route: TestRoute) => {
      registered = route;
      return async () => { registered = undefined; };
    } } });
  });
  await host.await();
  const plugin = ctx.plugin(scope => registerWorkbenchConversations(scope, {
    prefs, conversationSettings, conversationAccount: id => ['A', 'B'].includes(id) ? account : undefined,
  }, logger));
  await plugin.await();
  if (!registered) throw new Error('QQ workbench route not registered');
  const route = registered;
  return {
    route, stat, prefs, settingsPath, access, conversationSettings,
    get: (appId: string) => route.fetch(new Request(url + '?appId=' + appId)),
    post: (body: unknown) => route.fetch(new Request(url, { method: 'POST', body: JSON.stringify(body) })),
    close: async () => { await plugin.dispose(); await host.dispose(); },
  };
}

it('projects only the selected robot and hides reserved Session IDs until the Host reports them', async () => {
  const f = await fixture();
  try {
    const peer = peerKey('A', 'c2c', 'same');
    f.prefs.setSessionId(peer, 'old-a');
    f.prefs.setSessionId(peer, 'reserved');
    f.prefs.setSessionId(peerKey('A', 'group', 'same'), 'group-a');
    f.prefs.setSessionId(peerKey('B', 'c2c', 'same'), 'current-b');

    expect(f.route.methods).toEqual(['GET', 'POST']);
    const response = await f.get('A');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const { conversations } = await response.json() as { conversations: WorkbenchConversation[] };
    const c2c = conversations.find(c => c.scope === 'c2c');
    const group = conversations.find(c => c.scope === 'group');
    expect(c2c).toEqual({
      scope: 'c2c', openId: 'same', name: '', alias: '', receiving: true, admitted: true, revision: 0,
      sessions: [{ id: 'old-a', createdAt: 5, cwd: '/test/workspace', preset: 'test-preset' }],
    });
    expect(group).toMatchObject({ currentSessionId: 'group-a', admitted: false });
    expect(f.stat).not.toHaveBeenCalledWith('current-b');
    expect((await f.get('missing')).status).toBe(404);
    expect((await f.get('A&appId=B')).status).toBe(400);

    const other = await f.get('B');
    expect(await other.json()).toMatchObject({ conversations: [{ currentSessionId: 'current-b' }] });
  } finally {
    await f.close();
  }
});

it('keeps settings durable and scoped with stale-save rejection and separate admission', async () => {
  const f = await fixture();
  try {
    f.prefs.setSessionId(peerKey('A', 'group', 'same'), 'group-a');
    const body = { appId: 'A', scope: 'group', openId: 'same', revision: 0, alias: '我的群', receiving: false };
    const response = await f.post(body);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ conversation: { receiving: false, admitted: false, alias: '我的群', revision: 1 } });
    expect((await f.post({ ...body, receiving: true })).status).toBe(409);
    expect((await f.post({ ...body, revision: 1, receiving: true })).status).toBe(200);
    expect((await f.post({ ...body, openId: 'unknown' })).status).toBe(404);
    expect((await f.post({ ...body, openId: 'a b' })).status).toBe(400);

    const restored = new ConversationSettingsStore(f.settingsPath);
    expect(restored.get(peerKey('A', 'group', 'same'))).toEqual({ alias: '我的群', receiving: true, revision: 2 });
    expect(restored.get(peerKey('A', 'c2c', 'same'))).toEqual({ alias: '', receiving: true, revision: 0 });
    expect(restored.get(peerKey('B', 'group', 'same'))).toEqual({ alias: '', receiving: true, revision: 0 });

    // Even before the first read after a successful save, disappearance must not enable peers.
    rmSync(f.settingsPath);
    expect(() => f.conversationSettings.get(peerKey('A', 'group', 'same'))).toThrow();
  } finally {
    await f.close();
  }
  expect((await f.get('A')).status).toBe(503);
});

it('explains when the Host cannot verify any Session IDs', async () => {
  const f = await fixture(false);
  try {
    const response = await f.get('A');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('会话持久化接口') });
  } finally {
    await f.close();
  }
});
