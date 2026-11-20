import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiError, StreamInputState, type QQBot } from '@tencent-connect/qqbot-nodejs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QqTimeline } from '../runtime/qq-timeline.ts';
import { bindDelivery, replyDelivery } from './delivery-context.ts';
import { observeTimelineRequests } from './timeline-observer.ts';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const target = { scope: 'c2c' as const, targetId: 'shared' };
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'qq-observer-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

it('records only HTTP message submissions and coalesces real stream frames by send identity', async () => {
  const log = new QqTimeline(dir, logger);
  const request = vi.fn(async () => ({ id: 'qq-accepted' }));
  const bot = { apiClient: { request } } as unknown as QQBot;
  const observe = observeTimelineRequests(bot, 'A', log, () => true);
  await bot.apiClient.request('auth-token', 'POST', '/v2/users/shared/messages', { input_notify: {} });
  await bot.apiClient.request('auth-token', 'POST', '/v2/users/shared/files', { file_info: 'binary-reference' });
  expect(log.page('A', target)?.entries).toEqual([]);

  const raw = observe(replyDelivery(bindDelivery(target, { appId: 'fixture-app', key: 'logical-stream', sessionId: 'ds-session', allowed: () => true }), 1));
  const path = '/v2/users/shared/stream_messages';
  await raw('auth-token', 'POST', path, { content_raw: 'part', input_state: StreamInputState.GENERATING });
  expect(log.page('A', target)?.entries).toMatchObject([{ status: 'partial', text: 'part' }]);
  await raw('auth-token', 'POST', path, { content_raw: 'final', input_state: StreamInputState.DONE, keyboard: 'opaque value' });
  const page = log.page('A', target);
  expect(page?.entries).toHaveLength(1);
  expect(page?.entries[0]).toMatchObject({ status: 'accepted', text: 'final', sessionId: 'ds-session', platformId: 'qq-accepted', source: 'automatic' });
  expect(JSON.stringify(page)).not.toMatch(/auth-token|opaque value|binary-reference/);
});

it('distinguishes rejected and unknown SDK results and respects the per-peer recording gate', async () => {
  const log = new QqTimeline(dir, logger);
  const path = '/v2/users/shared/messages';
  const request = vi.fn().mockRejectedValueOnce(new ApiError('server', 400, path, 123))
    .mockRejectedValueOnce(new ApiError('network', 0, path))
    .mockRejectedValueOnce(new ApiError('timed out', 408, path)).mockResolvedValue({});
  const bot = { apiClient: { request } } as unknown as QQBot;
  let enabled = true;
  observeTimelineRequests(bot, 'A', log, () => enabled);
  const submit = (content: string) => bot.apiClient.request('token', 'POST', path, { content });
  await expect(submit('rejected')).rejects.toThrow('server');
  await expect(submit('unknown')).rejects.toThrow('network');
  await expect(submit('timeout')).rejects.toThrow('timed out');
  enabled = false;
  await submit('turned off');
  expect(log.page('A', target)?.entries).toMatchObject([
    { status: 'rejected', text: 'rejected', httpStatus: 400, platformCode: 123 },
    { status: 'unknown', text: 'unknown' },
    { status: 'unknown', text: 'timeout', httpStatus: 408 },
  ]);
});
