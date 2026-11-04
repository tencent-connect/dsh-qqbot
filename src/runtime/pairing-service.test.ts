import { describe, expect, it } from 'vitest';
import { PairingService } from './pairing-service.ts';
import { generatePairCode, normalizePairCode, openidTail } from '../shared/pairing-protocol.ts';

describe('pairing service', () => {
  it('keeps a code usable for multiple claims until explicitly ended', () => {
    const now = () => 1000;
    const svc = new PairingService({ now, random: () => 0 }); // deterministic code
    const c = svc.issue('owner');
    expect(c.purpose).toBe('owner');
    const first = svc.consume(c.code);
    expect(first).toEqual({ ok: true, purpose: 'owner' });
    expect(svc.consume(c.code)).toEqual({ ok: true, purpose: 'owner' });
    svc.end(c.code, 'owner');
    expect(svc.consume(c.code)).toEqual({ ok: false, reason: 'unknown' });
  });

  it('rejects an expired code', () => {
    let t = 1000;
    const svc = new PairingService({ now: () => t });
    const c = svc.issue('allow-c2c');
    t += 10 * 60 * 1000 + 1;
    expect(svc.consume(c.code)).toEqual({ ok: false, reason: 'expired' });
  });

  it('normalizes user-entered codes (case / spaces / dashes)', () => {
    const svc = new PairingService({ random: () => 0 });
    const c = svc.issue('allow-group');
    const messy = ` ${c.code.toLowerCase().slice(0, 3)}-${c.code.slice(3)} `;
    expect(svc.consume(messy)).toEqual({ ok: true, purpose: 'allow-group' });
  });

  it('reports only unexpired challenges and records claimed members (dedup by openid+scene)', () => {
    let t = 0; const svc = new PairingService({ now: () => t, random: () => 0 });
    const c = svc.issue('owner');
    expect(svc.listChallenges().map((x) => x.code)).toContain(c.code);
    svc.recordClaimed({ openid: 'oid-1234', nickname: '张三', scene: 'group', sceneName: 'G', claimedAt: t });
    svc.recordClaimed({ openid: 'oid-1234', nickname: '张三(改)', scene: 'group', sceneName: 'G', claimedAt: t + 5 });
    expect(svc.listClaimed()).toHaveLength(1);
    expect(svc.listClaimed()[0]?.nickname).toBe('张三(改)');
    svc.forget('oid-1234');
    expect(svc.listClaimed()).toHaveLength(0);
  });

  it('code generator uses the unambiguous alphabet and tail masks openid', () => {
    const code = generatePairCode(() => 0.99);
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    expect(normalizePairCode(' ab-12 cd ')).toBe('AB12CD');
    expect(openidTail('AAABBBCCCDDD')).toBe('…CDDD');
  });

  it('replaces only its own code and leaves other windows and purposes active', () => {
    const svc = new PairingService();
    const first = svc.issue('allow-c2c'); const other = svc.issue('allow-group');
    const second = svc.issue('allow-c2c', first.code);
    expect(svc.hasActiveCode(first.code)).toBe(false);
    expect(svc.hasActiveCode(second.code)).toBe(true);
    expect(svc.hasActiveCode(other.code)).toBe(true);
    expect(() => svc.end(other.code, 'owner')).toThrow('用途不匹配');
    expect(svc.hasActiveCode(other.code)).toBe(true);
    svc.end(second.code, 'allow-c2c'); svc.end(second.code, 'allow-c2c');
  });

  it('does not extend expiry or duplicate a member when recording repeated claims', () => {
    let t = 1000;
    const svc = new PairingService({ now: () => t }); const code = svc.issue('allow-c2c');
    const member = { openid: 'test-id', nickname: '小明', scene: 'c2c', sceneName: '', claimedAt: t, state: 'added' } as const;
    svc.recordResult(code.code, member); svc.recordResult(code.code, { ...member, state: 'existing' });
    expect(svc.listChallenges()[0]?.claims).toEqual([member]);
    t = code.expiresAt;
    expect(svc.hasActiveCode(code.code)).toBe(false);
    expect(svc.consume(code.code)).toEqual({ ok: false, reason: 'expired' });
    expect(svc.listChallenges()).toEqual([]);
  });
});
