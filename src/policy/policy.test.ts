import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { assertPathAllowed, catalogTools, defaultPolicy, installPolicy, stableToolId, toolCatalogEntry, validatePolicy, validatePolicyTools } from './index.ts';
import type { PolicyExecution, PolicyTools } from './index.ts';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function workspace() {
  const path = await mkdtemp(join(tmpdir(), 'qq-policy-'));
  temporary.push(path);
  const allowed = join(path, 'allowed');
  const other = join(path, 'other');
  await Promise.all([mkdir(allowed), mkdir(other)]);
  await Promise.all([writeFile(join(allowed, 'ok.txt'), 'public'), writeFile(join(other, 'secret.txt'), 'secret')]);
  return { path, allowed, other };
}

describe('policy validation and identity', () => {
  it('every template is independently mutable and grants no future tool implicitly', () => {
    for (const name of ['chat', 'roleplay', 'readonly', 'project', 'custom'] as const) {
      const one = defaultPolicy(name, '/tmp');
      const two = defaultPolicy(name, '/tmp');
      expect(validatePolicy(one)).toEqual(one);
      one.tools.new_tool = 'allow';
      expect(two.tools).toEqual({});
    }
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid revision %s', version => {
    expect(() => validatePolicy({ ...defaultPolicy(), version })).toThrow();
  });
  it('rejects invalid defaults, relative roots and execution in readonly template', () => {
    const policy = defaultPolicy();
    expect(() => validatePolicy({ ...policy, permission: 'workspace-write' })).toThrow();
    expect(() => validatePolicy({ ...policy, resources: { ...policy.resources, readRoots: ['relative'] } })).toThrow();
    expect(() => validatePolicy({ ...defaultPolicy('readonly'), resources: { ...policy.resources, executionEnabled: true } })).toThrow();
  });
  it('drops retired legacy policy fields and tool rules while preserving other permissions', () => {
    const policy = { ...defaultPolicy('custom', '/tmp'), tools: { ask_user_question: 'ask' as const } };
    const parsed = validatePolicy({ ...policy, memoryGrants: { project: 'readwrite' }, tools: { ...policy.tools, memory_get: 'ask', memory_write: 'allow', memory_future: 'allow' } });
    expect(parsed).toEqual(policy);
    expect(parsed).not.toHaveProperty('memoryGrants');
  });
  it('does not infer MCP identity from lossy normalized public names', () => {
    const name = 'mcp__norm_server__norm_tool_0123456789ab';
    expect(stableToolId(name)).toBe(name);
    expect(stableToolId(name, new Map([[name, { server: 'server/a', tool: 'tool/b' }]]))).toBe('mcp:["server/a","tool/b"]');
  });
  it('rejects a directory-scoped readonly claim for an unknown MCP tool', () => {
    const policy = defaultPolicy('readonly');
    policy.tools.mcp__files__read = 'allow';
    expect(() => validatePolicyTools(policy, [toolCatalogEntry({ name: 'mcp__files__read' })])).toThrow('只读范围适配');
  });
  it('requires resource roots and rejects unsupported network-domain restrictions', () => {
    const policy = defaultPolicy('custom');
    policy.tools.read = 'allow';
    expect(() => validatePolicyTools(policy, [toolCatalogEntry({ name: 'read' })])).toThrow('读取目录');
    policy.tools = { mcp__biz__query: 'ask' };
    policy.resources.networkDomains = ['example.com'];
    expect(() => validatePolicyTools(policy, [toolCatalogEntry({ name: 'mcp__biz__query' })])).toThrow('域名限制');
  });
  it('keeps unverified delegation backends unavailable even with an explicit allow', () => {
    const policy = defaultPolicy('custom'); policy.tools.subagent = 'allow';
    const tool = toolCatalogEntry({ name: 'subagent' });
    expect(tool.available).toBe(false);
    expect(() => validatePolicyTools(policy, [tool])).toThrow('不可用');
  });
  it('keeps retired tool names unavailable even with an explicit legacy allow', () => {
    const policy = defaultPolicy('custom'); policy.tools.memory_future = 'allow';
    const tool = toolCatalogEntry({ name: 'memory_future' });
    expect(tool.available).toBe(false);
    expect(() => validatePolicyTools(policy, [tool])).toThrow('不可用');
  });
});

