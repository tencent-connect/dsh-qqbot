import type { Context } from '@deepseek-ai/cordis';
import { WORKBENCH_ROBOTS_PATH, type WorkbenchRobot, type WorkbenchRobotsResponse } from '../shared/workbench-protocol.ts';

interface ConnectionFetchRegistry {
  register(route: {
    path: string;
    methods: readonly ['GET'];
    requestBody: 'buffered';
    fetch: (request: Request) => Promise<Response>;
  }): () => Promise<void>;
}

export function registerWorkbenchRoutes(ctx: Context, listRobots: () => readonly WorkbenchRobot[]): void {
  ctx.inject(['connection'], scope => {
    const connection = scope.get('connection') as { fetch?: ConnectionFetchRegistry } | undefined;
    const registry = connection?.fetch;
    // The exact Fetch registry admits only owners. Older hosts leave the endpoint unavailable.
    if (typeof registry?.register !== 'function') return;

    scope.effect(() => registry.register({
      path: WORKBENCH_ROBOTS_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => {
        const response: WorkbenchRobotsResponse = {
          robots: listRobots().map(({ appId, state }) => ({ appId, state })),
        };
        return Response.json(response, { headers: { 'Cache-Control': 'no-store' } });
      },
    }), 'im-qqbot.workbench-robots');
  });
}
