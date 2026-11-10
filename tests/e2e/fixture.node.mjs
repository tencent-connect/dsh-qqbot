import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createQQFixture } from './qq-fixture.mjs';
import { createFixtureCommands, DUMMY_APP_ID, DUMMY_SECRET, DUMMY_TOKEN, parseFixtureMessage } from './command-protocol.mjs';

const sdkRequire = createRequire(realpathSync(fileURLToPath(import.meta.resolve('@tencent-connect/qqbot-nodejs'))));
const { WebSocket } = sdkRequire('ws');
const routes = {
  primary: { provider: 'synthetic-a', model: 'one', reasoningEffort: 'high' },
  secondary: { provider: 'synthetic-b', model: 'family/two' },
  presets: { primary: 'preset-a', secondary: 'preset-b' },
};

async function request(origin, path, data) {
  const response = await fetch(origin + path, data === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
  });
  return { status: response.status, value: await response.json() };
}

function packet(ws, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Timed out waiting for fixture packet')), 2500);
    const onMessage = (data) => {
      const value = JSON.parse(data.toString());
      if (predicate(value)) finish(undefined, value);
    };
    const onError = (error) => finish(error);
    function finish(error, value) {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('error', onError);
      if (error) reject(error); else resolve(value);
    }
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

async function connect(fixture) {
  const ws = new WebSocket(fixture.origin.replace('http:', 'ws:') + '/gateway');
  const hello = packet(ws, (value) => value.op === 10);
  await once(ws, 'open');
  assert.equal((await hello).d.heartbeat_interval, 10000);
  const ready = packet(ws, (value) => value.t === 'READY');
  ws.send(JSON.stringify({ op: 2, d: { token: `QQBot ${DUMMY_TOKEN}` } }));
  assert.equal((await ready).d.user.id, 'local-fixture-bot');
  return ws;
}

test('command routes and presets are configurable, and messages stay on the fixed command surface', () => {
  const commands = createFixtureCommands(routes);
  assert.equal(commands['model-primary'], '/model synthetic-a/one');
  assert.equal(commands['model-secondary'], '/model synthetic-b/family/two');
  assert.equal(commands['model-short'], '/model one');
  assert.equal(commands['preset-standard'], '/preset preset-a');
  assert.equal(commands['preset-minimal'], '/preset preset-b');
  assert.equal(parseFixtureMessage({}, commands).identity, 'denied');
  assert.throws(() => parseFixtureMessage({ command: 'anything' }, commands), /Unsupported fixture command/);
  assert.throws(() => parseFixtureMessage({ content: 'free text' }, commands), /Unsupported fixture message option/);
  assert.throws(() => parseFixtureMessage({ identity: 'real-user' }, commands), /Unsupported fixture identity/);
  assert.throws(() => parseFixtureMessage({ command: 'smoke' }, commands), /model requests are disabled/);
  assert.throws(() => parseFixtureMessage({ command: 'compact' }, commands), /model requests are disabled/);
  assert.equal(parseFixtureMessage({ command: 'smoke' }, commands, true).content, commands.smoke);
  assert.throws(() => createFixtureCommands({ primary: { provider: 'bad/provider', model: 'one' } }), /Invalid fixture primary provider/);
});

test('HTTP token contract uses dummy credentials and gateway reports its allocated loopback port', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'qq-fixture-test-'));
  const statusFile = join(directory, 'status.json');
  const fixture = await createQQFixture({ ...routes, statusFile });
  t.after(async () => { await fixture.close(); await rm(directory, { recursive: true, force: true }); });
  assert.ok(fixture.port > 0);
  assert.equal(new URL(fixture.origin).hostname, '127.0.0.1');
  const denied = await request(fixture.origin, '/app/getAppAccessToken', { appId: 'real-app', clientSecret: 'private-value' });
  assert.equal(denied.status, 400);
  const granted = await request(fixture.origin, '/app/getAppAccessToken', { appId: DUMMY_APP_ID, clientSecret: DUMMY_SECRET });
  assert.equal(granted.status, 200);
  assert.equal(granted.value.access_token, DUMMY_TOKEN);
  const gateway = await request(fixture.origin, '/gateway');
  assert.equal(gateway.value.url, fixture.origin.replace('http:', 'ws:') + '/gateway');
  const status = await request(fixture.origin, '/__fixture/status');
  assert.equal(status.value.tokenRequests, 2);
  assert.equal(status.value.gatewayRequests, 1);
  assert.equal(status.value.outboundMode, 'blocked');
  assert.equal((await request(fixture.origin, '/__fixture/message', { command: 'smoke' })).status, 400);
  assert.equal((await request(fixture.origin, '/__fixture/message', { command: 'compact' })).status, 400);
  assert.equal((await request(fixture.origin, '/__fixture/message', { command: 'help', target: 'real-user' })).status, 400);
  const persisted = await readFile(statusFile, 'utf8');
  assert.equal(JSON.parse(persisted).tokenRequests, 2);
  assert.ok(!persisted.includes('private-value'));
});

