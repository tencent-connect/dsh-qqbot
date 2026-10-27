import { describe, expect, it } from 'vitest';
import { ConfigSchema } from './config.ts';

describe('ConfigSchema', () => {
  it('defaults groupIntervalTimer to five minutes', () => {
    const config = ConfigSchema({});
    expect(config.groupIntervalTimer).toBe(300000);
  });
});
