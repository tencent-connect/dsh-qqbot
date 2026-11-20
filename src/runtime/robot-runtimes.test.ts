import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { QQBot } from '@tencent-connect/qqbot-nodejs';
import { ACCOUNT_METHODS, ACCOUNT_RPC_ENDPOINT } from '../shared/rpc-protocol.ts';
import type { PairStatusWire, PairChallenge } from '../shared/pairing-protocol.ts';
import type { RpcResult } from '../rpc-carrier.ts';
import { expect, it, vi } from 'vitest';
import { ConfigSchema, type AccessControlConfig, type ImQQBotConfig } from '../config.ts';
import type { DshAgentRegistry } from '../session/index.ts';
import { persistCredentialsToProfile } from '../setup/persist.ts';
import { RobotConfigStore } from './robot-config.ts';
import { RobotRuntimes } from './robot-runtimes.ts';
import { PrefsStore } from '../model/prefs-store.ts';
import { QqTimeline } from './qq-timeline.ts';
import { SESSION_PREFERENCES_FILE } from '../shared/dirs.ts';

const sandbox = vi.hoisted(() => ({ dir: '' }));
vi.mock('../shared/dirs.ts', async original => {
  const actual = await original<typeof import('../shared/dirs.ts')>();
  return {
    ...actual,
    get PLUGIN_HOME() { return sandbox.dir || actual.PLUGIN_HOME; },
    resolveRobotWorkspace: (appId: string) => join(sandbox.dir || actual.PLUGIN_HOME, 'robots', appId, 'workspace'),
  };
});

it('unbinds an AppID that was previously removed as an additional robot and then bound as primary', async () => {
  sandbox.dir = mkdtempSync(join(tmpdir(), 'qq-robot-primary-after-unbind-'));
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const store = new RobotConfigStore(join(sandbox.dir, 'qqbot-robots.json'));
  const credentials = { appId: 'fixture-main', appSecret: 'fixture-secret' };
  const config = ConfigSchema({ ...credentials, media: { enabled: false } } as ImQQBotConfig);
  const prior = store.save({
    ...credentials, kind: 'additional', alias: '已有名称', enabled: true, revision: 0, access: config.access,
  });
  store.removeAdditional(prior.appId, prior.revision);
  vi.stubEnv('QQBOT_APPID', undefined);
  vi.stubEnv('QQBOT_SECRET', undefined);
  let runtime!: RobotRuntimes;
  const plugin = new Context().plugin(scope => {
    runtime = new RobotRuntimes(scope, { get: vi.fn() } as unknown as DshAgentRegistry, logger, store);
    runtime.bindPrimary(config);
  });
  try {
    expect(persistCredentialsToProfile(credentials, sandbox.dir, logger)).toBe(true);
    await plugin.await();
    const [primary] = runtime.list();
    expect(primary.primary).toBe(true);
    expect(() => runtime.remove(primary.appId, primary.revision, sandbox.dir)).not.toThrow();
    expect(primary.revision).toBeGreaterThan(prior.revision);
    expect(runtime.list()).toEqual([]);
    expect(readFileSync(join(sandbox.dir, 'cordis.patch.yml'), 'utf8')).not.toContain('appSecret:');
  } finally {
    await plugin.dispose();
    vi.unstubAllEnvs();
    rmSync(sandbox.dir, { recursive: true, force: true });
    sandbox.dir = '';
  }
});

