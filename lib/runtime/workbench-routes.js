import { WORKBENCH_ROBOTS_PATH } from "../shared/workbench-protocol.js";
export function registerWorkbenchRoutes(ctx, listRobots) {
    ctx.inject(['connection'], scope => {
        const connection = scope.get('connection');
        const registry = connection?.fetch;
        // The exact Fetch registry admits only owners. Older hosts leave the endpoint unavailable.
        if (typeof registry?.register !== 'function')
            return;
        scope.effect(() => registry.register({
            path: WORKBENCH_ROBOTS_PATH,
            methods: ['GET'],
            requestBody: 'buffered',
            fetch: async () => {
                const response = {
                    robots: listRobots().map(({ appId, state }) => ({ appId, state })),
                };
                return Response.json(response, { headers: { 'Cache-Control': 'no-store' } });
            },
        }), 'im-qqbot.workbench-robots');
    });
}
//# sourceMappingURL=workbench-routes.js.map