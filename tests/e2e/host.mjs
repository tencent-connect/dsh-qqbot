import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { open, mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));
const YAML = require('yaml');

export const HELP = `Usage: node scripts/verify-qqbot.mjs [options]

Without options, run offline QQ fixture and lifecycle tests. No DSH Host, model,
credentials or real QQ account is used.

Host mode (uses the existing plugin build; never rebuilds DSH or the plugin):
  --mode host
  --dsh-source /absolute/path/to/deepseek-harness
  --model-patch /absolute/path/to/model-only.patch.yml
  --primary provider/model             expected Host default; first provider model
  --secondary provider/other-model     selection-only alternative
  --reasoning high                     optional expected primary reasoning effort
  --allow-model-requests               opt in to primary-model generation tests
  --preset-primary standard            default: standard
  --preset-secondary minimal           default: minimal
  --host-port 0                        default: automatically allocated
  --fixture-port 0                     default: automatically allocated
  --output /absolute/new/directory      default: new OS temporary directory
  --python python3                     Python 3.10+ executable

The model patch must configure providers and agent-default-model. Credentials are
read only from the launch environment; no daily DSH home or credential store is
copied. Host state, QQ preferences, workspace, logs and reports stay in the new run
directory. Only synthetic QQ peers are accepted. Omit --allow-model-requests for
command-only tests; history, compaction, cancellation and cold replay are then
reported as skipped. The secondary model is never used for generation.
`;

export function assertNodeVersion(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (!((major === 22 && minor >= 19) || major >= 24)) {
    throw new Error('Use Node 22.19+ or Node 24+; Node 23 is not supported by the DSH source launcher.');
  }
}

export function parseRoute(value) {
  const boundary = value?.indexOf('/') ?? -1;
  if (boundary < 1 || boundary === value.length - 1 || /\s/.test(value)) {
    throw new Error('Model routes must use provider/model with no whitespace.');
  }
  return { provider: value.slice(0, boundary), model: value.slice(boundary + 1) };
}

export function parseArgs(argv) {
  const options = { mode: 'fixture', hostPort: 0, fixturePort: 0, python: 'python3',
    presetPrimary: 'standard', presetSecondary: 'minimal', allowModelRequests: false };
  const names = new Map([
    ['--mode', 'mode'], ['--dsh-source', 'dshSource'], ['--model-patch', 'modelPatch'],
    ['--primary', 'primary'], ['--secondary', 'secondary'], ['--reasoning', 'reasoning'],
    ['--preset-primary', 'presetPrimary'], ['--preset-secondary', 'presetSecondary'],
    ['--host-port', 'hostPort'], ['--fixture-port', 'fixturePort'], ['--output', 'output'], ['--python', 'python'],
  ]);
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (seen.has(key)) throw new Error(`Duplicate option ${key}`);
    seen.add(key);
    if (key === '--help' || key === '-h') options.help = true;
    else if (key === '--allow-model-requests') options.allowModelRequests = true;
    else {
      const property = names.get(key);
      if (!property) throw new Error(`Unknown option ${key}`);
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
      options[property] = value;
    }
  }
  if (options.help) return options;
  if (!['fixture', 'host'].includes(options.mode)) throw new Error('--mode must be fixture or host.');
  for (const key of ['hostPort', 'fixturePort']) {
    options[key] = Number(options[key]);
    if (!Number.isInteger(options[key]) || options[key] < 0 || options[key] > 65535) throw new Error(`Invalid ${key}.`);
  }
  if (options.hostPort && options.hostPort === options.fixturePort) throw new Error('Host and QQ fixture need separate ports.');
  if (options.mode === 'host') {
    for (const key of ['dshSource', 'modelPatch', 'primary', 'secondary']) {
      if (!options[key]) throw new Error(`Host mode requires --${key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())}.`);
    }
    for (const key of ['dshSource', 'modelPatch', 'output']) {
      if (options[key] && !isAbsolute(options[key])) throw new Error(`${key} must be an absolute path.`);
    }
    options.primary = parseRoute(options.primary);
    options.secondary = parseRoute(options.secondary);
    if (options.primary.provider === options.secondary.provider && options.primary.model === options.secondary.model) {
      throw new Error('Primary and secondary must be different model routes.');
    }
    if (options.reasoning !== undefined) {
      if (!/^[a-z][a-z0-9_-]*$/.test(options.reasoning)) throw new Error('Invalid reasoning effort.');
      options.primary.reasoningEffort = options.reasoning;
    }
    for (const key of ['presetPrimary', 'presetSecondary']) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(options[key])) throw new Error(`Invalid ${key}.`);
    }
    if (options.presetPrimary === options.presetSecondary) throw new Error('Primary and secondary presets must differ.');
  } else if ([...seen].some(key => !['--mode', '--python'].includes(key))) {
    throw new Error('Host options require --mode host. Use --help for examples.');
  }
  return options;
}