it('deletes the primary without waiting for disposal and rebinds the same AppID after reload', async () => {
  sandbox.dir = mkdtempSync(join(tmpdir(), 'qq-robot-rebind-'));
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const credentials = { appId: 'fixture-main', appSecret: 'fixture-secret' };
  const store = new RobotConfigStore(join(sandbox.dir, 'qqbot-robots.json'));
  const agents = { get: vi.fn() } as unknown as DshAgentRegistry;
  const start = vi.spyOn(QQBot.prototype, 'start').mockResolvedValue(undefined);
  vi.stubEnv('QQBOT_APPID', undefined);
  vi.stubEnv('QQBOT_SECRET', undefined);
  const ctx = new Context();
  let runtime!: RobotRuntimes;
  const mount = (primary: boolean) => ctx.plugin(scope => {
    runtime = new RobotRuntimes(scope, agents, logger, store);
    if (primary) runtime.bindPrimary(ConfigSchema({
      ...credentials, media: { enabled: false },
      access: { c2cMode: 'allowlist', c2cAllow: ['fixture-user'], groupMode: 'allowlist', groupAllow: ['fixture-group'], commandMode: 'allowlist' },
    } as ImQQBotConfig));
    return runtime.start();
  });
  let plugin: ReturnType<typeof mount> | undefined;
  try {
    expect(persistCredentialsToProfile(credentials, sandbox.dir, logger)).toBe(true);
    const original = store.save({ appId: credentials.appId, revision: 0, kind: 'primary', alias: '主机器人', enabled: true });
    plugin = mount(true);
    await plugin.await();
    const other = await runtime.save({ appId: 'fixture-other', appSecret: 'other-secret', revision: null, enabled: false });
    runtime.prefs.setSessionId('qqbot:fixture-main:c2c:shared-user', 'known-session');
    expect(runtime.list().map(robot => robot.appId)).toEqual([credentials.appId, other.appId]);
    expect(start).toHaveBeenCalledTimes(1);

    const remove = () => runtime.remove(credentials.appId, original.revision, sandbox.dir);
    expect(remove()).toBeUndefined();
    expect(runtime.list()).toEqual([other]);
    expect(remove()).toBeUndefined();
    const patch = readFileSync(join(sandbox.dir, 'cordis.patch.yml'), 'utf8');
    expect(patch).not.toContain('appSecret:');
    expect(patch).not.toContain('appId:');
    expect(store.get(credentials.appId)?.kind).toBe('primary');

    await plugin.dispose();
    plugin = mount(false);
    await plugin.await();
    const rebound = await runtime.save({ ...credentials, revision: null });
    expect(rebound).toMatchObject({
      appId: credentials.appId, primary: false,
      access: { c2cAllow: ['fixture-user'], groupAllow: ['fixture-group'], commandMode: 'allowlist' },
    });
    expect(rebound.revision).toBeGreaterThan(original.revision);
    expect(() => remove()).toThrow('配置已变化');
    await expect(runtime.save({ ...credentials, revision: null })).rejects.toThrow('这个机器人已添加');
    expect(runtime.list().map(robot => robot.appId).sort()).toEqual([credentials.appId, other.appId].sort());
    expect(runtime.prefs.getSessionId('qqbot:fixture-main:c2c:shared-user')).toBe('known-session');
  } finally {
    await plugin?.dispose();
    start.mockRestore();
    vi.unstubAllEnvs();
    rmSync(sandbox.dir, { recursive: true, force: true });
    sandbox.dir = '';
  }
});

it('clears only the confirmed binding, letting a later retry finish safely', async () => {
  sandbox.dir = mkdtempSync(join(tmpdir(), 'qq-robot-clear-'));
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const store = new RobotConfigStore(join(sandbox.dir, 'qqbot-robots.json'));
  let runtime!: RobotRuntimes;
  const plugin = new Context().plugin(scope => {
    runtime = new RobotRuntimes(scope, { get: vi.fn() } as unknown as DshAgentRegistry, logger, store);
  });
  try {
    await plugin.await();
    const add = (appId: string) => runtime.save({ appId, appSecret: 'fixture', revision: null, enabled: false });
    const target = await add('target');
    const other = await add('target-other');
    const key = 'qqbot:target:group:same';
    const otherKey = 'qqbot:target-other:group:same';
    const peer = { scope: 'group', targetId: 'same' } as const;
    const entry = { id: 'message', at: 1, direction: 'inbound', text: 'saved QQ message', status: 'received' } as const;
    runtime.prefs.setSessionId(key, 'old-session');
    runtime.prefs.setSessionId(key, 'current-session');
    runtime.prefs.setSessionId(otherKey, 'other-session');
    runtime.timeline.record(target.appId, peer, entry);
    runtime.timeline.record(other.appId, peer, entry);
    runtime.remove(target.appId, target.revision, sandbox.dir, 'retain', target.bindingRevision);
    expect(runtime.prefs.getSessionId(key)).toBe('current-session');
    expect(runtime.timeline.page(target.appId, peer)?.entries).toEqual([entry]);
    expect(() => runtime.remove(target.appId, target.revision, sandbox.dir, 'clear', target.bindingRevision))
      .toThrow('清除记录尚未执行');

    const rebound = await add(target.appId);
    expect(() => runtime.remove(target.appId, target.revision, sandbox.dir, 'clear', target.bindingRevision)).toThrow('重新确认');
    await runtime.save({ appId: rebound.appId, revision: rebound.revision, alias: 'renamed' });
    const failFirst = vi.spyOn(runtime.timeline, 'clearAccount').mockImplementationOnce(() => { throw new Error('unwritable'); });
    const clear = () => runtime.remove(rebound.appId, rebound.revision, sandbox.dir, 'clear', rebound.bindingRevision);
    expect(clear).toThrow('清除记录尚未完成');
    expect(new RobotConfigStore(join(sandbox.dir, 'qqbot-robots.json')).pendingClears().get(target.appId)).toBe(rebound.revision);
    expect(runtime.list()).toEqual([other]);
    expect(clear()).toBeUndefined();
    expect(failFirst).toHaveBeenCalledTimes(2);
    expect(clear()).toBeUndefined();
    expect(failFirst).toHaveBeenCalledTimes(2);

    const prefs = new PrefsStore(undefined, { path: join(sandbox.dir, SESSION_PREFERENCES_FILE) });
    expect(prefs.listSessionBindings(target.appId)).toEqual([]);
    expect(prefs.findKnownSessionKey('old-session')).toBeUndefined();
    expect(prefs.findKnownSessionKey('current-session')).toBeUndefined();
    expect(prefs.legacySessionId(key)).toBeUndefined();
    expect(prefs.getSessionId(otherKey)).toBe('other-session');
    const timeline = new QqTimeline(join(sandbox.dir, 'timeline'), logger);
    expect(timeline.page(target.appId, peer)?.entries).toEqual([]);
    expect(timeline.page(other.appId, peer)?.entries).toEqual([entry]);
    await add(target.appId);
    expect(clear).toThrow('重新确认');
  } finally {
    await plugin.dispose();
    rmSync(sandbox.dir, { recursive: true, force: true });
    sandbox.dir = '';
  }
});

