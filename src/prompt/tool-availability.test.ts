import { afterEach, describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import Agents, { type Agent } from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import SystemPrompt, { type AssembleContext, type PromptAssembly } from '@deepseek-ai/dsh-system-prompt';
import Tools, { defineTool } from '@deepseek-ai/dsh-tools';
import * as Native from '@deepseek-ai/dsh-tool-executor-native';
import { installQQPrompt } from './install.ts';
import type { QQScope } from './scope.ts';
import { TOOL_AVAILABILITY_SECTION_NAME, toolAvailabilityText } from './tool-availability.ts';

const contexts: Context[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
});

function inventory(assembly: PromptAssembly): string {
  return assembly.sections.find(section => section.name === TOOL_AVAILABILITY_SECTION_NAME)?.text ?? '';
}

function tool(name: string) {
  return defineTool({
    name, description: name, parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => { throw new Error('Prompt tests must not execute tools'); },
  });
}

/** In-process public registries only: no persistence, listener, QQ or model requests. */
async function runtime() {
  const root = new Context(); contexts.push(root);
  await root.plugin(LlmRuntime);
  await root.plugin(SessionStore);
  await root.plugin(SessionProjections);
  await root.plugin(SystemPrompt);
  await root.plugin(Tools);
  await root.plugin(Native);
  await root.plugin(Agents);
  await root.plugin(AgentLoop, { agents: [] });
  let owner: Context | undefined;
  await root.plugin({ inject: ['agents', 'tools', 'systemPrompt'], apply(ctx: Context) { owner = ctx; } });
  if (owner === undefined) throw new Error('Prompt test dependencies unavailable');
  const ctx = owner;
  const create = async (id: string, scope: QQScope = 'c2c') => {
    const handle = await ctx.agents.create({ sessionId: SessionId(id) });
    const prompt = installQQPrompt(handle.agent.ctx, { scope, personaCard: () => '', extraPrompts: () => ({}) });
    return { ...handle, prompt };
  };
  const resolve = (agent: Agent) => ctx.tools.resolve({
    agent, modelSelection: { provider: 'fixture', model: 'fixture' }, signal: new AbortController().signal,
  });
  const assemble = async (agent: Agent) => {
    const toolSet = await resolve(agent);
    try { return await ctx.systemPrompt.assemble({ agent, scope: agent, toolSet }); }
    finally { toolSet.dispose(); }
  };
  return { ctx, create, resolve, assemble };
}

describe('QQ current tool inventory text', () => {
  it('uses the confirmed wording and an explicit empty inventory', () => {
    expect(toolAvailabilityText([])).toBe('当前可用工具（完整清单）：无。\n工具权限会动态更新，请以本次请求的工具清单为准。历史回答中“没有工具”的判断不代表当前能力。');
  });

  it('sorts names without mutating their source or adding changing metadata', () => {
    const names = ['web_search', 'read', 'web_fetch'];
    const text = toolAvailabilityText(names);
    expect(text.split('\n')[0]).toBe('当前可用工具（完整清单）：read、web_fetch、web_search。');
    expect(toolAvailabilityText(['web_fetch', 'web_search', 'read'])).toBe(text);
    expect(toolAvailabilityText(names)).toBe(text);
    expect(names).toEqual(['web_search', 'read', 'web_fetch']);
  });
});

