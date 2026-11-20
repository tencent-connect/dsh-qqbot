import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  assertNodeVersion, availablePort, buildHostEnvironment, dummyQQConfig,
  readSessionEvents, runLogged, spawnLogged, waitForHost, writePrivateJson,
} from './host.mjs';
import { createFixtureCommands, DUMMY_APP_ID } from './command-protocol.mjs';
import { verifyGroupQueue } from './group-queue.mjs';
import { createQQFixture } from './qq-fixture.mjs';
import { stageHistoryPackage } from './history-registry.mjs';
import { verifyWebAnswers } from './web-timed-answer.mjs';

const appQuery = '?appId=' + DUMMY_APP_ID;
const bind = 'dsh-qqbot/bind';
const account = 'dsh-qqbot/account';
const workbench = '/api/qqbot/workbench/';
const groupId = 'local-fixture-allowed-group';
const userId = identity => 'local-fixture-' + identity + '-user';
const identities = ['allowed', 'denied'];
const modes = [['open', 'all'], ['allowlist', 'owner'], ['disabled', 'disabled']];
const commands = [
  ['model', 'model', /模型配置/],
  ['preset', 'preset', /Agent Preset/],
  ['effort', 'effort', /推理强度/],
  ['bot-ping', 'ping', /pong/i],
];
const ordinaryAnswer = 'QQ_ORDINARY_REPLY';
const modelDenied = 'fixture model authentication rejected';
const switchModelNotice = '⚠️ 当前模型不可用，请切换模型后重试。';
const primary = { provider: 'access-delivery-fixture', model: 'primary' };
const secondary = { provider: primary.provider, model: 'secondary' };

