import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const index = process.argv.indexOf('--host');
if (index < 0 || !process.argv[index + 1]) throw new Error('Usage: node scripts/link-stock-host.mjs --host /absolute/path/to/unmodified/deepseek-harness');
const host = resolve(process.argv[index + 1]);
const state = spawnSync('git', ['diff', '--quiet', 'HEAD'], { cwd: host });
if (state.status !== 0) throw new Error('The Host has tracked changes. Use an unmodified checkout.');
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
for (const [name, value] of Object.entries(pkg.devDependencies)) {
  if (!value.startsWith('link:') || !value.includes('deepseek-harness/')) continue;
  const suffix = value.slice(value.indexOf('deepseek-harness/') + 'deepseek-harness/'.length);
  await access(join(host, suffix, 'package.json'));
  pkg.devDependencies[name] = `link:${relative(root, join(host, suffix)).replaceAll('\\', '/')}`;
}
await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log('Updated plugin development links. The Host was not modified.');
