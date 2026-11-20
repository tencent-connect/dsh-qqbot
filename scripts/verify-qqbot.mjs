#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertNodeVersion, HELP, parseArgs, runHostVerification } from '../tests/e2e/host.mjs';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(HELP); return; }
  assertNodeVersion();
  if (options.mode === 'fixture') {
    const tests = ['fixture.node.mjs', 'host.node.mjs'].map(name => fileURLToPath(new URL('../tests/e2e/' + name, import.meta.url)));
    const child = spawn(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
    process.exitCode = await new Promise(resolve => {
      child.once('error', () => resolve(1));
      child.once('exit', code => resolve(code ?? 1));
    });
    if (process.exitCode === 0) {
      const python = spawn(options.python, ['-m', 'unittest', 'discover', '-s', 'tests/e2e', '-p', 'test_*.py'], {
        cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit',
      });
      process.exitCode = await new Promise(resolve => {
        python.once('error', () => { process.stderr.write('Python 3.10+ is required for helper tests.\n'); resolve(1); });
        python.once('exit', code => resolve(code ?? 1));
      });
    }
    return;
  }
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error('Verification interrupted.'));
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try { process.stdout.write(JSON.stringify(await runHostVerification(options, { signal: controller.signal })) + '\n'); }
  finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
}

main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
