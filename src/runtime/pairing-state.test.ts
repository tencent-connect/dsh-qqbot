import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PairingService } from './pairing-service.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function stateFile(): string { const root = mkdtempSync(join(tmpdir(), 'qq-pair-batch-')); roots.push(root); return join(root, 'pairing.json'); }

describe('persistent pairing batches', () => {
  it('survives a service reload and preserves results from multiple writers without reviving a stopped code', () => {
    const path = stateFile(); const first = new PairingService({ stateFile: path });
    const challenge = first.issue('allow-c2c');
    first.recordResult(challenge.code, { openid: 'one', nickname: '小明', scene: 'c2c', sceneName: '', claimedAt: Date.now(), state: 'added' });
    const reloaded = new PairingService({ stateFile: path });
    expect(reloaded.hasActiveCode(challenge.code)).toBe(true);
    reloaded.recordResult(challenge.code, { openid: 'two', nickname: 'Alice', scene: 'c2c', sceneName: '', claimedAt: Date.now(), state: 'added' });
    expect(first.listChallenges()[0]?.claims.map(member => member.openid)).toEqual(['one', 'two']);
    first.end(challenge.code, 'allow-c2c');
    expect(reloaded.hasActiveCode(challenge.code)).toBe(false);
  });
  it.skipIf(process.platform === 'win32')('stores bearer codes with private POSIX permissions (Windows has no POSIX mode bits)', () => {
    const path = stateFile(); new PairingService({ stateFile: path }).issue('allow-c2c');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
  it('removes expired codes from disk and keeps account files independent', () => {
    let now = 1000; const a = stateFile(); const b = stateFile();
    const first = new PairingService({ stateFile: a, now: () => now }); const code = first.issue('allow-group');
    const second = new PairingService({ stateFile: b, now: () => now });
    expect(second.hasActiveCode(code.code)).toBe(false);
    now = code.expiresAt;
    expect(new PairingService({ stateFile: a, now: () => now }).listChallenges()).toEqual([]);
    expect(JSON.parse(readFileSync(a, 'utf8')).challenges).toEqual([]);
  });
  it('rejects corrupt persisted batches instead of creating new authorization state', () => {
    const path = stateFile(); const broken = '{"version":1,"challenges":[{"code":"bad"}]}'; writeFileSync(path, broken);
    expect(() => new PairingService({ stateFile: path })).toThrow('配对码格式无效');
    expect(readFileSync(path, 'utf8')).toBe(broken);
  });
});
