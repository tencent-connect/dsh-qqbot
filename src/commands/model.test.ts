import { describe, expect, it, vi } from 'vitest';
import type { SlashCommandHandlerContext } from '@tencent-connect/qqbot-nodejs';
import { ConfigSchema } from '../config.ts';
import type { SessionManager } from '../session/session-manager.ts';
import { modelCommand } from './model.ts';

function harness(raw = '', kind: 'c2c' | 'group' = 'c2c') {
  const sendMarkdown = vi.fn(async (_target: unknown, _content: string): Promise<void> => {});
  const manager = {
    restoreExisting: vi.fn(async (): Promise<undefined> => undefined),
    getEffectiveModel: vi.fn(() => ({ provider: 'effective', model: 'planned' })),
    getDefaultModel: vi.fn(() => ({ provider: 'web', model: 'default' })),
    getStatus: vi.fn(() => ({ active: true, provider: 'actual', model: 'current' })),
    listAvailableModels: vi.fn(async () => [{ provider: 'actual', id: 'current', name: 'Current model' }]),
    setModelOverride: vi.fn(async (_scope: string, _peer: string, _route: { provider: string; model: string }): Promise<void> => {}),
    clearModelOverride: vi.fn(async (_scope: string, _peer: string): Promise<void> => {}),
  };
  const ctx = {
    message: { kind, senderId: 'owner', groupOpenid: 'group-a' }, command: { raw },
    bot: { sendMarkdown }, replyTarget: { scope: kind, targetId: kind === 'group' ? 'group-a' : 'owner' },
  } as unknown as SlashCommandHandlerContext;
  const command = modelCommand({ manager: manager as unknown as SessionManager, config: ConfigSchema({}) });
  return { manager, sendMarkdown, run: () => command.handler(ctx) };
}

describe('/model defaults and scope', () => {
  it.each(['reset', 'default'])('awaits %s and clears only the current peer override', async (argument) => {
    const { manager, run } = harness(argument, 'group');
    let finish: (() => void) | undefined;
    manager.clearModelOverride.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    let settled = false;
    const result = Promise.resolve(run()).then((value) => { settled = true; return value; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(manager.clearModelOverride).toHaveBeenCalledExactlyOnceWith('group', 'group-a');
    expect(manager.setModelOverride).not.toHaveBeenCalled();
    finish?.();
    expect(await result).toContain('恢复 QQ 网页默认');
  });

  it('uses the active provider for a short id, then falls back to the latest default without an active session', async () => {
    const { manager, run } = harness('other-model');
    await run();
    expect(manager.setModelOverride).toHaveBeenCalledExactlyOnceWith('c2c', 'owner', { provider: 'actual', model: 'other-model' });
    manager.getStatus.mockReturnValue({ active: false, provider: 'actual', model: 'current' });
    manager.getEffectiveModel.mockReturnValue({ provider: 'updated-host', model: 'new-default' });
    await run();
    expect(manager.setModelOverride).toHaveBeenLastCalledWith('c2c', 'owner', { provider: 'updated-host', model: 'other-model' });
  });

  it('restores a cold Session before resolving a short model id', async () => {
    const { manager, run } = harness('other-model', 'group');
    manager.getStatus.mockReturnValue({ active: false, provider: '', model: '' });
    manager.restoreExisting.mockImplementationOnce(async () => {
      manager.getStatus.mockReturnValue({ active: true, provider: 'stored-provider', model: 'stored-model' });
      return undefined;
    });
    expect(await run()).toContain('已切换');
    expect(manager.restoreExisting).toHaveBeenCalledExactlyOnceWith('group', 'group-a', {
      senderId: 'owner', replyTarget: { scope: 'group', targetId: 'group-a', msgId: undefined },
    });
    expect(manager.setModelOverride).toHaveBeenCalledExactlyOnceWith('group', 'group-a', { provider: 'stored-provider', model: 'other-model' });
  });

  it('shows the stored actual model after cold restoration', async () => {
    const { manager, run, sendMarkdown } = harness();
    manager.restoreExisting.mockImplementationOnce(async () => {
      manager.getStatus.mockReturnValue({ active: true, provider: 'stored-provider', model: 'stored-model' });
      return undefined;
    });
    await run();
    expect(sendMarkdown.mock.calls[0]?.[1]).toContain('当前模型:** stored-provider/stored-model');
    expect(manager.setModelOverride).not.toHaveBeenCalled();
  });

  it('does not report success or use a default when cold restoration fails', async () => {
    const { manager, run } = harness('reset');
    manager.restoreExisting.mockRejectedValueOnce(new Error('stored Session unreadable'));
    expect(await run()).toBe('无法恢复当前会话：stored Session unreadable');
    expect(manager.setModelOverride).not.toHaveBeenCalled();
    expect(manager.clearModelOverride).not.toHaveBeenCalled();
  });

  it('keeps slash-containing model ids and scopes a change to the current group', async () => {
    const { manager, run } = harness('provider/family/model', 'group');
    expect(await run()).toContain('QQ 网页默认不变');
    expect(manager.setModelOverride).toHaveBeenCalledExactlyOnceWith('group', 'group-a', { provider: 'provider', model: 'family/model' });
  });

  it('shows the actual current model separately from the configured QQ default', async () => {
    const { manager, sendMarkdown, run } = harness();
    expect(await run()).toEqual({ kind: 'noop' });
    const content = sendMarkdown.mock.calls[0]?.[1];
    expect(content).toContain('当前模型:** Current model');
    expect(content).toContain('QQ 网页默认:** web/default');
    expect(content).toContain('/model reset');
    expect(manager.setModelOverride).not.toHaveBeenCalled();
    expect(manager.clearModelOverride).not.toHaveBeenCalled();
  });

  it('reports switch and reset failures without claiming success', async () => {
    const change = harness('live/missing');
    change.manager.setModelOverride.mockRejectedValueOnce(new Error('模型不可用'));
    expect(await change.run()).toBe('模型切换失败：模型不可用');
    const reset = harness('reset');
    reset.manager.clearModelOverride.mockRejectedValueOnce(new Error('当前正在生成'));
    expect(await reset.run()).toBe('模型重置失败：当前正在生成');
  });

  it('does not fall back to a fabricated provider when a default is unavailable', async () => {
    const { manager, run } = harness('short-id');
    manager.getStatus.mockReturnValue({ active: false, provider: '', model: '' });
    manager.getEffectiveModel.mockImplementation(() => { throw new Error('未配置默认模型'); });
    expect(await run()).toContain('无法解析模型提供方');
    expect(manager.setModelOverride).not.toHaveBeenCalled();
  });

  it('reports catalog errors rather than sending a stale successful menu', async () => {
    const { manager, run, sendMarkdown } = harness();
    manager.listAvailableModels.mockRejectedValueOnce(new Error('目录离线'));
    expect(await run()).toBe('无法读取模型配置：目录离线');
    expect(sendMarkdown).not.toHaveBeenCalled();
  });
});
