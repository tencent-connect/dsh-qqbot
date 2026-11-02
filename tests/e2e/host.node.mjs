import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { assertNodeVersion, availablePort, buildHostEnvironment, createRunConfig, dummyQQConfig,
  mergeProfilePatch, parseArgs, parseRoute, runLogged, spawnLogged, validateCatalog, waitForHost } from './host.mjs';

const require = createRequire(import.meta.url);
const YAML = require('yaml');

async function temporary(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'qqbot-runner-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('offline mode is the default and model generation requires an explicit host option', () => {
  assert.deepEqual(parseArgs([]), { mode: 'fixture', hostPort: 0, fixturePort: 0, python: 'python3',
    presetPrimary: 'standard', presetSecondary: 'minimal', allowModelRequests: false });
  assert.throws(() => parseArgs(['--allow-model-requests']), /Host options require/);
  const args = ['--mode', 'host', '--dsh-source', '/source', '--model-patch', '/patch.yml',
    '--primary', 'provider/first/model', '--secondary', 'provider/second', '--reasoning', 'high'];
  assert.deepEqual(parseArgs(args).primary, { provider: 'provider', model: 'first/model', reasoningEffort: 'high' });
  assert.equal(parseArgs(args).allowModelRequests, false);
  assert.equal(parseArgs([...args, '--allow-model-requests']).allowModelRequests, true);
  assert.throws(() => parseArgs([...args, '--host-port', '3192', '--fixture-port', '3192']), /separate ports/);
  assert.throws(() => parseArgs([...args, '--mode', 'host']), /Duplicate option/);
  assert.throws(() => parseRoute('no-provider'), /provider\/model/);
});

test('rejects Node 23 instead of accepting a source CLI no-op', () => {
  for (const version of ['20.3.0', '22.18.0', '23.11.1']) assert.throws(() => assertNodeVersion(version), /not supported/);
  for (const version of ['22.19.0', '24.19.0', '25.0.0']) assert.doesNotThrow(() => assertNodeVersion(version));
});

test('new run owns independent private home, data and workspace and cannot reuse output', async t => {
  const root = await temporary(t);
  const source = join(root, 'source'); const project = join(root, 'plugin');
  await mkdir(join(source, 'apps/cli/src'), { recursive: true }); await mkdir(project);
  await writeFile(join(source, 'apps/cli/src/bin.ts'), '');
  const patch = join(root, 'model.yml'); await writeFile(patch, '[]');
  const output = join(root, 'run');
  const options = { dshSource: source, modelPatch: patch, output, primary: { provider: 'p', model: 'a' },
    secondary: { provider: 'p', model: 'b' }, presetPrimary: 'standard', presetSecondary: 'minimal', allowModelRequests: false };
  const config = await createRunConfig(options, project);
  assert.equal(config.home, join(output, 'home'));
  assert.equal(config.dataDir, join(output, 'data'));
  assert.equal(config.workspace, join(output, 'workspace'));
  if (process.platform !== 'win32') for (const path of [output, config.home, config.dataDir, config.workspace]) {
    assert.equal((await stat(path)).mode & 0o777, 0o700);
  }
  await assert.rejects(createRunConfig(options, project), { code: 'EEXIST' });
  await assert.rejects(createRunConfig({ ...options, output: join(project, 'inside') }, project), /outside/);
  await assert.rejects(createRunConfig({ ...options, output: join(source, 'inside') }, project), /outside/);
});

test('ambient QQ binding and injected Node options cannot leak into the isolated Host', () => {
  const config = { node: '/runtime/node', home: '/run/home', dataDir: '/run/data', fixtureOrigin: 'http://127.0.0.1:4567' };
  const env = buildHostEnvironment(config, { PATH: '/bin', DSH_HOME: '/daily', QQBOT_APPID: 'real-app',
    QQBOT_SECRET: 'real-secret', QQBOT_DATA_DIR: '/real', QQBOT_BASE_URL: 'https://real.invalid',
    QQBOT_EXTRA: 'ambient', NODE_OPTIONS: '--import ambient', MODEL_KEY: 'kept-only-in-environment' });
  assert.equal(env.DSH_HOME, config.home); assert.equal(env.QQBOT_DATA_DIR, config.dataDir);
  assert.equal(env.QQBOT_APPID, '0000000000'); assert.equal(env.QQBOT_SECRET, 'local-fixture-only');
  assert.equal(env.QQBOT_BASE_URL, config.fixtureOrigin); assert.equal(env.QQBOT_TOKEN_BASE_URL, config.fixtureOrigin);
  assert.equal(env.MODEL_KEY, 'kept-only-in-environment');
  assert.equal(env.QQBOT_EXTRA, undefined); assert.equal(env.NODE_OPTIONS, undefined);
});

