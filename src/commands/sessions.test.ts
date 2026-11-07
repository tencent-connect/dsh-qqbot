/**
 * /sessions 命令层用例：分组渲染、QQ 标签、参数解析、准入错误与鉴权。
 */
import { describe, it, expect, vi } from 'vitest';
import { sessionsCommand } from './sessions.ts';

const CONFIG = {
  textChunkLimit: 4500,
  access: { c2cMode: 'open', c2cAllow: [] },
} as never;

const GROUPS = [
  {
    path: '/tmp/含空格 项目',
    title: '含空格 项目',
    isCurrentWorkspace: true,
    truncated: 0,
    sessions: [
      { sessionId: 'session-current', createdAt: 1_700_000_000_000, agentPreset: 'standard', isCurrent: true, occupiedByOther: false },
      { sessionId: 'session-free', createdAt: 1_700_000_100_000, agentPreset: 'code', isCurrent: false, occupiedByOther: false },
      { sessionId: 'session-occupied', createdAt: 1_700_000_200_000, isCurrent: false, occupiedByOther: true },
    ],
  },
  {
    path: '/tmp/ws-b',
    title: 'B',
    isCurrentWorkspace: false,
    truncated: 2,
    sessions: [],
  },
];

function makeManager(overrides: Record<string, unknown> = {}) {
  return {
    listSessionGroups: vi.fn(async () => GROUPS),
    resolveSessionTarget: vi.fn(async (_s: string, _p: string, arg: string) => arg === '2' ? 'session-free' : undefined),
    switchSession: vi.fn(async () => ({ ok: true })),
    startNewInWorkspace: vi.fn(async () => ({ ok: true, path: '/tmp/含空格 项目' })),
    listWorkspaceRefs: vi.fn(() => [{ title: '含空格 项目', path: '/tmp/含空格 项目' }]),
    ...overrides,
  } as never;
}

function makeCmdCtx(raw: string, sent: string[], senderId = 'u1') {
  return {
    message: { senderId, kind: 'c2c' },
    command: { raw },
    bot: { sendMarkdown: async (_t: unknown, content: string) => { sent.push(content); } },
    replyTarget: { scope: 'c2c', targetId: senderId },
  } as never;
}

describe('/sessions 命令', () => {
  it('无参数：全局序号、当前/占用标记、截断提示；按钮只传序号且 urlencode', async () => {
    const sent: string[] = [];
    const cmd = sessionsCommand({ manager: makeManager(), config: CONFIG });

    const result = await cmd.handler!(makeCmdCtx('', sent), {} as never);

    expect(result).toEqual({ kind: 'noop' });
    const text = sent.join('\n');
    expect(text).toContain('1. 含空格 项目**（当前工作区）');
    expect(text).toContain('● 1. session-current（当前）');
    expect(text).toContain('🔒 3. session-occupied（其他 QQ 用户/群）');
    expect(text).toContain('…另有 2 个会话未展示');
    expect(text).toContain('text="' + encodeURIComponent('/sessions 2') + '"');
    expect(text).toContain('text="' + encodeURIComponent('/sessions new 1') + '"');
    expect(text).toContain('text="' + encodeURIComponent('/sessions new 2') + '"');
    // 绝对路径不得进入任何 QQ 标签；含空格/中文路径也不破坏渲染
    expect(text).not.toContain('text="/sessions new /tmp/');
    expect(text).not.toContain(encodeURIComponent('/sessions new /tmp/'));
    for (const match of text.matchAll(/(?:text|show)="([^"]*)"/g)) {
      expect(match[1]!.length).toBeLessThanOrEqual(100);
    }
  });

  it('宿主无工作区服务：明确降级提示', async () => {
    const manager = makeManager({ listSessionGroups: async () => [] });
    const cmd = sessionsCommand({ manager, config: CONFIG });
    const result = await cmd.handler!(makeCmdCtx('', []), {} as never);
    expect(String(result)).toContain('当前部署无工作区服务');
  });

  it('序号切换：解析并切换目标，提示上下文与文件现场一并切换', async () => {
    const manager = makeManager();
    const cmd = sessionsCommand({ manager, config: CONFIG });

    const result = await cmd.handler!(makeCmdCtx('2', []), {} as never);

    expect(manager.resolveSessionTarget).toHaveBeenCalledWith('c2c', 'u1', '2');
    expect(manager.switchSession).toHaveBeenCalledWith('c2c', 'u1', 'session-free');
    expect(String(result)).toContain('已切换到会话');
  });

  it('未知目标 / 占用 / 磁盘缺失分别给出准确错误', async () => {
    const unknown = sessionsCommand({ manager: makeManager(), config: CONFIG });
    expect(String(await unknown.handler!(makeCmdCtx('99', []), {} as never))).toContain('未找到会话');

    const occupiedManager = makeManager({
      resolveSessionTarget: async () => 'session-x',
      switchSession: async () => ({ ok: false, reason: 'occupied' }),
    });
    const occupied = sessionsCommand({ manager: occupiedManager, config: CONFIG });
    expect(String(await occupied.handler!(makeCmdCtx('3', []), {} as never))).toContain('已绑定其他 QQ 用户或群');

    const missingManager = makeManager({
      resolveSessionTarget: async () => 'session-x',
      switchSession: async () => ({ ok: false, reason: 'not-on-disk' }),
    });
    const missing = sessionsCommand({ manager: missingManager, config: CONFIG });
    expect(String(await missing.handler!(makeCmdCtx('3', []), {} as never))).toContain('磁盘记录已不存在');
  });

  it('目标即当前会话：幂等提示，不重复切换语义', async () => {
    const manager = makeManager({
      resolveSessionTarget: async () => 'session-current',
      switchSession: async () => ({ ok: true, alreadyCurrent: true }),
    });
    const cmd = sessionsCommand({ manager, config: CONFIG });
    expect(String(await cmd.handler!(makeCmdCtx('1', []), {} as never))).toContain('当前就在会话');
  });

  it('/sessions new 1：按组序号新建，返回工作区路径', async () => {
    const manager = makeManager();
    const cmd = sessionsCommand({ manager, config: CONFIG });

    const result = await cmd.handler!(makeCmdCtx('new 1', []), {} as never);

    expect(manager.startNewInWorkspace).toHaveBeenCalledWith('c2c', 'u1', '1');
    expect(String(result)).toContain('已切换工作区并开启新会话');
    expect(String(result)).toContain('/tmp/含空格 项目');
  });

  it('new 缺参数 / 未知工作区：用法与可用工作区提示', async () => {
    const cmd = sessionsCommand({ manager: makeManager(), config: CONFIG });
    expect(String(await cmd.handler!(makeCmdCtx('new', []), {} as never))).toContain('组序号');

    const manager = makeManager({ startNewInWorkspace: async () => ({ ok: false, reason: 'unknown-workspace' }) });
    const unknown = sessionsCommand({ manager, config: CONFIG });
    const result = await unknown.handler!(makeCmdCtx('new 99', []), {} as never);
    expect(String(result)).toContain('未知工作区: 99');
    expect(String(result)).toContain('含空格 项目');
  });

  it('鉴权：allowlist 名单内放行、名单外拒绝', async () => {
    const restricted = {
      textChunkLimit: 4500,
      access: { c2cMode: 'allowlist', c2cAllow: ['admin1'] },
    } as never;
    const cmd = sessionsCommand({ manager: makeManager(), config: restricted });
    expect(cmd.authorized!(makeCmdCtx('', [], 'admin1'), {} as never)).toBe(true);
    expect(cmd.authorized!(makeCmdCtx('', [], 'stranger'), {} as never)).not.toBe(true);
  });
});
