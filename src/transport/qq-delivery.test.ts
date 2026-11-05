import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, MediaFileType, QQBot, StreamInputState, type InlineKeyboard } from '@tencent-connect/qqbot-nodejs';
import { bindDelivery, guardMedia, guardSender, replyDelivery } from './delivery-context.ts';
import { DeliveryLedger } from './delivery-ledger.ts';
import { cacheEventId, cacheMsgId } from './msgid-cache.ts';
import { OutboundBuffer } from './outbound-buffer.ts';
import { createDeliveryMedia, openDeliveryStream, sendDeliveryMarkdown } from './qq-delivery.ts';
import { ReplyLimiter } from './reply-limiter.ts';
import type { ReplyTarget } from '../types.ts';

const logger = { debug() {}, info() {}, warn() {}, error() {} };
let nextUser = 0;
afterEach(() => vi.useRealTimers());

function setup() {
  const bot = new QQBot({ appId: 'fixture-app', appSecret: 'fixture-secret' });
  vi.spyOn(bot.tokenManager, 'getAccessToken').mockResolvedValue('fixture-token');
  const request = vi.spyOn(bot.apiClient, 'request').mockResolvedValue({ id: 'qq-message' });
  const peer: ReplyTarget = { scope: 'c2c', targetId: `user-${++nextUser}`, msgId: 'platform-input' };
  cacheMsgId(peer.scope, peer.targetId, peer.msgId);
  const limiter = new ReplyLimiter({ limit: 4 });
  let allowed = true;
  const target = replyDelivery(bindDelivery(peer, { key: 'fixture-delivery', allowed: () => allowed }), 1);
  const ledger = new DeliveryLedger();
  const sender = guardSender({
    openStream: target => openDeliveryStream(bot, target, logger),
    sendMarkdown: (target, body, opts) => sendDeliveryMarkdown(bot, limiter, target, body, opts),
  }, ledger);
  const media = guardMedia(createDeliveryMedia(bot, limiter), ledger);
  return { bot, request, peer, target, sender, media, revoke: () => { allowed = false; } };
}

it('checks access when the SDK flushes a queued frame', async () => {
  vi.useFakeTimers();
  const { request, sender, target, revoke } = setup();
  const stream = sender.openStream(target);
  await stream.update('allowed frame');
  await vi.advanceTimersByTimeAsync(200);
  await stream.update('queued frame');
  expect(request).toHaveBeenCalledTimes(1);
  revoke();
  await vi.advanceTimersByTimeAsync(300);
  await stream.complete();
  expect(request).toHaveBeenCalledTimes(1);
});

it.each([true, false])('checks access on an SDK rate limit retry with revoked=%s', async (revoked) => {
  vi.useFakeTimers();
  const { request, sender, target, revoke } = setup();
  request.mockRejectedValueOnce(new ApiError('rate limited', 429, '/v2/users/user/stream_messages', 50002));
  const stream = sender.openStream(target);
  const update = stream.update('first frame').catch(error => error);
  await vi.advanceTimersByTimeAsync(0);
  expect(request).toHaveBeenCalledTimes(1);
  if (revoked) revoke();
  await vi.advanceTimersByTimeAsync(1000);
  if (revoked) {
    await expect(update).resolves.toEqual(expect.objectContaining({ message: expect.stringContaining('no longer authorized') }));
    expect(request).toHaveBeenCalledTimes(1);
  } else {
    await update;
    await stream.complete();
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2]?.[3]).toMatchObject({ input_state: StreamInputState.DONE, stream_msg_id: 'qq-message' });
  }
});

it.each(['locally expired', 'explicitly rejected', 'unknown'] as const)('uses static fallback only when safe (%s)', async (outcome) => {
  vi.useFakeTimers();
  const { request, peer, sender, target } = setup();
  const streamPath = `/v2/users/${peer.targetId}/stream_messages`;
  if (outcome === 'locally expired') {
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
  } else if (outcome === 'explicitly rejected') {
    request.mockRejectedValueOnce(new ApiError('expired message', 400, streamPath, 40034005));
  } else {
    request.mockRejectedValueOnce(new ApiError('response timeout', 0, streamPath));
  }
  const buffer = new OutboundBuffer(target, sender, 4500, logger, true);
  buffer.append('answer');
  await buffer.flush();

  const paths = request.mock.calls.map(([, , path]) => path);
  const staticPath = `/v2/users/${peer.targetId}/messages`;
  if (outcome === 'unknown') {
    expect(paths).toEqual([streamPath]);
  } else {
    expect(paths).toEqual(outcome === 'locally expired' ? [staticPath] : [streamPath, staticPath]);
    expect(request.mock.lastCall?.[3]).not.toHaveProperty('msg_id');
    await sender.sendText?.(target, 'answer', 4500);
    expect(request.mock.calls.map(([, , path]) => path)).toEqual(paths);
  }
});