test('model rows replace full profile rows and preserve YAML expression tags without evaluation', () => {
  const existing = '- id: unrelated\n  config: {keep: true}\n- id: llm-pi-ai\n  config: {old: true}\n';
  const model = '- id: llm-pi-ai\n  name: provider-package\n  config:\n    providers: {p: {apiKeyEnv: MODEL_KEY}}\n    expression: !!js process.env.MODEL_KEY\n- id: agent-default-model\n  config: {provider: p, model: a}\n';
  const output = mergeProfilePatch(existing, model, dummyQQConfig({ workspace: '/run/workspace' }));
  assert.match(output, /!!js process.env.MODEL_KEY/);
  const values = YAML.parse(output, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] });
  assert.equal(values.find(row => row.id === 'unrelated').config.keep, true);
  const provider = values.find(row => row.id === 'llm-pi-ai');
  assert.equal(provider.config.old, undefined); assert.equal(provider.config.providers.p.apiKeyEnv, 'MODEL_KEY');
  const qq = values.find(row => row.id === 'im-qqbot').config;
  assert.equal(qq.appId, '0000000000'); assert.equal(qq.cwd, '/run/workspace');
  assert.throws(() => mergeProfilePatch('[]', '- id: im-qqbot\n  config: {appId: real}', qq), /model-only/);
  assert.throws(() => mergeProfilePatch('[]', 'not: a-list', qq), /entry lists/);
});

test('catalog validation proves registered models, first-model parity and reasoning defaults', () => {
  const config = { primary: { provider: 'p', model: 'a', reasoningEffort: 'high' }, secondary: { provider: 'p', model: 'b' } };
  const catalog = { default: config.primary, groups: [{ id: 'p', models: [{ id: 'a' }, { id: 'b' }] }], failures: [] };
  assert.doesNotThrow(() => validateCatalog(catalog, config));
  assert.throws(() => validateCatalog({ ...catalog, groups: [] }, config), /first live model/);
  assert.throws(() => validateCatalog({ ...catalog, default: { provider: 'p', model: 'a' } }, config), /reasoningEffort/);
  assert.throws(() => validateCatalog({ ...catalog, failures: [{}] }, config), /provider failures/);
});

test('owned child stdin stays open, log is private, and cleanup closes only that child', async t => {
  const root = await temporary(t); const logPath = join(root, 'child.log');
  const owned = await spawnLogged(process.execPath, ['-e',
    'process.stdin.on("end",()=>process.exit(7));process.stdin.resume();console.log("ready");setInterval(()=>{},1000)'],
  { cwd: root, env: process.env, logPath });
  t.after(() => owned.stop());
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(owned.settled, false);
  assert.match(await readFile(logPath, 'utf8'), /ready/);
  if (process.platform !== 'win32') assert.equal((await stat(logPath)).mode & 0o777, 0o600);
  const port = await availablePort(); assert.ok(port > 0 && port <= 65535);
  await owned.stop(); await owned.stop();
  assert.equal(owned.settled, true);
  assert.throws(() => process.kill(owned.child.pid, 0), { code: 'ESRCH' });
});

test('failed and timed-out setup children return bounded failures without leaking child logs', async t => {
  const root = await temporary(t); const logPath = join(root, 'failure.log');
  await assert.rejects(runLogged(process.execPath, ['-e', 'console.error("never-inline-this-private-log");process.exit(2)'],
    { cwd: root, env: process.env, logPath }), error => /failed \(2\)/.test(error.message) && !error.message.includes('never-inline'));
  const before = Date.now();
  await assert.rejects(runLogged(process.execPath, ['-e', 'setInterval(()=>{},1000)'],
    { cwd: root, env: process.env, logPath }, { timeoutMs: 100 }), /timed out/);
  assert.ok(Date.now() - before < 3000);
  await assert.rejects(runLogged(join(root, 'missing-command'), [], { cwd: root, env: process.env, logPath }), /failed \(spawn\)/);
});

test('startup authentication keeps cookies across a local redirect before validating live RPC data', async t => {
  const root = await temporary(t);
  const config = { primary: { provider: 'p', model: 'a', reasoningEffort: 'high' }, secondary: { provider: 'p', model: 'b' },
    hostLog: join(root, 'host.log') };
  let authenticatedRequests = 0;
  const server = createServer(async (request, response) => {
    if (request.url === '/?token=private-test-token') {
      response.writeHead(302, { location: '/', 'set-cookie': 'test-auth=private-cookie; HttpOnly; Path=/' }); response.end(); return;
    }
    if (request.headers.cookie !== 'test-auth=private-cookie') { response.writeHead(401); response.end(); return; }
    authenticatedRequests += 1;
    if (request.url === '/') { response.writeHead(200); response.end('Authenticated'); return; }
    response.setHeader('content-type', 'application/json');
    if (request.url === '/qqbot/im-qqbot/config') response.end(JSON.stringify({ config: { appId: '0000000000' } }));
    else if (request.url === '/qqbot/im-qqbot/runtime') response.end(JSON.stringify({ phase: 'ready' }));
    else if (request.url === '/api/session/modelCatalog') {
      let body = ''; for await (const chunk of request) body += chunk;
      assert.equal(JSON.parse(body).method, 'session/modelCatalog');
      response.end(JSON.stringify({ result: { ok: true, value: { default: config.primary,
        groups: [{ id: 'p', models: [{ id: 'a' }, { id: 'b' }] }], failures: [] } } }));
    } else { response.writeHead(404); response.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  config.hostOrigin = `http://127.0.0.1:${server.address().port}`;
  await writeFile(config.hostLog, config.hostOrigin + '/?token=private-test-token\n');
  const result = await waitForHost(config, { settled: false }, { timeoutMs: 1000 });
  assert.equal(result.runtime.phase, 'ready'); assert.equal(result.catalog.groups[0].models.length, 2);
  assert.equal(authenticatedRequests, 4);
});
