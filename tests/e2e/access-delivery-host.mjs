import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  assertNodeVersion, availablePort, buildHostEnvironment, dummyQQConfig,
  runLogged, spawnLogged, waitForHost, writePrivateJson,
} from './host.mjs';
import { createFixtureCommands, DUMMY_APP_ID } from './command-protocol.mjs';
import { createQQFixture } from './qq-fixture.mjs';
import { stageHistoryPackage } from './history-registry.mjs';

const appQuery = '?appId=' + DUMMY_APP_ID;
const qqApi = '/qqbot/im-qqbot/';
const workbench = '/api/qqbot/workbench/';
const groupId = 'local-fixture-allowed-group';
const userId = identity => 'local-fixture-' + identity + '-user';
const identities = ['allowed', 'denied'];
const modes = [['open', 'all'], ['allowlist', 'owner'], ['disabled', 'disabled']];
const commands = [
  ['model', 'model', /模型配置/],
  ['preset', 'preset', /Agent Preset/],
  ['bot-ping', 'ping', /pong/i],
];
const ordinaryAnswer = 'QQ_ORDINARY_REPLY';
const turnText = text => [{ type: 'text', text }];
const primary = { provider: 'access-delivery-fixture', model: 'primary' };
const secondary = { provider: primary.provider, model: 'secondary' };

async function verifyCommands({ client, hostReady, qq, exchange, report, until }) {
  const { owners } = await client.post(qqApi + 'pair/manual' + appQuery, { purpose: 'owner', openid: userId('allowed') });
  assert.deepEqual(owners.map(owner => owner.openid), [userId('allowed')]);
  const bindings = async () => {
    const { conversations } = await client.get(workbench + 'conversations' + appQuery);
    return Object.fromEntries(conversations.filter(row => row.currentSessionId)
      .map(row => [row.scope + ':' + row.openId, row.currentSessionId]));
  };

  let initialBindings;
  for (const [mode, catalogScope] of modes) {
    const { config } = await client.get(qqApi + 'config');
    if (config.access.commandMode !== mode) {
      const readyCount = qq.state.readyCount;
      await client.post(qqApi + 'config', { accessRevision: config.accessRevision, expectedAppId: DUMMY_APP_ID,
        access: { ...config.access, commandMode: mode } });
      await until(() => qq.state.readyCount > readyCount, 'reconnect with command mode ' + mode, 30_000);
      await hostReady();
    }
    const { robots } = await client.get(workbench + 'robots');
    const bot = robots.find(row => row.appId === DUMMY_APP_ID);
    assert.equal(bot?.access.commandMode, mode);
    assert.equal(bot.access.c2cMode, 'allowlist');
    assert.deepEqual(bot.access.c2cAllow, identities.map(userId));
    assert.equal(bot.access.groupMode, 'allowlist');
    assert.deepEqual(bot.access.groupAllow, [groupId]);
    const catalog = await client.get(qqApi + 'conversations' + appQuery);
    for (const [name] of commands) {
      assert.equal(catalog.commands.find(command => command.name === name)?.scope, catalogScope, mode + ' /' + name);
    }
    for (const scope of ['c2c', 'group']) {
      for (const identity of identities) {
        const allowed = mode === 'open' || (mode === 'allowlist' && identity === 'allowed');
        for (const [name, command, success] of commands) {
          const expected = mode === 'disabled' ? /^QQ 斜杠命令已关闭。$/
            : allowed ? success : /^你不在斜杠命令白名单中/;
          await exchange({ scope, identity, command }, expected, mode + ' /' + name);
          report.commands.push({ mode, scope, listed: identity === 'allowed', command: '/' + name, allowed });
        }
        await exchange({ scope, identity, command: 'smoke' }, ordinaryAnswer, mode + ' ordinary message');
        report.ordinaryReplies.push({ mode, scope, listed: identity === 'allowed' });
      }
    }
    const current = await bindings();
    initialBindings ??= current;
    assert.deepEqual(current, initialBindings, 'Changing slash mode must preserve QQ Session bindings.');
  }
  const pairing = await client.get(qqApi + 'pair/status' + appQuery);
  assert.deepEqual(pairing.owners.map(owner => owner.openid), [userId('allowed')]);
  assert.deepEqual(Object.keys(initialBindings).sort(), [...identities.map(identity => 'c2c:' + userId(identity)), 'group:' + groupId]);
  assert.equal(new Set(Object.values(initialBindings)).size, 3, 'Expected two private Sessions and one shared group Session.');
  return initialBindings['group:' + groupId];
}

