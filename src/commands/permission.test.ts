/**
 * /permission 命令用例
 *
 * - 无参列表：当前值 + preset 可点击项渲染
 * - 切换：确认文案（含高危警示）、无活跃会话降级、apply 失败降级
 * - reset：清除偏好
 * - 鉴权：挂 allowlist（名单外拒绝）
 */
import { describe, it, expect, vi } from 'vitest';
import { permissionCommand } from './permission.ts';
import type { PermissionKnobs } from '../host/adapter.ts';

const CONFIG = {
  textChunkLimit: 4500,
  access: { c2cMode: 'open', c2cAllow: [] },
} as never;

function makeManager(overrides: Record<string, unknown> = {}) {
  return {
    getPermissionStatus: vi.fn(() => ({ source: 'default' as const })),
    setPermission: vi.fn(async (_s: string, _p: string, _k: PermissionKnobs) => ({ ok: true, appliedLive: true })),
    clearPermission: vi.fn(() => true),
    ...overrides,
  } as never;
}

/** cmdCtx 桩：sendMarkdownChunked 依赖 bot.sendMarkdown + replyTarget */
function makeCmdCtx(raw: string, sent: string[], kind: 'c2c' | 'group' = 'c2c') {
  return {
    message: { senderId: 'u1', kind, messageId: 'm1', ...(kind === 'group' ? { groupOpenid: 'u1' } : {}) },
    command: { raw },
    bot: { sendMarkdown: async (_t: unknown, content: string) => { sent.push(content); } },
    replyTarget: { scope: 'c2c', targetId: 'u1' },
  } as never;
}

