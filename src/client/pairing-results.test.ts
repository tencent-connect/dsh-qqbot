import { describe, expect, it } from 'vitest';
import { mergePairResults } from './pairing-results.ts';
import type { PairClaimResult } from '../shared/pairing-protocol.ts';

const member: PairClaimResult = { openid: 'complete-openid', nickname: '小明', scene: 'c2c', sceneName: '', claimedAt: 1234, state: 'added' };
describe('adding-window results', () => {
  it('accumulates identities without losing names, complete ids or earlier additions on a repeated poll', () => {
    const merged = mergePairResults([member], [{ ...member, state: 'existing' }, { ...member, openid: 'other', nickname: 'Alice' }]);
    expect(merged).toEqual([member, { ...member, openid: 'other', nickname: 'Alice' }]);
    expect(mergePairResults(merged, [member])).toEqual(merged);
  });
  it('shows revocations and does not duplicate the same member after a scene update', () => {
    expect(mergePairResults([member], [{ ...member, state: 'revoked' }])[0]?.state).toBe('revoked');
    expect(mergePairResults([member], [{ ...member, scene: 'group' }])).toEqual([{ ...member, scene: 'group' }]);
  });
});
