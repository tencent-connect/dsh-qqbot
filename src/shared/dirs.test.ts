import { describe, expect, it } from 'vitest';
import { resolvePluginHome } from './dirs.ts';

describe('plugin data root', () => {
  it('keeps the existing home when no separate data directory is requested', () => {
    expect(resolvePluginHome(undefined, '/home/user')).toBe('/home/user/.dsh-qqbot');
    expect(resolvePluginHome('', '/home/user')).toBe('/home/user/.dsh-qqbot');
  });

  it('separates two instances without changing the process home', () => {
    expect(resolvePluginHome('/test/profile-a/qqbot', '/home/user')).toBe('/test/profile-a/qqbot');
    expect(resolvePluginHome('/test/profile-b/qqbot', '/home/user')).toBe('/test/profile-b/qqbot');
  });

  it('rejects a relative directory rather than storing preferences under the launch cwd', () => {
    expect(() => resolvePluginHome('qqbot-data', '/home/user')).toThrow('absolute path');
  });
});
