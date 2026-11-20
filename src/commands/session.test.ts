import { describe, it, expect, vi } from 'vitest';
import type { SlashCommandHandlerContext } from '@tencent-connect/qqbot-nodejs';
import { unarchiveCommand } from './session.ts';
import type { CommandDeps } from './types.ts';
import type { UnarchiveOutcome } from '../session/types.ts';

function context(): SlashCommandHandlerContext {
  return { message: { kind: 'c2c', senderId: 'user1', messageId: 'msg1' } } as unknown as SlashCommandHandlerContext;
}

describe('/unarchive 命令', () => {
  it.each([
    ['ok', '已恢复这条对话'],
    ['not-archived', '没有被归档'],
    ['no-session', '还没有开始过对话'],
    ['failed', '没能恢复这条对话'],
  ] as const)('%s → 对应提示', async (outcome: UnarchiveOutcome, expected: string) => {
    const manager = { unarchive: vi.fn(async () => outcome) } as unknown as CommandDeps['manager'];
    const command = unarchiveCommand({ manager } as CommandDeps);

    expect(await command.handler(context())).toContain(expected);
    expect(manager.unarchive).toHaveBeenCalledWith('c2c', 'user1');
  });
});
