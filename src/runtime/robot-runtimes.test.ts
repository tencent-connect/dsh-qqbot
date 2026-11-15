import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { QQBot } from '@tencent-connect/qqbot-nodejs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { WebRoute } from '../setup/bind-routes.ts';
import { PAIR_END_PATH, PAIR_ISSUE_PATH, PAIR_MANUAL_PATH, PAIR_REVOKE_PATH, PAIR_STATUS_PATH } from '../shared/pairing-protocol.ts';
import { expect, it, vi } from 'vitest';
import { ConfigSchema, type ImQQBotConfig } from '../config.ts';
import type { DshAgentRegistry } from '../session/index.ts';
import { persistCredentialsToProfile } from '../setup/persist.ts';
import { RobotConfigStore } from './robot-config.ts';
import { RobotRuntimes } from './robot-runtimes.ts';

const sandbox = vi.hoisted(() => ({ dir: '' }));
vi.mock('../shared/dirs.ts', async original => {
  const actual = await original<typeof import('../shared/dirs.ts')>();
  return {
    ...actual,
    get PLUGIN_HOME() { return sandbox.dir || actual.PLUGIN_HOME; },
    resolveRobotWorkspace: (appId: string) => join(sandbox.dir || actual.PLUGIN_HOME, 'robots', appId, 'workspace'),
  };
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

it('shares the upstream whitelist handlers by AppID across enable, revoke and rebind', async () => {
  sandbox.dir = mkdtempSync(join(tmpdir(), 'qq-robot-scoped-access-'));
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const store = new RobotConfigStore(join(sandbox.dir, 'robots.json'));
  const agents = { get: vi.fn() } as unknown as DshAgentRegistry;
  const start = vi.spyOn(QQBot.prototype, 'start').mockResolvedValue(undefined);
  const ctx = new Context();
  const routes = new Map<string, WebRoute>();
  const host = ctx.plugin(scope => {
    scope.provide('webServer', { register(route: WebRoute) {
      routes.set(route.path, route);
      return () => { routes.delete(route.path); };
    } });
  });
  await host.await();
  let runtime!: RobotRuntimes;
  const plugin = ctx.plugin(scope => { runtime = new RobotRuntimes(scope, agents, logger, store); });
  await plugin.await();
  const server = createServer((req, res) => {
    const route = routes.get(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (route) void route.handler(req, res);
    else res.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
  const req = (path: string, appId: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${address.port}${path}?appId=${appId}`, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  const create = (appId: string) => runtime.save({ appId, appSecret: 'fixture-secret', revision: null, access: { commandMode: 'allowlist' } });
  const read = (appId: string) => runtime.list().find(robot => robot.appId === appId)!;
  try {
    await create('robot-a');
    await create('robot-b');
    const membership = [
      ['allow-c2c', 'allowC2c', 'contact-aa:私聊'],
      ['allow-group', 'allowGroup', 'group-aaaa:群聊'],
      ['owner', 'owners', 'owner-aaaa:命令用户'],
    ] as const;
    for (const [purpose, field, openid] of membership) {
      expect((await req(PAIR_MANUAL_PATH, 'robot-a', { purpose, openid })).status).toBe(200);
      expect((await (await req(PAIR_STATUS_PATH, 'robot-a')).json())[field]).toHaveLength(1);
      expect((await (await req(PAIR_STATUS_PATH, 'robot-b')).json())[field]).toHaveLength(0);
    }
    expect((await req(PAIR_STATUS_PATH, 'absent')).status).toBe(404);
    const stale = read('robot-a').revision;
    const issued = await req(PAIR_ISSUE_PATH, 'robot-a', { purpose: 'allow-c2c' });
    expect(issued.status).toBe(200);
    const { code } = await issued.json();
    expect((await req(PAIR_REVOKE_PATH, 'robot-a', { purpose: 'allow-c2c', openid: 'contact-aa' })).status).toBe(200);
    await expect(runtime.save({ appId: 'robot-a', revision: stale, access: { c2cMode: 'open' } })).rejects.toThrow('配置已更新');
    await runtime.save({ appId: 'robot-a', revision: read('robot-a').revision, enabled: false });
    expect((await req(PAIR_ISSUE_PATH, 'robot-a', { purpose: 'allow-c2c' })).status).toBe(409);
    expect((await (await req(PAIR_STATUS_PATH, 'robot-a')).json()).challenges).toEqual([]);
    expect((await req(PAIR_END_PATH, 'robot-a', { purpose: 'allow-c2c', code })).status).toBe(200);
    expect(read('robot-b').enabled).toBe(true);
    runtime.remove('robot-a', read('robot-a').revision, sandbox.dir);
    expect((await req(PAIR_STATUS_PATH, 'robot-a')).status).toBe(404);
    await create('robot-a');
    const restored = await (await req(PAIR_STATUS_PATH, 'robot-a')).json();
    expect(restored.allowC2c).toEqual([]);
    expect(restored.allowGroup).toMatchObject([{ openid: 'group-aaaa', nickname: '群聊' }]);
    expect(restored.owners).toMatchObject([{ openid: 'owner-aaaa', nickname: '命令用户' }]);
    expect(restored.challenges).toEqual([]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await plugin.dispose();
    await host.dispose();
    start.mockRestore();
    rmSync(sandbox.dir, { recursive: true, force: true });
    sandbox.dir = '';
  }
});
