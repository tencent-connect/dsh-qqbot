import type { SlashCommandHandlerContext } from '@tencent-connect/qqbot-nodejs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema } from '../config.ts';
import type { SessionManager } from '../session/session-manager.ts';
import type { PresetSwitchOutcome } from '../session/types.ts';
import { sendMarkdownChunked } from '../shared/index.ts';
import { helpCommand } from './help.ts';
import { stopCommand, versionCommand } from './misc.ts';
import { presetCommand } from './preset.ts';
import { newCommand } from './session.ts';
import { statusCommand } from './status.ts';
import type { CommandDeps } from './types.ts';
import { buildCommandList, describeCommands } from './index.ts';

vi.mock('../shared/index.ts', async (original) => ({
  ...await original<typeof import('../shared/index.ts')>(),
  sendMarkdownChunked: vi.fn(async () => undefined),
}));

function context(raw = '', group = false): SlashCommandHandlerContext {
  return {
    message: { kind: group ? 'group' : 'c2c', senderId: 'owner', groupOpenid: 'group' },
    command: { raw },
  } as unknown as SlashCommandHandlerContext;
}

function dependencies() {
  const manager = {
    restoreExisting: vi.fn(async () => ({ agentPreset: 'standard' })),
    listPresets: vi.fn(async () => [{ id: 'standard' }, { id: 'minimal' }]),
    getSessionRecord: vi.fn(() => ({ agentPreset: 'standard', agent: { status: 'idle', cancel: vi.fn() } })),
    getEffectivePreset: vi.fn(() => 'minimal'),
    clearPresetOverride: vi.fn(async (): Promise<PresetSwitchOutcome> => ({ ok: true, sessionId: 'new-session' })),
    setPresetOverride: vi.fn(async (): Promise<PresetSwitchOutcome> => ({ ok: true, presetId: 'minimal', sessionId: 'new-session' })),
    getEffectiveModel: vi.fn(() => ({ provider: 'next', model: 'next-model' })),
    getStatus: vi.fn(() => ({ active: true, provider: 'actual', model: 'actual-model', preset: 'standard', nextPreset: 'minimal' })),
    remove: vi.fn(async () => undefined),
  };
  const deps: CommandDeps = { manager: manager as unknown as SessionManager, config: ConfigSchema({}) };
  return { deps, manager };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('mobile commands explain the same defaults as Web', () => {
  it('restores the current preset before showing it and the fresh-session default', async () => {
    const { deps, manager } = dependencies();
    await presetCommand(deps).handler(context());
    const markdown = vi.mocked(sendMarkdownChunked).mock.calls[0]?.[1];
    expect(markdown).toContain('当前会话:** standard');
    expect(markdown).toContain('新会话预设:** minimal');
    expect(markdown).toContain('QQ 网页默认');
    expect(manager.restoreExisting).toHaveBeenCalledWith('c2c', 'owner');
    expect(manager.getEffectivePreset).toHaveBeenCalledWith('c2c', 'owner');
  });

  it.each(['reset', 'default'])('clears only the peer preset for /preset %s', async (name) => {
    const { deps, manager } = dependencies();
    const reply = await presetCommand(deps).handler(context(name, true));
    expect(manager.clearPresetOverride).toHaveBeenCalledExactlyOnceWith('group', 'group');
    expect(reply).toContain('QQ 网页默认');
    expect(reply).toContain('已开始新会话');
    expect(reply).toContain('原会话历史和工作区保留');
    expect(manager.setPresetOverride).not.toHaveBeenCalled();
  });

  it('waits for /new cleanup before reporting success and advertises its aliases', async () => {
    const { deps, manager } = dependencies();
    let release!: () => void;
    manager.remove.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    let settled = false;
    const command = newCommand(deps);
    const result = Promise.resolve(command.handler(context())).then((value) => { settled = true; return value; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(manager.remove).toHaveBeenCalledExactlyOnceWith('c2c', 'owner');
    release(); expect(await result).toContain('已开启新会话');
    expect(command.name).toEqual(['new', 'reset', 'clear']);
    expect(command.description).toContain('保留模型与预设覆盖');
  });

  it('reports current and next preset without replacing the actual model by a default', async () => {
    const { deps } = dependencies();
    const reply = await statusCommand(deps).handler(context());
    expect(reply).toContain('模型: actual/actual-model');
    expect(reply).toContain('Preset: standard');
    expect(reply).toContain('新会话预设: minimal');
  });

  it('uses the invoking group in version model reporting', async () => {
    const { deps, manager } = dependencies();
    const reply = await versionCommand(deps).handler(context('', true));
    expect(manager.getStatus).toHaveBeenCalledExactlyOnceWith('group', 'group');
    expect(reply).toContain('actual/actual-model');
    expect(manager.getEffectiveModel).not.toHaveBeenCalled();
  });

  it.each([statusCommand, versionCommand])('restores a cold current Session before reporting its actual model', async factory => {
    const { deps, manager } = dependencies();
    manager.getStatus.mockReturnValue({ active: false, provider: '', model: '', preset: 'standard', nextPreset: 'minimal' });
    manager.restoreExisting.mockImplementationOnce(async () => {
      manager.getStatus.mockReturnValue({ active: true, provider: 'stored', model: 'cold-model', preset: 'standard', nextPreset: 'minimal' });
      return { agentPreset: 'standard' };
    });
    const reply = await factory(deps).handler(context('', true));
    expect(manager.restoreExisting).toHaveBeenCalledExactlyOnceWith('group', 'group');
    expect(reply).toContain('stored/cold-model');
    expect(manager.getEffectiveModel).not.toHaveBeenCalled();
  });

  it.each([statusCommand, versionCommand])('reports a restoration error without claiming a default or missing Session', async factory => {
    const { deps, manager } = dependencies();
    manager.restoreExisting.mockRejectedValueOnce(new Error('stored Session unreadable'));
    expect(await factory(deps).handler(context())).toBe('无法读取当前 QQ 会话：stored Session unreadable');
    expect(manager.getStatus).not.toHaveBeenCalled();
    expect(manager.getEffectiveModel).not.toHaveBeenCalled();
  });

  it('lists /stop and the reset/default rules in help', async () => {
    const { deps } = dependencies();
    const commands = [newCommand(deps), stopCommand(deps), presetCommand(deps)];
    await helpCommand(deps, () => commands).handler(context());
    const markdown = vi.mocked(sendMarkdownChunked).mock.calls[0]?.[1];
    expect(markdown).toContain('text="/stop"');
    expect(markdown).toContain('/model reset');
    expect(markdown).toContain('QQ 命令覆盖 > QQ 网页默认 > DSH 默认');
    expect(markdown).toContain('/reset');
    expect(markdown).toContain('/preset reset` 恢复获授权的网页默认预设并开始新会话，不携带旧上下文');
    expect(markdown).not.toContain('保留本会话上下文');
  });
  it('explains that a peer without a Session only changes its next preset', async () => {
    const { deps, manager } = dependencies();
    manager.setPresetOverride.mockResolvedValueOnce({ ok: true, presetId: 'minimal' });
    const reply = await presetCommand(deps).handler(context('minimal'));
    expect(reply).toContain('新会话将采用此预设'); expect(reply).not.toContain('已开始新会话');
  });

  it('projects the command registry to UI metadata without handlers (single source of truth)', () => {
    const { deps } = dependencies();
    const descriptors = describeCommands(deps);
    // 与注册表同一份清单
    expect(descriptors.length).toBe(buildCommandList(deps).length);
    // 只含 UI 需要的字段，不含 handler
    for (const descriptor of descriptors) {
      expect(descriptor).not.toHaveProperty('handler');
      expect(typeof descriptor.name).toBe('string');
      expect(descriptor.name.startsWith('/')).toBe(false);
      expect(['agent', 'qqbot']).toContain(descriptor.category);
    }
    // 别名展开：new 命令注册为数组时首个为 name、其余进 aliases
    const names = descriptors.map((descriptor) => descriptor.name);
    expect(names).toContain('new');
    expect(names).toContain('model');
    expect(names).toContain('bot-help');
  });
});
