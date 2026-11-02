/** Optional cross-package gate: run with DSH_POLICY_HOST_ROOT=/absolute/DSH. */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogTools, defaultPolicy, installPolicy, validatePolicyTools } from './index.ts';

const hostRoot = process.env.DSH_POLICY_HOST_ROOT;
const contexts: Array<{ fiber: { dispose(): Promise<void> } }> = [];
const temp: string[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
  await Promise.all(temp.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
async function hostModule(path: string) {
  if (!hostRoot) throw new Error('DSH_POLICY_HOST_ROOT is required');
  return import(pathToFileURL(join(hostRoot, path)).href);
}
async function setup() {
  const [{ Context }, { default: SystemPrompt }, { default: Tools }, scope, native, ptc, runtime] = await Promise.all([
    hostModule('vendor/cordis/lib/index.js'), hostModule('packages/core/system-prompt/lib/index.js'),
    hostModule('packages/core/tools/lib/index.js'), hostModule('packages/core/scope/lib/index.js'),
    hostModule('packages/core/tool-executor-native/lib/index.js'), hostModule('packages/core/tool-executor-ptc/lib/index.js'),
    hostModule('packages/ptc-runtime/ptc-runtime/lib/index.js'),
  ]);
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(SystemPrompt); await ctx.plugin(Tools);
  let runtimeCalls = 0;
  class FixtureRuntime extends runtime.PtcRuntime {
    language = 'typescript'; isolation = 'fixture';
    get sandboxMode() { return 'read-only'; }
    resolve(request: Record<string, unknown>) { return { ...request, cwd: request.cwd ?? '/tmp', timeoutMs: 1000 }; }
    async run() { runtimeCalls++; return { logs: [] }; }
  }
  await ctx.plugin(FixtureRuntime);
  const agent = { id: 'qq-policy-real', session: { id: 'qq-policy-real', header: { id: 'qq-policy-real', cwd: '/tmp' }, append: () => ({ seq: 1 }) } };
  let agentCtx: typeof ctx;
  await ctx.plugin(Object.assign((inner: typeof ctx) => { agentCtx = scope.createScope(inner, agent).ctx; }, { inject: ['tools', 'systemPrompt', 'ptcRuntime'] }));
  const run = async (executor: { execute(input: unknown): Promise<any> }, name: string, args: unknown, key = agent) => {
    const output = await executor.execute({ calls: [{ type: 'tool-call', id: `call-${name}`, name, arguments: JSON.stringify(args) }], signal: new AbortController().signal, agent: key });
    return output.results[0].result;
  };
  return { ctx, agent, agentCtx, scope, native, ptc, run, runtimeCalls: () => runtimeCalls };
}

describe.skipIf(!hostRoot)('actual DSH registry and executor policy integration', () => {
  it('hides reserved PTC and scope-local schemas, preserves unrelated scopes, and safely replaces policy executors', async () => {
    const h = await setup();
    h.ctx.tools.setExecutor(new h.ptc.PtcExecutor(h.ctx));
    h.agentCtx.tools.register({ name: 'local_only', description: 'local fixture', parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text', text: value }] }, execute: async () => 'never',
    });
    expect((await h.ctx.systemPrompt.assemble({ scope: h.agent })).tools.map((tool: { name: string }) => tool.name)).toContain('run_code');
    let policy = defaultPolicy('roleplay', '/tmp');
    const old = installPolicy(h.agentCtx, { agentId: h.agent.id, getPolicy: () => policy });
    expect((await h.ctx.systemPrompt.assemble({ scope: h.agent })).tools).toEqual([]);
    policy = { ...policy, version: 2, tools: { run_code: 'ask' }, resources: { ...policy.resources, executionEnabled: true } };
    const replacement = installPolicy(h.agentCtx, { agentId: h.agent.id, getPolicy: () => policy });
    old();
    expect((await h.ctx.systemPrompt.assemble({ scope: h.agent })).tools.map((tool: { name: string }) => tool.name)).toEqual(['run_code']);
    expect((await h.ctx.systemPrompt.assemble({ scope: { id: 'unrelated' } })).tools.map((tool: { name: string }) => tool.name)).toContain('run_code');
    policy = { ...policy, version: 3, resources: { ...policy.resources, executionEnabled: false } };
    expect((await h.ctx.systemPrompt.assemble({ scope: h.agent })).tools).toEqual([]);
    replacement();
  });
  it('blocks PTC outer run_code before the runtime starts', async () => {
    const h = await setup();
    installPolicy(h.agentCtx, { agentId: h.agent.id, getPolicy: () => defaultPolicy('roleplay', '/tmp') });
    const result = await h.run(new h.ptc.PtcExecutor(h.agentCtx), 'run_code', { code: 'return 1', description: 'verify group roleplay policy' });
    expect(result.isError).toBe(true);
    expect(result.error.message).toContain('未授权');
    expect(h.runtimeCalls()).toBe(0);
  });
  it('rejects subagent_fork before its body even when a saved policy explicitly allows it', async () => {
    const h = await setup();
    let forks = 0;
    h.ctx.tools.register({ name: 'subagent_fork', description: 'controlled fork boundary', parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text', text: value }] },
      execute: async () => { forks++; return 'UNGUARDED_CHILD_CREATED'; },
    });
    const policy = defaultPolicy('custom', '/tmp'); policy.tools.subagent_fork = 'allow';
    const catalog = catalogTools(h.ctx.tools);
    installPolicy(h.agentCtx, { agentId: h.agent.id, getPolicy: () => policy, getCatalog: () => catalog });

    const result = await h.run(new h.native.NativeToolExecutor(h.agentCtx), 'subagent_fork', {});
    expect(result.isError).toBe(true);
    expect(result.error.message).toContain('未授权');
    expect(forks).toBe(0);
    expect((await h.ctx.systemPrompt.assemble({ scope: h.agent })).tools.map((tool: { name: string }) => tool.name)).not.toContain('subagent_fork');
    for (const decision of ['ask', 'allow'] as const) {
      expect(() => validatePolicyTools({ ...policy, tools: { subagent_fork: decision } }, catalog)).toThrow('不可用');
    }
  });
  it('allows an authorized Native read and rejects an escape before its actual read body', async () => {
    const h = await setup();
    const root = await mkdtemp(join(tmpdir(), 'qq-real-policy-'));
    temp.push(root);
    const allowed = join(root, 'allowed'); const outside = join(root, 'outside');
    await Promise.all([mkdir(allowed), mkdir(outside)]);
    await Promise.all([writeFile(join(allowed, 'ok'), 'ok'), writeFile(join(outside, 'private'), 'secret')]);
    let reads = 0;
    h.ctx.tools.register({ name: 'read', description: 'controlled local read', parameters: { type: 'object', properties: { file_path: { type: 'string' } } },
      output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text', text: value }] },
      execute: async (args: { file_path: string }) => { reads++; return readFile(args.file_path, 'utf8'); },
    });
    const policy = defaultPolicy('readonly', allowed); policy.tools.read = 'allow'; policy.resources.readRoots = [allowed];
    const catalog = catalogTools(h.ctx.tools);
    installPolicy(h.agentCtx, { agentId: h.agent.id, getPolicy: () => policy, getCatalog: () => catalog });
    const executor = new h.native.NativeToolExecutor(h.agentCtx);
    expect((await h.run(executor, 'read', { file_path: join(allowed, 'ok') })).isError).toBe(false);
    expect((await h.run(executor, 'read', { file_path: join(outside, 'private') })).isError).toBe(true);
    expect(reads).toBe(1);
  });
  it('keeps an authorized preset-ancestor read visible and executable for the QQ Agent', async () => {
    const h = await setup();
    const directory = await mkdtemp(join(tmpdir(), 'qq-preset-policy-'));
    temp.push(directory);
    const file = join(directory, 'allowed.txt');
    await writeFile(file, 'PRESET_READ_OK');
    const preset = { id: 'qq-preset-fixture' };
    let presetCtx: typeof h.ctx;
    await h.ctx.plugin(Object.assign((inner: typeof h.ctx) => { presetCtx = h.scope.createScope(inner, preset).ctx; }, { inject: ['tools', 'systemPrompt'] }));
    let reads = 0;
    presetCtx.tools.register({ name: 'read', description: 'preset-owned read', parameters: { type: 'object', properties: { file_path: { type: 'string' } } },
      output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text', text: value }] },
      execute: async (args: { file_path: string }) => { reads++; return readFile(args.file_path, 'utf8'); },
    });
    h.scope.bindScopeParent(h.agent, preset);
    expect(h.ctx.tools.definitions().map((definition: { name: string }) => definition.name)).not.toContain('read');
    expect(h.ctx.tools.definitions(h.agent).map((definition: { name: string }) => definition.name)).toContain('read');
    const policy = defaultPolicy('readonly', directory);
    policy.tools.read = 'allow'; policy.resources.readRoots = [directory];
    installPolicy(h.agentCtx, { agentId: h.agent.id, getPolicy: () => policy });
    expect((await h.ctx.systemPrompt.assemble({ scope: h.agent })).tools.map((tool: { name: string }) => tool.name)).toContain('read');
    const result = await h.run(h.ctx.tools, 'read', { file_path: file });
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: 'text', text: 'PRESET_READ_OK' }]);
    expect(reads).toBe(1);
  });
  it('does not apply another group policy to an authorized tool call', async () => {
    const h = await setup();
    let calls = 0;
    h.ctx.tools.register({ name: 'update_plan', description: 'group-scoped fixture', parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text', text: value }] }, execute: async () => { calls++; return 'GROUP_A_OK'; },
    });
    const policyA = defaultPolicy('custom', '/tmp'); policyA.tools.update_plan = 'allow';
    installPolicy(h.agentCtx, { agentId: h.agent.id, getPolicy: () => policyA });
    const other = { id: 'group-b', session: { id: 'group-b', header: { id: 'group-b', cwd: '/tmp' }, append: () => ({ seq: 1 }) } };
    let otherCtx: typeof h.ctx;
    await h.ctx.plugin(Object.assign((inner: typeof h.ctx) => { otherCtx = h.scope.createScope(inner, other).ctx; }, { inject: ['tools', 'systemPrompt', 'ptcRuntime'] }));
    installPolicy(otherCtx, { agentId: other.id, getPolicy: () => defaultPolicy('roleplay', '/tmp') });
    expect((await h.run(h.ctx.tools, 'update_plan', {})).isError).toBe(false);
    expect(calls).toBe(1);
  });
  it('final guards deny own-scope and inherited child tools even when restrictions exempt them', async () => {
    const h = await setup();
    let sideEffects = 0;
    const tool = { name: 'local_mutation', description: 'fixture mutation', parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text', text: value }] },
      execute: async () => { sideEffects++; return 'mutated'; },
    };
    h.agentCtx.tools.register(tool);
    installPolicy(h.agentCtx, { agentId: h.agent.id, getPolicy: () => defaultPolicy('roleplay', '/tmp') });
    const executor = new h.native.NativeToolExecutor(h.agentCtx);
    expect((await h.run(executor, tool.name, {})).isError).toBe(true);
    const child = { id: 'qq-policy-child', session: { id: 'qq-policy-child', header: { id: 'qq-policy-child', cwd: '/tmp' }, append: () => ({ seq: 1 }) } };
    h.scope.bindScopeParent(child, h.agent);
    let childCtx: typeof h.ctx;
    await h.ctx.plugin(Object.assign((inner: typeof h.ctx) => { childCtx = h.scope.createScope(inner, child).ctx; childCtx.tools.register(tool); }, { inject: ['tools', 'systemPrompt', 'ptcRuntime'] }));
    expect((await h.run(new h.native.NativeToolExecutor(childCtx), tool.name, {}, child)).isError).toBe(true);
    expect(sideEffects).toBe(0);
  });
});
