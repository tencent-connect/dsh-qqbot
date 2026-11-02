import { describe, expect, it } from 'vitest';
import { PairingService } from './pairing-service.ts';
import { generatePairCode, normalizePairCode, openidTail } from '../shared/pairing-protocol.ts';

describe('pairing service', () => {
  it('issues a code, redeems it once, then rejects reuse', () => {
    const now = () => 1000;
    const svc = new PairingService({ now, random: () => 0 }); // deterministic code
    const c = svc.issue('owner');
    expect(c.purpose).toBe('owner');
    const first = svc.consume(c.code);
    expect(first).toEqual({ ok: true, purpose: 'owner' });
    expect(svc.consume(c.code)).toEqual({ ok: false, reason: 'unknown' }); // single-use
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
});
