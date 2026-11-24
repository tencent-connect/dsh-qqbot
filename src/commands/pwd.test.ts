/**
 * /pwd 命令用例：当前位置标签与降级提示。
 */
import { describe, it, expect, vi } from 'vitest';
import { pwdCommand } from './pwd.ts';

const CONFIG = { textChunkLimit: 4500 } as never;

function makeManager(header: string | undefined) {
  return {
    currentLocationHeader: vi.fn(async () => header),
  } as never;
}

function makeCmdCtx() {
  return {
    message: { senderId: 'u1', kind: 'c2c' },
    command: { raw: '' },
    bot: { sendMarkdown: vi.fn() },
    replyTarget: { scope: 'c2c', targetId: 'u1' },
  } as never;
}

describe('/pwd 命令', () => {
  it('显示当前位置标签（与回复头同格式）', async () => {
    const manager = makeManager('**A 项目 - 登录页优化**');
    const cmd = pwdCommand({ manager, config: CONFIG });

    const result = await cmd.handler!(makeCmdCtx(), {} as never);

    expect(result).toBe('**A 项目 - 登录页优化**');
    expect(manager.currentLocationHeader).toHaveBeenCalledWith('c2c', 'u1');
  });

  it('无活跃会话：给出可操作提示', async () => {
    const cmd = pwdCommand({ manager: makeManager(undefined), config: CONFIG });

    const result = await cmd.handler!(makeCmdCtx(), {} as never);

    expect(String(result)).toContain('当前无活跃会话');
    expect(String(result)).toContain('/sessions');
  });

  it('命令面向私聊与群聊（scope=all）', () => {
    const cmd = pwdCommand({ manager: makeManager('**x**'), config: CONFIG });
    expect(cmd.scope).toBe('all');
  });
});
