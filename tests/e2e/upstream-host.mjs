import { mkdir, realpath, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, parse, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { assertNodeVersion, availablePort, buildHostEnvironment, parseRoute, spawnLogged, waitForHost, writePrivateJson } from './host.mjs';
import { createQQFixture } from './qq-fixture.mjs';

export const DEPLOYMENT = Object.freeze({
  home: join(homedir(), '.local', 'share', 'dsh-qqbot-command-test'),
  profile: 'qqbot-commands', hostPort: 3194, fixturePort: 3195,
});

const HELP = `Usage: node tests/e2e/upstream-host.mjs
  --dsh-source /absolute/stock/deepseek-harness
  --plugin-root /absolute/dsh-qqbot-upstream-compatible
  --home /absolute/isolated/test-home --profile ${DEPLOYMENT.profile}
  --workspace /absolute/existing/workspace --data-dir /absolute/existing/plugin-data
  --primary provider/model --secondary provider/other-model
  [--reasoning high] [--preset-primary standard] [--preset-secondary minimal]
  [--output /absolute/new/directory/under/test-home/evidence]
  [--allow-model-requests]

Reuse the already installed profile and already built stock Host artifacts.
This command never installs packages, creates a Home, rewrites configuration,
or builds either repository. It owns only the Host and synthetic QQ fixture it
starts on 3194 and 3195. Keep stdin open. Send one JSON object per line with
action status, restart, or stop. EOF and SIGINT/SIGTERM stop owned resources.
Detailed logs, startup authentication, and run.json stay private in evidence.
Model requests are disabled unless explicitly enabled.
Set QQBOT_TEST_HOME in both runner and Python helper environments to register a
different isolated Home. Without it, --home must be ${DEPLOYMENT.home}.
Daily DSH_HOME, ~/.dsh, personal Home, and filesystem root are rejected.
`;

function canonical(path) {
  try { return realpathSync(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return resolve(path); }
}

export function testHome(env = process.env) {
  const home = env.QQBOT_TEST_HOME ?? DEPLOYMENT.home;
  if (typeof home !== 'string' || !isAbsolute(home) || resolve(home) !== home || canonical(home) !== home) {
    throw new Error('QQBOT_TEST_HOME must name an absolute canonical isolated Home');
  }
  if (home === parse(home).root || home === canonical(homedir())) throw new Error('An isolated test Home is required');
  for (const daily of [join(homedir(), '.dsh'), env.DSH_HOME].filter(Boolean).map(canonical)) {
    if (home === daily || inside(home, daily) || inside(daily, home)) throw new Error('Daily DSH Home cannot be used for tests');
  }
  return home;
}

export function parseArgs(argv, env = process.env) {
  const options = { allowModelRequests: false, presetPrimary: 'standard', presetSecondary: 'minimal' };
  const names = new Map(['dsh-source', 'plugin-root', 'home', 'profile', 'workspace', 'data-dir',
    'primary', 'secondary', 'reasoning', 'preset-primary', 'preset-secondary', 'output']
    .map(name => [`--${name}`, name.replace(/-([a-z])/gu, (_all, next) => next.toUpperCase())]));
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (seen.has(key)) throw new Error('Duplicate runner option');
    seen.add(key);
    if (key === '--help' || key === '-h') options.help = true;
    else if (key === '--allow-model-requests') options.allowModelRequests = true;
    else {
      const name = names.get(key);
      if (!name || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('Unknown or incomplete runner option');
      options[name] = argv[++index];
    }
  }
  if (options.help) return options;
  for (const key of ['dshSource', 'pluginRoot', 'home', 'profile', 'workspace', 'dataDir', 'primary', 'secondary']) {
    if (!options[key]) throw new Error(`Explicit --${key.replace(/[A-Z]/gu, char => '-' + char.toLowerCase())} is required`);
  }
  if (options.home !== testHome(env) || options.profile !== DEPLOYMENT.profile) throw new Error('Only the configured isolated qqbot-commands deployment is allowed');
  for (const key of ['dshSource', 'pluginRoot', 'home', 'workspace', 'dataDir', 'output']) {
    if (options[key] !== undefined && !isAbsolute(options[key])) throw new Error('Runner paths must be absolute');
  }
  options.primary = parseRoute(options.primary);
  options.secondary = parseRoute(options.secondary);
  if (options.reasoning !== undefined) {
    if (!/^[a-z][a-z0-9_-]{0,80}$/u.test(options.reasoning)) throw new Error('Invalid reasoning effort');
    options.primary.reasoningEffort = options.reasoning;
  }
  for (const key of ['presetPrimary', 'presetSecondary']) {
    if (!/^[a-zA-Z0-9_.-]{1,100}$/u.test(options[key])) throw new Error('Invalid preset ID');
  }
  return options;
}

function inside(path, root) {
  const rest = relative(root, path);
  return rest !== '' && rest !== '..' && !rest.startsWith('../') && !isAbsolute(rest);
}

export async function createConfig(options, env = process.env) {
  assertNodeVersion();
  const paths = {};
  for (const key of ['dshSource', 'pluginRoot', 'home', 'workspace', 'dataDir']) {
    paths[key] = await realpath(options[key]);
    if (!(await stat(paths[key])).isDirectory()) throw new Error('Runner paths must name existing directories');
  }
  if (paths.home !== testHome(env) || options.home !== paths.home || options.profile !== DEPLOYMENT.profile
      || !inside(paths.dataDir, paths.home)) throw new Error('The configured isolated Home must own plugin data');
  await stat(join(paths.dshSource, 'apps/cli/src/bin.ts'));
  await stat(join(paths.dshSource, 'packages/api/session-controller/lib/index.js'));
  await stat(join(paths.pluginRoot, 'lib/index.js'));
  const profileDir = join(paths.home, 'profiles', options.profile);
  if (await realpath(profileDir) !== profileDir) throw new Error('The test profile must remain in the isolated Home');
  await stat(join(profileDir, 'package.json'));
  const evidence = await realpath(join(paths.home, 'evidence'));
  if (evidence !== join(paths.home, 'evidence')) throw new Error('Evidence must remain in the isolated Home');
  const runDir = options.output ?? join(evidence, `stock-runtime-${new Date().toISOString().replace(/[:.]/gu, '-')}`);
  if (!inside(runDir, evidence)) throw new Error('Output must remain inside the registered Home evidence directory');
  const parent = await realpath(join(runDir, '..'));
  if (parent !== evidence && !inside(parent, evidence)) throw new Error('Output parent must remain inside evidence');
  await mkdir(runDir, { mode: 0o700 });
  return {
    version: 2, kind: 'stock-qqbot-commands', ...paths, runDir: await realpath(runDir), profile: options.profile,
    hostOrigin: `http://127.0.0.1:${DEPLOYMENT.hostPort}`, fixtureOrigin: `http://127.0.0.1:${DEPLOYMENT.fixturePort}`,
    hostLog: join(runDir, 'host.log'), fixtureStatus: join(runDir, 'fixture-status.json'),
    node: process.execPath, primary: options.primary, secondary: options.secondary,
    presets: { primary: options.presetPrimary, secondary: options.presetSecondary },
    allowModelRequests: options.allowModelRequests,
  };
}

export async function run(config, input = process.stdin) {
  const configPath = join(config.runDir, 'run.json');
  await writePrivateJson(configPath, config);
  let fixture, host, stopping = false, readyCount = 0;
  const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
  async function saveProcess(state) {
    await writePrivateJson(join(config.runDir, 'process.json'), { state, hostPid: host?.child.pid ?? null,
      runnerPid: process.pid, home: config.home, profile: config.profile, hostOrigin: config.hostOrigin,
      fixtureOrigin: config.fixtureOrigin, config: configPath, updatedAt: new Date().toISOString() });
  }
  async function startHost() {
    host = await spawnLogged(config.node, ['--import', 'tsx/esm', 'apps/cli/src/bin.ts',
      '--profile', config.profile, '--port', String(DEPLOYMENT.hostPort), '--no-open'], {
      cwd: config.dshSource, env: buildHostEnvironment(config), logPath: config.hostLog,
    });
    await saveProcess('starting');
    await waitForHost(config, host);
    readyCount += 1;
    await saveProcess('ready');
    emit({ state: 'ready', config: configPath, hostPid: host.child.pid, generation: readyCount,
      modelRequestsEnabled: config.allowModelRequests });
  }
  async function stop() {
    if (stopping) return;
    stopping = true;
    const results = await Promise.allSettled([host?.stop(), fixture?.close()]);
    await saveProcess('stopped');
    if (results.some(result => result.status === 'rejected')) throw new Error('Owned resource cleanup failed');
  }
  const signals = ['SIGINT', 'SIGTERM'];
  const onSignal = () => { input.destroy(); };
  for (const signal of signals) process.once(signal, onSignal);
  try {
    await availablePort(DEPLOYMENT.hostPort);
    await availablePort(DEPLOYMENT.fixturePort);
    fixture = await createQQFixture({ port: DEPLOYMENT.fixturePort, statusFile: config.fixtureStatus,
      primary: config.primary, secondary: config.secondary, presets: config.presets,
      allowModelRequests: config.allowModelRequests });
    await startHost();
    for await (const line of createInterface({ input, crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      let command;
      try { command = JSON.parse(line); } catch { emit({ state: 'rejected', reason: 'Invalid runner control JSON' }); continue; }
      if (command?.action === 'stop') break;
      if (command?.action === 'status') emit({ state: host.settled ? 'exited' : 'ready', hostPid: host.child.pid,
        generation: readyCount, fixture: fixture.state });
      else if (command?.action === 'restart') { await host.stop(); await startHost(); }
      else emit({ state: 'rejected', reason: 'Only status, restart and stop are supported' });
    }
  } finally {
    for (const signal of signals) process.off(signal, onSignal);
    await stop();
  }
  emit({ state: 'stopped', config: configPath });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(HELP); return; }
  await run(await createConfig(options));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => { process.stderr.write('Stock runner failed. Inspect its private evidence logs.\n'); process.exitCode = 1; });
}