it('uses upstream defaults for new robots and retains access for existing AppIDs', async () => {
  sandbox.dir = mkdtempSync(join(tmpdir(), 'qq-robot-access-defaults-'));
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const store = new RobotConfigStore(join(sandbox.dir, 'robots.json'));
  const savedAccess = {
    c2cMode: 'disabled', c2cAllow: ['saved-user'],
    groupMode: 'allowlist', groupAllow: ['saved-group'], commandMode: 'disabled',
  } satisfies AccessControlConfig;
  const existing = store.save({
    kind: 'additional', appId: 'existing-robot', appSecret: 'fixture-secret', alias: '手填名', enabled: false, revision: 0,
    access: savedAccess,
  });
  writeFileSync(join(sandbox.dir, 'qq-display-names.json'), JSON.stringify({
    [JSON.stringify([existing.appId, 'bot-mention', 'bot-id', ''])]: 'QQ 名称',
    [JSON.stringify([existing.appId, 'bot-mention', 'group-bot-id', 'group'])]: '群内称呼',
  }));
  let runtime!: RobotRuntimes;
  const plugin = new Context().plugin(scope => {
    runtime = new RobotRuntimes(scope, { get: vi.fn() } as unknown as DshAgentRegistry, logger, store);
  });
  try {
    await plugin.await();
    const credentials = { appSecret: 'fixture-secret', revision: null, enabled: false };
    const access = {
      c2cMode: 'open', c2cAllow: [], groupMode: 'open', groupAllow: [], commandMode: 'open',
    };
    const manual = await runtime.save({ ...credentials, appId: 'manual-robot' });
    expect(manual.access).toEqual(access);
    expect(manual.platformName).toBeUndefined();
    expect(runtime.list().find(robot => robot.appId === existing.appId))
      .toMatchObject({ alias: '手填名', platformName: 'QQ 名称' });
    await expect(runtime.save({ ...credentials, appId: existing.appId })).rejects.toThrow('这个机器人已添加');
    expect(store.get(existing.appId)).toEqual(existing);

    runtime.remove(existing.appId, existing.revision, sandbox.dir);
    const rebound = await runtime.save({ ...credentials, appId: existing.appId });
    expect(rebound.access).toEqual(savedAccess);
  } finally {
    await plugin.dispose();
    rmSync(sandbox.dir, { recursive: true, force: true });
    sandbox.dir = '';
  }
});

