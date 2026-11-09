import { Context } from '@deepseek-ai/cordis';
import { describe, expect, it, vi } from 'vitest';
import { WORKBENCH_ROBOTS_PATH, type WorkbenchRobot } from '../shared/workbench-protocol.ts';
import { registerWorkbenchRoutes } from './workbench-routes.ts';

interface TestRoute {
  path: string;
  methods: readonly string[];
  requestBody: string;
  fetch(request: Request): Promise<Response>;
}

describe('workbench robot list', () => {
  it('registers a read-only exact Fetch route and exposes only the current public state', async () => {
    const ctx = new Context();
    const routes = new Map<string, TestRoute>();
    const host = ctx.plugin(scope => {
      scope.provide('connection', { fetch: { register(route: TestRoute) {
        routes.set(route.path, route);
        return async () => { routes.delete(route.path); };
      } } });
    });
    await host.await();

    let robots: readonly WorkbenchRobot[] = [];
    const plugin = ctx.plugin(scope => registerWorkbenchRoutes(scope, () => robots));
    try {
      await plugin.await();
      const route = routes.get(WORKBENCH_ROBOTS_PATH);
      expect(routes.size).toBe(1);
      if (!route) throw new Error('Robot list route was not registered');
      expect(route.methods).toEqual(['GET']);
      expect(route.requestBody).toBe('buffered');

      const request = new Request(`http://localhost${WORKBENCH_ROBOTS_PATH}`);
      expect(await (await route.fetch(request)).json()).toEqual({ robots: [] });

      const robotWithCredentials = { appId: 'workbench-1', state: 'connected', appSecret: 'fixture-secret' } as const;
      robots = [robotWithCredentials, { appId: 'workbench-2', state: 'reconnecting' }];
      const response = await route.fetch(request);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({
        robots: [{ appId: 'workbench-1', state: 'connected' }, { appId: 'workbench-2', state: 'reconnecting' }],
      });
    } finally {
      await plugin.dispose();
      await host.dispose();
    }
    expect(routes.has(WORKBENCH_ROBOTS_PATH)).toBe(false);
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
