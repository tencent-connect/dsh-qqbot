import type { PairClaimResult } from '../shared/pairing-protocol.ts';

/** Keep the window's order and avoid counting repeated claims as new additions. */
export function mergePairResults(previous: readonly PairClaimResult[], incoming: readonly PairClaimResult[]): PairClaimResult[] {
  const results = new Map(previous.map(result => [result.openid, result]));
  for (const result of incoming) {
    const key = result.openid;
    const prior = results.get(key);
    results.set(key, { ...result, state: prior?.state === 'added' && result.state === 'existing' ? 'added' : result.state });
  }
  return [...results.values()];
}
