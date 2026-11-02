import { describe, expect, it, vi } from 'vitest';
import { QQBot } from '@tencent-connect/qqbot-nodejs';
import type { Middleware } from '@tencent-connect/qqbot-nodejs';
import { observeBotRuntime } from './observe-bot.ts';
import { RUNTIME_ERROR_HINTS, RuntimeState } from './state.ts';

function harness() {
  const bot = new QQBot({ appId: 'runtime-test', appSecret: 'never-used' });
  const middleware: Middleware[] = [];
  vi.spyOn(bot, 'use').mockImplementation((...chain) => { middleware.push(...chain); return bot; });
  const handlers = new Map<string, (...args: unknown[]) => void>();
  vi.spyOn(bot, 'on').mockImplementation(((name: string, handler: (...args: unknown[]) => void) => {
    handlers.set(name, handler);
    return bot;
  }) as QQBot['on']);
  const send = vi.spyOn(bot, 'send').mockResolvedValue({ id: 'sent', timestamp: 'now' });
  const text = vi.spyOn(bot, 'sendText').mockResolvedValue({ id: 'text', timestamp: 'now' });
  const keyboard = vi.spyOn(bot, 'sendTextWithKeyboard').mockResolvedValue({ id: 'keyboard', timestamp: 'now' });
  const media = vi.spyOn(bot, 'sendMedia').mockResolvedValue({ upload: { file_uuid: 'upload', file_info: 'info', ttl: 1 }, message: { id: 'media', timestamp: 'now' } });
  const update = vi.fn(async () => {});
  const complete = vi.fn(async () => ({ id: 'stream', timestamp: 'now' }));
  vi.spyOn(bot, 'openStream').mockReturnValue({ update, complete } as never);
  let now = 10;
  const runtime = new RuntimeState(() => now);
  observeBotRuntime(bot, runtime);
  return { bot, runtime, handlers, middleware, send, text, keyboard, media, update, complete, tick: () => { now += 1; } };
}

describe('observeBotRuntime', () => {
  const target = { scope: 'c2c' as const, targetId: 'fake-peer', msgId: 'fake-message' };

  it('changes readiness only on gateway signals and never copies SDK error payloads', () => {
    const { runtime, handlers } = harness();
    expect(runtime.snapshot().phase).toBe('unbound');
    runtime.setPhase('connecting');
    handlers.get('ready')?.({ secret: 'hidden' });
    expect(runtime.snapshot().phase).toBe('ready');
    handlers.get('error')?.(new Error('Bearer token-secret; message private'));
    expect(runtime.snapshot().lastError).toBe(RUNTIME_ERROR_HINTS.connection);
    expect(JSON.stringify(runtime.snapshot())).not.toContain('token-secret');
    handlers.get('resumed')?.({});
    expect(runtime.snapshot().lastError).toBeNull();
  });

  it('records incoming activity before executing the remaining middleware chain', async () => {
    const { runtime, middleware } = harness();
    const next = vi.fn(async () => { expect(runtime.snapshot().lastReceivedAt).toBe(10); });
    await middleware[0]!({} as never, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('records only resolved sends and includes text, keyboard, and media facades', async () => {
    const { bot, runtime, send, tick } = harness();
    send.mockRejectedValueOnce(new Error('private body'));
    await expect(bot.send({ target, content: 'not transmitted' })).rejects.toThrow('private body');
    expect(runtime.snapshot().lastSentAt).toBeNull();
    expect(runtime.snapshot().lastError).toBe(RUNTIME_ERROR_HINTS.send);
    await bot.send({ target, content: 'fake send' });
    expect(runtime.snapshot().lastSentAt).toBe(10);
    tick();
    await bot.sendText(target, 'fake text');
    expect(runtime.snapshot().lastSentAt).toBe(11);
    tick();
    await bot.sendTextWithKeyboard(target, 'fake keyboard', { content: { rows: [] } });
    expect(runtime.snapshot().lastSentAt).toBe(12);
    tick();
    await bot.sendImage(target, { localPath: '/not-read' });
    expect(runtime.snapshot().lastSentAt).toBe(13);
  });

  it('does not count queued streaming updates; counts a successful final response once', async () => {
    const { bot, runtime, complete } = harness();
    const stream = bot.openStream({ target });
    await stream.update('queued only');
    expect(runtime.snapshot().lastSentAt).toBeNull();
    await stream.complete();
    expect(runtime.snapshot().lastSentAt).toBe(10);
    complete.mockResolvedValueOnce(undefined as never);
    runtime.setPhase('stopped');
    await stream.complete();
    expect(runtime.snapshot().lastSentAt).toBe(10);
  });

  it('does not report stream completion failures as successful sends', async () => {
    const { bot, runtime, complete } = harness();
    complete.mockRejectedValueOnce(new Error('private stream error'));
    await expect(bot.openStream({ target }).complete()).rejects.toThrow('private stream error');
    expect(runtime.snapshot()).toMatchObject({ lastSentAt: null, lastError: RUNTIME_ERROR_HINTS.send });
  });
});