async function verifyQueueEdit({ client, sessionId, until, inject, newModelRound, outboundSince, qq }) {
  const events = async () => {
    const result = await client.rpc('session/events', {
      request: { address: { kind: 'session', sessionId }, maxMessages: 180 },
    });
    return result.records.filter(row => row.type === 'event').map(row => row.event);
  };
  const outgoingStart = qq.state.observedOutboundRequests;
  const expected = [];
  for (const edit of [true, false]) {
    const round = newModelRound(edit ? 'RESTORED' : 'UNCHANGED');
    const receipt = await client.rpc('session/prompt', { request: {
      sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: turnText(round.holder),
    } });
    assert.equal(receipt.accepted, true);
    await until(() => round.waiting, 'Web model request held before queueing QQ');

    const before = (await events()).at(-1)?.seq ?? 0;
    await inject({ scope: 'group', identity: 'allowed', command: 'smoke' });
    const original = await until(async () => {
      const queued = (await events()).find(event => event.seq > before && event.type === 'agent/inbox/spliced'
        && event.data.target === 'next-turn' && event.data.inserted.length === 1);
      return queued?.data.inserted[0];
    }, 'QQ input waiting in the next-turn queue');
    const replace = async content => {
      const status = await client.rpc('session/updateQueue', { request: { sessionId, itemId: original.id,
        action: { kind: 'edit', content } } });
      assert.equal(status.accepted, true);
    };
    if (edit) {
      const replacement = turnText('QQ_QUEUE_CHANGED_BODY');
      await replace(replacement);
      await until(async () => (await events()).some(event => event.seq > before && event.type === 'agent/inbox/spliced'
        && event.data.inserted.some(item => item.id === original.id && item.content[0]?.text === replacement[0].text)),
      'changed text in the original queue item');
      await replace(original.content);
    }
    round.release();

    await until(async () => {
      const rows = (await events()).filter(event => event.seq > before);
      const input = rows.find(event => event.type === 'user/message' && event.data.id === original.id);
      if (!input) return false;
      assert.deepEqual(input.data.content, original.content, 'The native turn must consume the original ID and text.');
      const answer = rows.find(event => event.seq > input.seq && event.type === 'assistant/message'
        && event.data.message.content.some(block => block.type === 'text' && block.text === round.answer));
      return answer && rows.some(event => event.seq > answer.seq && event.type === 'turn/end'
        && event.data.turn === answer.data.turn && event.data.reason.kind === 'completed');
    }, 'completed native turn with ' + round.answer);
    expected.push(round.holder);
    if (!edit) expected.push(round.answer);
  }
  // The unedited queued reply follows the restored turn on the same Session and must still reach QQ.
  await until(async () => (await outboundSince(outgoingStart)).some(row => row.content === expected.at(-1)), 'unedited queued reply');
  return { outgoingStart, expected };
}

