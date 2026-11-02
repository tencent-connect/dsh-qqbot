import { describe, expect, it } from 'vitest';
import { transitionPolicy } from './conversation-state.ts';
import { defaultPolicy, validatePolicy, validatePolicyTools } from '../policy/validation.ts';

const customPermission = 'Host/研究审批';
const permissionIds = ['read-only', 'workspace-write', 'danger-full-access', customPermission];
const catalog = [
  { id: 'read', name: 'read', description: '', category: 'file', constraint: 'read-path', available: true },
  { id: 'write', name: 'write', description: '', category: 'file', constraint: 'write-path', available: true },
  { id: 'shell', name: 'shell', description: '', category: 'execution', constraint: 'execution', available: true },
  { id: 'network', name: 'network', description: '', category: 'network', constraint: 'unsupported', available: true },
];
function seed(name) {
  const policy = defaultPolicy('custom', '/project');
  policy.allowedPermissions = [...permissionIds]; policy.resources.readRoots = ['/docs'];
  policy.tools = { read: 'allow', write: 'deny', shell: 'deny', network: 'deny' };
  switch (name) {
    case 'restricted readonly': policy.template = 'readonly'; break;
    case 'restricted project':
      policy.template = 'project'; policy.permission = 'workspace-write'; policy.resources.sandbox = 'workspace-write';
      policy.resources.writeRoots = ['/project']; policy.tools.write = 'ask'; break;
    case 'native read-only with inactive roots':
      policy.toolMode = 'native'; policy.resources.writeRoots = ['/legacy']; policy.resources.executionEnabled = true;
      policy.tools.write = 'ask'; policy.tools.shell = 'allow'; break;
    case 'native readonly template with full default':
      policy.toolMode = 'native'; policy.template = 'readonly'; policy.permission = 'danger-full-access';
      policy.resources.sandbox = 'danger-full-access'; policy.resources.writeRoots = ['/legacy']; policy.resources.executionEnabled = true; policy.tools.write = 'allow'; break;
    case 'native custom Host preset':
      policy.toolMode = 'native'; policy.permission = customPermission; policy.resources.sandbox = 'workspace-write';
      policy.resources.writeRoots = ['/legacy']; policy.tools.write = 'ask'; break;
    case 'restricted custom Host preset':
      policy.permission = customPermission; policy.resources.sandbox = 'danger-full-access'; policy.resources.networkDomains = ['example.com']; break;
    default: throw new Error(`Unknown fixture ${name}`);
  }
  return policy;
}
const seeds = ['restricted readonly', 'restricted project', 'native read-only with inactive roots', 'native readonly template with full default', 'native custom Host preset', 'restricted custom Host preset'];
const changes = [
  ...['chat', 'roleplay', 'readonly', 'project', 'custom'].map(template => ({ kind: 'template', template })),
  ...['native', 'restricted'].map(mode => ({ kind: 'tool-mode', mode })),
  ...permissionIds.map(permission => ({ kind: 'permission', permission })),
];
const directories = [
  ['complete catalog', permissionIds],
  ['custom preset only', [customPermission]],
  ['without read-only', ['workspace-write', 'danger-full-access', customPermission]],
];
describe('enabled policy transitions against the actual backend validators', () => {
  it.each(seeds.flatMap(name => directories.map(([directory, ids]) => [name, directory, ids])))('%s / %s', (name, _directory, ids) => {
    const current = seed(name); const original = structuredClone(current);
    expect(validatePolicy(current)).toEqual(current); expect(() => validatePolicyTools(current, catalog)).not.toThrow();
    for (const change of changes) {
      const result = transitionPolicy({ current, change, catalog, permissionIds: ids });
      expect(current).toEqual(original);
      if (result.kind === 'blocked') {
        expect(result.reason.length).toBeGreaterThan(10);
      } else {
        expect(validatePolicy(result.policy), JSON.stringify(change)).toEqual(result.policy);
        expect(() => validatePolicyTools(result.policy, catalog), JSON.stringify(change)).not.toThrow();
      }
    }
  });
  it('blocks changing the readonly default to write or full without silently changing its template', () => {
    const current = seed('restricted readonly');
    for (const permission of ['workspace-write', 'danger-full-access', customPermission]) {
      expect(transitionPolicy({ current, change: { kind: 'permission', permission }, catalog, permissionIds })).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('请先显式选择') });
    }
    expect(current.template).toBe('readonly'); expect(current.permission).toBe('read-only');
  });
  it('revokes restricted project writes when explicitly selecting a non-workspace default', () => {
    const current = seed('restricted project');
    for (const permission of ['read-only', 'danger-full-access', customPermission]) {
      const result = transitionPolicy({ current, change: { kind: 'permission', permission }, catalog, permissionIds });
      expect(result).toMatchObject({ kind: 'ready', policy: { permission, template: 'project', tools: { write: 'deny' }, resources: { writeRoots: [] } } });
    }
    expect(current.tools.write).toBe('ask'); expect(current.resources.writeRoots).toEqual(['/project']);
  });
  it('normalizes readonly native scope on an explicit restricted transition, or blocks if the needed Host preset is absent', () => {
    const current = seed('native readonly template with full default');
    const result = transitionPolicy({ current, change: { kind: 'tool-mode', mode: 'restricted' }, catalog, permissionIds });
    expect(result).toMatchObject({ kind: 'ready', policy: { toolMode: 'restricted', permission: 'read-only', allowedPermissions: ['read-only'], resources: { sandbox: 'read-only', writeRoots: [], executionEnabled: false } } });
    expect(transitionPolicy({ current, change: { kind: 'tool-mode', mode: 'restricted' }, catalog, permissionIds: ['danger-full-access'] })).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('read-only') });
    expect(current.permission).toBe('danger-full-access'); expect(current.resources.writeRoots).toEqual(['/legacy']);
  });
});