async function verifyReasoning({ client, exchange, inject, newModelRound, outboundSince, qq, until, modelRequests }) {
  const send = (scope, command, expected) => exchange({ scope, identity: 'allowed', command }, expected, 'reasoning effort');
  const binding = async scope => {
    const { conversations } = await client.get(workbench + 'conversations' + appQuery);
    return conversations.find(row => row.scope === scope && row.openId === (scope === 'group' ? groupId : userId('allowed')))
      ?.currentSessionId ?? undefined;
  };
  const nextSelection = async sessionId => (await client.rpc('session/projections', {
    request: { sessionId },
  })).values.modelSelection.next;
  const waitIdle = sessionId => until(async () => {
    const state = await client.rpc('session/state', { request: { sessionId } });
    return state.active && !state.running;
  }, 'Session is idle');
  const generate = async (scope, sessionId, effort) => {
    const before = (await readSessionEvents(client, sessionId)).at(-1)?.seq ?? -1;
    const firstRequest = modelRequests.length;
    await send(scope, 'smoke', ordinaryAnswer);
    await until(async () => (await readSessionEvents(client, sessionId)).some(event =>
      event.seq > before && event.type === 'turn/end' && event.data.reason.kind === 'completed'), 'reasoning turn completed');
    await waitIdle(sessionId);
    const request = (await readSessionEvents(client, sessionId)).find(event => event.seq > before && event.type === 'request/header');
    assert.equal(request?.data.header.config.reasoningEffort, effort);
    assert(modelRequests.slice(firstRequest).some(row => row.model === primary.model && row.effort === effort),
      'Reasoning effort must reach the loopback model.');
  };
  const hostDefault = (await client.rpc('session/modelCatalog')).default;
  const help = await send('c2c', 'help', /通用能力/);
  assert.match(help, /text="\/effort"/);
  assert.match(help, /text="\/stop"/);
  const sessions = {};
  for (const scope of ['c2c', 'group']) {
    const menu = await send(scope, 'effort', /新建 Session 默认值[\s\S]*默认（low）/);
    assert.match(menu, /text="\/effort low"[\s\S]*text="\/effort high"/);
    assert.doesNotMatch(menu, /text="\/effort max"/);
    await send(scope, 'effort-high', /先发一条普通消息/);
    assert.equal(await binding(scope), undefined);
    await send(scope, 'smoke', ordinaryAnswer);
    const id = await binding(scope);
    assert(id, 'The ordinary QQ message establishes a Session.');
    sessions[scope] = id;
    await waitIdle(id);
    const before = await nextSelection(id);
    await send(scope, 'effort-invalid', /可用档位：low、high/);
    assert.deepEqual(await nextSelection(id), before);
    await send(scope, 'effort-high', /推理强度已设为 high/);
    assert.deepEqual(await nextSelection(id), { ...primary, reasoningEffort: 'high' });
    await send(scope, 'effort', /当前 Session[\s\S]*推理强度：high/);
    await generate(scope, id, 'high');
    const status = await send(scope, 'status', /推理强度: high/);
    assert.match(status, /生成状态: 空闲[\s\S]*排队消息: 0[\s\S]*上下文占用: 约 [0-9]+%/);
    await send(scope, 'effort-default', /默认（low）/);
    assert.deepEqual(await nextSelection(id), primary);
    await generate(scope, id, 'low');
    assert.equal(await binding(scope), id);
  }
  assert.notEqual(sessions.c2c, sessions.group);
  assert.deepEqual((await client.rpc('session/modelCatalog')).default, hostDefault);

  const id = sessions.group;
  const held = newModelRound('EFFORT');
  const sequence = qq.state.observedOutboundRequests;
  const { accepted } = await client.rpc('session/prompt', { request: { sessionId: id,
    requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: held.holder }] } });
  assert(accepted);
  await until(() => held.waiting, 'group turn starts');
  const beforeQueue = (await readSessionEvents(client, id)).at(-1)?.seq ?? -1;
  await inject({ scope: 'group', identity: 'allowed', command: 'smoke' });
  await until(async () => (await readSessionEvents(client, id)).some(event =>
    event.seq > beforeQueue && event.type === 'agent/inbox/spliced' && event.data.target === 'next-turn'
    && event.data.inserted.length === 1), 'group has a queued QQ message');
  await send('group', 'status', /生成状态: 正在生成[\s\S]*排队消息: 1/);
  await send('group', 'effort', /当前 Session[\s\S]*默认（low）/);
  await send('group', 'effort-high', /请等本轮结束/);
  assert.deepEqual(await nextSelection(id), primary);
  held.release();
  await until(async () => (await outboundSince(sequence)).some(row => row.content === held.answer), 'queued group reply');
  await send('c2c', 'effort-high', /推理强度已设为 high/);
  assert.deepEqual(await nextSelection(sessions.c2c), { ...primary, reasoningEffort: 'high' });
  assert.deepEqual(await nextSelection(sessions.group), primary);
  return sessions;
}

