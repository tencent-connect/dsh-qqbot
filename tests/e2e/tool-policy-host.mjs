import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { strToU8, zipSync } from 'fflate';
import { assertNodeVersion, availablePort, runLogged, spawnLogged, waitForHost } from './host.mjs';
import { createQQFixture } from './qq-fixture.mjs';
import { DUMMY_APP_ID, DUMMY_SECRET } from './command-protocol.mjs';
import { DatabaseSync } from 'node:sqlite';
import { QqTimeline } from '../../lib/runtime/qq-timeline.js';
import { deliveryKey } from '../../lib/transport/delivery-ledger.js';
import { stageHistoryPackage } from './history-registry.mjs';

const [source, corePackage, historyPackage, dir, expected = 'fixed', browser] = process.argv.slice(2);
assertNodeVersion();
assert([source, corePackage, historyPackage, dir].every(value => value && isAbsolute(value))
  && ['baseline', 'fixed'].includes(expected)
  && (browser === undefined || expected === 'fixed' && browser === '--browser'),
'Usage: node tests/e2e/tool-policy-host.mjs HOST_SOURCE CORE_TGZ HISTORY_TGZ NEW_OUTPUT_DIR [baseline|fixed [--browser]]');
await mkdir(dir, { mode: 0o700 });
const home = join(dir, 'home');
const workspace = join(dir, 'workspace');
const qqData = join(dir, 'qq-data');
await mkdir(workspace);
const profile = 'qqbot-policy';
const hostPort = await availablePort();
const hostOrigin = 'http://127.0.0.1:' + hostPort;
const hostLog = join(dir, 'host.log');
const primary = { provider: 'policy-fixture', model: 'fixture-primary' };
const secondary = { provider: primary.provider, model: 'fixture-secondary' };
const qq = await createQQFixture({ primary, secondary, allowModelRequests: true });
const pending = new Map();
const requests = [];
const promptRequests = new Map();
const report = { expected, hostOrigin, cases: {}, requests };

