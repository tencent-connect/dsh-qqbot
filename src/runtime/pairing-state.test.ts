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
  it('loads existing version-one batches and persists revocations without exposing them as claim receipts', () => {
    const path = stateFile();
    writeFileSync(path, JSON.stringify({ version: 1, challenges: [
      { code: 'ABCDEF', purpose: 'allow-c2c', createdAt: 1000, expiresAt: 601000, claims: [] },
    ] }));
    const service = new PairingService({ stateFile: path, now: () => 1000 });
    expect(service.isRevoked('ABCDEF', 'one')).toBe(false);
    service.revokeIdentity('allow-c2c', 'one');
    const reloaded = new PairingService({ stateFile: path, now: () => 1000 });
    expect(reloaded.isRevoked('ABCDEF', 'one')).toBe(true);
    expect(reloaded.listChallenges()[0]?.claims).toEqual([]);
    expect(reloaded.listChallenges()[0]).not.toHaveProperty('revokedOpenids');
  });
  it('scopes a revocation to its purpose, preserves other members and allows a freshly issued code even at the same clock tick', () => {
    const path = stateFile(); const service = new PairingService({ stateFile: path, now: () => 1000 });
    const old = service.issue('allow-c2c'); const group = service.issue('allow-group'); const owner = service.issue('owner');
    service.revokeIdentity('allow-c2c', 'one');
    expect(service.isRevoked(old.code, 'one')).toBe(true);
    expect(service.isRevoked(old.code, 'two')).toBe(false);
    expect(service.isRevoked(group.code, 'one')).toBe(false);
    expect(service.isRevoked(owner.code, 'one')).toBe(false);
    const fresh = service.issue('allow-c2c');
    expect(service.isRevoked(fresh.code, 'one')).toBe(false);
    expect(service.hasActiveCode(old.code)).toBe(true);
    expect(service.listChallenges().every(batch => batch.claims.length === 0)).toBe(true);
  });
  it.each([null, 'not-an-array', [42], [''], ['x'.repeat(1025)]])('rejects an invalid revocation list (%j)', revokedOpenids => {
    const path = stateFile();
    writeFileSync(path, JSON.stringify({ version: 1, challenges: [
      { code: 'ABCDEF', purpose: 'allow-c2c', createdAt: 1000, expiresAt: 601000, claims: [], revokedOpenids },
    ] }));
    expect(() => new PairingService({ stateFile: path })).toThrow();
  });
});
