import { describe, expect, it } from 'vitest';
import { defaultPolicy, validatePolicy } from './validation.ts';
import { CONTEXT_LIMITS, CONVERSATION_SANDBOX_MODES } from '../shared/policy-settings.ts';
import { transitionPolicy } from '../client/conversation-state.ts';

/** Real persistence validation must accept the exact draft produced by the editor helpers. */
describe('permission form to persistence validation', () => {
  it('starts ordinary conversations with native read-only execution and no tool grants', () => {
    const policy = defaultPolicy();
    expect(policy.toolMode).toBe('native');
    expect(policy.tools).toEqual({});
    expect(policy.permission).toBe('read-only');
    expect(policy.allowedPermissions).toEqual(['read-only']);
    expect(validatePolicy(policy)).toEqual(policy);
  });
  it('keeps legacy and explicitly directory-scoped policies restricted', () => {
    const legacy = defaultPolicy();
    delete legacy.toolMode;
    expect(validatePolicy(legacy).toolMode).toBe('restricted');
    expect(defaultPolicy('readonly').toolMode).toBe('restricted');
    expect(defaultPolicy('project').toolMode).toBe('restricted');
  });
  it.each(CONVERSATION_SANDBOX_MODES)('saves an explicitly authorized native %s selection without a hidden sandbox edit', permission => {
    const current = defaultPolicy('custom', '/project');
    current.toolMode = 'native'; current.allowedPermissions = [...CONVERSATION_SANDBOX_MODES];
    const result = transitionPolicy({ current, change: { kind: 'permission', permission }, catalog: [], permissionIds: CONVERSATION_SANDBOX_MODES });
    if (result.kind === 'blocked') throw new Error(result.reason);
    const next = result.policy;
    expect(validatePolicy(next)).toEqual(next);
    expect(next.resources.sandbox).toBe(permission);
    expect(current.resources.sandbox).toBe('read-only');
  });
  it('preserves an actual custom Host id and the separately declared sandbox without manufacturing a built-in grant', () => {
    const current = defaultPolicy('custom', '/project'); current.allowedPermissions.push('研究/审批');
    const result = transitionPolicy({ current, change: { kind: 'permission', permission: '研究/审批' }, catalog: [], permissionIds: ['read-only', '研究/审批'] });
    if (result.kind === 'blocked') throw new Error(result.reason);
    const next = result.policy;
    expect(validatePolicy(next)).toEqual(next);
    expect(next.permission).toBe('研究/审批'); expect(next.resources.sandbox).toBe('read-only');
    expect(next.allowedPermissions).toEqual(['read-only', '研究/审批']);
    expect(transitionPolicy({ current, change: { kind: 'permission', permission: 'danger-full-access' }, catalog: [], permissionIds: CONVERSATION_SANDBOX_MODES }).kind).toBe('blocked');
  });
  it('continues rejecting forged known-preset/sandbox mismatches instead of normalizing a broader sandbox', () => {
    const current = defaultPolicy('custom', '/project'); current.toolMode = 'native'; current.allowedPermissions.push('danger-full-access'); current.permission = 'danger-full-access';
    expect(() => validatePolicy(current)).toThrow('沙箱模式与当前权限模式必须一致');
  });
  it('uses the shared context limits at the real persistence boundary', () => {
    const current = defaultPolicy('custom', '/project'); current.context.maxChars = CONTEXT_LIMITS.maxChars.max;
    expect(validatePolicy(current).context.maxChars).toBe(32000);
    current.context.maxChars += 1;
    expect(() => validatePolicy(current)).toThrow('maxChars 必须在 0 到 32000 之间');
    current.context.maxChars = 10.5;
    expect(() => validatePolicy(current)).toThrow('maxChars');
  });
  it('makes a directory-scoped readonly template restricted even when starting from native capabilities', () => {
    const current = defaultPolicy('custom', '/project'); current.toolMode = 'native'; current.resources.readRoots = ['/docs'];
    const result = transitionPolicy({ current, change: { kind: 'template', template: 'readonly' }, catalog: [{ id: 'read', name: 'read', description: '', category: 'file', constraint: 'read-path', available: true }], permissionIds: CONVERSATION_SANDBOX_MODES });
    if (result.kind === 'blocked') throw new Error(result.reason);
    const next = result.policy;
    expect(next.toolMode).toBe('restricted'); expect(next.tools.read).toBe('allow');
    expect(validatePolicy(next)).toEqual(next);
  });
});
