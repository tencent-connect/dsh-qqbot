import { describe, it, expect, vi } from 'vitest';
import type { QQBot } from '@tencent-connect/qqbot-nodejs';
import { ReplyLimiter } from './reply-limiter.ts';
import { cacheMsgId, cacheEventId } from './msgid-cache.ts';
import { resolveReplyTarget, sendResolvedMarkdown } from './reply-target.ts';
import type { ReplyTarget } from '../types.ts';

function makeTarget(msgId?: string, targetId = 'peer-1'): ReplyTarget {
  return { scope: 'c2c', targetId, msgId };
}

describe('resolveReplyTarget', () => {
  it('prefers explicit target.msgId (cached & within window)', () => {
    const limiter = new ReplyLimiter({ limit: 4 });
    cacheMsgId('c2c', 'peer-1', 'm1');
    const result = resolveReplyTarget(makeTarget('m1'), limiter, true);
    expect(result.msgId).toBe('m1');
    expect(result.eventId).toBeUndefined();
  });

  it('falls back to cached msgId after target.msgId is exhausted', () => {
    const limiter = new ReplyLimiter({ limit: 1 });
    cacheMsgId('c2c', 'peer-2', 'cached-1');
    limiter.record('m-exhausted');
    const result = resolveReplyTarget(makeTarget('m-exhausted', 'peer-2'), limiter, true);
    expect(result.msgId).toBe('cached-1');
  });

  it('drops explicit msgId beyond the platform window: falls back to a fresher cached candidate', () => {
    vi.useFakeTimers();
    try {
      const limiter = new ReplyLimiter({ limit: 4 });
      cacheMsgId('c2c', 'peer-10', 'stale-id');
      vi.setSystemTime(Date.now() + 31 * 60 * 1000); // c2c TTL 30min 过期
      cacheMsgId('c2c', 'peer-10', 'fresh-id'); // 窗口过期后用户又发了一条
      const result = resolveReplyTarget(makeTarget('stale-id', 'peer-10'), limiter, true);
      expect(result.msgId).toBe('fresh-id');
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops explicit msgId beyond the platform window: no candidates → proactive', () => {
    vi.useFakeTimers();
    try {
      const limiter = new ReplyLimiter({ limit: 4 });
      cacheMsgId('c2c', 'peer-11', 'stale-id');
      vi.setSystemTime(Date.now() + 31 * 60 * 1000);
      const result = resolveReplyTarget(makeTarget('stale-id', 'peer-11'), limiter, true);
      expect(result.msgId).toBeUndefined();
      expect(result.eventId).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips event candidates when allowEvent is false', () => {
    const limiter = new ReplyLimiter({ limit: 4 });
    cacheEventId('c2c', 'peer-3', 'evt-1');
    const result = resolveReplyTarget(makeTarget(undefined, 'peer-3'), limiter, false);
    expect(result.eventId).toBeUndefined();
    expect(result.msgId).toBeUndefined();
  });

  it('forceProactive skips cached msgId and eventId', () => {
    const limiter = new ReplyLimiter({ limit: 4 });
    cacheMsgId('c2c', 'peer-5', 'still-fresh');
    cacheEventId('c2c', 'peer-5', 'evt-5');
    const result = resolveReplyTarget(
      { scope: 'c2c', targetId: 'peer-5', msgId: 'still-fresh', forceProactive: true },
      limiter,
      true,
    );
    expect(result).toEqual({ scope: 'c2c', targetId: 'peer-5' });
    expect(limiter.checkLimit('still-fresh').remaining).toBe(4);
  });

  it('returns eventId when allowEvent is true', () => {
    const limiter = new ReplyLimiter({ limit: 4 });
    cacheEventId('c2c', 'peer-4', 'evt-2');
    const result = resolveReplyTarget(makeTarget(undefined, 'peer-4'), limiter, true);
    expect(result.eventId).toBe('INTERACTION_CREATE:evt-2');
    expect(result.msgId).toBeUndefined();
  });
});

describe('sendResolvedMarkdown', () => {
  it('fills event_id via bot.send when target has eventId', async () => {
    const bot = {
      send: vi.fn(async () => ({})),
      sendMarkdown: vi.fn(async () => ({})),
    } as unknown as QQBot;
    const target: ReplyTarget = { scope: 'c2c', targetId: 'p', eventId: 'INTERACTION_CREATE:evt' };
    await sendResolvedMarkdown(bot, target, 'hello');
    expect(bot.send).toHaveBeenCalledWith(expect.objectContaining({
      extra: { event_id: 'INTERACTION_CREATE:evt' },
    }));
    expect(bot.sendMarkdown).not.toHaveBeenCalled();
  });

  it('uses sendMarkdown for msgId targets', async () => {
    const bot = {
      send: vi.fn(async () => ({})),
      sendMarkdown: vi.fn(async () => ({})),
    } as unknown as QQBot;
    const target: ReplyTarget = { scope: 'c2c', targetId: 'p', msgId: 'm1' };
    await sendResolvedMarkdown(bot, target, 'hello');
    expect(bot.sendMarkdown).toHaveBeenCalledWith(target, 'hello', undefined);
    expect(bot.send).not.toHaveBeenCalled();
  });
});
