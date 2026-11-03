import { describe, expect, it } from 'vitest';
import { assertSupportedNode } from './node-version.ts';

describe('QQ Node compatibility', () => {
  it.each(['22.19.0', '22.20.1', '24.0.0', '26.2.0'])('accepts supported Node %s', version => {
    expect(() => assertSupportedNode(version)).not.toThrow();
  });
  it.each(['20.3.0', '22.18.0', '23.11.0', 'invalid'])('rejects unsupported Node %s before migration', version => {
    expect(() => assertSupportedNode(version)).toThrow('插件数据未迁移');
  });
});
