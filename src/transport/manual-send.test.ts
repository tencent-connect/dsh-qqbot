import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiError, type QQBot } from '@tencent-connect/qqbot-nodejs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QqTimeline } from '../runtime/qq-timeline.ts';
import { DeliveryLedger } from './delivery-ledger.ts';
import { createManualTransport, ManualQqSender } from './manual-send.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qq-manual-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
const peer = { scope: 'group', targetId: 'same' } as const;
const yes = () => true;
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

it('keeps one bubble and durable operation per robot and target even after a lost reply', async () => {
  const path = join(dir, 'ledger.jsonl');
  const timeline = new QqTimeline(join(dir, 'timeline'), log);
  let lose!: () => void;
  const transmit = vi.fn(async (_target, _text, fence: () => void) => {
    fence();
    await new Promise<void>(resolve => { lose = resolve; });
    throw new Error('connection lost after POST');
  });
  const send = new ManualQqSender('robot', new DeliveryLedger(path), transmit, timeline);
  const first = send.submit(peer, 'one', 'secret body', yes, yes);
  expect((await send.submit(peer, 'one', 'secret body', yes, yes)).status).toBe('sending');
  expect(timeline.page('robot', peer)?.entries).toMatchObject([{ status: 'sending', source: 'manual' }]);
  expect(new ManualQqSender('robot', new DeliveryLedger(path), transmit).status(peer, 'one')?.status).toBe('unknown');
  lose();
  expect((await first).status).toBe('unknown');
  const restored = new ManualQqSender('robot', new DeliveryLedger(path), transmit, timeline);
  expect((await restored.submit(peer, 'one', 'secret body', yes, yes)).status).toBe('unknown');
  await expect(restored.submit(peer, 'one', 'different body', yes, yes)).rejects.toThrow('正文已变更');
  expect(restored.status({ ...peer, scope: 'c2c' }, 'one')).toBeUndefined();
  expect(new ManualQqSender('other', new DeliveryLedger(path), transmit).status(peer, 'one')).toBeUndefined();
  expect(transmit).toHaveBeenCalledTimes(1);
  expect(timeline.page('robot', peer)?.entries).toMatchObject([{ status: 'unknown', source: 'manual' }]);
  expect(readFileSync(path, 'utf8')).not.toContain('secret body');
});

it('links a submitted native answer to its Session in the same conversation timeline', async () => {
  const timeline = new QqTimeline(join(dir, 'timeline'), log);
  const send = new ManualQqSender('A', new DeliveryLedger(), async (_target, _text, fence) => {
    fence();
    return { id: 'receipt' };
  }, timeline);
  const result = await send.submit(peer, 'answer', 'Native answer', yes, yes, 'source-session');
  expect(timeline.page('A', peer)?.entries).toMatchObject([{
    id: result.id, source: 'answer', sessionId: 'source-session', text: 'Native answer', status: 'accepted',
  }]);
  expect(timeline.page('B', peer)?.entries).toEqual([]);
});

it('rechecks permission before HTTP and does not persist text when recording is off', async () => {
  const timeline = new QqTimeline(join(dir, 'timeline'), log);
  let allowed = true;
  const post = vi.fn();
  const send = new ManualQqSender('robot', new DeliveryLedger(), async (_target, _text, fence) => {
    allowed = false;
    fence();
    post();
    return { id: 'platform-id' };
  }, timeline);
  expect((await send.submit(peer, 'revoked', 'revoked body', () => allowed, () => false)).status).toBe('rejected');
  expect(post).not.toHaveBeenCalled();
  expect(timeline.page('robot', peer)?.entries).toEqual([]);

  const rejected = new ManualQqSender('robot', new DeliveryLedger(), async (_target, _text, fence) => {
    fence();
    throw new ApiError('rejected', 400, '/messages', 304023);
  }, timeline);
  expect(await rejected.submit(peer, 'reject', 'body', yes, yes)).toMatchObject({ status: 'rejected', httpStatus: 400, platformCode: 304023 });
  expect(timeline.page('robot', peer)?.entries).toMatchObject([{ status: 'rejected', platformCode: 304023 }]);
});

