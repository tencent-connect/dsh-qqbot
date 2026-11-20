import { describe, it, expect } from 'vitest';
import { sessionFailureReply } from './inbound.ts';
import { SessionArchivedError, SessionBusyError } from '../session/errors.ts';

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
