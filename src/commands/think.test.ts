import { describe, it, expect, vi } from 'vitest';
import { thinkCommand } from './think.ts';
import type { CommandDeps } from './types.ts';
import type { SlashCommandHandlerContext } from '@tencent-connect/qqbot-nodejs';
import type { ModelReasoning, ModelRoute } from '../model/types.ts';
import type { EffortSwitchOutcome } from '../session/types.ts';

const config = {
  textChunkLimit: 4000,
  access: { c2cMode: 'open', c2cAllow: [] },
} as unknown as CommandDeps['config'];

const REASONING: ModelReasoning = {
  efforts: [
    { id: 'low', name: 'Low' },
    { id: 'medium', name: 'Medium' },
    { id: 'high', name: 'High' },
  ],
  defaultEffort: 'high',
};

function makeCtx(raw?: string) {
  const sent: string[] = [];
  const ctx = {
    message: { kind: 'c2c', senderId: 'u1' },
    command: { name: 'think', args: raw ? raw.split(/\s+/) : [], raw: raw ?? '' },
    bot: {
      sendMarkdown: vi.fn(async (_target: unknown, text: string) => {
        sent.push(text);
      }),
    },
    replyTarget: { scope: 'c2c', targetId: 'u1', msgId: 'm1' },
  } as unknown as SlashCommandHandlerContext;
  return { ctx, sent };
}

function makeManager(opts: {
  route?: ModelRoute;
  reasoning?: ModelReasoning;
  effort?: string;
  outcome?: EffortSwitchOutcome;
}): { manager: CommandDeps['manager']; calls: Array<string | null> } {
  const calls: Array<string | null> = [];
  const manager = {
    getEffectiveModel: () => opts.route ?? { provider: 'chatgpt', model: 'gpt-6.1-sol' },
    getReasoningInfo: async () => opts.reasoning,
    getEffectiveEffort: () => opts.effort,
    setEffortOverride: async (_scope: string, _peerId: string, effort: string | null) => {
      calls.push(effort);
      return opts.outcome ?? { ok: true, live: true };
    },
  } as unknown as CommandDeps['manager'];
  return { manager, calls };
}

async function run(raw: string | undefined, manager: CommandDeps['manager']) {
  const cmd = thinkCommand({ manager, config });
  const { ctx, sent } = makeCtx(raw);
  const result = await cmd.handler(ctx);
  const text = typeof result === 'string' ? result : sent.join('\n');
  return { text, result };
}

describe('/think 思考深度命令', () => {
  it('注册为 agent 类、多别名、白名单鉴权', () => {
    const { manager } = makeManager({ reasoning: REASONING });
    const cmd = thinkCommand({ manager, config, logger: { warn() {} } as unknown as CommandDeps['logger'] });
    expect(cmd.name).toEqual(['think', 'effort', 'reasoning', '思考']);
    expect(cmd.category).toBe('agent');
    expect(cmd.scope).toBe('all');
    expect(typeof cmd.authorized).toBe('function');
  });

  it('无参数：列出档位、标注当前与模型默认', async () => {
    const { manager } = makeManager({ reasoning: REASONING });
    const { text, result } = await run(undefined, manager);
    expect(result).toEqual({ kind: 'noop' });
    expect(text).toContain('思考深度');
    expect(text).toContain('/think low');
    expect(text).toContain('/think high');
    expect(text).toContain('**当前档位:** high（未手动设置）');
  });

  it('无参数：已手动设置时展示手动值', async () => {
    const { manager } = makeManager({ reasoning: REASONING, effort: 'low' });
    const { text } = await run(undefined, manager);
    expect(text).toContain('**当前档位:** low');
    expect(text).not.toContain('未手动设置');
  });

  it('设置有效档位：立即生效文案 + 透传 id', async () => {
    const { manager, calls } = makeManager({ reasoning: REASONING });
    const { text } = await run('medium', manager);
    expect(calls).toEqual(['medium']);
    expect(text).toContain('思考深度已切换: Medium (medium)');
    expect(text).toContain('立即生效');
  });

  it('档位匹配忽略大小写与首尾空白', async () => {
    const { manager, calls } = makeManager({ reasoning: REASONING });
    await run('  LOW ', manager);
    expect(calls).toEqual(['low']);
  });

  it('未知档位：报错并列出支持项，不写入偏好', async () => {
    const { manager, calls } = makeManager({ reasoning: REASONING });
    const { text } = await run('ultra', manager);
    expect(calls).toEqual([]);
    expect(text).toContain('未知档位: ultra');
    expect(text).toContain('low / medium / high');
  });

  it('default 恢复默认：清除偏好', async () => {
    const { manager, calls } = makeManager({ reasoning: REASONING, effort: 'low' });
    const { text } = await run('default', manager);
    expect(calls).toEqual([null]);
    expect(text).toContain('已恢复默认思考深度');
  });

  it('default 且未设置过：幂等提示，不调用切换', async () => {
    const { manager, calls } = makeManager({ reasoning: REASONING });
    const { text } = await run('default', manager);
    expect(calls).toEqual([]);
    expect(text).toContain('已是默认档');
  });

  it('模型未公布档位：给出不支持提示', async () => {
    const { manager, calls } = makeManager({ reasoning: undefined });
    const { text } = await run('high', manager);
    expect(calls).toEqual([]);
    expect(text).toContain('不支持调节思考深度');
  });

  it('无活跃会话：提示下次对话生效', async () => {
    const { manager } = makeManager({ reasoning: REASONING, outcome: { ok: true, live: false } });
    const { text } = await run('high', manager);
    expect(text).toContain('下次对话开始时生效');
  });

  it('宿主不支持动态选择：明确提示版本要求', async () => {
    const { manager } = makeManager({
      reasoning: REASONING,
      outcome: { ok: false, reason: 'unsupported' },
    });
    const { text } = await run('high', manager);
    expect(text).toContain('不支持动态调整思考深度');
    expect(text).toContain('0.2.x');
  });

  it('切换失败：回显错误', async () => {
    const { manager } = makeManager({
      reasoning: REASONING,
      outcome: { ok: false, reason: 'failed', message: 'boom' },
    });
    const { text } = await run('high', manager);
    expect(text).toContain('切换失败: boom');
  });
});
