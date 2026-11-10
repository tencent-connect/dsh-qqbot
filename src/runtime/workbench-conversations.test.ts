import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QqTimeline, receivedEntryId } from './qq-timeline.ts';
import { WORKBENCH_TIMELINE_PATH } from '../shared/workbench-timeline-protocol.ts';
import { PrefsStore } from '../model/prefs-store.ts';
import { WORKBENCH_CONVERSATIONS_PATH, type WorkbenchConversation } from '../shared/workbench-conversation-protocol.ts';
import { ConversationSettingsStore, peerKey, registerWorkbenchConversations } from './workbench-conversations.ts';
import { legacyAgentSettings } from './workbench-agent-settings.ts';
import { ConfigSchema, type ImQQBotConfig } from '../config.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qq-conversation-tests-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const url = `http://dsh.internal${WORKBENCH_CONVERSATIONS_PATH}`;
type TestRoute = { path: string; methods: string[]; fetch(request: Request): Promise<Response> };
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

it('copies per-robot defaults once and freezes legacy peers in the same commit as a template change', () => {
  const path = join(dir, 'defaults.json');
  const store = new ConversationSettingsStore(path);
  const legacy = legacyAgentSettings(ConfigSchema({ streaming: false, directPrompt: 'legacy' } as ImQQBotConfig));
  const oldA = peerKey('A', 'c2c', 'old');
  const newA = peerKey('A', 'group', 'same');
  const newB = peerKey('B', 'group', 'same');
  const newPrivate = peerKey('A', 'c2c', 'same');
  store.save(oldA, { revision: 0, receiving: false });
  const a = { ...legacy, groupPrompt: 'A', streaming: true };
  const b = { ...legacy, groupPrompt: 'B', showToolResults: true };
  store.saveTemplate('A', { revision: 0, settings: a }, new Map([[oldA, legacy]]));
  store.saveTemplate('B', { revision: 0, settings: b }, new Map());
  store.initialize(newA, store.template('A')!.settings);
  store.initialize(newB, store.template('B')!.settings);
  expect(() => store.saveTemplate('A', { revision: 0, settings: b }, new Map())).toThrow('已更新');
  store.saveTemplate('A', { revision: 1, settings: { ...a, directPrompt: 'A2' } }, new Map([[newA, legacy]]));
  store.initialize(newA, store.template('A')!.settings);
  store.initialize(newPrivate, store.template('A')!.settings);
  const restored = new ConversationSettingsStore(path);
  expect(restored.get(oldA)).toMatchObject({ agent: legacy, receiving: false });
  expect(restored.get(newA).agent).toEqual(a);
  expect(restored.get(newB).agent).toEqual(b);
  expect(restored.get(newPrivate).agent).toMatchObject({ directPrompt: 'A2', groupPrompt: 'A' });
});