function isWithin(path, root) {
  const value = relative(root, path);
  return value === '' || (!value.startsWith('..' + sep) && value !== '..' && !isAbsolute(value));
}

export async function writePrivateJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

export async function createRunConfig(options, projectRoot = pluginRoot) {
  const source = await realpath(options.dshSource);
  const modelPatch = await realpath(options.modelPatch);
  const project = await realpath(projectRoot);
  await stat(join(source, 'apps/cli/src/bin.ts'));
  if (!(await stat(modelPatch)).isFile()) throw new Error('The model patch must be a file.');
  let runDir;
  if (options.output) {
    const parent = await realpath(dirname(options.output));
    const output = join(parent, basename(options.output));
    if (isWithin(output, project) || isWithin(output, source)) throw new Error('Test output must be outside both source repositories.');
    await mkdir(output, { mode: 0o700 });
    runDir = await realpath(output);
  } else runDir = await realpath(await mkdtemp(join(tmpdir(), 'dsh-qqbot-e2e-')));
  const config = {
    version: 1, runDir, home: join(runDir, 'home'), profile: 'qqbot-e2e',
    workspace: join(runDir, 'workspace'), dataDir: join(runDir, 'data'),
    hostOrigin: '', fixtureOrigin: '', hostLog: join(runDir, 'host.log'), fixtureLog: join(runDir, 'fixture.log'),
    fixtureStatus: join(runDir, 'fixture-status.json'), pluginRoot: project, dshSource: source,
    primary: options.primary, secondary: options.secondary,
    presets: { primary: options.presetPrimary, secondary: options.presetSecondary },
    node: process.execPath, allowModelRequests: options.allowModelRequests, modelPatch,
  };
  for (const path of [config.home, config.workspace, config.dataDir]) await mkdir(path, { mode: 0o700 });
  return config;
}

export function buildHostEnvironment(config, inherited = process.env) {
  const env = { ...inherited };
  for (const name of Object.keys(env)) {
    if (name.startsWith('QQBOT_') || name === 'NODE_OPTIONS') delete env[name];
  }
  return { ...env, PATH: dirname(config.node) + (process.platform === 'win32' ? ';' : ':') + (env.PATH ?? ''),
    DSH_HOME: config.home, QQBOT_DATA_DIR: config.dataDir, QQBOT_APPID: '0000000000',
    QQBOT_SECRET: 'local-fixture-only', QQBOT_BASE_URL: config.fixtureOrigin, QQBOT_TOKEN_BASE_URL: config.fixtureOrigin,
    COREPACK_ENABLE_AUTO_PIN: '0' };
}

