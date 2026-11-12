import { Context } from '@deepseek-ai/cordis';
import { describe, expect, it, vi } from 'vitest';
import { WORKBENCH_ROBOT_BIND_PATH, WORKBENCH_ROBOTS_PATH, type WorkbenchRobot, type WorkbenchRobotPatch } from '../shared/workbench-protocol.ts';
import { BindingService, type ConnectFn } from '../setup/binding-service.ts';
import { RobotConfigConflictError } from './robot-config.ts';
import { registerWorkbenchRobotBinding, registerWorkbenchRoutes, WorkbenchRequestError } from './workbench-routes.ts';

interface TestRoute {
  path: string;
  methods: readonly string[];
  requestBody: string;
  fetch(request: Request): Promise<Response>;
}

const robot: WorkbenchRobot = {
  appId: 'workbench-1', state: 'connected', enabled: true, primary: true, alias: '机器人',
  revision: 1, access: { c2cMode: 'allowlist', groupMode: 'disabled', c2cAllow: ['allowed'], groupAllow: [], commandMode: 'open' },
};

const url = `http://dsh.internal${WORKBENCH_ROBOTS_PATH}`;
function post(body: unknown): Request {
  return new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { origin: 'http://127.0.0.1:3201', host: '127.0.0.1:3201' } });
}

async function install(
  list: () => readonly WorkbenchRobot[],
  save?: (patch: WorkbenchRobotPatch) => WorkbenchRobot | Promise<WorkbenchRobot>,
  createBinding?: () => BindingService,
) {
  const ctx = new Context();
  const routes = new Map<string, TestRoute>();
  const host = ctx.plugin(scope => {
    scope.provide('connection', { fetch: { register(route: TestRoute) {
      routes.set(route.path, route);
      return async () => { routes.delete(route.path); };
    } } });
  });
  await host.await();

  const plugin = ctx.plugin(scope => {
    registerWorkbenchRoutes(scope, list, save);
    if (createBinding && save) registerWorkbenchRobotBinding(scope, async patch => save(patch), createBinding);
  });
  await plugin.await();
  expect(routes.size).toBe(createBinding ? 2 : 1);
  const route = routes.get(WORKBENCH_ROBOTS_PATH);
  if (!route) throw new Error('Robot route was not registered');
  return {
    route,
    binding: routes.get(WORKBENCH_ROBOT_BIND_PATH),
    async dispose() {
      await plugin.dispose();
      await host.dispose();
      expect(routes.has(WORKBENCH_ROBOTS_PATH)).toBe(false);
    },
  };
}

describe('workbench robot account route', () => {
  it('uses the owner-only exact registry and projects public fields even when the source carries credentials', async () => {
    const raw = { ...robot, appSecret: 'fixture-secret', access: { ...robot.access, appSecret: 'nested-secret' } };
    const save = vi.fn(() => raw);
    const { route, dispose } = await install(() => [raw], save);
    try {
      expect(route.methods).toEqual(['GET', 'POST']);
      expect(route.requestBody).toBe('buffered');
      const response = await route.fetch(new Request(url));
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ robots: [robot] });

      const patch = { appId: robot.appId, revision: 1, access: { commandMode: 'disabled' } };
      expect(await (await route.fetch(post(patch))).json()).toEqual({ robot });
      expect(save).toHaveBeenCalledWith(patch);
    } finally {
      await dispose();
    }
    const response = await route.fetch(post({ appId: robot.appId, revision: 1, enabled: false }));
    expect(response.status).toBe(503);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed or stale writes without exposing credentials on failure', async () => {
    const save = vi.fn((patch: WorkbenchRobotPatch) => {
      if (patch.revision === 0) throw new RobotConfigConflictError();
      throw new Error('fixture-secret');
    });
    const { route, dispose } = await install(() => [], save);
    try {
      const invalid = [
        { appId: '../escape', revision: 0, enabled: true },
        { appId: robot.appId, enabled: true },
        { appId: robot.appId, revision: 0, enabled: 'true' },
        { appId: robot.appId, revision: 0, primary: true },
        { appId: robot.appId, revision: 0, access: { groupMode: 'any' } },
        { appId: robot.appId, revision: 0, access: { c2cAllow: ['a b'] } },
        { appId: robot.appId, revision: null, enabled: true },
      ];
      for (const body of invalid) expect((await route.fetch(post(body))).status).toBe(400);
      const badJSON = await route.fetch(new Request(url, { method: 'POST', body: 'fixture-secret' }));
      expect(badJSON.status).toBe(400);
      expect(await badJSON.text()).not.toContain('fixture-secret');
      expect(save).not.toHaveBeenCalled();

      expect((await route.fetch(post({ appId: robot.appId, revision: 0, enabled: true }))).status).toBe(409);
      const failed = await route.fetch(post({ appId: robot.appId, revision: 1, appSecret: 'fixture-secret' }));
      expect(failed.status).toBe(503);
      expect(await failed.text()).not.toContain('fixture-secret');
    } finally {
      await dispose();
    }
  });

  it('registers a read-only route without a configuration store', async () => {
    const { route, dispose } = await install(() => []);
    try {
      expect(route.methods).toEqual(['GET']);
      expect(await (await route.fetch(new Request(url))).json()).toEqual({ robots: [] });
      expect((await route.fetch(post({ appId: robot.appId, revision: 0, enabled: false }))).status).toBe(405);
    } finally {
      await dispose();
    }
  });

  it.each([undefined, {}])('keeps the route unavailable without the exact Fetch registry (%j)', async connection => {
    const ctx = new Context();
    const legacyRegister = vi.fn();
    const host = ctx.plugin(scope => {
      scope.provide('webServer', { register: legacyRegister });
      if (connection !== undefined) scope.provide('connection', connection);
    });
    await host.await();
    const plugin = ctx.plugin(scope => registerWorkbenchRoutes(scope, () => []));
    try {
      await plugin.await();
      expect(legacyRegister).not.toHaveBeenCalled();
    } finally {
      await plugin.dispose();
      await host.dispose();
    }
  });
});