it('shares the upstream whitelist handlers by AppID across enable, revoke and rebind', async () => {
  sandbox.dir = mkdtempSync(join(tmpdir(), 'qq-robot-scoped-access-'));
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const store = new RobotConfigStore(join(sandbox.dir, 'robots.json'));
  const agents = { get: vi.fn() } as unknown as DshAgentRegistry;
  const start = vi.spyOn(QQBot.prototype, 'start').mockResolvedValue(undefined);
  const ctx = new Context();
  const routes = new Map<string, (request: Request) => Promise<Response>>();
  const host = ctx.plugin(scope => {
    scope.provide('connection', { fetch: { register(route: { path: string; fetch: (request: Request) => Promise<Response> }) {
      routes.set(route.path, route.fetch);
      return async () => { routes.delete(route.path); };
    } } });
  });
  await host.await();
  let runtime!: RobotRuntimes;
  const plugin = ctx.plugin(scope => { runtime = new RobotRuntimes(scope, agents, logger, store); });
  await plugin.await();
  const path = '/api/' + ACCOUNT_RPC_ENDPOINT;
  const req = async (method: string, appId: string, payload: Record<string, unknown> = {}): Promise<RpcResult> => {
    const response = await routes.get(path)!(new Request('http://localhost' + path, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request', rpcId: 'test', method: ACCOUNT_RPC_ENDPOINT, payload: { method, payload: { appId, ...payload } },
      }),
    }));
    return (await response.json()).result as RpcResult;
  };
  const readStatus = async (appId: string): Promise<PairStatusWire> => {
    const result = await req(ACCOUNT_METHODS.pairStatus, appId);
    if (!result.ok) throw new Error(result.error.message);
    return result.value as PairStatusWire;
  };
  const create = (appId: string) => runtime.save({
    appId, appSecret: 'fixture-secret', revision: null,
    access: { c2cMode: 'allowlist', groupMode: 'allowlist', commandMode: 'allowlist' },
  });
  const read = (appId: string) => runtime.list().find(robot => robot.appId === appId)!;
  try {
    await vi.waitFor(() => expect(routes.has(path)).toBe(true));
    await create('robot-a');
    await create('robot-b');
    const membership = [
      ['allow-c2c', 'allowC2c', 'contact-aa:私聊'],
      ['allow-group', 'allowGroup', 'group-aaaa:群聊'],
      ['owner', 'owners', 'owner-aaaa:命令用户'],
    ] as const;
    for (const [purpose, field, openid] of membership) {
      expect(await req(ACCOUNT_METHODS.pairManual, 'robot-a', { purpose, openid })).toMatchObject({ ok: true });
      expect((await readStatus('robot-a'))[field]).toHaveLength(1);
      expect((await readStatus('robot-b'))[field]).toHaveLength(0);
    }
    expect(await req(ACCOUNT_METHODS.pairStatus, 'absent')).toMatchObject({ ok: false, error: { code: 'account/not-found' } });
    const stale = read('robot-a').revision;
    const issued = await req(ACCOUNT_METHODS.pairIssue, 'robot-a', { purpose: 'allow-c2c' });
    if (!issued.ok) throw new Error(issued.error.message);
    const { code } = issued.value as PairChallenge;
    expect(await req(ACCOUNT_METHODS.pairRevoke, 'robot-a', { purpose: 'allow-c2c', openid: 'contact-aa' })).toMatchObject({ ok: true });
    await expect(runtime.save({ appId: 'robot-a', revision: stale, access: { c2cMode: 'open' } })).rejects.toThrow('配置已更新');
    await runtime.save({ appId: 'robot-a', revision: read('robot-a').revision, enabled: false });
    expect(await req(ACCOUNT_METHODS.pairIssue, 'robot-a', { purpose: 'allow-c2c' })).toMatchObject({ ok: false, error: { code: 'pair/rejected' } });
    expect((await readStatus('robot-a')).challenges).toEqual([]);
    expect(await req(ACCOUNT_METHODS.pairEnd, 'robot-a', { purpose: 'allow-c2c', code })).toMatchObject({ ok: true });
    expect(read('robot-b').enabled).toBe(true);
    runtime.remove('robot-a', read('robot-a').revision, sandbox.dir);
    expect(await req(ACCOUNT_METHODS.pairStatus, 'robot-a')).toMatchObject({ ok: false, error: { code: 'account/not-found' } });
    await create('robot-a');
    const restored = await readStatus('robot-a');
    expect(restored.allowC2c).toEqual([]);
    expect(restored.allowGroup).toMatchObject([{ openid: 'group-aaaa', nickname: '群聊' }]);
    expect(restored.owners).toMatchObject([{ openid: 'owner-aaaa', nickname: '命令用户' }]);
    expect(restored.challenges).toEqual([]);
  } finally {
    await plugin.dispose();
    await host.dispose();
    start.mockRestore();
    rmSync(sandbox.dir, { recursive: true, force: true });
    sandbox.dir = '';
  }
});
