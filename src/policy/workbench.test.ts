/** Native workbench policy behavior against the linked Host's actual registry and Agents. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { createUserMessage, LlmAdapter, ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import Agents from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools, { defineTool, type ToolExecutor } from '@deepseek-ai/dsh-tools';
import * as Native from '@deepseek-ai/dsh-tool-executor-native';
import { bindScopeParent, createScope, scopeOf } from '@deepseek-ai/dsh-scope';
import { executeModelToolFixture } from '@deepseek-ai/dsh-tool-testkit';
import { ConfigSchema } from '../config.ts';
import { SessionManager } from '../session/session-manager.ts';
import type { DshAgentRegistry, SessionRecord } from '../session/types.ts';
import { ConversationService } from '../runtime/conversation-service.ts';
import { ConversationStore } from '../conversations/index.ts';
import { catalogTools, defaultPolicy, installPolicy } from './index.ts';

const profile = vi.hoisted(() => ({ dir: null as string | null }));
vi.mock('../shared/index.ts', async original => ({ ...await original<typeof import('../shared/index.ts')>(), getProfileDir: () => profile.dir }));

vi.mock('../model/model-resolver.ts', () => ({
  ModelResolver: class {
    private readonly ids = new Map<string, string>();
    resolveDefault() { return { provider: 'fixture', model: 'fixture' }; }
    getEffectiveRoute() { return this.resolveDefault(); }
    getResumeRoute() { return this.resolveDefault(); }
    getPreset() { return undefined; }
    getSessionId(key: string) { return this.ids.get(key); }
    setSessionId(key: string, id: string) { this.ids.set(key, id); }
  },
}));

vi.mock('../host/adapter.ts', () => ({ createHostAdapter: (ctx: Context) => ({ capabilities: [], resolveAgent: async (id: string) => ctx.agents.get(SessionId(id)) }) }));

const contexts: Context[] = [];
const roots: string[] = [];
afterEach(async () => {
  profile.dir = null;
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function runtime() {
  const ctx = new Context(); contexts.push(ctx);
  await ctx.plugin(LlmRuntime);
  await ctx.plugin(SessionStore);
  await ctx.plugin(SessionProjections);
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(Tools);
  await ctx.plugin(Native);
  await ctx.plugin(Agents);
  await ctx.plugin(AgentLoop, { agents: [] });
  let owner: Context | undefined;
  await ctx.plugin({ inject: ['agents', 'tools', 'systemPrompt', 'llm'], apply(child: Context) { owner = child; } });
  if (!owner) throw new Error('test dependency context unavailable');
  const first = createScope(owner, {});
  const second = createScope(owner, {});
  let count = 0;
  for (const [scope, name] of [[first, 'before'], [first, 'memory_write'], [second, 'after'], [second, 'ungranted']] as const) {
    scope.ctx.tools.register(defineTool({
      name, description: name, parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => { count++; return name; },
    }));
  }
  return { ctx: owner, first, second, count: () => count };
}

describe('native workbench tool ownership', () => {
  it.each([
    { scope: 'group', mapped: true }, { scope: 'c2c', mapped: true },
    { scope: 'group', mapped: false }, { scope: 'c2c', mapped: false },
  ] as const)('aborts a real $scope tool before its delayed write with QQ mapping $mapped', async ({ scope, mapped }) => {
    const h = await runtime();
    const root = await mkdtemp(join(tmpdir(), 'qq-live-revocation-')); roots.push(root);
    profile.dir = root;
    await writeFile(join(root, 'cordis.patch.yml'), '- id: im-qqbot\n  config:\n    appId: live-revocation\n');
    const marker = join(root, 'late-side-effect.txt');
    const entered = Promise.withResolvers<void>();
    let aborted = false;
    h.second.ctx.tools.register(defineTool({ name: 'delayed_fixture', description: 'local cancellation fixture', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async (_args, exec) => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { writeFileSync(marker, 'completed'); resolve(); }, 80);
          exec.signal.addEventListener('abort', () => { aborted = true; clearTimeout(timer); reject(new Error('cancelled')); }, { once: true });
          entered.resolve();
        });
        return 'written';
      },
    }));
    h.ctx.llm.registerAdapter(['revocation-fixture'], new class extends LlmAdapter {
      async *stream(): AsyncIterable<StreamChunk> {
        const callId = ToolCallId('delayed-tool-call');
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'tool-call-delta', index: 0, id: callId, name: 'delayed_fixture', argumentsDelta: '{}' };
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name: 'delayed_fixture', arguments: '{}' } };
        yield { type: 'finish', reason: { kind: 'tool-calls' } };
      }
    }());
    const config = ConfigSchema({ appId: 'live-revocation', cwd: root,
      access: { groupMode: 'allowlist', groupAllow: ['peer'], c2cMode: 'allowlist', c2cAllow: ['peer'] } });
    let record: SessionRecord | undefined;
    const manager = { getDefaultModel: () => ({ provider: 'revocation-fixture', model: 'local' }), getDefaultPreset: () => '',
      getSessionRecord: () => mapped ? record : undefined, findBySessionId: () => mapped ? record : undefined,
    } as unknown as SessionManager;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const service = new ConversationService(h.ctx, manager, config, logger, root); manager.conversations = service;
    const entry = service.entry(scope, 'peer');
    const handle = await h.ctx.agents.create({ sessionId: SessionId(`running-${scope}-${mapped}`), agentOptions: { provider: 'revocation-fixture', model: 'local' } });
    const agentScope = scopeOf(handle.agent.ctx); const parent = scopeOf(h.second.ctx);
    if (!agentScope || !parent) throw new Error('test scope unavailable');
    bindScopeParent(agentScope, parent);
    record = { sessionKey: entry.key, sessionId: handle.agent.id, scope, peerId: 'peer', senderId: 'actor', agent: handle.agent, handle, replyTarget: { scope, targetId: 'peer' }, lastActivity: Date.now() };
    service.attach(record);
    try {
      handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'run local delayed tool' }] }));
      await entered.promise;
      expect(handle.agent.status).toBe('running');
      handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'queued local task' }] }));
      expect(handle.agent.inbox.nextTurn).toHaveLength(1);
      expect(service.revokePair('peer', scope === 'group' ? 'allow-group' : 'allow-c2c').ok).toBe(true);
      await handle.agent.whenIdle();
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(aborted).toBe(true);
      expect(existsSync(marker)).toBe(false);
      expect(handle.agent.inbox.nextTurn).toHaveLength(0);
      expect(handle.agent.session.snapshotEvents().filter(event => event.type === 'turn/end').map(event => event.data.reason)).toEqual([{ kind: 'aborted', reason: { kind: 'user' } }]);
    } finally { await handle.dispose(); }
  });
  it('enforces the repaired custom tool ceiling against real tool execution after reload', async () => {
    const h = await runtime();
    const root = await mkdtemp(join(tmpdir(), 'qq-reloaded-policy-')); roots.push(root);
    const store = new ConversationStore(root, 'reloaded-policy');
    const entry = store.ensure('c2c', 'peer');
    store.updateSettings(entry.key, entry.policy.version, { ...entry.settings!, execution: { kind: 'custom', permission: 'read-only', tools: ['after'] } }, '', true);
    const path = join(root, `conversations-${createHash('sha256').update('reloaded-policy').digest('hex')}.json`);
    const catalog = JSON.parse(await readFile(path, 'utf8'));
    catalog.entries[0].policy.nativeTools = true;
    await writeFile(path, JSON.stringify(catalog));
    const reloaded = new ConversationStore(root, 'reloaded-policy');
    const handle = await h.ctx.agents.create({ sessionId: SessionId('reloaded-custom-policy') });
    const scope = scopeOf(handle.agent.ctx); const parent = scopeOf(h.second.ctx);
    if (!scope || !parent) throw new Error('test scope unavailable');
    bindScopeParent(scope, parent);
    const dispose = installPolicy(handle.agent.ctx, { agentId: handle.agent.id, getPolicy: () => reloaded.get(entry.key)?.policy, getCatalog: () => catalogTools(h.ctx.tools, handle.agent) });
    try {
      expect((await h.ctx.systemPrompt.assemble({ scope: handle.agent })).tools.map(tool => tool.name)).toEqual(['after']);
      const execute = (name: string) => executeModelToolFixture(h.ctx, { agent: handle.agent, name, callId: ToolCallId(`reloaded-${name}`), arguments: {}, signal: new AbortController().signal });
      expect((await execute('after')).isError).toBe(false);
      expect((await execute('ungranted')).isError).toBe(true);
      expect(h.count()).toBe(1);
    } finally { dispose(); await handle.dispose(); }
  });
  it.each(['restricted', 'native'] as const)('blocks retired tools from declarations and real execution in %s mode', async toolMode => {
    const h = await runtime();
    const handle = await h.ctx.agents.create({ sessionId: SessionId(`retired-policy-${toolMode}`) });
    const key = scopeOf(handle.agent.ctx); const parent = scopeOf(h.first.ctx);
    if (!key || !parent) throw new Error('test scope unavailable');
    bindScopeParent(key, parent);
    const policy = { ...defaultPolicy('custom', '/tmp'), toolMode, tools: { before: 'allow' as const, memory_write: 'allow' as const } };
    const dispose = installPolicy(handle.agent.ctx, { agentId: handle.agent.id, getPolicy: () => policy, getCatalog: () => catalogTools(h.ctx.tools, handle.agent) });
    expect((await h.ctx.systemPrompt.assemble({ scope: handle.agent })).tools.map(tool => tool.name)).toEqual(['before']);
    const denied = await executeModelToolFixture(h.ctx, { agent: handle.agent, name: 'memory_write', callId: ToolCallId('retired-call'), arguments: {}, signal: new AbortController().signal });
    expect(denied.isError).toBe(true); expect(h.count()).toBe(0);
    const allowed = await executeModelToolFixture(h.ctx, { agent: handle.agent, name: 'before', callId: ToolCallId('allowed-call'), arguments: {}, signal: new AbortController().signal });
    expect(allowed.isError).toBe(false); expect(h.count()).toBe(1);
    dispose(); await handle.dispose();
  });

  it('inherits the preset executor and applies the QQ tool ceiling before side effects', async () => {
    const h = await runtime();
    const native = new Native.NativeToolExecutor(h.first.ctx);
    const inherited: ToolExecutor = {
      describe: tools => {
        const description = native.describe(tools);
        return { ...description, schemas: description.schemas.map(tool => ({ ...tool, description: `preset executor: ${tool.description}` })) };
      },
      execute: input => native.execute(input),
    };
    h.first.ctx.tools.setExecutor(inherited);
    const handle = await h.ctx.agents.create({ sessionId: SessionId('native-policy') });
    const key = scopeOf(handle.agent.ctx); const parent = scopeOf(h.first.ctx);
    if (!key || !parent) throw new Error('test scope unavailable');
    bindScopeParent(key, parent);
    let policy = { ...defaultPolicy('custom', '/tmp'), toolMode: 'native' as const, tools: { before: 'allow' as const } };
    const dispose = installPolicy(handle.agent.ctx, { agentId: handle.agent.id, getPolicy: () => policy, getCatalog: () => catalogTools(h.ctx.tools, handle.agent) });
    const assembly = await h.ctx.systemPrompt.assemble({ scope: handle.agent });
    expect(assembly.tools.map(tool => [tool.name, tool.description])).toEqual([['before', 'preset executor: before']]);
    const run = () => executeModelToolFixture(h.ctx, { agent: handle.agent, name: 'before', callId: ToolCallId('before-call'), arguments: {}, signal: new AbortController().signal });
    expect((await run()).isError).toBe(false); expect(h.count()).toBe(1);
    policy = { ...policy, version: policy.version + 1, receiveEnabled: false };
    expect((await run()).isError).toBe(true); expect(h.count()).toBe(1);
    dispose(); await handle.dispose();
  });

  it('applies the current policy to a fresh composition and its in-process child', async () => {
    const h = await runtime();
    const root = await mkdtemp(join(tmpdir(), 'qq-composition-policy-')); roots.push(root);
    let selected = h.first.ctx;
    const registry: DshAgentRegistry = {
      get: id => h.ctx.agents.get(SessionId(id)),
      create: options => h.ctx.agents.create({ ...options, sessionId: SessionId(options.sessionId), setup: async ctx => {
        const scope = scopeOf(ctx); const parent = scopeOf(selected);
        if (!scope || !parent) throw new Error('test scope unavailable');
        bindScopeParent(scope, parent);
        await options.setup?.(ctx);
      } }),
      resume: options => h.ctx.agents.resume({ ...options, resumeSessionId: SessionId(options.resumeSessionId) }),
    };
    const config = ConfigSchema({ appId: 'native-policy', cwd: root, sessionIdleTimeout: 0, access: { c2cMode: 'open', c2cAllow: [], groupMode: 'disabled', groupAllow: [] } });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const manager = new SessionManager(h.ctx, registry, config, logger);
    const service = new ConversationService(h.ctx, manager, config, logger, root); manager.conversations = service;
    const entry = service.entry('c2c', 'peer');
    service.store.updatePolicy(entry.key, entry.policy.version, { ...entry.policy, toolMode: 'native', nativeTools: false, tools: { before: 'allow', after: 'allow' } });
    const first = await manager.getOrCreate('c2c', 'peer', 'peer', { scope: 'c2c', targetId: 'peer' });
    expect((await h.ctx.systemPrompt.assemble({ scope: first.agent })).tools.map(tool => tool.name)).toContain('before');
    selected = h.second.ctx;
    const next = await manager.replaceSession('c2c', 'peer');
    expect(next.sessionId).not.toBe(first.sessionId);
    const names = (await h.ctx.systemPrompt.assemble({ scope: next.agent })).tools.map(tool => tool.name);
    expect(names).toContain('after'); expect(names).not.toContain('before'); expect(names).not.toContain('ungranted');
    const actual = h.ctx.agents.get(SessionId(next.sessionId));
    if (!actual) throw new Error('test Agent unavailable');
    const child = await h.ctx.agents.create({ sessionId: SessionId('qq-native-child'), parentAgent: actual,
      meta: { parentSession: actual.id, cwd: root }, setup: ctx => {
        const scope = scopeOf(ctx); const parent = scopeOf(actual.ctx);
        if (!scope || !parent) throw new Error('child scope unavailable');
        bindScopeParent(scope, parent);
      } });
    const allowed = await executeModelToolFixture(h.ctx, { agent: child.agent, name: 'after', callId: ToolCallId('child-after'), arguments: {}, signal: new AbortController().signal });
    expect(allowed, JSON.stringify(allowed)).toMatchObject({ isError: false });
    expect((await executeModelToolFixture(h.ctx, { agent: child.agent, name: 'ungranted', callId: ToolCallId('child-ungranted'), arguments: {}, signal: new AbortController().signal })).isError).toBe(true);
    const revoke = service.requireEntry(entry.key).policy;
    service.store.updatePolicy(entry.key, revoke.version, { ...revoke, tools: { ...revoke.tools, after: 'deny' } });
    expect((await executeModelToolFixture(h.ctx, { agent: child.agent, name: 'after', callId: ToolCallId('revoked-child'), arguments: {}, signal: new AbortController().signal })).isError).toBe(true);
    expect(h.count()).toBe(1);
    await child.dispose(); await next.handle.dispose();
  });

});
