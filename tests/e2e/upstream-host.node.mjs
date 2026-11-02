import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createConfig, DEPLOYMENT, parseArgs, testHome } from './upstream-host.mjs';

const runner = fileURLToPath(new URL('./upstream-host.mjs', import.meta.url));
const home = '/isolated-qqbot-test-home';
const environment = { QQBOT_TEST_HOME: home };
const required = ['--dsh-source', '/stock', '--plugin-root', '/plugin', '--home', home,
  '--profile', DEPLOYMENT.profile, '--workspace', '/workspace', '--data-dir', home + '/data',
  '--primary', 'provider/primary', '--secondary', 'provider/secondary'];

test('registered deployment defaults to fixture-only model authorization', () => {
  const options = parseArgs(required, environment);
  assert.equal(options.allowModelRequests, false);
  assert.deepEqual(options.primary, { provider: 'provider', model: 'primary' });
});

test('real model use requires an explicit runner flag', () => {
  const options = parseArgs([...required, '--allow-model-requests', '--reasoning', 'high'], environment);
  assert.equal(options.allowModelRequests, true);
  assert.equal(options.primary.reasoningEffort, 'high');
});

test('daily Home, other profiles and relative paths are rejected before startup', () => {
  for (const [name, value] of [['--home', join(homedir(), '.dsh')], ['--profile', 'web'], ['--workspace', '.']]) {
    const args = [...required];
    args[args.indexOf(name) + 1] = value;
    assert.throws(() => parseArgs(args, environment));
  }
});

test('portable default and environment registration select the same isolated Home boundary', () => {
  assert.equal(testHome({}), join(homedir(), '.local', 'share', 'dsh-qqbot-command-test'));
  assert.equal(testHome(environment), home);
  assert.throws(() => parseArgs(required, {}));
  for (const value of ['', '.', homedir(), parse(homedir()).root, join(homedir(), '.dsh'),
    join(homedir(), '.dsh', 'profiles', 'web'), home, home + '/profiles/web', '/']) {
    const env = { QQBOT_TEST_HOME: value, DSH_HOME: home };
    assert.throws(() => testHome(env));
  }
});

test('duplicate or unknown flags cannot override the deployment boundary', () => {
  assert.throws(() => parseArgs([...required, '--home', home], environment));
  assert.throws(() => parseArgs([...required, '--port', '3080'], environment));
  assert.throws(() => parseArgs([...required, '--host-origin', 'https://example.com'], environment));
  assert.throws(() => parseArgs([...required, '--reasoning', 'high with spaces'], environment));
});

async function deploymentFixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'qqbot-runner-boundary-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = { dshSource: join(root, 'stock'), pluginRoot: join(root, 'plugin'),
    home: join(root, 'test-home'), workspace: join(root, 'workspace'), dataDir: join(root, 'test-home', 'data'),
    profile: DEPLOYMENT.profile, primary: { provider: 'test', model: 'primary' },
    secondary: { provider: 'test', model: 'secondary' }, presetPrimary: 'standard', presetSecondary: 'minimal',
    allowModelRequests: false };
  for (const path of [options.workspace, options.dataDir, join(options.home, 'evidence'),
    join(options.home, 'profiles', options.profile), join(options.dshSource, 'apps/cli/src'),
    join(options.dshSource, 'packages/api/session-controller/lib'), join(options.pluginRoot, 'lib')]) {
    await mkdir(path, { recursive: true });
  }
  for (const path of [join(options.dshSource, 'apps/cli/src/bin.ts'),
    join(options.dshSource, 'packages/api/session-controller/lib/index.js'),
    join(options.pluginRoot, 'lib/index.js'), join(options.home, 'profiles', options.profile, 'package.json')]) {
    await writeFile(path, '');
  }
  return { root, options, env: { QQBOT_TEST_HOME: options.home } };
}

test('a configured temporary Home creates private evidence with bounded fixture endpoints', async t => {
  const { options, env } = await deploymentFixture(t);
  const config = await createConfig(options, env);
  assert.equal(config.home, options.home);
  assert.equal(config.dataDir, options.dataDir);
  assert.equal(config.hostOrigin, 'http://127.0.0.1:3194');
  assert.equal(config.fixtureOrigin, 'http://127.0.0.1:3195');
  assert.equal(config.allowModelRequests, false);
});

test('data outside the test Home, Home itself and symlink escapes are rejected', async t => {
  const { root, options, env } = await deploymentFixture(t);
  const outside = join(root, 'outside');
  const escape = join(options.home, 'data-link');
  await mkdir(outside);
  await symlink(outside, escape, 'dir');
  for (const dataDir of [outside, options.home, escape]) {
    await assert.rejects(createConfig({ ...options, dataDir }, env));
  }
});

test('symlinked Home and evidence cannot cross the configured isolation boundary', async t => {
  const { root, options, env } = await deploymentFixture(t);
  const alias = join(root, 'home-link');
  await symlink(options.home, alias, 'dir');
  await assert.rejects(createConfig({ ...options, home: alias }, { QQBOT_TEST_HOME: alias }));
  const outside = join(root, 'outside');
  await mkdir(outside);
  await rm(join(options.home, 'evidence'), { recursive: true });
  await symlink(outside, join(options.home, 'evidence'), 'dir');
  await assert.rejects(createConfig(options, env));
});

test('a test profile cannot link to a profile outside the isolated Home', async t => {
  const { root, options, env } = await deploymentFixture(t);
  const profile = join(options.home, 'profiles', options.profile);
  const outside = join(root, 'daily-profile');
  await mkdir(outside);
  await writeFile(join(outside, 'package.json'), '');
  await rm(profile, { recursive: true });
  await symlink(outside, profile, 'dir');
  await assert.rejects(createConfig(options, env));
});

test('help works with closed stdin without announcing a ready deployment', () => {
  const child = spawnSync(process.execPath, [runner, '--help'], { input: '', encoding: 'utf8' });
  assert.equal(child.status, 0);
  assert.match(child.stdout, /Keep stdin open/u);
  assert.doesNotMatch(child.stdout, /"state":"ready"/u);
});

test('missing launch arguments with closed stdin fail without a false ready result', () => {
  const child = spawnSync(process.execPath, [runner], { input: '', encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.doesNotMatch(child.stdout, /"state":"ready"|"passed":true/u);
  assert.doesNotMatch(child.stderr, /token=|Bearer|clientSecret/u);
});
