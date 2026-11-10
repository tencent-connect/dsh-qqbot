import { describe, expect, it } from 'vitest';
import { whitelistCsv, whitelistEntries } from './whitelist-export.ts';
import type { ClaimedMember } from '../shared/pairing-protocol.ts';

const member = (openid: string, nickname = '小明'): ClaimedMember =>
  ({ openid, nickname, scene: 'c2c', sceneName: '私聊', claimedAt: 0 });

describe('whitelist export', () => {
  it('copies ID:name entries one per line, keeping spaces in names and omitting empty names', () => {
    expect(whitelistEntries([
      member('ABCD1234EFGH', ''), member('WXYZ5678', '小明'), member('IJKL0000', 'Alice Zhang'),
    ])).toBe('ABCD1234EFGH\nWXYZ5678:小明\nIJKL0000:Alice Zhang');
  });

  it('preserves list order without duplicate IDs or empty nickname suffixes', () => {
    expect(whitelistEntries([member('a', '  小明  '), member('b', '   '), member('a', 'other')]))
      .toBe('a:小明\nb');
    expect(whitelistEntries([])).toBe('');
  });

  it.each(['owner', 'allow-c2c', 'allow-group'] as const)('exports %s with a typed header and escaped names', purpose => {
    const csv = whitelistCsv([member('full-id', '小明,"Alice"\n张')], purpose);
    expect(csv).toContain('\uFEFF"昵称","OpenID","名单类型"\r\n');
    expect(csv).toContain('"小明,""Alice""\n张","full-id"');
    expect(csv).toContain(purpose === 'owner' ? '斜杠命令白名单' : purpose === 'allow-group' ? '群白名单' : '私聊白名单');
  });

  it.each(['=1+1', '+formula', '-1+2', '@SUM(A1)', '\t=1', '  =1'])('neutralizes spreadsheet formulas in %j', name => {
    expect(whitelistCsv([member('id', name)], 'owner')).toContain(`"'${name}"`);
  });
});
