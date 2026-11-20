import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Document } from 'yaml';
import { assertNodeVersion, availablePort, hostClient, runLogged, spawnLogged, verifyComponents, writePrivateJson } from './host.mjs';
import { DUMMY_APP_ID, DUMMY_SECRET } from './command-protocol.mjs';
import { createQQFixture } from './qq-fixture.mjs';
import { stageHistoryPackage } from './history-registry.mjs';
import { scannedBot } from './qr-binding-fixture.mjs';

const [cli, oldPackage, corePackage, historyPackage, root, mode = 'workbench'] = process.argv.slice(2);
assertNodeVersion();
assert([cli, oldPackage, corePackage, historyPackage, root].every(path => path && isAbsolute(path))
  && ['workbench', 'gateway'].includes(mode),
'Usage: node tests/e2e/upgrade-055.mjs DSH_BIN_JS OFFICIAL_055_TGZ CORE_TGZ HISTORY_TGZ NEW_OUTPUT_DIR [workbench|gateway]');
await mkdir(root, { mode: 0o700 });
const home = join(root, 'home');
const workspace = join(root, 'workspace');
const oldPrefs = join(home, '.dsh-qqbot', 'model-prefs.json');
await mkdir(workspace);
const primary = { provider: 'upgrade-fixture', model: 'primary' };
const secondary = { provider: primary.provider, model: 'secondary' };
const directId = 'local-fixture-denied-user';
const groupId = 'local-fixture-allowed-group';
const directKey = `qqbot:${DUMMY_APP_ID}:c2c:${directId}`;
const groupKey = `qqbot:${DUMMY_APP_ID}:group:${groupId}`;
const core = '@tencent-connect/dsh-qqbot';
const history = '@tencent-connect/dsh-qqbot-workbench-history';
const legacyPrompt = 'Legacy prompt beginning\n' + '字'.repeat(80_001) + '\nLegacy prompt end  \n';
const qq = await createQQFixture({ primary, secondary, allowModelRequests: true, scanBindings: mode === 'workbench' });
const registry = await stageHistoryPackage(historyPackage, '0.5.6');
const requests = [];
let resultMode = 'answer';
const model = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks));
  requests.push({ model: payload.model });
  if (resultMode === 'failure') {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'private synthetic model failure' } }));
    return;
  }
  const base = { id: 'fixture', object: 'chat.completion.chunk', created: 123, model: payload.model };
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const tool = { index: 0, id: 'unknown-probe', type: 'function', function: { name: 'synthetic_missing_tool', arguments: '{}' } };
  const content = resultMode === 'tool-then-answer' ? 'PRIVATE_PREAMBLE' : 'QQ_CMD_OK';
  const deltas = [[{ role: 'assistant', content }, null]];
  if (resultMode === 'tool-then-answer') {
    deltas.push([{ tool_calls: [tool] }, null]);
    resultMode = 'answer';
  }
  deltas.push([{}, content === 'PRIVATE_PREAMBLE' ? 'tool_calls' : 'stop']);
  for (const [delta, finish_reason] of deltas) {
    response.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason }] }) + '\n\n');
  }
  response.end('data: [DONE]\n\n');
});
await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));

const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('QQBOT_') && key !== 'NODE_OPTIONS'));
Object.assign(env, {
  HOME: home, DSH_HOME: home, QQBOT_BASE_URL: qq.origin, QQBOT_TOKEN_BASE_URL: qq.origin,
  QQBOT_MODEL_FIXTURE_KEY: 'local-fixture-only', DSH_TELEMETRY_MODE: 'DISABLED',
  COREPACK_ENABLE_AUTO_PIN: '0',
});
const profilePath = profile => join(home, 'profiles', profile);
const patchPath = profile => join(profilePath(profile), 'cordis.patch.yml');
const installed = (profile, name) => readFile(join(profilePath(profile), 'node_modules', name, 'package.json'), 'utf8').then(JSON.parse);
const cliOptions = { cwd: root, env, logPath: join(root, 'install.log') };
const run = (args, options = cliOptions) => runLogged(process.execPath, [cli, ...args], options);
const install = (profile, artifact) => run(['plugin', '--profile', profile, 'add', 'file:' + artifact,
  '--registry=' + registry.origin]);
