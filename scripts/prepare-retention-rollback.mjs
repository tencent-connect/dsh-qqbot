import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { atomicWrite } from '../lib/shared/atomic-file.js';
import { isMessageRetention } from '../lib/shared/workbench-conversation-protocol.js';

const [input, backup, ...extra] = process.argv.slice(2);
if (!input || !backup || !isAbsolute(input) || !isAbsolute(backup) || extra.length) {
  throw new Error('Usage (with the Host stopped): node prepare-retention-rollback.mjs /absolute/conversation-settings.json /absolute/backup.json');
}

const path = realpathSync(input);
const original = readFileSync(path);
const data = JSON.parse(original.toString('utf8'));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
if (data?.version !== 1 || !isObject(data.peers)) throw new Error('Invalid QQ conversation settings.');

const legacy = new Set(['7d', '30d', 'forever', 'paused']);
let converted = 0;
for (const peer of Object.values(data.peers)) {
  if (!isObject(peer) || (peer.retention !== undefined && !isMessageRetention(peer.retention))) {
    throw new Error('Invalid QQ message retention policy.');
  }
  if (peer.retention === undefined || legacy.has(peer.retention)) continue;
  peer.retention = 'forever';
  converted++;
}

if (converted > 0) {
  // Preserve the exact settings, including the custom values, before replacing the live file.
  writeFileSync(backup, original, { flag: 'wx', mode: 0o600, flush: true });
  atomicWrite(path, [JSON.stringify(data) + '\n'], {
    mode: 0o600,
    verify() {
      if (!original.equals(readFileSync(path))) throw new Error('QQ conversation settings changed. Stop the Host before retrying.');
    },
  });
}
console.log(JSON.stringify({ converted }));
