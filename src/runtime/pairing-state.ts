import { existsSync, readFileSync } from 'node:fs';
import { atomicWrite } from '../shared/atomic-file.ts';
import type { PairChallenge, PairClaimResult } from '../shared/pairing-protocol.ts';

/** Revocation is authorization state, independent of best-effort claim receipts. */
export interface StoredPairChallenge extends PairChallenge { readonly revokedOpenids: string[] }

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('配对状态格式无效');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100_000) throw new Error('配对身份格式无效');
  return value;
}
function time(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('配对时间格式无效');
  return value;
}
function result(input: unknown): PairClaimResult {
  const value = object(input);
  if (value.scene !== 'group' && value.scene !== 'c2c') throw new Error('配对结果格式无效');
  const state = value.state;
  if (state !== 'added' && state !== 'existing' && state !== 'revoked') throw new Error('配对结果格式无效');
  const openid = text(value.openid);
  if (!openid || openid.length > 1024) throw new Error('配对身份格式无效');
  return { openid, nickname: text(value.nickname), scene: value.scene, sceneName: text(value.sceneName), claimedAt: time(value.claimedAt), state };
}

/** Short-lived bearer codes remain private and survive a profile-triggered reload. */
export function readPairingState(path: string): StoredPairChallenge[] {
  if (!existsSync(path)) return [];
  const data = object(JSON.parse(readFileSync(path, 'utf8')));
  if (data.version !== 1 || !Array.isArray(data.challenges) || data.challenges.length > 20) throw new Error('配对状态版本或数量无效');
  const codes = new Set<string>();
  return data.challenges.map(input => {
    const value = object(input);
    const code = text(value.code);
    const purpose = value.purpose;
    if (!/^[2-9A-HJ-NP-Z]{6}$/.test(code) || codes.has(code) || (purpose !== 'owner' && purpose !== 'allow-c2c' && purpose !== 'allow-group') || !Array.isArray(value.claims)) throw new Error('配对码格式无效');
    codes.add(code);
    const createdAt = time(value.createdAt); const expiresAt = time(value.expiresAt);
    if (expiresAt <= createdAt) throw new Error('配对期限无效');
    const revoked: unknown = value.revokedOpenids === undefined ? [] : value.revokedOpenids;
    if (!Array.isArray(revoked)) throw new Error('配对撤销记录格式无效');
    const revokedOpenids = revoked.map(id => {
      const openid = text(id);
      if (!openid || openid.length > 1024) throw new Error('配对撤销身份格式无效');
      return openid;
    });
    return { code, purpose, createdAt, expiresAt, claims: value.claims.map(result), revokedOpenids: [...new Set(revokedOpenids)] };
  });
}

export function writePairingState(path: string, challenges: StoredPairChallenge[]): void {
  atomicWrite(path, [JSON.stringify({ version: 1, challenges })]);
}
