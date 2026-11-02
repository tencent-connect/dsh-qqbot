import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const at = process.argv.indexOf('--root');
const root = at < 0 ? process.cwd() : resolve(process.argv[at + 1]);
const retired = /\b(?:channelMessages|admitPrompt|registerPromptGuard|registerManagedSessionGuard|registerSessionSender|updateSessionControls|appendPluginRecord)\b|conversation\.workbench|agentPreset\.selector|presets\??\.switch\b/;
const privateImport = /(?:from\s*|import\s*\()['"][^'"]*(?:deepseek-harness[^'"]*\/src\/|node_modules\/|@deepseek-ai\/[^'"]*\/src\/)/;
const failures = [];
let files = 0;
async function scan(path) {
  for (const item of await readdir(path, { withFileTypes: true })) {
    const name = join(path, item.name);
    if (item.isDirectory()) await scan(name);
    else if (/\.tsx?$/.test(item.name) && !/\.test\.tsx?$/.test(item.name)) {
      files++;
      const text = await readFile(name, 'utf8');
      if (retired.test(text) || privateImport.test(text)) failures.push(name.slice(root.length + 1));
      if (/@deepseek-ai\/dsh-client-ui-primitives\//.test(text)) failures.push(`${name.slice(root.length + 1)} uses an unsupported primitive subpath`);
      if (/userQuestions\.ask\s*=/.test(text)) failures.push(`${name.slice(root.length + 1)} replaces a Host service method`);
    }
  }
}
await scan(join(root, 'src'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
for (const group of ['dependencies', 'peerDependencies', 'devDependencies']) {
  for (const [name, value] of Object.entries(pkg[group] ?? {})) {
    if (name === '@deepseek-ai/dsh-session-channel' || /deepseek-harness-qq-(?:workbench|native)/.test(value)) failures.push(`${group}.${name}`);
    if (['mem0ai', '@qdrant/js-client-rest', 'better-sqlite3'].includes(name)) failures.push(`${group}.${name}`);
  }
}
console.log(JSON.stringify({ status: failures.length ? 'failed' : 'passed', files, failures }, null, 2));
if (failures.length) process.exitCode = 1;
