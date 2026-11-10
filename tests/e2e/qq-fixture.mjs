import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFixtureCommands, DUMMY_APP_ID, DUMMY_SECRET, DUMMY_TOKEN, isFixtureOutboundPath, outboundObservation, parseFixtureMessage } from './command-protocol.mjs';

// The QQ SDK owns this dependency; resolve from its installed location rather than a workstation path.
const sdkRequire = createRequire(realpathSync(fileURLToPath(import.meta.resolve('@tencent-connect/qqbot-nodejs'))));
const { WebSocketServer, WebSocket } = sdkRequire('ws');
const MAX_BODY_BYTES = 32_768;
const LOG_LIMIT = 80;

export async function createQQFixture(options = {}) {
  const requestedPort = options.port ?? 0;
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new Error('Invalid fixture port');
  if (options.statusFile !== undefined && (typeof options.statusFile !== 'string' || !isAbsolute(options.statusFile))) {
    throw new Error('Fixture statusFile must be an absolute path');
  }
  if (options.allowModelRequests !== undefined && typeof options.allowModelRequests !== 'boolean') {
    throw new Error('Fixture allowModelRequests must be boolean');
  }
  const commands = createFixtureCommands(options);
  const state = {
    startedAt: Date.now(), tokenRequests: 0, gatewayRequests: 0, connections: 0,
    readyCount: 0, resumedCount: 0, receivedMessages: 0, blockedOutboundRequests: 0,
    successfulOutboundRequests: 0, failedOutboundRequests: 0, mediaUploadRequests: 0,
    observedOutboundRequests: 0, heartbeatCount: 0, unexpectedRequests: 0, invalidPackets: 0,
    mode: 'ready', outboundMode: 'blocked', autoMessage: false,
  };
  let sequence = 0;
  let origin = 'http://127.0.0.1';
  const outboundLog = [];
  const commandLog = [];
  const authenticated = new WeakSet();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY_BYTES });

  function snapshot() { return { ...state, activeConnections: wss.clients.size }; }
  function persist() {
    if (options.statusFile) writeFileSync(options.statusFile, `${JSON.stringify(snapshot(), null, 2)}\n`, { mode: 0o600 });
  }
  function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
  async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw new Error('Fixture request too large');
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    const value = text ? JSON.parse(text) : {};
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Fixture JSON body must be an object');
    return value;
  }
  function dispatch(ws, type, data) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 0, t: type, s: ++sequence, d: data }));
  }
  function message(ws, selected) {
    if (ws.readyState !== WebSocket.OPEN || !authenticated.has(ws)) return;
    const allowed = selected.identity === 'allowed';
    const envelope = { id: `local-fixture-message-${state.receivedMessages + 1}`, content: selected.content, timestamp: new Date().toISOString() };
    if (selected.scope === 'c2c') {
      dispatch(ws, 'C2C_MESSAGE_CREATE', { ...envelope, author: { user_openid: `local-fixture-${allowed ? 'allowed' : 'denied'}-user` } });
    } else {
      dispatch(ws, selected.mention ? 'GROUP_AT_MESSAGE_CREATE' : 'GROUP_MESSAGE_CREATE', {
        ...envelope, group_openid: `local-fixture-${allowed ? 'allowed' : 'denied'}-group`,
        author: { member_openid: `local-fixture-${allowed ? 'allowed' : 'denied'}-user` },
      });
    }
    state.receivedMessages += 1;
    commandLog.push({ command: selected.command, scope: selected.scope, identity: selected.identity, mention: selected.mention, at: Date.now() });
    if (commandLog.length > LOG_LIMIT) commandLog.shift();
    persist();
  }

  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? '/', origin).pathname;
      if (req.method === 'GET' && path === '/__fixture/status') return json(res, 200, snapshot());
      if (req.method === 'GET' && path === '/__fixture/observations') return json(res, 200, { commands: [...commandLog], outbound: [...outboundLog] });
      if (req.method === 'POST' && path === '/__fixture/message') {
        const selected = parseFixtureMessage(await readJson(req), commands, options.allowModelRequests === true);
        for (const ws of wss.clients) message(ws, selected);
        return json(res, 200, snapshot());
      }
      if (req.method === 'POST' && path === '/__fixture/outbound') {
        const data = await readJson(req);
        if (!['blocked', 'success', 'failure'].includes(data.mode)) return json(res, 400, { message: 'Invalid fixture outbound mode' });
        state.outboundMode = data.mode;
        persist();
        return json(res, 200, snapshot());
      }
      if (req.method === 'POST' && path === '/__fixture/disconnect') {
        const data = await readJson(req);
        if (data.terminal !== undefined && typeof data.terminal !== 'boolean') return json(res, 400, { message: 'Invalid fixture disconnect option' });
        state.mode = data.terminal ? 'failed' : 'reconnecting';
        for (const ws of wss.clients) ws.close(data.terminal ? 4914 : 4000, 'local fixture control');
        persist();
        return json(res, 200, snapshot());
      }
      if (req.method === 'POST' && path === '/__fixture/resume') {
        state.mode = 'ready';
        persist();
        return json(res, 200, snapshot());
      }
      if (req.method === 'POST' && path === '/app/getAppAccessToken') {
        const data = await readJson(req);
        state.tokenRequests += 1;
        persist();
        if (data.appId !== DUMMY_APP_ID || data.clientSecret !== DUMMY_SECRET) return json(res, 400, { message: 'Fixture accepts only dummy credentials' });
        return json(res, 200, { access_token: DUMMY_TOKEN, expires_in: 7200 });
      }
      if (req.method === 'GET' && path === '/gateway') {
        state.gatewayRequests += 1;
        persist();
        return json(res, 200, { url: origin.replace('http:', 'ws:') + '/gateway' });
      }
      if (req.method === 'POST' && /\/(?:messages|files)$/u.test(path)) {
        const body = await readJson(req);
        if (!isFixtureOutboundPath(path)) {
          state.unexpectedRequests += 1;
          persist();
          return json(res, 403, { message: 'Fixture accepts only synthetic peer targets' });
        }
        outboundLog.push({ ...outboundObservation(path, body, state.outboundMode), sequence: ++state.observedOutboundRequests });
        if (outboundLog.length > LOG_LIMIT) outboundLog.shift();
        if (state.outboundMode === 'blocked') {
          state.blockedOutboundRequests += 1;
          persist();
          return json(res, 409, { message: 'Fixture outbound is blocked' });
        }
        if (state.outboundMode === 'failure') {
          state.failedOutboundRequests += 1;
          persist();
          return json(res, 400, { message: 'Controlled local fixture send failure', code: 304023 });
        }
        if (path.endsWith('/files')) {
          state.mediaUploadRequests += 1;
          persist();
          return json(res, 200, { file_uuid: 'local-fixture-file', file_info: 'local-fixture-file-info', ttl: 3600 });
        }
        state.successfulOutboundRequests += 1;
        persist();
        return json(res, 200, { id: `local-fixture-sent-${state.successfulOutboundRequests}`, timestamp: new Date().toISOString() });
      }
      state.unexpectedRequests += 1;
      persist();
      return json(res, 404, { message: 'Unsupported local fixture route' });
    } catch {
      if (!res.headersSent && !res.destroyed) json(res, 400, { message: 'Invalid local fixture request' });
    }
  });
  server.on('upgrade', (req, socket, head) => {
    if (state.mode !== 'ready' || new URL(req.url ?? '/', origin).pathname !== '/gateway') {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });
  wss.on('connection', (ws) => {
    state.connections += 1;
    persist();
    ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 10000 } }));
    ws.on('error', () => {});
    ws.on('close', persist);
    ws.on('message', (data) => {
      try {
        const packet = JSON.parse(data.toString());
        if (!packet || typeof packet !== 'object' || Array.isArray(packet)) throw new Error('Invalid packet');
        if (packet.op === 1) {
          state.heartbeatCount += 1;
          ws.send(JSON.stringify({ op: 11 }));
        } else if (packet.op === 2 || packet.op === 6) {
          if (packet.d?.token !== `QQBot ${DUMMY_TOKEN}`) {
            ws.close(4004, 'fixture authentication failed');
            return;
          }
          authenticated.add(ws);
          if (packet.op === 6) {
            state.resumedCount += 1;
            dispatch(ws, 'RESUMED', {});
          } else {
            state.readyCount += 1;
            dispatch(ws, 'READY', { session_id: 'local-fixture-session', user: { id: 'local-fixture-bot' } });
          }
        } else {
          throw new Error('Unsupported packet');
        }
        persist();
      } catch {
        state.invalidPackets += 1;
        persist();
        ws.close(1003, 'invalid fixture packet');
      }
    });
  });

  try { persist(); } catch (error) { wss.close(); throw error; }
  await new Promise((resolve, reject) => {
    const failed = (error) => { wss.close(); reject(error); };
    server.once('error', failed);
    server.listen(requestedPort, '127.0.0.1', () => {
      server.off('error', failed);
      resolve();
    });
  });
  const port = server.address().port;
  origin = `http://127.0.0.1:${port}`;
  let closePromise;
  function close() {
    closePromise ??= (async () => {
      for (const ws of wss.clients) ws.terminate();
      const socketsClosed = new Promise((resolve) => wss.close(resolve));
      const serverClosed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await Promise.all([socketsClosed, serverClosed]);
    })();
    return closePromise;
  }
  return { origin, port, close, get state() { return snapshot(); } };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--config')) throw new Error('Usage: node tests/e2e/qq-fixture.mjs [--config RUN.json]');
  const config = args.length ? JSON.parse(readFileSync(args[1], 'utf8')) : {};
  const port = config.fixturePort ?? (config.fixtureOrigin ? Number(new URL(config.fixtureOrigin).port) : undefined)
    ?? Number(process.env.QQ_FIXTURE_PORT ?? 0);
  const fixture = await createQQFixture({ ...config, port, statusFile: config.fixtureStatus ?? process.env.QQ_FIXTURE_STATUS_FILE });
  process.stdout.write(`${JSON.stringify({ origin: fixture.origin, port: fixture.port })}\n`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void fixture.close().catch(() => { process.exitCode = 1; }); });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