describe('canonical resource boundaries', () => {
  it('reads only the allowed tree, including sibling-prefix denial', async () => {
    const w = await workspace();
    await expect(assertPathAllowed('ok.txt', [w.allowed], w.allowed)).resolves.toBe(await realpath(join(w.allowed, 'ok.txt')));
    await expect(assertPathAllowed(join(w.other, 'secret.txt'), [w.allowed], w.allowed)).rejects.toThrow('超出');
    await mkdir(`${w.allowed}-sibling`);
    await writeFile(join(`${w.allowed}-sibling`, 'x'), 'private');
    await expect(assertPathAllowed(join(`${w.allowed}-sibling`, 'x'), [w.allowed], w.allowed)).rejects.toThrow('超出');
  });
  it('denies symlink escapes and symlink plus parent traversal', async () => {
    const w = await workspace();
    await symlink(w.other, join(w.allowed, 'link'));
    await expect(assertPathAllowed('link/secret.txt', [w.allowed], w.allowed)).rejects.toThrow('超出');
    await expect(assertPathAllowed('link/../allowed/ok.txt', [w.allowed], w.allowed)).rejects.toThrow('父目录');
  });
  it('writes may target absent children but cannot follow a dangling symlink', async () => {
    const w = await workspace();
    await expect(assertPathAllowed('new/deep.txt', [w.allowed], w.allowed, true)).resolves.toBe(join(await realpath(w.allowed), 'new/deep.txt'));
    await symlink(join(w.other, 'absent'), join(w.allowed, 'dangling'));
    await expect(assertPathAllowed('dangling', [w.allowed], w.allowed, true)).rejects.toThrow('符号链接');
  });
  it('expands home paths before checking, rather than treating ~ as a workspace child', async () => {
    const w = await workspace();
    await expect(assertPathAllowed('~', [w.allowed], w.allowed)).rejects.toThrow('超出');
  });
});

type Gate = { kind: 'allow' } | { kind: 'deny'; reason: string } | { kind: 'cancel' } | { kind: 'ask'; reason?: string };
function harness(policy = defaultPolicy('custom', '/tmp')) {
  const handlers = new Map<string, Function>();
  const guards: Array<(exec: PolicyExecution) => string | undefined> = [];
  const body = vi.fn(async () => ({ isError: false, content: [] }));
  const definitions = ['read', 'write', 'bash', 'mine', 'mcp__biz__query'].map(name => ({ name }));
  const tools: PolicyTools = {
    definitions: () => definitions,
    restrict: vi.fn(() => () => {}),
    guard: guard => { guards.push(guard); return () => { guards.splice(guards.indexOf(guard), 1); }; },
  };
  const approval = { request: vi.fn(async () => 'allowed-once') };
  const ctx = {
    get: (name: string) => name === 'tools' ? tools : name === 'approval' ? approval : undefined,
    on: (event: string, handler: Function) => { handlers.set(event, handler); return () => handlers.delete(event); },
  } as unknown as Context;
  let current = policy;
  const dispose = installPolicy(ctx, { getPolicy: () => current, getCatalog: () => catalogTools(tools), getSandboxMode: () => 'read-only' });
  const invoke = async (name: string, input: unknown = {}, changeAfterPolicy?: () => void, agent: unknown = {}) => {
    const exec: PolicyExecution = { name, arguments: input, token: Symbol(), signal: new AbortController().signal, agent };
    const gate: Gate = await handlers.get('tools/pre-execute')?.(exec, async () => ({ kind: 'allow' }));
    changeAfterPolicy?.();
    if (gate.kind === 'deny') return gate.reason;
    if (gate.kind !== 'allow') return 'not allowed';
    for (const guard of guards) {
      const reason = guard(exec);
      if (reason) return reason;
    }
    const result = await handlers.get('tools/execute')?.(exec, body);
    handlers.get('tools/result')?.(exec, result);
    return result;
  };
  return { invoke, body, policy, approval, guards, dispose, set: (p: typeof policy) => { current = p; } };
}