async function verifyCommands({ client, hostReady, qq, exchange, report, until }) {
  const { owners } = await client.pluginRpc(account, 'pair.manual', { appId: DUMMY_APP_ID, purpose: 'owner', openid: userId('allowed') });
  assert.deepEqual(owners.map(owner => owner.openid), [userId('allowed')]);
  const bindings = async () => {
    const { conversations } = await client.get(workbench + 'conversations' + appQuery);
    return Object.fromEntries(conversations.filter(row => row.currentSessionId)
      .map(row => [row.scope + ':' + row.openId, row.currentSessionId]));
  };

  let initialBindings;
  for (const [mode, catalogScope] of modes) {
    const { config } = await client.pluginRpc(bind, 'config.get');
    if (config.access.commandMode !== mode) {
      const readyCount = qq.state.readyCount;
      await client.pluginRpc(bind, 'config.set', { accessRevision: config.accessRevision, expectedAppId: DUMMY_APP_ID,
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
    const catalog = await client.pluginRpc(account, 'commands.list', { appId: DUMMY_APP_ID });
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
  const pairing = await client.pluginRpc(account, 'pair.status', { appId: DUMMY_APP_ID });
  assert.deepEqual(pairing.owners.map(owner => owner.openid), [userId('allowed')]);
  assert.deepEqual(Object.keys(initialBindings).sort(), [...identities.map(identity => 'c2c:' + userId(identity)), 'group:' + groupId]);
  assert.equal(new Set(Object.values(initialBindings)).size, 3, 'Expected two private Sessions and one shared group Session.');
  return { group: initialBindings['group:' + groupId], c2c: initialBindings['c2c:' + userId('allowed')] };
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
  const modelRequests = [];
  let modelReply;
  let denyModel = false;
  const model = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      modelRequests.push({ model: body.model, effort: body.reasoning_effort });
      if (denyModel) {
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { type: 'invalid_request_error', code: 'invalid_api_key', message: modelDenied } }));
        return;
      }
      const userText = JSON.stringify(body.messages.findLast(message => message.role === 'user')?.content ?? '');
      const current = round;
      let answer = ordinaryAnswer;
      if (current?.waiting && userText.includes(smoke)) {
        answer = current.replies[current.inputs.length] ?? current.answer;
        current.inputs.push({ latest: userText, history: JSON.stringify(body.messages.filter(message => message.role === 'user')) });
      } else if (current && userText.includes(current.holder)) {
        current.waiting = true;
        await current.released;
        answer = current.holder;
      }
      const delta = modelReply?.(body) ?? { content: answer };
      const base = { id: 'fixture', object: 'chat.completion.chunk', created: 123, model: body.model };
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const [part, finish_reason] of [[{ role: 'assistant', ...delta }, null], [{}, delta.tool_calls ? 'tool_calls' : 'stop']]) {
        response.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: part, finish_reason }] }) + '\n\n');
      }
      response.end('data: ' + JSON.stringify({ ...base, choices: [],
        usage: { prompt_tokens: 1800, completion_tokens: 20, total_tokens: 1820 } }) + '\n\ndata: [DONE]\n\n');
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
    const qqConfig = { ...bot, preset: 'minimal', proactiveDelivery: { externalTurns: 'all' },
      access: { ...bot.access, commandMode: 'open', c2cAllow: identities.map(userId) } };
    const patch = [
      { id: 'im-qqbot', config: qqConfig },
      { id: 'preset-minimal', config: { id: 'minimal', order: 3, plugins: [
        { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user', config: { mode: 'timed', timeout: 1 } },
      ] } },
      { id: 'agent-default-model', config: primary },
      { id: 'llm-pi-ai', config: { providers: { [primary.provider]: { api: 'openai-completions',
        baseURL: 'http://127.0.0.1:' + model.address().port + '/v1', apiKeyEnv: 'QQBOT_ACCESS_TEST_KEY',
        reasoning: 'low', compat: { thinkingFormat: 'openai' },
        models: [primary, secondary].map(({ model: id }) => ({ id, name: id, contextWindow: 32_000, maxTokens: 1024,
          reasoningEfforts: { low: 'low', high: 'high' } })) } } } },
    ];
    const patchPath = join(config.home, 'profiles', config.profile, 'cordis.patch.yml');
    const savePatch = () => writeFile(patchPath, JSON.stringify(patch, null, 2), { mode: 0o600 });
    await savePatch();
    const startHost = async () => {
      host = await spawnLogged(config.node, [...cli, ...profile, '--port', String(port), '--no-open'],
        { ...launch, logPath: config.hostLog });
      await writePrivateJson(join(runDir, 'process.json'), { pid: host.child.pid, hostOrigin: config.hostOrigin });
      return waitForHost(config, host, { signal });
    };
    const hostReady = () => waitForHost(config, host, { signal });
    let { client } = await startHost();
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
    const inject = async ({ scope, identity, command, mention }) => {
      const count = qq.state.receivedMessages;
      const status = await fixture('message', { scope, identity, command, mention,
        ...(scope === 'group' ? { groupIdentity: 'allowed' } : {}) });
      assert.equal(status.receivedMessages, count + 1, 'Exactly one gateway should receive each fixture input.');
      return 'local-fixture-message-' + status.receivedMessages;
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
      return reply.content;
    };
    const newModelRound = name => {
      const gate = Promise.withResolvers();
      round = { holder: 'QQ_WEB_HOLDER_' + name, answer: 'QQ_QUEUE_ANSWER_' + name,
        inputs: [], replies: [], waiting: false, released: gate.promise, release: gate.resolve };
      return round;
    };
    const effortSessions = await verifyReasoning({ client, exchange, inject, newModelRound, outboundSince, qq, until, modelRequests });
    round = undefined;
    await host.stop();
    const readyBefore = qq.state.readyCount;
    config.hostLog = join(runDir, 'restarted-host.log');
    ({ client } = await startHost());
    await until(() => qq.state.readyCount > readyBefore, 'gateway reconnects after process restart');
    await exchange({ scope: 'c2c', identity: 'allowed', command: 'effort' },
      /当前 Session[\s\S]*推理强度：high/, 'cold native Session choice');
    await exchange({ scope: 'c2c', identity: 'allowed', command: 'effort-default' },
      /推理强度已设为 默认（low）/, 'restore default in a cold Session');
    assert.deepEqual((await client.rpc('session/projections', { request: { sessionId: effortSessions.c2c } }))
      .values.modelSelection.next, primary);
    report.reasoning = { group: true, c2c: true, idleAndQueued: true, readAndSetAfterRestart: true };
    const sessions = await verifyCommands({ client, hostReady, qq, exchange, report, until });
    assert.deepEqual(sessions, { group: effortSessions.group, c2c: effortSessions.c2c });
    const beforeModelFailure = qq.state.observedOutboundRequests;
    denyModel = true;
    for (const [scope, sessionId] of Object.entries(sessions)) {
      await exchange({ scope, identity: 'allowed', command: 'smoke' }, switchModelNotice, 'unavailable model');
      const failure = await until(async () => (await readSessionEvents(client, sessionId)).findLast(event =>
        event.type === 'turn/end' && event.data.reason?.kind === 'error' && event.data.reason.error?.code === 'AUTH'
      ), 'original DSH provider error');
      assert(failure.data.reason.error.message.includes(modelDenied));
    }
    denyModel = false;
    assert.deepEqual((await outboundSince(beforeModelFailure)).filter(row => row.messageType !== 6).map(row => row.content),
      [switchModelNotice, switchModelNotice]);
    report.unavailableModel = { group: true, c2c: true, nativeError: true };
    const queue = await verifyGroupQueue({ client, sessionId: sessions.group, groupId, until, inject, newModelRound, outboundSince, qq });
    await queue.verifyOutbound();
    report.queue = queue.cases;
    round = undefined;

    const setModelReply = responder => { modelReply = responder; };
    const webTest = { client, sessions, setModelReply, until, outboundSince, qq };
    report.timedWebAnswers = { on: await verifyWebAnswers({ ...webTest, expectPush: true }) };
    const previousReady = qq.state.readyCount;
    qqConfig.access = (await client.pluginRpc(bind, 'config.get')).config.access;
    qqConfig.proactiveDelivery.externalTurns = 'off';
    await savePatch();
    await until(() => qq.state.readyCount > previousReady, 'QQ reconnects with Web push disabled', 30_000);
    await hostReady();
    assert.equal((await client.pluginRpc(bind, 'config.get')).config.proactiveDelivery.externalTurns, 'off');
    const offStart = qq.state.observedOutboundRequests;
    report.timedWebAnswers.off = await verifyWebAnswers({ ...webTest, expectPush: false });
    for (const scope of Object.keys(sessions)) {
      await exchange({ scope, identity: 'allowed', command: 'smoke' }, ordinaryAnswer, 'reply to QQ while Web push is off');
    }
    await host.stop();
    const offReplies = (await outboundSince(offStart)).filter(row => row.messageType !== 6);
    assert.deepEqual(offReplies.map(row => row.content), [ordinaryAnswer, ordinaryAnswer],
      'With Web push off, only the two fresh QQ inputs may generate outbound replies.');
    assert.equal(qq.state.unexpectedRequests, 0);
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
