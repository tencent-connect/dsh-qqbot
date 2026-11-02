import { describe, expect, it, vi } from 'vitest';
import type { SlashCommandHandlerContext } from '@tencent-connect/qqbot-nodejs';
import { ConfigSchema } from '../config.ts';
import type { SessionManager } from '../session/session-manager.ts';
import { stopCommand } from './misc.ts';

function fixture(status: 'idle' | 'running' = 'running') {
  const agent = { status, cancel: vi.fn() };
  const record = { agent };
  const restoreExisting = vi.fn(async () => record);
  const assertCommandAuthority = vi.fn();
  const manager = { restoreExisting, conversations: { assertCommandAuthority } } as unknown as SessionManager;
  const command = stopCommand({ manager, config: ConfigSchema({}) });
  const context = { message: { kind: 'group', senderId: 'actor', groupOpenid: 'group' } } as unknown as SlashCommandHandlerContext;
  return { agent, restoreExisting, assertCommandAuthority, run: () => command.handler(context) };
}

describe('/stop in a shared native Session', () => {
  it('restores the native Session and preserves queued QQ and Web work', async () => {
    const f = fixture();
    expect(await f.run()).toContain('已中止');
    expect(f.restoreExisting).toHaveBeenCalledExactlyOnceWith('group', 'group');
    expect(f.agent.cancel).toHaveBeenCalledExactlyOnceWith({ kind: 'user' }, { keepInbox: true });
  });

  it('does not cancel an idle Session or its inbox', async () => {
    const f = fixture('idle');
    expect(await f.run()).toContain('没有进行中的生成');
    expect(f.agent.cancel).not.toHaveBeenCalled();
  });

  it('rechecks authority after native restoration before cancellation', async () => {
    const f = fixture(); f.assertCommandAuthority.mockImplementationOnce(() => { throw new Error('revoked'); });
    await expect(f.run()).rejects.toThrow('revoked'); expect(f.agent.cancel).not.toHaveBeenCalled();
  });
});