it('does not finalize or re-send a stream after a deferred frame times out', async () => {
  vi.useFakeTimers();
  const { request, sender, target } = setup();
  request.mockResolvedValueOnce({ id: 'first-frame' })
    .mockRejectedValueOnce(new ApiError('response timeout', 0, '/v2/users/user/stream_messages'));
  const stream = sender.openStream(target);
  await stream.update('first frame');
  await vi.advanceTimersByTimeAsync(200);
  await stream.update('queued frame');
  await vi.advanceTimersByTimeAsync(300);
  await expect(stream.complete()).rejects.toThrow('response timeout');
  await sender.sendText?.(target, 'queued frame', 4500);
  expect(request).toHaveBeenCalledTimes(2);
});

it.each([true, false])('rechecks file access after upload with revoked=%s', async (revoked) => {
  const { bot, media, request, target, revoke } = setup();
  const upload = vi.spyOn(bot, 'uploadMedia').mockImplementation(async () => {
    if (revoked) revoke();
    return { file_info: 'uploaded-file', file_uuid: 'file-1', ttl: 60 };
  });
  const delivery = media.sendFile(target, { localPath: '/fixture/a.txt' }, { fileName: 'a.txt' });
  if (revoked) {
    await expect(delivery).rejects.toThrow('no longer authorized');
    expect(request).not.toHaveBeenCalled();
  } else {
    await expect(delivery).resolves.toMatchObject({ message: { id: 'qq-message' } });
    expect(request.mock.lastCall?.[3]).toMatchObject({ media: { file_info: 'uploaded-file' }, msg_id: target.msgId });
  }
  expect(upload).toHaveBeenCalledWith(expect.objectContaining({ fileType: MediaFileType.FILE, fileName: 'a.txt', srvSendMsg: false }));
});

it('rechecks file access if token acquisition delays submission', async () => {
  const { bot, media, request, target, revoke } = setup();
  vi.spyOn(bot, 'uploadMedia').mockResolvedValue({ file_info: 'uploaded-file', file_uuid: 'file-1', ttl: 60 });
  let releaseToken!: (token: string) => void;
  const token = vi.spyOn(bot.tokenManager, 'getAccessToken').mockReturnValueOnce(new Promise(resolve => {
    releaseToken = resolve;
  }));
  const delivery = media.sendFile(target, { localPath: '/fixture/a.txt' });
  await vi.waitFor(() => expect(token).toHaveBeenCalled());
  revoke();
  releaseToken('fixture-token');
  await expect(delivery).rejects.toThrow('no longer authorized');
  expect(request).not.toHaveBeenCalled();
});

const keyboard: InlineKeyboard = { content: { rows: [] } };

it.each(['text', 'card'] as const)('blocks static %s if access is revoked while acquiring the token', async kind => {
  const { bot, request, sender, target, revoke } = setup();
  const release = Promise.withResolvers<string>();
  const token = vi.spyOn(bot.tokenManager, 'getAccessToken').mockReturnValueOnce(release.promise);
  const sending = kind === 'text'
    ? sender.sendText!(target, 'static answer', 4500)
    : sender.sendMarkdown(target, 'card', { keyboard });
  const denied = expect(sending).rejects.toThrow('no longer authorized');
  try {
    await vi.waitFor(() => expect(token).toHaveBeenCalledOnce());
    revoke();
  } finally {
    release.resolve('fixture-token');
  }
  await denied;
  expect(request).not.toHaveBeenCalled();
});

it('preserves event_id, keyboard, and outbound reference tracking for an authorized card', async () => {
  const { bot, request, sender, peer, target } = setup();
  const eventId = 'INTERACTION_CREATE:approval';
  cacheEventId(peer.scope, peer.targetId, 'approval');
  const eventTarget = bindDelivery({ scope: peer.scope, targetId: peer.targetId }, { key: 'approved', allowed: () => true });
  const notify = vi.spyOn(bot.messageApi, 'notifyMessageSent');
  request.mockResolvedValueOnce({ id: 'card', ext_info: { ref_idx: 'reference' } });
  await sender.sendMarkdown(eventTarget, 'approval card', { keyboard });
  expect(request.mock.lastCall?.[3]).toMatchObject({ event_id: eventId, msg_type: 2, markdown: { content: 'approval card' }, keyboard });
  expect(request.mock.lastCall?.[3]).not.toHaveProperty('msg_id');
  expect(notify).toHaveBeenCalledWith('reference', { text: 'approval card' });
  await sender.sendText!(target, 'static answer', 4500);
  expect(request.mock.lastCall?.[3]).toMatchObject({ msg_id: peer.msgId, msg_type: 2, markdown: { content: 'static answer' } });
  expect(request.mock.lastCall?.[3]).not.toHaveProperty('event_id');
});