async function main([dshSource, corePackage, historyPackage, runDir], signal) {
  assertNodeVersion();
  assert([dshSource, corePackage, historyPackage, runDir].every(path => path && isAbsolute(path)),
    'Usage: node tests/e2e/access-delivery-host.mjs HOST_SOURCE CORE_TGZ HISTORY_TGZ NEW_OUTPUT_DIR');
  await mkdir(runDir, { mode: 0o700 });
  const config = {
    home: join(runDir, 'home'), dataDir: join(runDir, 'qq-data'),
    profile: 'qqbot-access-delivery', workspace: join(runDir, 'workspace'), node: process.execPath,
    hostLog: join(runDir, 'host.log'), primary, secondary,
  };
  await mkdir(config.workspace);
  const report = { commands: [], ordinaryReplies: [], passed: false };
  const smoke = createFixtureCommands().smoke;
  let qq, registry, host, round;
  const model = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      const userText = JSON.stringify(body.messages.findLast(message => message.role === 'user')?.content ?? '');
      const current = round;
      let answer = ordinaryAnswer;
      if (current && userText.includes(current.holder)) {
        current.waiting = true;
        await current.released;
        answer = current.holder;
      } else if (current?.waiting && userText.includes(smoke)) {
        answer = current.answer;
      }
      const base = { id: 'fixture', object: 'chat.completion.chunk', created: 123, model: body.model };
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const [delta, finish_reason] of [[{ role: 'assistant', content: answer }, null], [{}, 'stop']]) {
        response.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason }] }) + '\n\n');
      }
      response.end('data: [DONE]\n\n');
    } catch {
      if (!response.headersSent) response.writeHead(400);
      response.end();
    }
  });

  const until = async (read, label, timeoutMs = 15_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      if (host?.settled) throw new Error('Isolated Host exited; see ' + config.hostLog);
      const value = await read();
      if (value) return value;
      await delay(80, undefined, { signal });
    }
    throw new Error('Timed out: ' + label);
  };
  try {
    await new Promise((resolve, reject) => model.once('error', reject).listen(0, '127.0.0.1', resolve));
    qq = await createQQFixture({ primary, secondary, allowModelRequests: true });
    const { version } = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    registry = await stageHistoryPackage(historyPackage, version);
    config.fixtureOrigin = qq.origin;
    const port = await availablePort();
    config.hostOrigin = 'http://127.0.0.1:' + port;
    const env = { ...buildHostEnvironment(config), HOME: config.home, DSH_TELEMETRY_MODE: 'DISABLED',
      QQBOT_ACCESS_TEST_KEY: 'local-fixture-only' };
    const cli = ['--import', 'tsx/esm', 'apps/cli/src/bin.ts'];
    const profile = ['--profile', config.profile];
    const launch = { cwd: dshSource, env, logPath: join(runDir, 'install.log') };
    await runLogged(config.node, [...cli, ...profile, '--from-default-profile', 'web', '--dump-config'], launch, { signal });
    await runLogged(config.node, [...cli, 'plugin', ...profile, 'add', 'file:' + corePackage, '--registry=' + registry.origin],
      launch, { signal });
    const bot = dummyQQConfig(config);
    const patch = [
      { id: 'im-qqbot', config: { ...bot, preset: 'minimal',
        proactiveDelivery: { externalTurns: 'all' },
        access: { ...bot.access, commandMode: 'open', c2cAllow: identities.map(userId) } } },
      { id: 'agent-default-model', config: primary },
      { id: 'llm-pi-ai', config: { providers: { [primary.provider]: { api: 'openai-completions',
        baseURL: 'http://127.0.0.1:' + model.address().port + '/v1', apiKeyEnv: 'QQBOT_ACCESS_TEST_KEY',
        models: [primary, secondary].map(({ model: id }) => ({ id, name: id, contextWindow: 32_000, maxTokens: 1024 })) } } } },
    ];
    await writeFile(join(config.home, 'profiles', config.profile, 'cordis.patch.yml'), JSON.stringify(patch, null, 2), { mode: 0o600 });
    host = await spawnLogged(config.node, [...cli, ...profile, '--port', String(port), '--no-open'],
      { ...launch, logPath: config.hostLog });
    await writePrivateJson(join(runDir, 'process.json'), { pid: host.child.pid, hostOrigin: config.hostOrigin });
    const hostReady = () => waitForHost(config, host, { signal });
    const { client } = await hostReady();
    const fixture = async (operation, data) => {
      const response = await fetch(qq.origin + '/__fixture/' + operation, {
        method: data === undefined ? 'GET' : 'POST', body: data === undefined ? undefined : JSON.stringify(data),
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      });
      assert.ok(response.ok, 'QQ fixture request failed: ' + operation);
      return response.json();
    };
    await fixture('outbound', { mode: 'success' });
    const outboundSince = async sequence => (await fixture('observations')).outbound.filter(row => row.sequence > sequence);
    const inject = async ({ scope, identity, command }) => {
      const count = qq.state.receivedMessages;
      const status = await fixture('message', { scope, identity, command,
        ...(scope === 'group' ? { groupIdentity: 'allowed' } : {}) });
      assert.equal(status.receivedMessages, count + 1, 'Exactly one gateway should receive each fixture input.');
    };
    const exchange = async (input, expected, action) => {
      const label = action + ' in ' + input.scope + ' from ' + input.identity;
      const sequence = qq.state.observedOutboundRequests;
      await inject(input);
      // QQ's input-status request is separate from the reply.
      const reply = await until(async () => (await outboundSince(sequence)).find(row => row.messageType !== 6), label);
      const path = input.scope === 'group' ? '/groups/' + groupId : '/users/' + userId(input.identity);
      assert.equal(reply.path, '/v2' + path + '/messages', label);
      if (expected instanceof RegExp) assert.match(reply.content, expected, label);
      else assert.equal(reply.content, expected, label);
    };
    const newModelRound = name => {
      const gate = Promise.withResolvers();
      round = { holder: 'QQ_WEB_HOLDER_' + name, answer: 'QQ_QUEUE_ANSWER_' + name,
        waiting: false, released: gate.promise, release: gate.resolve };
      return round;
    };
    const sessionId = await verifyCommands({ client, hostReady, qq, exchange, report, until });
    const { outgoingStart, expected } = await verifyQueueEdit({ client, sessionId, until, inject, newModelRound, outboundSince, qq });
    await host.stop();
    const outbound = await outboundSince(outgoingStart);
    assert.deepEqual(outbound.map(row => row.content).sort(), expected.toSorted(),
      'Only the Web controls and the unedited queued reply may send to QQ.');
    assert.ok(outbound.every(row => row.path === '/v2/groups/' + groupId + '/messages'), 'Replies must target the test group.');
    assert.equal(qq.state.unexpectedRequests, 0);
    report.queue = { sessionId, nativeAnswerAfterRestore: true, restoredQqOutbound: 0, unchangedQueuedReply: true };
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally {
    round?.release();
    const resources = await Promise.allSettled([host?.stop()]);
    model.closeAllConnections();
    resources.push(...await Promise.allSettled([qq?.close(), registry?.close(),
      model.listening ? new Promise((resolve, reject) => model.close(error => error ? reject(error) : resolve())) : undefined]));
    const cleanupFailed = resources.some(result => result.status === 'rejected');
    report.passed &&= !cleanupFailed;
    await writePrivateJson(join(runDir, 'report.json'), report);
    if (cleanupFailed) throw new Error('Could not close all isolated test resources.');
  }
  process.stdout.write('Passed QQ access and queue delivery regression. Report: ' + join(runDir, 'report.json') + '\n');
}

const controller = new AbortController();
const interrupt = () => controller.abort(new Error('Verification interrupted.'));
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
try {
  await main(process.argv.slice(2), controller.signal);
} finally {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