const patch = [
  { id: 'im-qqbot', config: { appId: DUMMY_APP_ID, appSecret: DUMMY_SECRET, cwd: workspace,
    preset: 'standard', streaming: false, showToolResults: true, media: { enabled: false },
    access: { c2cMode: 'allowlist', c2cAllow: [directId], groupMode: 'allowlist', groupAllow: [groupId] } } },
  { id: 'agent-default-model', config: primary },
  { id: 'llm-pi-ai', config: { providers: { [primary.provider]: { api: 'openai-completions',
    baseURL: 'http://127.0.0.1:' + model.address().port + '/v1', apiKeyEnv: 'QQBOT_MODEL_FIXTURE_KEY',
    models: [primary, secondary].map(({ model: id }) => ({ id, name: id, contextWindow: 256_000, maxTokens: 1024 })) } } } },
];
const patchText = JSON.stringify(patch, null, 2);
function legacyPatch() {
  if (mode === 'gateway') return patchText;
  const doc = new Document(patch);
  const config = doc.getIn([0, 'config'], true);
  const access = doc.createNode('(' + JSON.stringify(patch[0].config.access) + ')');
  access.tag = 'tag:yaml.org,2002:js';
  config.anchor = 'legacy-qq-config';
  config.set('access', access);
  config.set('directPrompt', legacyPrompt);
  return doc.toString({ lineWidth: 0 });
}
const upgradePatch = legacyPatch();
async function configure(profile, artifact) {
  if (mode === 'workbench') await run(['--profile', profile, '--from-default-profile', 'web', '--dump-config']);
  await install(profile, artifact);
  await writeFile(patchPath(profile), profile === 'upgrade' ? upgradePatch : patchText, { mode: 0o600 });
}
async function until(read, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await delay(150);
  }
  throw new Error('Timed out: ' + label);
}
async function fixture(operation, payload) {
  const response = await fetch(qq.origin + '/__fixture/' + operation, {
    method: payload === undefined ? 'GET' : 'POST', body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  });
  assert(response.ok, 'QQ fixture ' + operation);
  return response.json();
}
async function exchange(scope, identity, command, expected) {
  const sequence = (await fixture('observations')).outbound.at(-1)?.sequence ?? 0;
  const peer = scope === 'group' ? '/groups/local-fixture-' + identity + '-group/' : '/users/local-fixture-' + identity + '-user/';
  await fixture('message', { scope, identity, command });
  const messages = () => fixture('observations').then(({ outbound }) => outbound.filter(row => row.sequence > sequence && row.path.includes(peer)));
  if (!expected) {
    await delay(500);
    assert.deepEqual(await messages(), []);
    return [];
  }
  await until(async () => (await messages()).some(row => expected.test(row.content)), command + ' ' + scope);
  return messages();
}
async function launch(profile, phase, extraEnvironment = {}) {
  const hostPort = await availablePort();
  const hostLog = join(root, phase + '.log');
  const hostOrigin = 'http://127.0.0.1:' + hostPort;
  const host = await spawnLogged(process.execPath, [cli, '--profile', profile, '--port', String(hostPort), '--no-open'],
    { ...cliOptions, env: { ...env, ...extraEnvironment }, logPath: hostLog });
  return { host, hostLog, connect: async () => until(
    async () => hostClient({ hostOrigin, hostLog }).catch(() => undefined), 'client ' + phase,
  ) };
}
async function withHost(profile, phase, work) {
  const count = qq.state.readyCount;
  const { host, hostLog, connect } = await launch(profile, phase);
  try {
    await until(() => {
      if (host.settled) throw new Error('Host exited: ' + hostLog);
      return qq.state.readyCount > count;
    }, 'gateway ' + phase, 60_000);
    return await work(connect);
  } finally {
    await host.stop();
    await until(() => qq.state.activeConnections === 0, 'gateway stop ' + phase);
  }
}
async function verifyArchiveRoundTrip(client, sessionId) {
  const archived = await client.rpc('workspace/archiveSession', { request: { sessionId } });
  assert(archived.archivedSessionIds.includes(sessionId));
  const requestsBefore = requests.length;
  const blocked = (await exchange('c2c', 'denied', 'smoke', /当前会话已归档/))
    .filter(row => row.messageType !== 6); // The SDK also submits a C2C typing notification.
  assert.equal(blocked.length, 1);
  assert.match(blocked[0].content, /<qqbot-cmd-input text="\/unarchive"/);
  assert.match(blocked[0].content, /<qqbot-cmd-input text="\/new"/);
  await exchange('c2c', 'denied', 'compact', /已归档/);
  assert.equal(requests.length, requestsBefore, 'The archived Session must not call the model');

  await exchange('c2c', 'denied', 'unarchive', /已取消归档/);
  await exchange('c2c', 'denied', 'restore', /没有被归档/);
  await exchange('c2c', 'denied', 'smoke', /QQ_CMD_OK/);
  assert.equal(requests.at(-1)?.model, secondary.model);
  const { conversations } = await client.get('/api/qqbot/workbench/conversations?appId=' + DUMMY_APP_ID);
  assert.equal(conversations.find(row => row.openId === directId)?.currentSessionId, sessionId);
  return { blockedWithoutModelCall: true, unarchiveAndAlias: true, sameSession: true };
}

