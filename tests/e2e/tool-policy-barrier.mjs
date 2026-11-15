// Isolated Host fixture. Pause after the real tools.guard stage, before write's body.
export const name = 'qqbot-tool-policy-barrier';
export const inject = ['agents', 'connection', 'permissionPresets'];

export function apply(ctx) {
  const gates = new Map();
  const children = new Map();
  ctx.on('agent/created', ({ agent }) => {
    const parent = agent.session.header.parentSession;
    if (parent) children.set(String(agent.id), String(parent));
  }, { global: true });
  ctx.on('tools/execute', async (exec, next) => {
    const path = exec.arguments?.file_path;
    if (exec.name === 'write' && typeof path === 'string'
      && (path.endsWith('/waiting.txt') || path.endsWith('/waiting-native-cap.txt'))) {
      const gate = Promise.withResolvers();
      gates.set(String(exec.agent.id), gate);
      // Deliberately do not stop waiting when aborted; exercise the Host's own
      // check at the body after a non-cooperative dispatch wrapper returns.
      const timeout = setTimeout(gate.resolve, 15_000);
      try { await gate.promise; } finally {
        clearTimeout(timeout);
        gates.delete(String(exec.agent.id));
      }
    }
    return next();
  }, { global: true, prepend: true });
  ctx.connection.fetch.register({
    path: '/api/qqbot-test/tool-barrier', methods: ['GET', 'POST'], requestBody: 'buffered',
    async fetch(request) {
      if (request.method === 'POST') {
        const { sessionId, permission } = await request.json();
        if (permission) {
          const agent = ctx.agents.get(sessionId);
          if (!agent) return new Response(null, { status: 404 });
          ctx.permissionPresets.set(agent.session, permission);
        } else {
          gates.get(sessionId)?.resolve();
        }
      }
      return Response.json({ waiting: [...gates.keys()], children: [...children] });
    },
  });
}
