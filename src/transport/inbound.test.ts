/**
 * 入站层用例 — 语音转录去重（assembleAgentBody）与消息处理方式分派
 * （handleInbound）、失败文案（sessionFailureReply）等重点行为。
 */
import { describe, it, expect, vi } from 'vitest';
import { assembleAgentBody, handleInbound, sessionFailureReply } from './inbound.ts';
import { SessionArchivedError, SessionBusyError } from '../session/errors.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { QqInputRegistry } from './qq-input-origin.ts';
import type { SessionManager } from '../session/index.ts';
import type { Logger } from '../types.ts';
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { DshAgent, SessionRecord } from '../session/types.ts';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

function makeMsg(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'c2c',
    senderId: 'user1',
    content: '',
    messageId: 'm1',
    timestamp: '2026-11-09T00:00:00Z',
    ...overrides,
  } as never;
}

describe('assembleAgentBody 语音转录去重', () => {
  it('有 ASR 的语音：转录只出现一次（[Voice message] 行），不再注入 - ASR: 行', () => {
    const body = assembleAgentBody(
      makeMsg({ attachments: [{ content_type: 'voice', url: 'https://v/1', asr_refer_text: '帮我看下报错', filename: 'v1.silk' }] }),
      {},
      'c2c',
      logger,
    );

    expect(body).toContain('[Voice message] 帮我看下报错');
    expect(body).not.toContain('- ASR:');
    expect(body).not.toContain('- Voice:');
  });

  it('无转录的语音：降级给 URL 行，且无 [Voice message] 行', () => {
    const body = assembleAgentBody(
      makeMsg({ attachments: [{ content_type: 'voice', url: 'https://v/2', filename: 'v2.silk' }] }),
      {},
      'c2c',
      logger,
    );

    expect(body).toContain('- Voice: https://v/2');
    expect(body).not.toContain('[Voice message]');
  });

  it('多条语音混合：有转录的走正文、无转录的逐条降级 URL', () => {
    const body = assembleAgentBody(
      makeMsg({ attachments: [
        { content_type: 'voice', url: 'https://v/a', asr_refer_text: '第一条有转录', filename: 'a.silk' },
        { content_type: 'voice', url: 'https://v/b', filename: 'b.silk' },
      ] }),
      {},
      'c2c',
      logger,
    );

    expect(body).toContain('[Voice message] 第一条有转录');
    expect(body).toContain('- Voice: https://v/b');
    expect(body).not.toContain('- ASR:');
  });

  it('处理后转录（processedAttachments）优先于原始 ASR，同样只出现一次', () => {
    const body = assembleAgentBody(
      makeMsg({ attachments: [{ content_type: 'voice', url: 'https://v/c', asr_refer_text: '原始ASR', filename: 'c.silk' }] }),
      { processedAttachments: [{ type: 'voice', filename: 'c.silk', voiceText: 'STT 转录文本', voiceSource: 'stt', duration: 8 }] },
      'c2c',
      logger,
    );

    expect(body).toContain('[Voice message (8s)] STT 转录文本');
    expect(body).not.toContain('原始ASR');
    expect(body).not.toContain('- ASR:');
  });

  it('图片上下文行不受影响（回归：分层分工保持）', () => {
    const body = assembleAgentBody(
      makeMsg({ attachments: [{ content_type: 'image', url: 'https://i/1', filename: 'i1.png' }] }),
      { downloadedFiles: [{ filename: 'i1.png', localPath: '/media/i1.png' }] },
      'c2c',
      logger,
    );

    expect(body).toContain('Image: /media/i1.png');
    expect(body).toContain('[图片]');
  });

  it('纯文本消息：无媒体前缀（回归）', () => {
    const body = assembleAgentBody(makeMsg({ content: '你好' }), {}, 'c2c', logger);
    expect(body).toBe('你好');
  });
});

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
