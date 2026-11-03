import { describe, expect, it } from 'vitest';
import type { SessionManager } from '../session/session-manager.ts';
import { selectionMenuAccess } from './auth.ts';

describe('selection menus without an owner directory service', () => {
  const manager = {} as SessionManager;

  it.each(['model', 'preset'] as const)('does not grant QQ %s access without an owner directory', kind => {
    const access = selectionMenuAccess({ manager }, 'group', 'group', 'actor', kind);
    expect(access.editable).toBe(false);
    expect(access.allows('otherwise-available')).toBe(false);
  });

  it.each(['model', 'preset'] as const)('preserves explicit authenticated web-owner %s access', kind => {
    const access = selectionMenuAccess({ manager, origin: 'web-owner' }, 'group', 'group', 'web-identity', kind);
    expect(access.editable).toBe(true);
    expect(access.allows('otherwise-available')).toBe(true);
  });
});
