import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { ApiError, QQBot, errorHandler } from '@tencent-connect/qqbot-nodejs';
import type { SessionManager } from '../session/session-manager.ts';
import { ConfigSchema } from '../config.ts';
import { ConversationService } from './conversation-service.ts';
import { trackSdkOutbound } from './sdk-outbound.ts';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'qq-sdk-outbound-')); roots.push(root);
  const ctx = { get: () => undefined, on: () => () => {} } as unknown as Context;
  const manager = { getDefaultModel: () => ({ provider: 'p', model: 'm' }), getDefaultPreset: () => 'standard' } as unknown as SessionManager;
  const config = ConfigSchema({ appId: 'sdk', appSecret: 'private-configured-secret', cwd: root });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const service = new ConversationService(ctx, manager, config, logger, root);
  const key = service.entry('group', 'g').key;
  const bot = new QQBot({ appId: 'sdk', appSecret: 'dummy' });
  const send = vi.spyOn(bot, 'send').mockResolvedValue({ id: 'receipt-1', timestamp: 1 });
  const sendText = vi.spyOn(bot, 'sendText').mockResolvedValue({ id: 'text-1', timestamp: 1 });
  trackSdkOutbound(bot, service);
  return { root, service, key, bot, send, sendText, logger };
}

describe('SDK outbound recording', () => {
  const target = { scope: 'group' as const, targetId: 'g', msgId: 'frozen-input' };
  it('tracks facade-to-lowlevel delegation exactly once with receipt and frozen target', async () => {
    const f = fixture();
    await f.bot.sendMarkdown(target, 'answer');
    expect(f.service.store.deliveries(f.key)).toMatchObject([{ text: 'answer', state: 'accepted', parts: [{ receiptId: 'receipt-1' }] }]);
    expect(f.service.store.deliveries(f.key)).toHaveLength(1);
    expect(f.send.mock.calls[0]?.[0].target).toEqual(target);
  });
  it('covers command and SDK prompts while suppressing an already tracked automatic send', async () => {
    const f = fixture();
    await f.service.withOutboundContext({ provenance: 'command', sourceMessageId: 'command-input' }, () => f.bot.sendText(target, 'unknown command'));
    await f.service.trackAutomatic(target, 'question prompt', () => f.bot.sendMarkdown(target, 'question prompt'));
    await f.bot.sendText(target, 'SDK rate limit prompt');
    const rows = f.service.store.deliveries(f.key);
    expect(rows).toHaveLength(3);
    expect(rows.find(row => row.text === 'unknown command')).toMatchObject({ provenance: 'command', sourceMessageId: 'command-input', parts: [{ receiptId: 'text-1' }] });
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it.each([
    { error: new ApiError('ignored', 403, '/private', 40034105, 'private-configured-secret denied'), state: 'failed', expected: 'HTTP 403' },
    { error: new Error('private-configured-secret socket disconnected'), state: 'unknown', expected: 'socket disconnected' },
  ])('redacts bare configured credentials in SDK failure records and logs ($state)', async ({ error, state, expected }) => {
    const f = fixture(); f.sendText.mockRejectedValueOnce(error);
    await expect(f.bot.sendText(target, 'prompt')).rejects.toThrow(expected);
    const record = f.service.store.deliveries(f.key)[0];
    expect(record?.state).toBe(state); expect(record?.error).toContain(expected);
    if (error instanceof ApiError) expect(record?.error).toContain('40034105');
    expect(JSON.stringify(record)).not.toContain('private-configured-secret');
    expect(JSON.stringify(f.logger.warn.mock.calls)).not.toContain('private-configured-secret');
  });
  it('keeps SDK error-handler logging and its separate feedback prompt free of bare configured credentials', async () => {
    const f = fixture();
    f.sendText.mockRejectedValueOnce(new ApiError('private-configured-secret failed', 403, '/private-configured-secret', 40034105, 'private-configured-secret denied'));
    await errorHandler()({ bot: f.bot, replyTarget: target, log: f.logger } as never, () => f.bot.sendText(target, 'original prompt').then(() => {}));
    expect(f.sendText).toHaveBeenCalledTimes(2);
    expect(f.sendText.mock.calls[0]?.[1]).toBe('original prompt');
    expect(f.sendText.mock.calls[1]?.[1]).toContain('40034105');
    expect(f.sendText.mock.calls[1]?.[1]).not.toContain('private-configured-secret');
    expect(JSON.stringify(f.logger.error.mock.calls)).not.toContain('private-configured-secret');
    expect(JSON.stringify(f.service.store.deliveries(f.key))).not.toContain('private-configured-secret');
  });
  it('redacts stored credentials, records unknown failure once, and never retries it', async () => {
    const f = fixture(); f.sendText.mockRejectedValueOnce(new Error('socket disconnected'));
    await expect(f.bot.sendText(target, 'api_key=visible-private private-configured-secret')).rejects.toThrow('disconnected');
    const rows = f.service.store.deliveries(f.key);
    expect(rows).toHaveLength(1); expect(rows[0]?.state).toBe('unknown');
    expect(rows[0]?.text).not.toContain('visible-private'); expect(rows[0]?.text).not.toContain('private-configured-secret');
    expect(f.sendText).toHaveBeenCalledTimes(1);
  });
});
