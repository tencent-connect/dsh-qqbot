import { afterEach, expect, it, vi } from 'vitest';
import { fsyncSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWrite } from './atomic-file.ts';

const roots: string[] = [];
const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, fsyncSync: vi.fn(actual.fsyncSync), openSync: vi.fn(actual.openSync) };
});

afterEach(() => {
  vi.mocked(fsyncSync).mockReset();
  vi.mocked(openSync).mockReset();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'qq-private-write-'));
  roots.push(root);
  return root;
}

it('preserves the previous private state and removes a partial replacement if serialization fails', () => {
  const root = tempRoot();
  const path = join(root, 'state.json'); atomicWrite(path, ['original']);
  function* broken() { yield 'partial'; throw new Error('serialization failed'); }
  expect(() => atomicWrite(path, broken())).toThrow('serialization failed');
  expect(readFileSync(path, 'utf8')).toBe('original'); expect(readdirSync(root)).toEqual(['state.json']);
  if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
});

it('initializes and replaces state on Windows without opening its directory for sync', () => {
  const root = tempRoot();
  const path = join(root, 'state.json');
  vi.mocked(openSync).mockImplementation((name, flags, mode) => {
    if (name === root) throw new Error('Windows directory sync unavailable');
    return realFs.openSync(name, flags, mode);
  });
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  try {
    expect(() => atomicWrite(path, ['initial'])).not.toThrow();
    expect(readFileSync(path, 'utf8')).toBe('initial');
    expect(() => atomicWrite(path, ['replacement'])).not.toThrow();
  } finally {
    Object.defineProperty(process, 'platform', platform);
  }
  expect(readFileSync(path, 'utf8')).toBe('replacement');
  expect(vi.mocked(fsyncSync)).toHaveBeenCalledTimes(2);
});

it.skipIf(process.platform === 'win32')('reports a directory sync failure after replacement as a durability warning', () => {
  const root = tempRoot();
  const path = join(root, 'state.json');
  atomicWrite(path, ['original']);
  const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
  const failure = new Error('directory sync failed');
  vi.mocked(fsyncSync)
    .mockImplementationOnce(realFs.fsyncSync)
    .mockImplementationOnce(() => { throw failure; });
  let writeError: unknown;
  try { atomicWrite(path, ['replacement']); } catch (error) { writeError = error; }
  expect(readFileSync(path, 'utf8')).toBe('replacement');
  expect(writeError).toBeUndefined();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining(failure.message), { code: 'QQBOT_DIRECTORY_SYNC_FAILED' });
});

it('leaves the original state and removes the temp file if syncing the replacement fails', () => {
  const root = tempRoot();
  const path = join(root, 'state.json');
  atomicWrite(path, ['original']);
  vi.mocked(fsyncSync).mockImplementationOnce(() => { throw new Error('file sync failed'); });
  expect(() => atomicWrite(path, ['replacement'])).toThrow('file sync failed');
  expect(readFileSync(path, 'utf8')).toBe('original');
  expect(readdirSync(root)).toEqual(['state.json']);
});