async function fixture(withPersistence = true) {
  const prefs = new PrefsStore(undefined, { path: join(dir, 'prefs.json') });
  const settingsPath = join(dir, 'settings.json');
  const conversationSettings = new ConversationSettingsStore(settingsPath);
  const access = { c2cMode: 'allowlist' as const, c2cAllow: ['same'], groupMode: 'disabled' as const, groupAllow: [] };
  const account = { access, liveSessionId: () => undefined, peerName: () => '' };
  const stat = vi.fn(async (id: string) => !['old-a', 'group-a', 'current-b'].includes(id) ? undefined : ({
    header: { id, cwd: '/test/workspace', agentPreset: 'test-preset', createdAt: 5 },
  }));
  const ctx = new Context();
  const timeline = new QqTimeline(join(dir, "timeline"), logger);
  const registered = new Map<string, TestRoute>();
  const host = ctx.plugin(scope => {
    if (withPersistence) scope.provide('sessionPersistence', { stat });
    scope.provide('connection', { fetch: { register: (route: TestRoute) => {
      registered.set(route.path, route);
      return async () => { registered.delete(route.path); };
    } } });
  });
  await host.await();
  const plugin = ctx.plugin(scope => registerWorkbenchConversations(scope, {
    prefs, conversationSettings, timeline, conversationAccount: id => ['A', 'B'].includes(id) ? account : undefined,
  }, logger));
  await plugin.await();
  const route = registered.get(WORKBENCH_CONVERSATIONS_PATH);
  const history = registered.get(WORKBENCH_TIMELINE_PATH);
  if (!route || !history) throw new Error('QQ workbench route not registered');
  return {
    route, stat, prefs, settingsPath, access, conversationSettings, timeline,
    history: (query: string) => history.fetch(new Request('http://dsh.internal' + WORKBENCH_TIMELINE_PATH + '?' + query)),
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
      scope: 'c2c', openId: 'same', name: '', alias: '', receiving: true, recording: true, admitted: true, revision: 0,
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
    expect(restored.get(peerKey('A', 'group', 'same'))).toEqual({ alias: '我的群', receiving: true, recording: true, revision: 2 });
    expect(restored.get(peerKey('A', 'c2c', 'same'))).toEqual({ alias: '', receiving: true, recording: true, revision: 0 });
    expect(restored.get(peerKey('B', 'group', 'same'))).toEqual({ alias: '', receiving: true, recording: true, revision: 0 });

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

it('discovers admitted recorded peers without a Session and reads only the explicit robot and scope', async () => {
  const f = await fixture();
  try {
    const record = (appId: string, scope: 'c2c' | 'group', text: string) => {
      f.timeline.record(appId, { scope, targetId: 'same' }, {
        id: receivedEntryId('platform-message'), at: 1, direction: 'inbound', text, status: 'received',
      }, true);
    };
    record('A', 'group', 'one');
    record('A', 'c2c', 'two');
    record('B', 'group', 'three');
    const peers = await (await f.get('A')).json();
    expect(peers.conversations).toContainEqual(expect.objectContaining({ scope: 'group', sessions: [] }));
    const group = await (await f.history('appId=A&scope=group&openId=same')).json();
    expect(group.entries.map((row: { text: string }) => row.text)).toEqual(['one']);
    const id = receivedEntryId('platform-message');
    const lookup = '&entryId=' + id;
    expect(await (await f.history('appId=A&scope=c2c&openId=same' + lookup)).json()).toMatchObject({ text: 'two' });
    expect(await (await f.history('appId=B&scope=group&openId=same' + lookup)).json()).toMatchObject({ text: 'three' });
    expect((await f.history('appId=B&scope=c2c&openId=same' + lookup)).status).toBe(404);
    expect((await f.history('appId=A&scope=group&openId=same&before=' + id + lookup)).status).toBe(400);
    expect((await f.history('appId=C&scope=group&openId=same')).status).toBe(404);
    expect((await f.history('appId=A&scope=other&openId=same')).status).toBe(400);
    expect((await f.post({ appId: 'A', scope: 'group', openId: 'same', revision: 0, recording: false })).status).toBe(200);
    expect(f.conversationSettings.get(peerKey('A', 'group', 'same')).recording).toBe(false);
    expect(f.conversationSettings.get(peerKey('B', 'group', 'same')).recording).toBe(true);
    expect((await (await f.history('appId=A&scope=group&openId=same')).json()).entries).toHaveLength(1);
  } finally { await f.close(); }
});

it('persists an empty custom list separately from native tools and snapshots it only for new peers', () => {
  const path = join(dir, 'settings.json');
  const store = new ConversationSettingsStore(path);
  const native = legacyAgentSettings(ConfigSchema({} as ImQQBotConfig));
  const first = peerKey('A', 'group', 'same');
  const second = peerKey('A', 'c2c', 'same');
  const otherRobot = peerKey('B', 'c2c', 'same');
  store.initialize(first, native);
  store.saveTemplate('A', { revision: 0, settings: { ...native, permission: 'read-only', tools: [] } }, new Map());
  store.initialize(second, store.template('A')!.settings);
  store.initialize(otherRobot, native);
  store.save(second, { revision: 1, agent: { ...store.get(second).agent!, tools: ['read', 'read'] } });
  const restored = new ConversationSettingsStore(path);
  expect(restored.get(first).agent?.tools).toBeUndefined();
  expect(restored.get(second).agent?.tools).toEqual(['read']);
  expect(restored.get(otherRobot).agent?.tools).toBeUndefined();
  expect(restored.template('A')?.settings.tools).toEqual([]);
  expect(() => restored.save(second, { revision: 1, agent: native })).toThrow('已更新');
});
