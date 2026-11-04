import type { ClaimedMember, PairPurpose } from '../shared/pairing-protocol.ts';
import { PAIR_PURPOSE_LABEL } from '../shared/pairing-protocol.ts';

export function whitelistOpenIds(members: readonly ClaimedMember[]): string {
  return [...new Set(members.map(member => member.openid))].join('\n');
}

/** Quote CSV fields and neutralize spreadsheet formulas in editable display names. */
export function whitelistCsv(members: readonly ClaimedMember[], purpose: PairPurpose): string {
  const field = (value: string): string => {
    const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows = [
    ['昵称', 'OpenID', '名单类型'],
    ...members.map(member => [member.nickname, member.openid, PAIR_PURPOSE_LABEL[purpose]]),
  ];
  return '\uFEFF' + rows.map(row => row.map(field).join(',')).join('\r\n') + '\r\n';
}

export function downloadWhitelist(members: readonly ClaimedMember[], purpose: PairPurpose): void {
  const url = URL.createObjectURL(new Blob([whitelistCsv(members, purpose)], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `qq-${purpose}-whitelist.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
