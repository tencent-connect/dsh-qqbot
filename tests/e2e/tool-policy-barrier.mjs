// Isolated Host fixture. Pause after the real tools.guard stage, before write's body.
import https from 'node:https';
import http from 'node:http';
import { promises as dns } from 'node:dns';
import { DUMMY_TOKEN } from './command-protocol.mjs';
import { stickerGif, stickerUrl } from './timeline-media-fixture.mjs';

export const name = 'qqbot-tool-policy-barrier';
export const inject = ['agents', 'connection', 'permissionPresets'];

export function apply(ctx) {
  // Keep QR tests and the scanner opened after unbinding off the real service.
  const qrOrigin = process.env.QQBOT_TEST_QR_FIXTURE === '1' ? new URL(process.env.QQBOT_BASE_URL) : undefined;
  const request = https.request;
  https.request = (options, ...args) => {
    if (options?.hostname === 'q.qq.com' || options?.host === 'q.qq.com') {
      if (qrOrigin?.protocol !== 'http:' || qrOrigin.hostname !== '127.0.0.1'
        || !['/lite/create_bind_task', '/lite/poll_bind_result'].includes(options.path)) {
        throw new Error('The isolated fixture does not start real QQ pairing.');
      }
      return http.request(new URL('/__fixture/qr' + options.path, qrOrigin), {
        method: options.method, headers: options.headers, timeout: options.timeout,
      }, ...args);
    }
    return request(options, ...args);
  };
  ctx.effect(() => () => { https.request = request; });
  const resolve4 = dns.resolve4;
  const fetch = globalThis.fetch;
  const stickerHost = new URL(stickerUrl).hostname;
  const resolveFixture = (host, ...args) => host === stickerHost ? Promise.resolve(['203.0.113.1']) : resolve4(host, ...args);
  const fetchFixture = (input, init) => {
    if (String(input) !== stickerUrl) return fetch(input, init);
    init?.signal?.throwIfAborted();
    const authorized = new Headers(init?.headers).get('authorization') === 'QQBot ' + DUMMY_TOKEN;
    return Promise.resolve(authorized
      ? new Response(stickerGif, { headers: { 'content-type': 'image/gif' } })
      : new Response(null, { status: 403 }));
  };
  dns.resolve4 = resolveFixture;
  globalThis.fetch = fetchFixture;
  ctx.effect(() => () => {
    if (dns.resolve4 === resolveFixture) dns.resolve4 = resolve4;
    if (globalThis.fetch === fetchFixture) globalThis.fetch = fetch;
  });
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