test('WebSocket dispatch covers READY, heartbeat, synthetic identities and mention semantics', async (t) => {
  const fixture = await createQQFixture(routes);
  t.after(() => fixture.close());
  const ws = await connect(fixture);
  const heartbeat = packet(ws, (value) => value.op === 11);
  ws.send(JSON.stringify({ op: 1, d: null }));
  await heartbeat;
  assert.equal(fixture.state.readyCount, 1);
  assert.equal(fixture.state.heartbeatCount, 1);

  const privateMessage = packet(ws, (value) => value.t === 'C2C_MESSAGE_CREATE');
  await request(fixture.origin, '/__fixture/message', { command: 'model-primary', scope: 'c2c', identity: 'allowed' });
  const privatePacket = await privateMessage;
  assert.equal(privatePacket.d.content, '/model synthetic-a/one');
  assert.equal(privatePacket.d.author.user_openid, 'local-fixture-allowed-user');

  const groupMessage = packet(ws, (value) => value.t === 'GROUP_MESSAGE_CREATE');
  await request(fixture.origin, '/__fixture/message', { command: 'help', scope: 'group', identity: 'denied', mention: false });
  const groupPacket = await groupMessage;
  assert.equal(groupPacket.d.group_openid, 'local-fixture-denied-group');
  assert.equal(groupPacket.d.author.member_openid, 'local-fixture-denied-user');

  const mentioned = packet(ws, (value) => value.t === 'GROUP_AT_MESSAGE_CREATE');
  await request(fixture.origin, '/__fixture/message', { command: 'preset-minimal', scope: 'group', identity: 'allowed' });
  assert.equal((await mentioned).d.content, '/preset preset-b');
  const observations = (await request(fixture.origin, '/__fixture/observations')).value;
  assert.deepEqual(observations.commands.map((item) => [item.command, item.scope, item.identity, item.mention]), [
    ['model-primary', 'c2c', 'allowed', true], ['help', 'group', 'denied', false], ['preset-minimal', 'group', 'allowed', true],
  ]);
});

