import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function send(root, origin, failure) {
  const { ManualQqSender, createManualTransport } = await import('../../../lib/transport/manual-send.js');
  const { DeliveryLedger } = await import('../../../lib/transport/delivery-ledger.js');
  const credentials = { appId: 'fixture-robot', clientSecret: 'fixture-only' };
  const bot = {
    tokenManager: { getAccessToken: async () => 'fixture-only' },
    getCredentials: () => credentials,
    messageApi: { notifyMessageSent() {} },
  };
  const target = { scope: 'group', targetId: 'fixture-group' };
  const submit = async () => {
    const sender = new ManualQqSender(credentials.appId, new DeliveryLedger(join(root, 'ledger.jsonl')),
      createManualTransport(bot, origin, 'qqbot-local-replay'));
    return sender.submit(target, 'same-operation', 'fixture text', () => true, () => false);
  };
  if (failure) await assert.rejects(submit, new RegExp(`QQ delivery ledger ${failure};`));
  else assert.equal((await submit()).status, 'accepted');
}

async function replay() {
  const root = mkdtempSync(join(tmpdir(), 'qqbot-ledger-replay-'));
  const posts = [];
  const expectedPost = ['POST', '/v2/groups/fixture-group/messages', 'fixture text'];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    posts.push([req.method, req.url, body.content]);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: `fixture-receipt-${posts.length}` }));
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const freshSender = (failure = '') => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--sender', root, origin, failure], {
        stdio: 'inherit', timeout: 5_000,
      });
      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`Replay sender exited with ${code ?? signal}`));
      });
    });
    await freshSender();
    assert.deepEqual(posts, [expectedPost]);
    await freshSender();
    assert.deepEqual(posts, [expectedPost]);
    console.log('Same operation after restart with intact ledger: 1 total HTTP POST.');
    const ledger = join(root, 'ledger.jsonl');
    const backup = join(root, 'ledger.offline');
    renameSync(ledger, backup);
    await freshSender('disappeared');
    assert.deepEqual(posts, [expectedPost]);
    writeFileSync(ledger, '');
    await freshSender('was emptied');
    assert.deepEqual(posts, [expectedPost]);
    renameSync(backup, ledger);
    await freshSender();
    assert.deepEqual(posts, [expectedPost]);
    console.log('Missing and empty ledgers blocked after restart. Restoring the ledger preserved deduplication: 1 total HTTP POST.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--sender') {
  const [root, origin, failure] = process.argv.slice(3);
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  await send(root, origin, failure);
} else {
  await replay();
}