function connector() {
  const calls: Array<{ callbacks: Parameters<ConnectFn>[0]; signal?: AbortSignal }> = [];
  const createBinding = () => new BindingService({
    source: 'test',
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    connect(callbacks, options) {
      calls.push({ callbacks, signal: options?.signal });
      options?.signal?.addEventListener('abort', () => callbacks.onFailure(new Error('cancelled')), { once: true });
      return () => {};
    },
    renderQr: async () => 'data:image/svg+xml;base64,fixture',
  });
  return { calls, createBinding };
}

const bindUrl = `http://dsh.internal${WORKBENCH_ROBOT_BIND_PATH}`;
const firstId = 'a0000000-0000-0000-0000-000000000001';
const secondId = 'a0000000-0000-0000-0000-000000000002';
function bindPost(route: TestRoute, id: string, action: string, fields = {}) {
  return route.fetch(new Request(bindUrl, { method: 'POST', body: JSON.stringify({ id, action, ...fields }) }));
}

describe('binding another workbench robot', () => {
  it('cancels replaced or closed QR attempts and saves the current scan as a new account', async () => {
    const { calls, createBinding } = connector();
    const added = { ...robot, primary: false, appId: 'added' };
    const save = vi.fn(() => ({ ...added, appSecret: 'private-credential' }));
    const { binding, dispose } = await install(() => [robot], save, createBinding);
    try {
      if (!binding) throw new Error('Missing binding route');
      await bindPost(binding, firstId, 'start');
      await bindPost(binding, secondId, 'start');
      expect(calls[0]?.signal?.aborted).toBe(true);
      expect((await binding.fetch(new Request(`${bindUrl}?id=${firstId}`))).status).toBe(404);
      calls[0]?.callbacks.onSuccess([{ appId: 'stale', appSecret: 'private-credential' }]);
      await bindPost(binding, firstId, 'cancel');
      calls[1]?.callbacks.onQrDisplayed?.('https://q.qq.com/connect?task_id=fixture');
      const current = new Request(`${bindUrl}?id=${secondId}`);
      await vi.waitFor(async () => expect(await (await binding.fetch(current)).json()).toMatchObject({ phase: 'waiting' }));
      calls[1]?.callbacks.onSuccess([{ appId: 'added', appSecret: 'private-credential', userOpenid: 'scanning-user' }]);
      await vi.waitFor(async () => {
        expect(await (await binding.fetch(current)).json()).toEqual({ phase: 'bound', robot: added });
      });
      expect(save).toHaveBeenCalledExactlyOnceWith({ appId: 'added', appSecret: 'private-credential', revision: null,
        access: { c2cMode: 'allowlist', c2cAllow: ['scanning-user'] },
      });

      await bindPost(binding, firstId, 'start');
      await bindPost(binding, firstId, 'cancel');
      expect(calls[2]?.signal?.aborted).toBe(true);
      calls[2]?.callbacks.onSuccess([{ appId: 'cancelled', appSecret: 'private-credential' }]);
      expect((await binding.fetch(new Request(`${bindUrl}?id=${firstId}`))).status).toBe(404);
      expect(save).toHaveBeenCalledTimes(1);
    } finally { await dispose(); }
  });

  it('uses the same create-only write for manual binding and reports duplicate AppIDs', async () => {
    const { calls, createBinding } = connector();
    const save = vi.fn((patch: WorkbenchRobotPatch) => {
      if (patch.appId === robot.appId) throw new WorkbenchRequestError(409, 'already exists');
      return { ...robot, primary: false, appId: patch.appId };
    });
    const { binding, dispose } = await install(() => [robot], save, createBinding);
    try {
      if (!binding) throw new Error('Missing binding route');
      await bindPost(binding, firstId, 'start');
      const duplicate = await bindPost(binding, firstId, 'manual', { appId: robot.appId, appSecret: 'private-credential' });
      expect(await duplicate.json()).toEqual({ phase: 'failed', reason: '这个机器人已添加，请在机器人列表中选择它。' });
      expect(calls[0]?.signal?.aborted).toBe(true);
      const next = await bindPost(binding, firstId, 'manual', { appId: 'manual', appSecret: 'private-credential' });
      expect(await next.json()).toMatchObject({ phase: 'bound', robot: { appId: 'manual' } });
      expect(save.mock.calls.map(([patch]) => patch.revision)).toEqual([null, null]);
    } finally { await dispose(); }
  });
});