async function verifyLegacySettings(client, profile, sessionId) {
  const conversations = '/api/qqbot/workbench/conversations';
  const peer = (appId, openId) => client.get(conversations + '?' + new URLSearchParams({ appId, scope: 'c2c', openId }))
    .then(({ conversations: rows }) => rows[0]);
  const original = await peer(DUMMY_APP_ID, directId);
  assert.equal(original.currentSessionId, sessionId);
  assert(original.agent.directPrompt === legacyPrompt, 'Upgrade must keep the entire stored prompt');
  const saved = await client.post(conversations, { appId: DUMMY_APP_ID, scope: 'c2c', openId: directId, revision: original.revision,
    alias: 'Legacy conversation', agent: original.agent });
  assert(saved.conversation.agent.directPrompt === legacyPrompt, 'Saving other settings must keep the old prompt');
  await assert.rejects(client.post(conversations, { appId: DUMMY_APP_ID, scope: 'c2c', openId: directId, revision: saved.conversation.revision,
    agent: { ...saved.conversation.agent, directPrompt: legacyPrompt + 'changed' } }), /HTTP 400/);

  const otherAppId = scannedBot.appId;
  const otherUser = 'local-fixture-allowed-user';
  const { robot } = await client.post('/api/qqbot/workbench/robots', {
    appId: otherAppId, appSecret: DUMMY_SECRET, revision: null,
    access: { c2cMode: 'allowlist', c2cAllow: [otherUser], groupMode: 'disabled' },
  });
  assert.equal(robot.appId, otherAppId);
  await until(() => qq.state.activeConnections === 2, 'both robots online in one profile');
  const defaultsPath = '/api/qqbot/workbench/defaults';
  const defaults = await client.get(defaultsPath + '?appId=' + otherAppId);
  // The loopback QQ fixture handles complete messages.
  await client.post(defaultsPath, { appId: otherAppId, revision: defaults.revision,
    settings: { ...defaults.settings, streaming: false } });
  await exchange('c2c', 'allowed', 'smoke', /QQ_CMD_OK/);
  assert.equal(requests.at(-1)?.model, primary.model);
  assert((await peer(otherAppId, otherUser)).currentSessionId);

  const settingsPath = join(profilePath(profile), 'qqbot-state', 'conversation-settings.json');
  const readSettings = () => readFile(settingsPath, 'utf8').then(JSON.parse);
  const settings = await readSettings();
  const valid = settings.peers[directKey];
  const invalid = { ...valid, receiving: 'invalid-fixture-value' };
  settings.peers[directKey] = invalid;
  await writePrivateJson(settingsPath, settings);
  await assert.rejects(peer(DUMMY_APP_ID, directId), /HTTP 409/);
  await exchange('c2c', 'denied', 'smoke', null);
  await exchange('c2c', 'allowed', 'smoke', /QQ_CMD_OK/);
  const other = await peer(otherAppId, otherUser);
  const changed = await client.post(conversations, { appId: otherAppId, scope: 'c2c', openId: otherUser,
    revision: other.revision, alias: 'Second robot still writable' });
  assert.equal(changed.conversation.alias, 'Second robot still writable');
  const afterSave = await readSettings();
  assert.deepEqual(afterSave.peers[directKey], invalid);
  afterSave.peers[directKey] = valid;
  await writePrivateJson(settingsPath, afterSave);
  assert((await peer(DUMMY_APP_ID, directId)).agent.directPrompt === legacyPrompt);

  const result = await client.pluginRpc('dsh-qqbot/account', 'pair.revoke', {
    appId: DUMMY_APP_ID, purpose: 'allow-c2c', openid: directId,
  });
  assert.deepEqual(result.allowC2c, []);
  await exchange('c2c', 'denied', 'ping', null);
  await exchange('group', 'allowed', 'ping', /pong/i);
  await exchange('c2c', 'allowed', 'smoke', /QQ_CMD_OK/);
  return { exactLegacyPrompt: true, unchangedPromptCanBeSaved: true, invalidSettingsIsolated: true, revocation: true };
}
async function verifyWriters() {
  const shared = { QQBOT_DATA_DIR: join(root, 'shared-state') };
  const owned = [];
  const start = async (profile, name, overrides) => {
    const record = await launch(profile, name, overrides);
    owned.push(record.host);
    return record;
  };
  try {
    const first = await start('clean', 'writer-owner', shared);
    await until(() => qq.state.activeConnections === 1, 'writer connected');
    const disjoint = await start('parallel', 'writer-independent', { QQBOT_DATA_DIR: join(root, 'separate-state') });
    await until(() => qq.state.activeConnections === 2, 'distinct directory connects');
    await disjoint.host.stop();
    await until(() => qq.state.activeConnections === 1, 'independent writer stops');

    const contender = await start('parallel', 'writer-contender', shared);
    const blocked = await contender.connect();
    await assert.rejects(blocked.get('/api/qqbot/workbench/robots'), /HTTP 503/);
    assert.equal(qq.state.activeConnections, 1);
    first.host.child.kill('SIGKILL');
    await until(() => first.host.settled && qq.state.activeConnections === 0, 'crashed writer released');
    await contender.host.stop();

    const replacement = await start('parallel', 'writer-takeover', shared);
    await until(() => qq.state.activeConnections === 1, 'takeover gateway');
    assert.equal((await (await replacement.connect()).get('/api/qqbot/workbench/robots')).robots[0].state, 'connected');
    return { disjoint: true, sameDirectoryRejected: true, crashedWriterTakenOver: true };
  } finally {
    await Promise.all(owned.map(host => host.stop()));
  }
}
const report = { mode, root };
try {
  await fixture('outbound', { mode: 'success' });
  const profile = 'upgrade';
  await configure(profile, oldPackage);
  assert.equal((await installed(profile, core)).version, '0.5.5');
  await withHost(profile, 'official-055', async connect => {
    if (mode === 'workbench') {
      const { config } = await (await connect()).get('/qqbot/im-qqbot/config');
      assert(config.directPrompt === legacyPrompt, '0.5.5 must load the entire legacy YAML prompt');
      assert.deepEqual(config.access.c2cAllow, [directId]);
      assert.deepEqual(config.access.groupAllow, [groupId]);
    }
    await exchange('group', 'allowed', 'ping', /pong/i);
    await exchange('group', 'allowed', 'model-secondary', /无权限|不在斜杠命令白名单/);
    await exchange('group', 'allowed', 'preset-minimal', /无权限|不在斜杠命令白名单/);
    await exchange('c2c', 'allowed', 'ping', null);
    await exchange('c2c', 'denied', 'model-secondary', /secondary/);
    if (mode === 'workbench') await exchange('c2c', 'denied', 'preset-minimal', /minimal/);
    await exchange('c2c', 'denied', 'new', /新会话|新建|已清空/);
    await exchange('c2c', 'denied', 'smoke', /QQ_CMD_OK/);
  });
  const oldBytes = await readFile(oldPrefs, 'utf8');
  const old = JSON.parse(oldBytes);
  const sessionId = old.sessionIds[directKey];
  assert(sessionId);
  if (mode === 'workbench') assert.equal(old.presets[directKey], 'minimal');
  assert.equal(requests.at(-1)?.model, secondary.model);
  await install(profile, corePackage);
  assert.equal((await installed(profile, core)).version, '0.5.6');
  const manifest = JSON.parse(await readFile(join(profilePath(profile), 'package.json'), 'utf8'));
  assert(Object.hasOwn(manifest.dependencies, core));
  assert(!Object.hasOwn(manifest.dependencies, history), 'Install must resolve the companion transitively');
  assert.equal(await readFile(patchPath(profile), 'utf8'), upgradePatch);
  await withHost(profile, 'upgrade-candidate', async connect => {
    await exchange('group', 'allowed', 'ping', /pong/i);
    await exchange('group', 'allowed', 'model', /模型配置/);
    await exchange('group', 'allowed', 'preset', /Agent Preset|无可用的 agent preset/);
    await exchange('group', 'denied', 'model', null);
    await exchange('c2c', 'allowed', 'ping', null);
    await exchange('c2c', 'denied', 'smoke', /QQ_CMD_OK/);
    assert.equal(requests.at(-1)?.model, secondary.model);
    if (mode === 'gateway') {
      await exchange('group', 'allowed', 'smoke', /QQ_CMD_OK/);
      return;
    }
    const client = await connect();
    const { robots } = await client.get('/api/qqbot/workbench/robots');
    assert.equal(robots[0]?.appId, DUMMY_APP_ID);
    assert.equal(robots[0]?.access.commandMode, 'open');
    const conversations = await client.get('/api/qqbot/workbench/conversations?appId=' + DUMMY_APP_ID);
    assert.equal(conversations.conversations.find(row => row.openId === directId)?.currentSessionId, sessionId);
    report.archive = await verifyArchiveRoundTrip(client, sessionId);
    resultMode = 'tool-then-answer';
    const answer = await exchange('group', 'allowed', 'smoke', /QQ_CMD_OK/);
    assert.deepEqual(answer.map(row => row.content), ['QQ_CMD_OK']);
    resultMode = 'failure';
    const failure = await exchange('group', 'allowed', 'smoke', /失败|出错/);
    assert.equal(failure.length, 1);
    assert(!failure[0].content.includes('private synthetic'));
    resultMode = 'answer';
    report.componentSwitches = await verifyComponents(client, qq);
    const data = JSON.parse(await readFile(join(profilePath(profile), 'qqbot-state', 'session-preferences.json'), 'utf8'));
    assert.equal(data.sessionIds[directKey], sessionId);
    assert.equal(data.presets[directKey], 'minimal');
    assert(!data.overrides[groupKey], 'The model list request changed the shared group model');
    report.legacySettings = await verifyLegacySettings(client, profile, sessionId);
  });
  assert.equal(await readFile(oldPrefs, 'utf8'), oldBytes);
  report.upgrade = { sessionId, model: secondary.model, unifiedCommandAccess: true, sourcePrefsPreserved: true };
  await install(profile, oldPackage);
  assert.equal((await installed(profile, core)).version, '0.5.5');
  if (mode === 'workbench') {
    await withHost(profile, 'rollback-after-revocation', async () => {
      await exchange('c2c', 'denied', 'ping', null);
      await exchange('group', 'allowed', 'ping', /pong/i);
    });
    report.rollbackKeepsRevocation = true;
    await writeFile(patchPath(profile), upgradePatch, { mode: 0o600 });
  }
  await withHost(profile, 'rollback', async connect => {
    await exchange('c2c', 'denied', 'smoke', /QQ_CMD_OK/);
    assert.equal(requests.at(-1)?.model, secondary.model);
    if (mode === 'workbench') {
      const { config } = await (await connect()).get('/qqbot/im-qqbot/config');
      assert(config.directPrompt === legacyPrompt, '0.5.5 must still load the entire prompt after rollback');
    }
  });
  assert.equal(JSON.parse(await readFile(oldPrefs, 'utf8')).sessionIds[directKey], sessionId);
  report.rollback = true;
  if (mode === 'workbench') {
    await configure('clean', corePackage);
    await withHost('clean', 'clean-install', async connect => {
      const client = await connect();
      report.cleanInstall = await verifyComponents(client, qq);
    });
    const settingsPath = join(profilePath(profile), 'qqbot-state', 'conversation-settings.json');
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    const group = settings.peers[groupKey];
    group.agent = { ...group.agent, preset: 'ptc', permission: 'read-only', tools: ['read'] };
    await writeFile(settingsPath, JSON.stringify(settings), { mode: 0o600 });
    await install(profile, corePackage);
    await withHost(profile, 'rc3-with-restricted-ptc', async connect => {
      const client = await connect();
      const { conversations } = await client.get('/api/qqbot/workbench/conversations?appId=' + DUMMY_APP_ID);
      assert(conversations.find(row => row.scope === 'group' && row.openId === groupId)?.executionBlocked);
      const count = requests.length;
      await exchange('group', 'allowed', 'smoke', null);
      assert.equal(requests.length, count);
      await exchange('c2c', 'denied', 'smoke', /QQ_CMD_OK/);
      report.restrictedPtcPaused = true;
    });
    await configure('parallel', corePackage);
    report.directoryOwnership = await verifyWriters();
  }
  await writePrivateJson(join(root, 'report.json'), report);
  console.log(JSON.stringify(report));
} finally {
  await Promise.all([qq.close(), registry.close(), new Promise(resolve => model.close(resolve))]);
}
