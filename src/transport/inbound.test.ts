import { describe, it, expect, vi } from 'vitest';
import { handleInbound, sessionFailureReply } from './inbound.ts';
import { SessionArchivedError, SessionBusyError } from '../session/errors.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { QqInputRegistry } from './qq-input-origin.ts';
import type { SessionManager } from '../session/index.ts';
import type { Logger } from '../types.ts';
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { DshAgent, SessionRecord } from '../session/types.ts';

describe('sessionFailureReply', () => {
  it('归档：说清消息没处理，并给出两条下一步', () => {
    const text = sessionFailureReply(new SessionArchivedError('session-1'));

    expect(text).toContain('这条对话已经归档');
    expect(text).toContain('没有处理');
    expect(text).toContain('恢复对话');
    expect(text).toContain('新对话');
  });

  it('归档：提示里的指令用可点击标签，点一下即可发送', () => {
    const text = sessionFailureReply(new SessionArchivedError('session-1'));

    expect(text).toContain('<qqbot-cmd-input text="/unarchive"');
    expect(text).toContain('<qqbot-cmd-input text="/new"');
  });

  it('占用：说清是被另一个窗口打开着，并给出可执行动作', () => {
    const text = sessionFailureReply(new SessionBusyError('session-1'));

    expect(text).toContain('正被另一个窗口打开着');
    expect(text).toContain('没有处理');
    expect(text).toContain('再发一次');
    expect(text).toContain('<qqbot-cmd-input text="/new"');
  });

  it('其他失败：不暴露内部错误，只给重发建议', () => {
    for (const err of [new Error('EIO'), undefined]) {
      const text = sessionFailureReply(err);
      expect(text).toContain('没有处理成功');
      expect(text).toContain('再发一次');
      expect(text).not.toContain('EIO');
    }
  });

  it('文案不出现内部术语，普通用户可读', () => {
    const texts = [
      sessionFailureReply(new SessionArchivedError('session-1')),
      sessionFailureReply(new SessionBusyError('session-1')),
      sessionFailureReply(new Error('EIO')),
    ];
    for (const text of texts) {
      for (const jargon of ['写句柄', '进程', '会话归档', 'agent', 'DSH 进程']) {
        expect(text).not.toContain(jargon);
      }
    }
  });
});

// ── handleInbound 消息处理方式分派 ──

function makeAgent(status: 'idle' | 'running'): DshAgent {
  return {
    id: 's1',
    ctx: {},
    status,
    session: { id: 's1', snapshotEvents: () => [] },
    cancel: vi.fn(),
    followup: vi.fn(),
    steer: vi.fn(),
    whenIdle: vi.fn(async () => {}),
    runMaintenance: vi.fn(async () => undefined),
  } as unknown as DshAgent;
}

function makeCtx(content: string): MiddlewareContext {
  return {
    message: { kind: 'c2c', senderId: 'U1', content, messageId: 'm1' },
    state: {},
    bot: { sendMarkdown: vi.fn(async () => {}) },
  } as unknown as MiddlewareContext;
}

function makeManager(agent: DshAgent): SessionManager {
  return {
    getOrCreate: vi.fn(async () => ({ agent }) as SessionRecord),
  } as unknown as SessionManager;
}

function makeConfig(mode: 'queue' | 'interrupt'): ImQQBotConfig {
  return { messageHandlingMode: mode, appId: 'app1' } as ImQQBotConfig;
}

const logger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
const inputs = { register: vi.fn() } as unknown as QqInputRegistry;

describe('handleInbound 消息处理方式分派', () => {
  it('queue 模式：followup 开启任务，不 steer，等待收敛', async () => {
    const agent = makeAgent('idle');
    await handleInbound(makeCtx('hello'), makeManager(agent), makeConfig('queue'), logger, inputs);
    expect(agent.followup).toHaveBeenCalledTimes(1);
    expect(agent.steer).not.toHaveBeenCalled();
    expect(agent.whenIdle).toHaveBeenCalledTimes(1);
  });

  it('interrupt 模式 + idle：followup 开启新任务，不 steer', async () => {
    const agent = makeAgent('idle');
    await handleInbound(makeCtx('hello'), makeManager(agent), makeConfig('interrupt'), logger, inputs);
    expect(agent.followup).toHaveBeenCalledTimes(1);
    expect(agent.steer).not.toHaveBeenCalled();
    expect(agent.whenIdle).toHaveBeenCalledTimes(1);
  });

  it('interrupt 模式 + running：steer 补充当前任务，不 followup、不阻塞', async () => {
    const agent = makeAgent('running');
    await handleInbound(makeCtx('补充'), makeManager(agent), makeConfig('interrupt'), logger, inputs);
    expect(agent.steer).toHaveBeenCalledTimes(1);
    expect(agent.followup).not.toHaveBeenCalled();
    expect(agent.whenIdle).not.toHaveBeenCalled();
  });
});
