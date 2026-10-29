import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImQQBotConfig } from '../config.ts';
import type { ChatScope, Logger } from '../types.ts';
import type { DshAgent, DshAgentRegistry } from './types.ts';
import { SessionManager } from './session-manager.ts';

// Keep tests independent of the user's saved model preferences and settings.
vi.mock('../model/model-resolver.ts', () => ({
  ModelResolver: class {
    getEffectiveRoute() { return undefined; }
    getResumeRoute() { return undefined; }
    getSessionId() { return undefined; }
    getPreset() { return undefined; }
  },
}));

interface Prompt {
  sections: Array<{ name: string; order: number; text: string }>;
}
type Assemble = (assembly: unknown, context: { agent?: DshAgent }, next: () => Promise<Prompt>) => Promise<Prompt>;

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).reverse().map((dispose) => dispose()));
});

async function promptFile(text: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'qqbot-scope-prompt-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, '群聊提示词.md');
  await writeFile(path, text, 'utf8');
  return path;
}

function harness(config: Partial<ImQQBotConfig>, resume = false) {
  let assemble: Assemble | undefined;
  const ctx = {
    on(event: string, listener: Assemble) {
      if (event === 'system-prompt/assemble') assemble = listener;
    },
    get() { return undefined; },
  } as unknown as Context;
  const handle = (id: string) => ({
    agent: {
      id, ctx, status: 'idle', session: { id, events: [] },
      cancel: vi.fn(), followup: vi.fn(), whenIdle: async () => {},
    } as unknown as DshAgent,
    dispose: async () => {},
  });
  const agents = {
    get: () => undefined,
    resume: vi.fn(async ({ resumeSessionId }: { resumeSessionId: string }) => {
      if (!resume) throw new Error('no persisted session');
      return handle(resumeSessionId);
    }),
    create: vi.fn(async ({ sessionId }: { sessionId: string }) => handle(sessionId)),
  } as unknown as DshAgentRegistry;
  const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const manager = new SessionManager(ctx, agents, {
    appId: 'test', sessionIdleTimeout: 0, ...config,
  } as ImQQBotConfig, logger);
  cleanup.push(() => manager.disposeAll());
  const base: Prompt = { sections: [{ name: 'host', order: 0, text: 'Harness base prompt' }] };
  return {
    manager, agents, base,
    async record(scope: ChatScope) {
      return manager.getOrCreate(scope, `${scope}-peer`, 'sender', {
        scope, targetId: `${scope}-peer`, msgId: 'test-message',
      });
    },
    async assemble(agent?: DshAgent) {
      if (!assemble) throw new Error('prompt hook was not registered');
      return assemble({}, { agent }, async () => base);
    },
  };
}

describe('QQ scope system prompt assembly', () => {
  it('preserves legacy text configuration and isolates group/private prompts', async () => {
    const test = harness({ groupPrompt: '群聊规则', directPrompt: '私聊规则' });
    const group = await test.record('group');
    const direct = await test.record('c2c');
    expect((await test.assemble(group.agent)).sections.map((section) => section.text))
      .toEqual(['Harness base prompt', '群聊规则']);
    expect((await test.assemble(direct.agent)).sections.map((section) => section.text))
      .toEqual(['Harness base prompt', '私聊规则']);
    expect(await test.assemble()).toBe(test.base);
    expect(await test.assemble({ id: 'unrelated' } as DshAgent)).toBe(test.base);
  });

  it.each([false, true])('injects the full file once into a created/resumed session (resume=%s)', async (resume) => {
    const text = '# 群聊规则\n\n你好，世界。\n';
    const path = await promptFile(text);
    const test = harness({
      groupPrompt: '保留但停用的旧文本', groupPromptMode: 'file', groupPromptFile: path,
      directPrompt: '私聊仍使用文本',
    }, resume);
    const group = await test.record('group');
    const assembled = await test.assemble(group.agent);
    expect(assembled.sections).toEqual([
      ...test.base.sections,
      { name: 'qqbot:scope-prompt', order: 90, text },
    ]);
    const direct = await test.record('c2c');
    expect((await test.assemble(direct.agent)).sections.at(-1)?.text).toBe('私聊仍使用文本');
    expect(test.agents.create).toHaveBeenCalledTimes(resume ? 0 : 2);
  });

  it('reads updated file content on the next turn of an existing session', async () => {
    const path = await promptFile('第一版');
    const test = harness({ directPromptMode: 'file', directPromptFile: path });
    const record = await test.record('c2c');
    expect((await test.assemble(record.agent)).sections.at(-1)?.text).toBe('第一版');
    await writeFile(path, '第二版', 'utf8');
    expect((await test.assemble(record.agent)).sections.at(-1)?.text).toBe('第二版');
    expect(await test.record('c2c')).toBe(record);
  });

  it('rejects a missing file rather than sending a request with a missing or fallback prompt', async () => {
    const path = await promptFile('必需规则');
    const test = harness({ groupPrompt: '旧文本', groupPromptMode: 'file', groupPromptFile: path });
    const record = await test.record('group');
    await rm(path);
    await expect(test.assemble(record.agent)).rejects.toThrow();
  });
});