describe('/permission', () => {
  it('无参数：展示当前值来源 + 三个可点击 preset + reset 提示', async () => {
    const sent: string[] = [];
    const manager = makeManager({
      getPermissionStatus: () => ({ knobs: { sandbox: 'workspace-write', approval: 'ask' }, source: 'session' }),
    });
    const cmd = permissionCommand({ manager, config: CONFIG });

    const result = await cmd.handler!(makeCmdCtx('', sent), {} as never);

    expect(result).toEqual({ kind: 'noop' });
    const text = sent.join('\n');
    expect(text).toContain('工作区可写（workspace-write）');
    expect(text).toContain('当前会话生效值');
    // 私聊：preset 按钮用 cmd-enter（点击直接发送）
    expect(text).toContain('<qqbot-cmd-enter text="' + encodeURIComponent('/permission read-only') + '"/>');
    expect(text).toContain('<qqbot-cmd-enter text="' + encodeURIComponent('/permission workspace-write') + '"/>');
    expect(text).toContain('<qqbot-cmd-enter text="' + encodeURIComponent('/permission danger-full-access') + '"/>');
    expect(text).toContain('/permission reset');
    expect(text).toContain('⚠️'); // 私聊下 label 为明文行 + cmd-enter 按钮
    // 所有 text/show 均按更严格的「编码后 <=100」约束输出
    for (const match of text.matchAll(/(?:text|show)="([^"]*)"/g)) {
      expect(match[1]!.length).toBeLessThanOrEqual(100);
    }
  });

  it('群聊：preset 按钮回退 cmd-input（插入式）', async () => {
    const sent: string[] = [];
    const manager = makeManager({
      getPermissionStatus: () => ({ knobs: { sandbox: 'workspace-write', approval: 'ask' }, source: 'session', active: true }),
    });
    const cmd = permissionCommand({ manager, config: CONFIG });

    await cmd.handler!(makeCmdCtx('', sent, 'group'), {} as never);

    const text = sent.join('\n');
    expect(text).not.toContain('qqbot-cmd-enter');
    expect(text).toContain('<qqbot-cmd-input text="' + encodeURIComponent('/permission read-only') + '"');
  });

  it('无参数且无偏好：显示宿主部署默认', async () => {
    const sent: string[] = [];
    const cmd = permissionCommand({ manager: makeManager(), config: CONFIG });

    await cmd.handler!(makeCmdCtx('', sent), {} as never);

    expect(sent.join('\n')).toContain('宿主部署默认');
  });

  it('无活跃会话但有偏好：显示「待应用」，不谎称当前已生效', async () => {
    const sent: string[] = [];
    const manager = makeManager({
      getPermissionStatus: () => ({
        knobs: { sandbox: 'read-only', approval: 'ask' },
        source: 'pref',
        active: false,
      }),
    });
    const cmd = permissionCommand({ manager, config: CONFIG });

    await cmd.handler!(makeCmdCtx('', sent), {} as never);

    const text = sent.join('\n');
    expect(text).toContain('**待应用:** 只读（read-only）');
    expect(text).toContain('下条消息恢复或创建会话时应用');
    expect(text).not.toContain('**当前:** 只读');
  });

  it('切换成功（活跃会话）：立即生效文案', async () => {
    const setPermission = vi.fn(async () => ({ ok: true, appliedLive: true }));
    const cmd = permissionCommand({ manager: makeManager({ setPermission }), config: CONFIG });

    const result = await cmd.handler!(makeCmdCtx('read-only', []));

    expect(setPermission).toHaveBeenCalledWith(
      'c2c',
      'u1',
      { sandbox: 'read-only', approval: 'ask' },
      { senderId: 'u1', replyTarget: { scope: 'c2c', targetId: 'u1', msgId: 'm1' } },
    );
    expect(String(result)).toContain('权限已切换');
    expect(String(result)).toContain('当前会话立即生效');
  });

  it('切换成功（无活跃会话）：提示创建时生效', async () => {
    const setPermission = vi.fn(async () => ({ ok: true, appliedLive: false }));
    const cmd = permissionCommand({ manager: makeManager({ setPermission }), config: CONFIG });

    const result = await cmd.handler!(makeCmdCtx('workspace-write', []));

    expect(String(result)).toContain('当前无活跃会话，下一条消息恢复或创建会话时应用');
  });

  it('danger-full-access：确认文案带显著高危警示', async () => {
    const cmd = permissionCommand({ manager: makeManager(), config: CONFIG });

    const result = await cmd.handler!(makeCmdCtx('danger-full-access', []));

    expect(String(result)).toContain('⚠️ **高危**');
    expect(String(result)).toContain('不再询问审批');
  });

  it('live 应用失败：偏好已保存 + 降级说明', async () => {
    const setPermission = vi.fn(async () => ({ ok: false, reason: 'apply-failed' }));
    const cmd = permissionCommand({ manager: makeManager({ setPermission }), config: CONFIG });

    const result = await cmd.handler!(makeCmdCtx('read-only', []));

    expect(String(result)).toContain('权限偏好已保存');
    expect(String(result)).toContain('宿主未组合 sandbox/审批服务');
  });

  it('未知 preset：报错并列出可用项', async () => {
    const cmd = permissionCommand({ manager: makeManager(), config: CONFIG });

    const result = await cmd.handler!(makeCmdCtx('root', []));

    expect(String(result)).toContain('未知权限: root');
    expect(String(result)).toContain('read-only / workspace-write / danger-full-access / reset');
  });

  it('reset：清除偏好成功 / 无偏好时提示', async () => {
    const cmd = permissionCommand({ manager: makeManager(), config: CONFIG });
    expect(String(await cmd.handler!(makeCmdCtx('reset', [])))).toContain('已重置为宿主默认权限');

    const notSet = permissionCommand({ manager: makeManager({ clearPermission: () => false }), config: CONFIG });
    expect(String(await notSet.handler!(makeCmdCtx('reset', [])))).toContain('无需重置');
  });

  it('鉴权：挂 commandAllowlistAuth（allowlist 模式名单外拒绝）', async () => {
    const restricted = {
      textChunkLimit: 4500,
      access: { c2cMode: 'allowlist', c2cAllow: ['admin1'] },
    } as never;
    const cmd = permissionCommand({ manager: makeManager(), config: restricted });

    expect(typeof cmd.authorized).toBe('function');
    // 名单内放行
    const allowed = cmd.authorized!({
      message: { senderId: 'admin1', kind: 'c2c' },
    } as never, {} as never);
    expect(allowed).toBe(true);
    // 名单外拒绝（fail-closed）
    const denied = cmd.authorized!({
      message: { senderId: 'stranger', kind: 'c2c' },
    } as never, {} as never);
    expect(denied).not.toBe(true);
  });
});