describe('execution gates before side effects (controlled Host boundary)', () => {
  it('native tool mode follows actual Agent tools without an explicit catalog selection and retains descendant and outbound guards', async () => {
    const policy = { ...defaultPolicy('chat', '/tmp'), nativeTools: true };
    const h = harness(policy);
    expect(await h.invoke('read', { file_path: '/outside/agent-controls-this' })).toMatchObject({ isError: false });
    expect(await h.invoke('newly_mounted_agent_tool')).toMatchObject({ isError: false });
    expect(h.body).toHaveBeenCalledTimes(2);
    expect(await h.invoke('present', { files: [{ path: '/tmp/file' }] })).toContain('没有授权资源目录');
    expect(await h.invoke('newly_mounted_agent_tool', {}, undefined, { id: 'unprotected-child' })).toContain('权限继承');
    expect(h.body).toHaveBeenCalledTimes(2);
    expect(policy.tools).toEqual({});
  });
  it('a policy without the nativeTools flag stays restricted to its explicit tools', async () => {
    const policy = defaultPolicy('chat', '/tmp'); delete policy.nativeTools; policy.tools.read = 'allow';
    const h = harness(policy);
    await h.invoke('read', { file_path: '/outside/native-sandbox' });
    expect(await h.invoke('newly_mounted_agent_tool')).toContain('未授权');
    expect(h.body).toHaveBeenCalledTimes(1);
  });
  it('denies guessed, scope-local and reserved run_code names in roleplay', async () => {
    const h = harness(defaultPolicy('roleplay', '/tmp'));
    for (const name of ['read', 'mine', 'run_code', 'mcp__biz__query']) expect(await h.invoke(name)).toContain('未授权');
    expect(h.body).not.toHaveBeenCalled();
  });
  it('denies retired names even if an unparsed legacy policy still allows them', async () => {
    const policy = defaultPolicy('custom', '/tmp'); policy.tools.memory_future = 'allow';
    const h = harness(policy);
    expect(await h.invoke('memory_future')).toContain('未授权');
    expect(h.body).not.toHaveBeenCalled();
  });
  it('allows a scoped read but denies write, traversal and cross-tree access', async () => {
    const w = await workspace();
    const policy = defaultPolicy('readonly', w.allowed);
    policy.tools = { read: 'allow', write: 'allow' };
    policy.resources.readRoots = [w.allowed];
    const h = harness(policy);
    await h.invoke('read', { file_path: 'ok.txt' });
    expect(h.body).toHaveBeenCalledTimes(1);
    await h.invoke('read', { file_path: join(w.other, 'secret.txt') });
    await h.invoke('write', { file_path: 'x', content: 'bad' });
    expect(h.body).toHaveBeenCalledTimes(1);
  });
  it('resolves relative paths using the actual Session cwd after a pending workspace change', async () => {
    const w = await workspace();
    await writeFile(join(w.allowed, 'secret.txt'), 'allowed version');
    const policy = defaultPolicy('readonly', w.allowed); policy.tools.read = 'allow'; policy.resources.readRoots = [w.allowed];
    const h = harness(policy);
    const actualAgent = { session: { header: { cwd: w.other } } };
    expect(await h.invoke('read', { file_path: 'secret.txt' }, undefined, actualAgent)).toContain('超出');
    expect(h.body).not.toHaveBeenCalled();
  });
  it('requires approval for the precise MCP call and rechecks revocation after approval', async () => {
    const policy = defaultPolicy('custom', '/tmp');
    policy.tools.mcp__biz__query = 'ask';
    const h = harness(policy);
    await h.invoke('mcp__biz__query');
    expect(h.approval.request).toHaveBeenCalledTimes(1);
    expect(h.body).toHaveBeenCalledTimes(1);
    await h.invoke('mcp__biz__query', {}, () => h.set({ ...policy, version: 2, tools: {} }));
    expect(h.body).toHaveBeenCalledTimes(1);
  });
  it('missing, rejected or throwing approvers cannot grant execution', async () => {
    const policy = defaultPolicy('custom', '/tmp');
    policy.tools.mine = 'ask';
    const h = harness(policy);
    h.approval.request.mockResolvedValueOnce('unavailable').mockRejectedValueOnce(new Error('failed'));
    await h.invoke('mine'); await h.invoke('mine');
    expect(h.body).not.toHaveBeenCalled();
  });
  it('a direct guard check cannot bypass resource validation or approval', () => {
    const policy = defaultPolicy('custom', '/tmp');
    policy.tools.mine = 'ask';
    const h = harness(policy);
    const execution: PolicyExecution = { name: 'mine', arguments: {}, token: Symbol(), signal: new AbortController().signal };
    expect(h.guards[0]?.(execution)).toContain('未经资源检查');
    expect(h.body).not.toHaveBeenCalled();
  });
  it('requires explicit execution grant and a real matching sandbox', async () => {
    const policy = defaultPolicy('custom', '/tmp');
    policy.tools.bash = 'allow';
    const h = harness(policy);
    expect(await h.invoke('bash')).toContain('未启用');
    h.set({ ...policy, version: 2, resources: { ...policy.resources, executionEnabled: true, sandbox: 'workspace-write' } });
    expect(await h.invoke('bash')).toContain('沙箱');
    expect(h.body).not.toHaveBeenCalled();
  });
  it('approval cannot escalate an execution beyond the group sandbox ceiling', async () => {
    const policy = defaultPolicy('custom', '/tmp');
    policy.tools.bash = 'allow'; policy.resources.executionEnabled = true;
    const h = harness(policy);
    expect(await h.invoke('bash', { sandbox_permissions: 'require_escalated' })).toContain('授权范围之外');
    expect(await h.invoke('bash', { sandbox_permissions: 'danger-full-access' })).toContain('授权范围之外');
    expect(h.body).not.toHaveBeenCalled();
  });
  it('disposal removes final guard and scoped listeners', () => {
    const h = harness();
    h.dispose();
    expect(h.guards).toEqual([]);
  });
});