const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks));
    const users = payload.messages.filter(message => message.role === 'user').map(message => JSON.stringify(message.content));
    const child = users.some(content => content.includes('DELEGATED_POLICY_PROBE'));
    const prompt = users.findLast(content => content.includes('QQ_CMD_OK'));
    const actor = child ? 'child' : prompt?.includes('(@you)') ? 'group' : 'c2c';
    const plan = prompt || child ? pending.get(actor)?.shift() : undefined;
    if (plan) {
      requests.push({ name: plan.name, tools: (payload.tools ?? []).map(tool => tool.function.name).sort() });
      if (plan.name.startsWith('file-prompt-')) {
        promptRequests.set(plan.name, JSON.stringify(payload.messages.filter(message => message.role === 'system')));
      }
    }
    const calls = await plan?.response;
    const delta = calls?.length ? {
      role: 'assistant', tool_calls: calls.map(({ name, args }, index) => ({
        index, id: 'call_' + requests.length + '_' + index, type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      })),
    } : { role: 'assistant', content: 'QQ_CMD_OK' };
    const base = { id: 'fixture', object: 'chat.completion.chunk', created: 123, model: payload.model };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const [part, finish_reason] of [[delta, null], [{}, calls?.length ? 'tool_calls' : 'stop']]) {
      res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: part, finish_reason }] }) + '\n\n');
    }
    res.end('data: [DONE]\n\n');
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const registry = await stageHistoryPackage(historyPackage, '0.5.6');
let host;
const controls = [];
try {
  const env = {
    ...process.env, HOME: home, DSH_HOME: home, QQBOT_DATA_DIR: qqData,
    QQBOT_BASE_URL: qq.origin, QQBOT_TOKEN_BASE_URL: qq.origin,
    QQBOT_TOOL_TEST_KEY: 'isolated-test-only', DSH_TELEMETRY_MODE: 'DISABLED',
  };
  for (const name of Object.keys(process.env)) {
    if ((name.startsWith('QQBOT_') && !['QQBOT_DATA_DIR', 'QQBOT_BASE_URL', 'QQBOT_TOKEN_BASE_URL', 'QQBOT_TOOL_TEST_KEY'].includes(name))
      || name === 'NODE_OPTIONS') delete env[name];
  }
  const cli = ['--import', 'tsx/esm', 'apps/cli/src/bin.ts'];
  const select = ['--profile', profile];
  const install = { cwd: source, env, logPath: join(dir, 'install.log') };
  await runLogged(process.execPath, [...cli, ...select, '--from-default-profile', 'web', '--dump-config'], install);
  const companion = expected === 'baseline' ? ['file:' + historyPackage] : ['--registry=' + registry.origin];
  await runLogged(process.execPath, [...cli, 'plugin', ...select, 'add', 'file:' + corePackage, ...companion], install);
  const profileDir = join(home, 'profiles', profile);
  const barrier = fileURLToPath(new URL('./tool-policy-barrier.mjs', import.meta.url));
  await writeFile(join(profileDir, 'cordis.patch.yml'), JSON.stringify([
    { id: 'im-qqbot', config: { appId: DUMMY_APP_ID, appSecret: DUMMY_SECRET, cwd: workspace,
      preset: 'standard', streaming: false, showToolResults: false,
      media: { enabled: false }, access: { c2cMode: 'open', groupMode: 'open', commandMode: 'open' } } },
    { id: 'agent-default-model', config: primary },
    { id: 'llm-pi-ai', config: { providers: { [primary.provider]: { api: 'openai-completions',
      baseURL: 'http://127.0.0.1:' + server.address().port + '/v1', apiKeyEnv: 'QQBOT_TOOL_TEST_KEY',
      models: [primary.model, secondary.model].map(id => ({ id, name: id, contextWindow: 32_000, maxTokens: 1024 })) } } } },
    { insert: [{ id: 'qqbot-tool-policy-barrier', name: barrier }] },
  ], null, 2), { mode: 0o600 });
  let historyFixture;
  let openLog;
  if (browser === '--browser') {
    const directId = 'local-fixture-allowed-user';
    const pausedId = 'local-fixture-legacy-paused';
    const timelineOnlyId = 'local-fixture-legacy-timeline';
    const timedId = 'local-fixture-already-timed';
    const settings = (recording, alias = '') => ({ alias, receiving: true, recording, revision: 0 });
    await mkdir(qqData, { recursive: true });
    await writeFile(join(qqData, 'conversation-settings.json'), JSON.stringify({
      version: 1, peers: {
        [`qqbot:${DUMMY_APP_ID}:c2c:${directId}`]: settings(true),
        [`qqbot:${DUMMY_APP_ID}:c2c:${pausedId}`]: settings(false, '旧暂停对话'),
        [`qqbot:${DUMMY_APP_ID}:c2c:${timedId}`]: { alias: '', receiving: true, retention: '7d', revision: 1 },
      },
    }), { mode: 0o600 });
    const older = 'QQ_TIMELINE_BEYOND_30_DAYS';
    const recent = 'QQ_TIMELINE_BETWEEN_7_AND_30_DAYS';
    const timelineDir = join(qqData, 'timeline');
    const timeline = new QqTimeline(timelineDir, { warn: message => { throw new Error(message); } });
    const seed = (openId, entries) => {
      for (const [text, age] of entries) {
        timeline.record(DUMMY_APP_ID, { scope: 'c2c', targetId: openId }, {
          id: deliveryKey(text), text, at: Date.now() - age * 86_400_000, direction: 'inbound', status: 'received',
        });
      }
    };
    const storedMessages = openId => {
      const db = new DatabaseSync(join(timelineDir, 'messages.sqlite'), { readOnly: true });
      try {
        return db.prepare("SELECT body FROM messages WHERE app_id = ? AND scope = 'c2c' AND target_id = ?")
          .all(DUMMY_APP_ID, openId).map(row => JSON.parse(row.body).text);
      } finally { db.close(); }
    };
    seed(directId, [[older, 35], [recent, 12]]);
    seed(timedId, [['QQ_EXPIRE_WITHOUT_OPENING', 9], ['QQ_KEEP_ON_STARTUP', 2]]);
    seed(timelineOnlyId, [['QQ_LEGACY_TIMELINE_WITHOUT_SETTINGS', 35]]);
    seed('local-fixture-paged-messages', Array.from({ length: 105 }, (_, index) => ['QQ_PAGE_' + (index + 1), 1]));
    timeline.close();
    historyFixture = { older, recent, pausedId, timelineOnlyId, storedMessages, timedId };
    if (process.platform === 'darwin') {
      openLog = join(dir, 'native-open.log');
      const bin = join(dir, 'bin');
      await mkdir(bin);
      await writeFile(join(bin, 'open'), '#!/bin/sh\nprintf "%s\\n" "$1" >> "$QQBOT_TEST_OPEN_LOG"\n', { mode: 0o700 });
      env.PATH = bin + ':' + env.PATH;
      env.QQBOT_TEST_OPEN_LOG = openLog;
    }
  }
  host = await spawnLogged(process.execPath, [...cli, ...select, '--port', String(hostPort), '--no-open'], { cwd: source, env, logPath: hostLog });
  report.pid = host.child.pid;
  await writeFile(join(dir, 'process.json'), JSON.stringify({ pid: report.pid, hostOrigin }), { mode: 0o600 });
  const { client } = await waitForHost({ hostOrigin, hostLog, primary, secondary }, host);
  const peer = scope => 'local-fixture-allowed-' + (scope === 'group' ? 'group' : 'user');
  const base = '/api/qqbot/workbench/';
  const conversation = async scope => (await client.get(base + 'conversations?appId=' + DUMMY_APP_ID)).conversations
    .find(row => row.openId === peer(scope) && row.scope === scope);
  const save = async (scope, config) => {
    const row = await conversation(scope);
    return (await client.post(base + 'conversations', { appId: DUMMY_APP_ID, scope, openId: peer(scope),
      revision: row.revision, agent: { ...row.agent, ...config } })).conversation;
  };
  const dispatch = async (scope, command = 'smoke') => {
    if (command === 'smoke') {
      const next = pending.get('root')?.shift();
      if (next) pending.set(scope, [...pending.get(scope) ?? [], next]);
    }
    const res = await fetch(qq.origin + '/__fixture/message', { method: 'POST', body: JSON.stringify({ scope, command, identity: 'allowed' }) });
    assert(res.ok, command);
  };
  const until = async (fn, label) => {
    for (let i = 0; i < 100; i++) {
      const value = await fn();
      if (value) return value;
      await sleep(150);
    }
    throw new Error('Timed out: ' + label);
  };
  const observed = name => until(() => requests.find(entry => entry.name === name), 'model request ' + name);
  const plan = (name, calls = [], actor = 'root') => {
    const queue = pending.get(actor) ?? [];
    queue.push({ name, response: calls });
    pending.set(actor, queue);
  };
  const hold = (name, actor) => {
    const gate = Promise.withResolvers();
    controls.push(gate);
    plan(name, gate.promise, actor);
    return gate.resolve;
  };
  const events = async (sid, parent) => {
    const address = parent ? { kind: 'subagent', parentSessionId: parent, childSessionId: sid, mode: 'continuable' }
      : { kind: 'session', sessionId: sid };
    const result = await client.rpc('session/events', { request: { address, maxMessages: 180 } });
    return result.records.filter(row => row.type === 'event').map(row => row.event);
  };
  const finish = (sid, count, parent) => until(async () => {
    const rows = await events(sid, parent);
    return rows.filter(row => row.type === 'turn/end').length >= count && rows;
  }, 'settled turn ' + sid);
  const current = scope => until(async () => (await conversation(scope))?.currentSessionId, 'current ' + scope);
  const barrierPath = '/api/qqbot-test/tool-barrier';
  await client.get(barrierPath);
  await fetch(qq.origin + '/__fixture/outbound', { method: 'POST', body: '{"mode":"success"}' });
  const write = name => ({ name: 'write', args: { file_path: join(workspace, name), content: 'fixture only\n' } });

  await dispatch('group', 'ping');
  await until(() => conversation('group'), 'discovered group');
  await save('group', { preset: 'ptc', permission: 'danger-full-access', tools: ['read', 'write'] });
  plan('ptc-custom', [write('allowed.txt')]);
  await dispatch('group');
  const group = await current('group');
  await finish(group, 1);
  assert.deepEqual((await observed('ptc-custom')).tools, ['read', 'write']);
  assert.equal(await readFile(join(workspace, 'allowed.txt'), 'utf8'), 'fixture only\n');

  const program = `return await tools.write(${JSON.stringify(write('ptc-bypass.txt').args)})`;
  plan('guessed-ptc', [{ name: 'run_code', args: { code: program, description: 'Try to bypass allowlist' } }]);
  await dispatch('group');
  const guessed = await finish(group, 2);
  const guessedCall = guessed.find(row => row.type === 'tool/call' && row.data.name === 'run_code');
  assert(guessedCall);
  assert(guessed.some(row => row.type === 'tool/result' && row.data.message.toolCallId === guessedCall.data.callId
    && row.data.message.isError && /unknown tool|未允许该工具/.test(JSON.stringify(row.data))));
  assert.equal(existsSync(join(workspace, 'ptc-bypass.txt')), false);
  report.cases.ptc = 'Exact schemas read/write, real write effect, guessed run_code refused';

  plan('waiting-before-revoke', [write('waiting.txt')]);
  await dispatch('group');
  await until(async () => (await client.get(barrierPath)).waiting.includes(group), 'write after Host guard');
  await save('group', { tools: ['read'] });
  await client.post(barrierPath, { sessionId: group });
  const revoked = await finish(group, 3);
  const afterGuardWrite = existsSync(join(workspace, 'waiting.txt'));
  assert.equal(afterGuardWrite, expected === 'baseline');
  if (expected === 'fixed') assert(revoked.some(row => row.type === 'tool/result' && JSON.stringify(row.data).includes('ABORTED_BEFORE_DISPATCH')));
  report.cases.afterGuard = { fileWritten: afterGuardWrite, turn: revoked.filter(row => row.type === 'turn/end').at(-1).data.reason };

  plan('after-revoke', [write('forbidden.txt'), { name: 'subagent', args: { description: 'Forbidden delegation probe', prompt: 'DELEGATED_POLICY_PROBE' } }]);
  await dispatch('group');
  const denied = await finish(group, 4);
  assert.deepEqual((await observed('after-revoke')).tools, ['read']);
  assert.equal(existsSync(join(workspace, 'forbidden.txt')), false);
  assert.equal((await client.get(barrierPath)).children.length, 0);
  assert(denied.filter(row => row.type === 'tool/result' && JSON.stringify(row.data).includes('未允许该工具')).length >= 2);
  report.cases.guessedTools = 'Revoked write and guessed subagent both rejected';

  await dispatch('c2c', 'ping');
  await until(() => conversation('c2c'), 'discovered private chat');
  await save('c2c', { preset: 'standard', permission: 'danger-full-access' });
  const releaseChild = hold('child-before-restrict', 'child');
  plan('native-parent', [{ name: 'subagent', args: { description: 'Live child policy probe', prompt: 'DELEGATED_POLICY_PROBE' } }]);
  await dispatch('c2c');
  const direct = await current('c2c');
  assert((await observed('native-parent')).tools.includes('subagent'));
  const childBefore = await observed('child-before-restrict');
  assert(childBefore.tools.includes('write'), 'child started as a real unrestricted Agent');
  const child = await until(async () => (await client.get(barrierPath)).children.find(([, parent]) => parent === direct)?.[0], 'child lineage');
  await save('c2c', { tools: ['read'] });
  releaseChild([write('child-forbidden.txt')]);
  const childEvents = await finish(child, 1, direct);
  await finish(direct, 1);
  const childWrite = existsSync(join(workspace, 'child-forbidden.txt'));
  assert.equal(childWrite, expected === 'baseline');
  report.cases.liveChild = { fileWritten: childWrite, turn: childEvents.filter(row => row.type === 'turn/end').at(-1).data.reason };
  assert.equal((await conversation('group')).currentSessionId, group);
  assert.equal((await conversation('c2c')).currentSessionId, direct);
  await save('group', { permission: 'read-only' }); // The current Session is still at full access.
  await client.post(barrierPath, { sessionId: group, permission: 'danger-full-access' });
  plan('native-cap-conflict', [{ name: 'read', args: { file_path: join(workspace, 'allowed.txt') } }]);
  await dispatch('group');
  const conflicted = await finish(group, 5);
  assert.deepEqual((await observed('native-cap-conflict')).tools, []);
  assert(conflicted.some(row => row.type === 'tool/result' && row.data.turn === 5 && JSON.stringify(row.data).includes('基础权限')));
  await client.post(barrierPath, { sessionId: group, permission: 'read-only' });
  plan('native-cap-restored', [{ name: 'read', args: { file_path: join(workspace, 'allowed.txt') } }]);
  await dispatch('group');
  const restored = await finish(group, 6);
  assert.deepEqual((await observed('native-cap-restored')).tools, ['read']);
  assert(restored.some(row => row.type === 'tool/result' && row.data.turn === 6 && row.data.message.isError === false));
  report.cases.nativeCap = 'No model tools or guessed read while above the cap; native read works once restored';

  // An already assembled PTC request can return after switching to custom mode.
  await save('group', { tools: undefined });
  await client.post(barrierPath, { sessionId: group, permission: 'danger-full-access' });
  plan('native-ptc-control', [{ name: 'run_code', args: {
    code: `return await tools.write(${JSON.stringify(write('ptc-control.txt').args)})`, description: 'Exercise nested write',
  } }]);
  await dispatch('group');
  await finish(group, 7);
  assert.deepEqual((await observed('native-ptc-control')).tools, ['run_code']);
  assert.equal(await readFile(join(workspace, 'ptc-control.txt'), 'utf8'), 'fixture only\n');

  const releaseProgram = hold('old-ptc-request', 'root');
  await dispatch('group');
  assert.deepEqual((await observed('old-ptc-request')).tools, ['run_code']);
  await save('group', { permission: 'danger-full-access', tools: ['read'] });
  releaseProgram([{ name: 'run_code', args: { code: program, description: 'Return the stale PTC call' } }]);
  const stale = await finish(group, 8);
  assert.equal(existsSync(join(workspace, 'ptc-bypass.txt')), false);
  report.cases.stalePtc = { fileWritten: false, turn: stale.filter(row => row.type === 'turn/end').at(-1).data.reason };

  const setNativePermission = async (preset) => {
    const result = await client.rpc('commands/execute', {
      agentId: group, line: '/permission ' + preset, submittedAttachments: [],
    });
    assert.deepEqual(result?.result, { kind: 'success', text: 'preset ' + preset });
  };
  await save('group', { permission: 'workspace-write', tools: ['read', 'write'] });
  await setNativePermission('workspace-write');
  plan('waiting-before-native-switch', [write('waiting-native-cap.txt')]);
  await dispatch('group');
  await until(async () => (await client.get(barrierPath)).waiting.includes(group), 'write admitted under workspace-write');
  assert.deepEqual((await observed('waiting-before-native-switch')).tools, ['read', 'write']);
  await setNativePermission('danger-full-access');
  await client.post(barrierPath, { sessionId: group });
  const switched = await finish(group, 9);
  const nativeSwitchWrite = existsSync(join(workspace, 'waiting-native-cap.txt'));
  const nativeSwitchError = switched.find(row => row.type === 'tool/result' && row.data.turn === 9)?.data.error?.code;
  report.cases.nativeSwitchAfterGuard = {
    fileWritten: nativeSwitchWrite, errorCode: nativeSwitchError ?? null,
    turn: switched.filter(row => row.type === 'turn/end').at(-1).data.reason,
  };
  assert.equal(nativeSwitchWrite, expected === 'baseline', 'native permission above the QQ cap must fence the admitted write');
  if (expected === 'fixed') assert.equal(nativeSwitchError, 'ABORTED_BEFORE_DISPATCH');

  await setNativePermission('workspace-write');
  plan('after-native-switch-restored', [write('native-restored.txt')]);
  await dispatch('group');
  await finish(group, 10);
  assert.deepEqual((await observed('after-native-switch-restored')).tools, ['read', 'write']);
  assert.equal(await readFile(join(workspace, 'native-restored.txt'), 'utf8'), 'fixture only\n');
  report.cases.nativeSwitchRestored = 'A fresh turn can write after the native permission returns within the cap';
  if (expected === 'fixed') {
    await save('group', { tools: undefined });
    const outbound = async () => (await fetch(qq.origin + '/__fixture/observations').then(result => result.json())).outbound;
    const before = (await outbound()).at(-1)?.sequence ?? 0;
    plan('recover-after-ptc-error', [{ name: 'run_code', args: { code: "throw new Error('private PTC fixture')", description: 'Fail in PTC' } }]);
    await dispatch('group');
    const completed = await finish(group, 11);
    assert(completed.some(event => event.type === 'tool/result' && event.data.turn === 11 &&
      (event.data.error !== undefined || event.data.message?.isError)), 'the real run_code tool failed');
    const sent = await until(async () => {
      const rows = (await outbound()).filter(row => row.sequence > before);
      return rows.some(row => row.content === 'QQ_CMD_OK') ? rows : undefined;
    }, 'PTC recovery after tool failure');
    assert.deepEqual(sent.map(row => row.content), ['QQ_CMD_OK']);
    report.cases.ptcRecoveryDelivery = { toolFailed: true, finalAnswerOnly: true };
  }
  report.sessions = { group, direct, child };
  if (browser === '--browser') {
    const { verifyWorkbenchBrowser } = await import('./workbench-browser.mjs');
    const files = join(dir, 'prompt documents');
    await mkdir(files);
    const word = { path: join(files, 'group-prompt.docx'), initial: 'QQ_GROUP_WORD_PROMPT', openLog };
    const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + `<w:body><w:p><w:r><w:t>${word.initial}</w:t></w:r></w:p></w:body></w:document>`;
    await writeFile(word.path, zipSync({ 'word/document.xml': strToU8(xml) }), { mode: 0o600 });
    const plain = { path: join(files, 'plain-prompt.txt'), initial: '原 TXT 提示词\n', edited: 'TXT 已原地保存\n' };
    const prompt = { path: join(files, 'live-prompt.md'), initial: '# QQ_PROMPT_PREVIEW_INITIAL\n', edited: '# QQ_PROMPT_PREVIEW_EDITED\n', word, plain };
    await writeFile(prompt.path, prompt.initial, { mode: 0o600 });
    await writeFile(plain.path, plain.initial, { mode: 0o600 });
    await writeFile(join(files, 'hidden-from-picker.pdf'), 'unsupported');
    for (const route of ['prompt-preview', 'prompt-files', 'prompt-write', 'timeline/clear']) {
      const unauthenticated = await fetch(hostOrigin + base + route, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: prompt.path }),
      });
      assert([401, 403].includes(unauthenticated.status), route + ' requires a trusted Host owner');
    }
    report.browser = await verifyWorkbenchBrowser({ source, hostOrigin, hostLog, client, qq, dir, until, prompt, historyFixture });

    const before = await conversation('c2c');
    assert.equal(before.currentSessionId, direct);
    assert.deepEqual(before.agent.directPrompt, { kind: 'file', path: prompt.path });
    const turnCount = (await events(direct)).filter(event => event.type === 'turn/end').length;
    plan('file-prompt-first');
    await dispatch('c2c');
    await finish(direct, turnCount + 1);
    assert(promptRequests.get('file-prompt-first')?.includes(prompt.edited.trim()));

    const latest = '# QQ_PROMPT_RUNTIME_LATEST\n\n末尾一行。';
    await writeFile(prompt.path, latest, { mode: 0o600 });
    plan('file-prompt-second');
    await dispatch('c2c');
    await finish(direct, turnCount + 2);
    const system = promptRequests.get('file-prompt-second');
    assert(system?.includes(JSON.stringify(latest).slice(1, -1)), 'the next model request receives the updated complete file');
    assert(!system.includes(prompt.edited.trim()), 'the previous file content is gone from the current system prompt');
    assert.equal((await conversation('c2c')).revision, before.revision);
    assert.equal((await client.get(base + 'timeline?' + new URLSearchParams({
      appId: DUMMY_APP_ID, scope: 'c2c', openId: peer('c2c'),
    }))).entries.length, 0, 'paused recording does not prevent model requests or add new rows');

    await rm(prompt.path);
    plan('file-prompt-missing');
    await dispatch('c2c');
    const stopped = await finish(direct, turnCount + 3);
    assert.equal(stopped.filter(event => event.type === 'turn/end').at(-1).data.reason.kind, 'error');
    assert(!promptRequests.has('file-prompt-missing'), 'a missing file cannot fall back to old prompt text');
    assert.equal(pending.get('c2c').shift()?.name, 'file-prompt-missing');
    report.cases.livePromptFile = { modelSawLatest: true, sameSession: true, noConfigRewrite: true, missingFileStoppedTurn: true };
  }
  if (expected === 'fixed') {
    const robots = async () => (await client.get(base + 'robots')).robots;
    const bot = (await robots()).find(row => row.appId === DUMMY_APP_ID);
    await client.post(base + 'robots/remove', {
      appId: DUMMY_APP_ID, revision: bot.revision, bindingRevision: bot.bindingRevision, mode: 'retain',
    });
    await until(async () => qq.state.activeConnections === 0 &&
      !(await robots().catch(() => [bot])).some(row => row.appId === DUMMY_APP_ID), 'QQ unbound and routes reloaded');
    const before = (await fetch(qq.origin + '/__fixture/observations').then(result => result.json())).outbound.length;
    const previousTurns = (await events(direct)).filter(event => event.type === 'turn/end').length;
    plan('native-after-unbind', [write('native-after-unbind.txt')], 'c2c');
    const receipt = await client.rpc('session/prompt', { request: { sessionId: direct, requestId: crypto.randomUUID(),
      mode: 'queue', content: [{ type: 'text', text: 'QQ_CMD_OK native followup' }] } });
    assert.equal(receipt.accepted, true);
    assert((await observed('native-after-unbind')).tools.includes('write'));
    await finish(direct, previousTurns + 1);
    assert.equal(await readFile(join(workspace, 'native-after-unbind.txt'), 'utf8'), 'fixture only\n');
    assert.equal((await fetch(qq.origin + '/__fixture/observations').then(result => result.json())).outbound.length, before);
    report.cases.nativeAfterUnbind = { sameSession: true, nativeWriteRestored: true, noQqDelivery: true };
  }
  assert.equal(qq.state.unexpectedRequests, 0);
} finally {
  for (const gate of controls) gate.resolve([]);
  await host?.stop();
  server.closeAllConnections();
  await Promise.all([qq.close(), registry.close(), new Promise(resolve => server.close(resolve))]);
  await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
}
