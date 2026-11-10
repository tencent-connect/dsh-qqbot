import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const formalDir = fileURLToPath(new URL('../tests/formal/', import.meta.url));
const deliveryDir = join(formalDir, 'qq-delivery');
const pairingDir = join(formalDir, 'qq-pairing');
const jarSha256 = '936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88';
const usage = 'Usage: TLA2TOOLS=/path/to/tla2tools.jar pnpm verify:formal [--ledger-loss]\n'
  + 'Requires the TLC 1.7.4 release JAR and Java on PATH (or set JAVA). See TESTING.md.';

function runTlc(jar, { cwd, module, config, metadir, expectedInvariant }) {
  const result = spawnSync(process.env.JAVA || 'java', [
    '-jar', jar, '-workers', '1', '-fp', '0', '-metadir', metadir,
    '-config', config, `${module}.tla`,
  ], { cwd, encoding: 'utf8', timeout: 60_000 });
  if (result.error) throw result.error;
  const out = result.stdout;
  const name = `${module}/${config}`;
  const ok = expectedInvariant
    ? result.status === 12 && out.split(/\r?\n/).includes(`Error: Invariant ${expectedInvariant} is violated.`)
    : result.status === 0 && out.includes('Model checking completed. No error has been found.');
  if (!ok) {
    throw new Error(`${name}: unexpected TLC result (exit ${result.status ?? result.signal}).\n${out}${result.stderr}`);
  }
  if (expectedInvariant) {
    console.log(`${name}: caught ${expectedInvariant}`);
    for (const line of out.split(/\r?\n/).filter(line => /^State \d+:/.test(line))) console.log(line);
  } else {
    const count = out.match(/\d+ distinct states found/);
    console.log(`${name}: all invariants held${count ? ` (${count[0]})` : ''}.`);
  }
}

function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    return;
  }
  const replayLedgerLoss = args.length === 1 && args[0] === '--ledger-loss';
  if (args.length && !replayLedgerLoss) throw new Error(usage);
  if (!process.env.TLA2TOOLS) throw new Error(usage);
  const jar = resolve(process.env.TLA2TOOLS);
  if (createHash('sha256').update(readFileSync(jar)).digest('hex') !== jarSha256) {
    throw new Error('TLA2TOOLS does not match the TLC 1.7.4 release JAR. See TESTING.md.');
  }

  const dir = mkdtempSync(join(tmpdir(), 'qqbot-tlc-'));
  try {
    const delivery = { cwd: deliveryDir, module: 'QqManualSend' };
    const pairing = { cwd: pairingDir, module: 'QqPairing' };
    runTlc(jar, { ...delivery, config: 'normal.cfg', metadir: join(dir, 'delivery-normal') });
    runTlc(jar, {
      ...delivery, config: 'no-post-check.cfg', metadir: join(dir, 'no-post-check'),
      expectedInvariant: 'OnlyAuthorizedPost',
    });
    runTlc(jar, {
      ...delivery, config: 'ledger-loss.cfg', metadir: join(dir, 'ledger-loss'),
      expectedInvariant: 'OnePostPerOperation',
    });
    runTlc(jar, { ...pairing, config: 'normal.cfg', metadir: join(dir, 'pairing-normal') });
    runTlc(jar, {
      ...pairing, config: 'forget-fence.cfg', metadir: join(dir, 'forget-fence'),
      expectedInvariant: 'NoOldCodeReadmission',
    });
    if (replayLedgerLoss) {
      const replay = spawnSync(process.execPath, [join(deliveryDir, 'replay-ledger-loss.mjs')], {
        stdio: 'inherit', timeout: 30_000,
      });
      if (replay.error) throw replay.error;
      if (replay.status !== 0) {
        throw new Error('Ledger-loss replay failed. Rebuild the plugin and inspect the replay output.');
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