it('uses one SDK plaintext POST and does not follow a platform redirect', async () => {
  const paths: string[] = [];
  let body: Record<string, unknown> = {};
  const server = createServer(async (request, response) => {
    paths.push(request.url!);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    body = JSON.parse(Buffer.concat(chunks).toString());
    if (body.content === 'redirect') {
      response.writeHead(307, { Location: '/unexpected' }); response.end();
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"id":"test-platform-id"}');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as { port: number };
    const bot = {
      tokenManager: { getAccessToken: async () => 'fixture' },
      getCredentials: () => ({ appId: 'robot', clientSecret: 'fixture' }),
      messageApi: { notifyMessageSent: vi.fn() },
    } as unknown as QQBot;
    const send = new ManualQqSender('robot', new DeliveryLedger(), createManualTransport(bot, 'http://127.0.0.1:' + port, 'test'));
    expect((await send.submit(peer, 'first', 'redirect', yes, yes)).status).toBe('unknown');
    expect(paths).toEqual(['/v2/groups/same/messages']);
    expect((await send.submit({ scope: 'c2c', targetId: 'same', msgId: 'reply-to' }, 'second', 'ordinary **text**', yes, yes)).status).toBe('accepted');
    expect(paths).toEqual(['/v2/groups/same/messages', '/v2/users/same/messages']);
    expect(body).toMatchObject({ content: 'ordinary **text**', msg_type: 0, msg_id: 'reply-to' });
    expect(body).not.toHaveProperty('markdown');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

it('uploads and sends one attachment with a caption and keeps lost receipts from triggering a resend', async () => {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  let allowed = true;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const path = request.url!;
    requests.push({ path, body });
    if (path.endsWith('/files')) {
      if (body.file_name === 'revoke.txt') allowed = false;
      response.setHeader('Content-Type', 'application/json');
      response.end('{"file_uuid":"upload","file_info":"media-reference","ttl":60}');
    } else if (body.content === 'lost') {
      request.socket.destroy();
    } else {
      response.setHeader('Content-Type', 'application/json');
      response.end('{"id":"test-platform-id"}');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as { port: number };
    const bot = {
      tokenManager: { getAccessToken: async () => 'fixture' },
      getCredentials: () => ({ appId: 'robot', clientSecret: 'fixture' }),
      messageApi: { notifyMessageSent: vi.fn() },
    } as unknown as QQBot;
    const timeline = new QqTimeline(join(dir, 'timeline'), log);
    const journal = join(dir, 'ledger.jsonl');
    const transport = createManualTransport(bot, 'http://127.0.0.1:' + port, 'test', target => {
      expect(requests.at(-1)?.path).toMatch(/\/files$/);
      return target;
    });
    const send = new ManualQqSender('robot', new DeliveryLedger(journal), transport, timeline);
    const file = { name: 'report.txt', bytes: Buffer.from('confidential fixture') };
    const image = { name: 'image.gif', bytes: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') };
    expect((await send.submit(peer, 'group', '请查收', yes, yes, undefined, file)).status).toBe('accepted');
    expect(requests).toMatchObject([
      { path: '/v2/groups/same/files', body: { file_type: 4, file_name: 'report.txt', srv_send_msg: false, file_data: file.bytes.toString('base64') } },
      { path: '/v2/groups/same/messages', body: { content: '请查收', msg_type: 7, media: { file_info: 'media-reference' } } },
    ]);
    expect(timeline.page('robot', peer)?.entries).toMatchObject([{ status: 'accepted', attachments: 1, attachmentName: 'report.txt' }]);

    const direct = { scope: 'c2c', targetId: 'same', msgId: 'private-trigger' } as const;
    expect((await send.submit(direct, 'private', 'lost', yes, yes, undefined, image)).status).toBe('unknown');
    const restored = new ManualQqSender('robot', new DeliveryLedger(journal), transport, timeline);
    expect((await restored.submit(direct, 'private', 'lost', yes, yes, undefined, image)).status).toBe('unknown');
    await expect(restored.submit(direct, 'private', 'lost', yes, yes, undefined, { ...image, bytes: file.bytes })).rejects.toThrow('附件不同');
    expect(requests.slice(2)).toMatchObject([
      { path: '/v2/users/same/files', body: { file_type: 1, srv_send_msg: false } },
      { path: '/v2/users/same/messages', body: { msg_type: 7, msg_id: 'private-trigger' } },
    ]);

    expect((await send.submit(peer, 'revoked', '', () => allowed, yes, undefined, { ...file, name: 'revoke.txt' })).status).toBe('rejected');
    expect(requests.slice(4).map(row => row.path)).toEqual(['/v2/groups/same/files']);
    expect(readFileSync(journal, 'utf8')).not.toContain(file.bytes.toString('base64'));
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
