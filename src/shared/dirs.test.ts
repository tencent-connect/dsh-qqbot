import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { expandLeadingTilde, PLUGIN_HOME, resolveAgentCwd, resolvePluginHome } from './dirs.ts';

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

describe('legacy Agent working directory', () => {
  it('resolves an explicit relative directory against the original Host launch directory', () => {
    expect(resolveAgentCwd('./workspace')).toBe(resolve(process.cwd(), 'workspace'));
    expect(resolveAgentCwd('../other/project')).toBe(resolve(process.cwd(), '../other/project'));
  });
  it('preserves absolute paths', () => {
    expect(resolveAgentCwd('/tmp/qq-workspace')).toBe('/tmp/qq-workspace');
  });
});

describe('agent 工作目录 ~ 展开', () => {
  it('expands bare ~ and ~/... to the home directory', () => {
    expect(expandLeadingTilde('~', '/home/tester')).toBe('/home/tester');
    expect(expandLeadingTilde('~/work', '/home/tester')).toBe('/home/tester/work');
    expect(expandLeadingTilde('~/a/b/', '/home/tester')).toBe('/home/tester/a/b');
  });

  it('treats ~user, absolute and relative paths as literals', () => {
    expect(expandLeadingTilde('~alice/work', '/home/tester')).toBe('~alice/work');
    expect(expandLeadingTilde('/abs/path', '/home/tester')).toBe('/abs/path');
    expect(expandLeadingTilde('rel/path', '/home/tester')).toBe('rel/path');
  });

  it('resolves ~ through the real home and keeps the empty-string default', () => {
    const home = homedir();
    expect(resolveAgentCwd('~')).toBe(home);
    expect(resolveAgentCwd('~/x')).toBe(resolve(home, 'x'));
    expect(resolveAgentCwd('')).toBe(resolve(PLUGIN_HOME, 'workspace'));
    expect(resolveAgentCwd(undefined)).toBe(resolve(PLUGIN_HOME, 'workspace'));
  });
});