export async function availablePort(requested = 0) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(requested, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function withTimeout(promise, milliseconds, timeoutValue) {
  let timer;
  try {
    return await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(timeoutValue), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

export async function spawnLogged(command, args, { cwd, env, logPath }) {
  const log = await open(logPath, 'a', 0o600);
  let child;
  try {
    child = spawn(command, args, { cwd, env, detached: process.platform !== 'win32', stdio: ['pipe', log.fd, log.fd] });
  } catch (error) { await log.close(); throw error; }
  child.stdin.on('error', () => {});
  let settled = false;
  const exit = new Promise(resolve => {
    child.once('error', () => { settled = true; resolve({ code: null, signal: null, spawnError: true }); });
    child.once('exit', (code, signal) => { settled = true; resolve({ code, signal }); });
  });
  await log.close();
  return { child, exit, get settled() { return settled; }, async stop() {
    if (settled) return;
    if (child.pid === undefined) { await exit; return; }
    const send = signal => {
      try {
        if (process.platform === 'win32') child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    send('SIGTERM');
    if (await withTimeout(exit.then(() => true), 5000, false)) return;
    send('SIGKILL');
    await exit;
  } };
}

export async function runLogged(command, args, options, { timeoutMs = 180_000, signal } = {}) {
  signal?.throwIfAborted();
  const owned = await spawnLogged(command, args, options);
  const abort = () => { void owned.stop(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw new Error('Verification interrupted.');
    const result = await withTimeout(owned.exit, timeoutMs, { timeout: true });
    if (signal?.aborted) throw new Error('Verification interrupted.');
    if (result.timeout) throw new Error(`Child process timed out; private log: ${options.logPath}`);
    if (result.code !== 0) throw new Error(`Child process failed (${result.code ?? result.signal ?? 'spawn'}); private log: ${options.logPath}`);
  } finally {
    signal?.removeEventListener('abort', abort);
    await owned.stop();
  }
}

export function dummyQQConfig(config) {
  return {
    appId: '0000000000', appSecret: 'local-fixture-only', cwd: config.workspace,
    provider: '', model: '', preset: '', requireMention: true, streaming: false,
    showToolResults: false, debug: false,
    access: { c2cMode: 'allowlist', c2cAllow: ['local-fixture-allowed-user'],
      groupMode: 'allowlist', groupAllow: ['local-fixture-allowed-group'] },
    media: { enabled: false, maxMB: 1, ttlHours: 0 }, vision: { enabled: false },
    sendFile: { restrictPaths: true, extraRoots: [], sendPresentedFiles: false, maxFiles: 1 },
  };
}

const tags = [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }];

export function mergeProfilePatch(existing, modelPatch, qqConfig) {
  const profile = YAML.parseDocument(existing || '[]', { customTags: tags });
  const models = YAML.parseDocument(modelPatch, { customTags: tags });
  if (profile.errors.length || models.errors.length || !YAML.isSeq(profile.contents) || !YAML.isSeq(models.contents)) {
    throw new Error('Profile and model patches must be valid YAML entry lists.');
  }
  const rows = profile.contents;
  const replace = row => {
    const id = row.get('id');
    if (typeof id !== 'string' || !id) throw new Error('Every model patch row needs an id.');
    const index = rows.items.findIndex(item => YAML.isMap(item) && item.get('id') === id);
    if (index < 0) rows.add(row); else rows.items[index] = row;
  };
  for (const row of models.contents.items) {
    if (!YAML.isMap(row)) throw new Error('Every model patch row must be an object.');
    if (row.get('id') === 'im-qqbot' || String(row.get('name') ?? '').includes('dsh-qqbot')) {
      throw new Error('Supply a model-only patch, without QQ binding rows.');
    }
    replace(row.clone());
  }
  replace(profile.createNode({ id: 'im-qqbot', config: qqConfig }));
  return profile.toString();
}

export async function prepareProfile(config, { signal } = {}) {
  const env = buildHostEnvironment(config);
  const cli = ['--import', 'tsx/esm', 'apps/cli/src/bin.ts'];
  const options = { cwd: config.dshSource, env, logPath: join(config.runDir, 'install.log') };
  await runLogged(config.node, [...cli, '--profile', config.profile, '--from-default-profile', 'web', '--dump-config'], options, { signal });
  await runLogged(config.node, [...cli, 'plugin', '--profile', config.profile, 'add', `link:${config.pluginRoot}`], options, { signal });
  const profileDir = join(config.home, 'profiles', config.profile);
  const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'));
  const plugin = JSON.parse(await readFile(join(config.pluginRoot, 'package.json'), 'utf8'));
  if (manifest.dependencies?.[plugin.name] !== `link:${config.pluginRoot}` || !manifest.dsh?.profile?.bundles?.includes(plugin.name)) {
    throw new Error('Supported plugin installation did not add the dependency and bundle to the isolated profile.');
  }
  const path = join(profileDir, 'cordis.patch.yml');
  const existing = await readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return '[]'; throw error; });
  const modelPatch = await readFile(config.modelPatch, 'utf8');
  await writeFile(path, mergeProfilePatch(existing, modelPatch, dummyQQConfig(config)), { mode: 0o600 });
}

export function validateCatalog(catalog, config) {
  const group = catalog.groups?.find(group => group.id === config.primary.provider);
  if (!group?.models?.length || group.models[0].id !== config.primary.model) throw new Error('The primary route must be the provider\'s first live model.');
  const alternate = catalog.groups?.find(group => group.id === config.secondary.provider);
  if (!alternate?.models?.some(model => model.id === config.secondary.model)) throw new Error('The secondary model is not in the live Host catalog.');
  for (const field of ['provider', 'model', 'reasoningEffort']) {
    if (config.primary[field] !== undefined && catalog.default?.[field] !== config.primary[field]) {
      throw new Error(`Live Host default does not match the expected primary ${field}.`);
    }
  }
  if (catalog.failures?.length) throw new Error('The live Host model catalog reports provider failures.');
}

async function hostClient(config) {
  const log = await readFile(config.hostLog, 'utf8');
  const prefix = config.hostOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...log.matchAll(new RegExp(prefix + '/\\?token=[A-Za-z0-9._~%+-]+', 'g'))];
  if (!matches.length) throw new Error('Startup authentication is not ready.');
  const cookies = new Map();
  let url = matches.at(-1)[0];
  for (let index = 0; index < 5; index += 1) {
    if (new URL(url).origin !== config.hostOrigin) throw new Error('Refusing cross-origin Host authentication redirect.');
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000),
      headers: { cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') } });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';'); const equal = pair.indexOf('=');
      cookies.set(pair.slice(0, equal), pair.slice(equal + 1));
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      url = new URL(response.headers.get('location'), url).href;
      await response.body?.cancel();
    } else {
      await response.body?.cancel();
      if (!response.ok) throw new Error('Host startup authentication failed.');
      break;
    }
  }
  const cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
  const request = async (path, data) => {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Host requests must use relative API paths.');
    const response = await fetch(config.hostOrigin + path, { method: data === undefined ? 'GET' : 'POST',
      headers: { cookie, 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!response.ok) throw new Error(`Host ${path.split('?')[0]} returned HTTP ${response.status}.`);
    return response.json();
  };
  return { get: path => request(path), rpc: async (method, args = {}) => {
    const value = await request('/api/' + method, { type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } });
    if (!value.result?.ok) throw new Error(`Host RPC ${method} failed.`);
    return value.result.value;
  } };
}

export async function waitForHost(config, owned, { timeoutMs = 90_000, signal } = {}) {
  const deadline = Date.now() + timeoutMs;
  let client;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (owned.settled) throw new Error(`Isolated Host exited before readiness; private log: ${config.hostLog}`);
    try {
      client ??= await hostClient(config);
      const current = await client.get('/qqbot/im-qqbot/config');
      if (current.config?.appId !== '0000000000') throw new Error('NON_DUMMY_BINDING');
      const runtime = await client.get('/qqbot/im-qqbot/runtime');
      if (runtime.phase === 'ready') {
        const catalog = await client.rpc('session/modelCatalog');
        validateCatalog(catalog, config);
        return { client, catalog, runtime };
      }
    } catch (error) {
      if (error.message === 'NON_DUMMY_BINDING') throw new Error('Refusing a non-dummy QQ binding.');
      if (client && !/HTTP 404/.test(error.message)) throw error;
    }
    await delay(250);
  }
  throw new Error(`Isolated Host did not become ready; private log: ${config.hostLog}`);
}

export async function runHostVerification(options, { signal } = {}) {
  const config = await createRunConfig(options);
  const configPath = join(config.runDir, 'run.json');
  const reportPath = join(config.runDir, 'verification.json');
  let fixture, host, passed = false, failure;
  try {
    const { createQQFixture } = await import('./qq-fixture.mjs');
    fixture = await createQQFixture({ port: options.fixturePort, statusFile: config.fixtureStatus,
      primary: config.primary, secondary: config.secondary, presets: config.presets, allowModelRequests: config.allowModelRequests });
    config.fixtureOrigin = fixture.origin;
    const port = await availablePort(options.hostPort);
    if (port === fixture.port) throw new Error('Host and QQ fixture ports collided.');
    config.hostOrigin = `http://127.0.0.1:${port}`;
    await writePrivateJson(configPath, config);
    await runLogged(options.python, ['-c', 'import sys; assert sys.version_info >= (3,10), "Python 3.10+ required"'],
      { cwd: config.pluginRoot, env: buildHostEnvironment(config), logPath: join(config.runDir, 'python.log') }, { signal, timeoutMs: 10_000 });
    await prepareProfile(config, { signal });
    host = await spawnLogged(config.node, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', config.profile,
      '--port', String(port), '--no-open'], { cwd: config.dshSource, env: buildHostEnvironment(config), logPath: config.hostLog });
    await writePrivateJson(join(config.runDir, 'process.json'), { pid: host.child.pid, cwd: config.dshSource,
      home: config.home, profile: config.profile, hostOrigin: config.hostOrigin });
    await waitForHost(config, host, { signal });
    await runLogged(options.python, [join(config.pluginRoot, 'tests/e2e/command_matrix.py'), '--config', configPath],
      { cwd: config.pluginRoot, env: buildHostEnvironment(config), logPath: join(config.runDir, 'matrix.log') }, { signal, timeoutMs: 360_000 });
    const matrix = JSON.parse(await readFile(join(config.runDir, 'command-report.json'), 'utf8'));
    if (!matrix.passed) throw new Error('The command matrix did not report success.');
    passed = true;
  } catch (error) {
    failure = signal?.aborted ? 'Verification interrupted.' : error.message;
  } finally {
    const closed = await Promise.allSettled([host?.stop(), fixture?.close()]);
    if (closed.some(result => result.status === 'rejected')) {
      passed = false;
      failure = 'Owned test resources did not close cleanly.';
    }
    await writePrivateJson(reportPath, { passed, failure, mode: 'host', modelRequestsEnabled: config.allowModelRequests,
      config: 'run.json', matrix: 'command-report.json', homeRetained: true, ownedHostStopped: !host || host.settled,
      fixtureClosed: closed[1].status === 'fulfilled', completedAt: new Date().toISOString() });
  }
  if (!passed) throw new Error(`${failure} Report: ${reportPath}`);
  return { passed, mode: 'host', runDir: config.runDir, report: reportPath, matrix: join(config.runDir, 'command-report.json') };
}
