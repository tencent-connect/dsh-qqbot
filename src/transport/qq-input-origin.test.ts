import { describe, it, expect } from 'vitest';
import { QqInputRegistry, inputOriginTtlMs } from './qq-input-origin.ts';

describe('QqInputRegistry', () => {
  it('登记后可重复查询（不消费），释放后失效', () => {
    const registry = new QqInputRegistry();
    registry.register('m1');

    expect(registry.has('m1')).toBe(true);
    expect(registry.has('m1')).toBe(true);
    registry.release('m1');
    expect(registry.has('m1')).toBe(false);
  });

  it.each([undefined, '', 'unknown'])('未登记的 id（%s）返回 false', (id) => {
    expect(new QqInputRegistry().has(id)).toBe(false);
  });

  it('过期登记失效并被清除', () => {
    let now = 1_000;
    const registry = new QqInputRegistry({ ttlMs: 100, now: () => now });
    registry.register('m1');

    now += 100;

    expect(registry.has('m1')).toBe(false);
    expect(registry.size).toBe(0);
  });

  it('超过条数上限时淘汰最早的登记', () => {
    const registry = new QqInputRegistry({ maxEntries: 2 });
    registry.register('m1');
    registry.register('m2');
    registry.register('m3');

    expect(registry.has('m1')).toBe(false);
    expect(registry.has('m2')).toBe(true);
    expect(registry.has('m3')).toBe(true);
  });
});

describe('inputOriginTtlMs', () => {
  it.each([
    [0, 30 * 60 * 1000],
    [10 * 60 * 1000, 30 * 60 * 1000],
    [30 * 60 * 1000, 60 * 60 * 1000],
    [Number.NaN, 30 * 60 * 1000],
  ])('processingTimeoutMs=%d → %d', (processing, expected) => {
    expect(inputOriginTtlMs(processing)).toBe(expected);
  });
});