describe('QQ tool inventory with native in-process registries', () => {
  it('follows no tools -> fetch -> search and tool removal without reinstalling', async () => {
    const h = await runtime();
    const { agent } = await h.create('qq-live-inventory');
    expect(inventory(await h.assemble(agent))).toBe(toolAvailabilityText([]));

    let fetchReady = false;
    let searchReady = false;
    const removeSearch = h.ctx.tools.register(tool('web_search'), { when: () => searchReady });
    h.ctx.tools.register(tool('web_fetch'), { when: () => fetchReady });
    expect(h.ctx.tools.definitions(agent).map(definition => definition.name)).toEqual(['web_search', 'web_fetch']);
    expect(inventory(await h.assemble(agent))).toBe(toolAvailabilityText([]));

    fetchReady = true;
    expect(inventory(await h.assemble(agent))).toBe(toolAvailabilityText(['web_fetch']));
    searchReady = true;
    expect(inventory(await h.assemble(agent))).toBe(toolAvailabilityText(['web_fetch', 'web_search']));
    expect(inventory(await h.assemble(agent))).toBe(toolAvailabilityText(['web_fetch', 'web_search']));
    fetchReady = false;
    expect(inventory(await h.assemble(agent))).toBe(toolAvailabilityText(['web_search']));
    removeSearch();
    expect(inventory(await h.assemble(agent))).toBe(toolAvailabilityText([]));
  });

  it('reflects permission restrictions and removed registrations even within an admitted step', async () => {
    const h = await runtime();
    const { agent } = await h.create('qq-permission-inventory');
    const removeFetch = h.ctx.tools.register(tool('web_fetch'));
    h.ctx.tools.register(tool('web_search'));
    const toolSet = await h.resolve(agent);
    const render = () => h.ctx.systemPrompt.assemble({ agent, scope: agent, toolSet });
    try {
      expect(inventory(await render())).toBe(toolAvailabilityText(['web_fetch', 'web_search']));
      const allowFetchOnly = agent.ctx.tools.restrict({ allow: ['web_fetch'] });
      expect(inventory(await render())).toBe(toolAvailabilityText(['web_fetch']));
      const disableAll = agent.ctx.tools.restrict({ allow: [] });
      expect(inventory(await render())).toBe(toolAvailabilityText([]));
      disableAll();
      expect(inventory(await h.assemble(agent))).toBe(toolAvailabilityText(['web_fetch']));
      removeFetch();
      expect(inventory(await render())).toBe(toolAvailabilityText([]));
      allowFetchOnly();
      expect(inventory(await h.assemble(agent))).toBe(toolAvailabilityText(['web_search']));
    } finally { toolSet.dispose(); }
  });

  it('omits capability assertions without agent and step admission even when the catalog has tools', async () => {
    const h = await runtime();
    const { agent } = await h.create('qq-diagnostic-inventory');
    h.ctx.tools.register(tool('web_fetch'));
    const toolSet = await h.resolve(agent);
    try {
      const missingContexts: AssembleContext[] = [{}, { scope: agent }, { agent, scope: agent }, { scope: agent, toolSet }];
      for (const context of missingContexts) {
        expect(inventory(await h.ctx.systemPrompt.assemble(context))).toBe('');
      }
      const section = (await h.ctx.systemPrompt.assemble({ agent, scope: agent, toolSet })).sections
        .find(section => section.name === TOOL_AVAILABILITY_SECTION_NAME);
      expect(section?.text).toBe(toolAvailabilityText(['web_fetch']));
      expect(section?.interpolate).toBe(false);
    } finally { toolSet.dispose(); }
  });

  it('keeps group, private and unrelated agents isolated and disposes the QQ contribution', async () => {
    const h = await runtime();
    const group = await h.create('qq-group-inventory', 'group');
    const direct = await h.create('qq-direct-inventory', 'c2c');
    const unrelated = await h.ctx.agents.create({ sessionId: SessionId('ordinary-agent') });
    group.agent.ctx.tools.register(tool('web_search'));
    direct.agent.ctx.tools.register(tool('web_fetch'));
    expect(inventory(await h.assemble(group.agent))).toBe(toolAvailabilityText(['web_search']));
    expect(inventory(await h.assemble(direct.agent))).toBe(toolAvailabilityText(['web_fetch']));
    expect(inventory(await h.assemble(unrelated.agent))).toBe('');
    group.prompt.dispose();
    expect(inventory(await h.assemble(group.agent))).toBe('');
    expect(inventory(await h.assemble(direct.agent))).toBe(toolAvailabilityText(['web_fetch']));
  });
});
