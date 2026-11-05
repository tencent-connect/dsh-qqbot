import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWrite } from './atomic-file.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it('preserves the previous private state and removes a partial replacement if serialization fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'qq-private-write-')); roots.push(root);
  const path = join(root, 'state.json'); atomicWrite(path, ['original']);
  function* broken() { yield 'partial'; throw new Error('serialization failed'); }
  expect(() => atomicWrite(path, broken())).toThrow('serialization failed');
  expect(readFileSync(path, 'utf8')).toBe('original'); expect(readdirSync(root)).toEqual(['state.json']);
  if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
});
