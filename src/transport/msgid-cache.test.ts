import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { ReplyIdCache } from './msgid-cache.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('ReplyIdCache', () => {
  let cache: ReplyIdCache;
  beforeEach(() => { cache = new ReplyIdCache(); });
  it('caches and returns the most recent msgId', () => {
    cache.cacheMsgId('c2c', 'u-cache-1', 'm1');
    cache.cacheMsgId('c2c', 'u-cache-1', 'm2');
    expect(cache.getCachedReplyIds('c2c', 'u-cache-1')).toEqual([
      { kind: 'msg', id: 'm2' },
      { kind: 'msg', id: 'm1' },
    ]);
  });

  it('distinguishes msg and event kinds', () => {
    cache.cacheMsgId('c2c', 'u-cache-2', 'm1');
    cache.cacheEventId('c2c', 'u-cache-2', 'evt1');
    expect(cache.getCachedReplyIds('c2c', 'u-cache-2')).toEqual([
      { kind: 'event', id: 'INTERACTION_CREATE:evt1' },
      { kind: 'msg', id: 'm1' },
    ]);
  });

  it('isolates by target', () => {
    cache.cacheMsgId('c2c', 'u-cache-3', 'ma');
    cache.cacheMsgId('c2c', 'u-cache-4', 'mb');
    expect(cache.getCachedReplyIds('c2c', 'u-cache-3')).toEqual([{ kind: 'msg', id: 'ma' }]);
    expect(cache.getCachedReplyIds('c2c', 'u-cache-4')).toEqual([{ kind: 'msg', id: 'mb' }]);
  });

  it('returns empty for an unknown target', () => {
    expect(cache.getCachedReplyIds('c2c', 'u-nonexistent')).toEqual([]);
  });

  it('returns multiple cached ids in reverse chronological order', () => {
    cache.cacheMsgId('c2c', 'u-cache-5', 'm1');
    cache.cacheMsgId('c2c', 'u-cache-5', 'm2');
    cache.cacheMsgId('c2c', 'u-cache-5', 'm3');
    expect(cache.getCachedReplyIds('c2c', 'u-cache-5')).toEqual([
      { kind: 'msg', id: 'm3' },
      { kind: 'msg', id: 'm2' },
      { kind: 'msg', id: 'm1' },
    ]);
  });

  it('expires group messages after 5 minutes', () => {
    vi.useFakeTimers();
    cache.cacheMsgId('group', 'g-cache-1', 'mg1');
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(cache.getCachedReplyIds('group', 'g-cache-1')).toEqual([]);
  });
});