test('outbound controls reject real targets and retain only bounded response observations', async (t) => {
  const fixture = await createQQFixture(routes);
  t.after(() => fixture.close());
  const path = '/v2/users/local-fixture-allowed-user/messages';
  assert.equal((await request(fixture.origin, '/v2/users/real-account/messages', { content: 'private-value' })).status, 403);
  assert.equal((await request(fixture.origin, path, { content: 'blocked' })).status, 409);
  await request(fixture.origin, '/__fixture/outbound', { mode: 'failure' });
  const failure = await request(fixture.origin, path, { markdown: { content: 'controlled' }, msg_type: 2 });
  assert.equal(failure.status, 400);
  assert.equal(failure.value.code, 304023);
  await request(fixture.origin, '/__fixture/outbound', { mode: 'success' });
  const success = await request(fixture.origin, path, { content: 'https://example.test/?token=private-token Bearer private-bearer', headers: { authorization: 'private-header' }, unknown: 'private-extra' });
  assert.equal(success.status, 200);
  assert.match(success.value.id, /^local-fixture-sent-/);
  const initialObservations = JSON.stringify((await request(fixture.origin, '/__fixture/observations')).value);
  for (const privateValue of ['private-token', 'private-bearer', 'private-header', 'private-extra']) assert.ok(!initialObservations.includes(privateValue));
  assert.ok(initialObservations.includes('[redacted]'));
  const upload = await request(fixture.origin, '/v2/groups/local-fixture-allowed-group/files', { file_type: 1 });
  assert.equal(upload.value.file_info, 'local-fixture-file-info');
  for (let index = 0; index < 85; index += 1) await request(fixture.origin, path, { content: `result-${index}` });
  const observations = (await request(fixture.origin, '/__fixture/observations')).value;
  assert.equal(observations.outbound.length, 80);
  assert.equal(observations.outbound.at(-1).content, 'result-84');
  assert.ok(observations.outbound.at(-1).sequence > observations.outbound[0].sequence);
  const encoded = JSON.stringify(observations);
  assert.ok(!encoded.includes('private-value'));
  assert.ok(!encoded.includes('private-header'));
  assert.ok(!encoded.includes('private-extra'));
  const state = fixture.state;
  assert.equal(state.unexpectedRequests, 1);
  assert.equal(state.blockedOutboundRequests, 1);
  assert.equal(state.failedOutboundRequests, 1);
  assert.equal(state.mediaUploadRequests, 1);
});

test('malformed WebSocket packets and controlled disconnects do not crash or leave the fixture listening', async () => {
  const fixture = await createQQFixture(routes);
  try {
    const ws = await connect(fixture);
    const closed = once(ws, 'close');
    ws.send('{bad JSON');
    assert.equal((await closed)[0], 1003);
    assert.equal(fixture.state.invalidPackets, 1);
    assert.equal((await request(fixture.origin, '/__fixture/status')).status, 200);

    const reconnected = await connect(fixture);
    const disconnected = once(reconnected, 'close');
    await request(fixture.origin, '/__fixture/disconnect', { terminal: false });
    assert.equal((await disconnected)[0], 4000);
    assert.equal(fixture.state.mode, 'reconnecting');
    await request(fixture.origin, '/__fixture/resume', {});
    const resumed = new WebSocket(fixture.origin.replace('http:', 'ws:') + '/gateway');
    const hello = packet(resumed, (value) => value.op === 10);
    await once(resumed, 'open');
    await hello;
    const ready = packet(resumed, (value) => value.t === 'RESUMED');
    resumed.send(JSON.stringify({ op: 6, d: { token: `QQBot ${DUMMY_TOKEN}`, session_id: 'local-fixture-session' } }));
    await ready;
    assert.equal(fixture.state.resumedCount, 1);
  } finally {
    await fixture.close();
    await fixture.close();
  }
  await assert.rejects(fetch(fixture.origin + '/__fixture/status'));
});

test('CLI config writes a private status file, prints the allocated address and exits on SIGTERM', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'qq-fixture-cli-'));
  const configPath = join(directory, 'run.json');
  const fixtureStatus = join(directory, 'status.json');
  await writeFile(configPath, JSON.stringify({ ...routes, fixturePort: 0, fixtureStatus }), { mode: 0o600 });
  const child = spawn(process.execPath, [fileURLToPath(new URL('./qq-fixture.mjs', import.meta.url)), '--config', configPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const timeout = setTimeout(() => child.kill('SIGKILL'), 1000);
      timeout.unref();
      await exited;
      clearTimeout(timeout);
    }
    await rm(directory, { recursive: true, force: true });
  });
  const lines = createInterface({ input: child.stdout });
  const printed = await Promise.race([
    once(lines, 'line', { signal: AbortSignal.timeout(3000) }).then(([line]) => JSON.parse(line)),
    once(child, 'exit').then(([code]) => { throw new Error(`Fixture CLI exited before readiness (${code})`); }),
  ]);
  lines.close();
  assert.ok(printed.port > 0);
  assert.equal((await request(printed.origin, '/__fixture/status')).status, 200);
  assert.equal(JSON.parse(await readFile(fixtureStatus, 'utf8')).outboundMode, 'blocked');
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  assert.equal((await exited)[0], 0);
  await assert.rejects(fetch(printed.origin + '/__fixture/status'));
});
