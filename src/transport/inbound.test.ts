import { describe, it, expect } from 'vitest';
import { sessionFailureReply } from './inbound.ts';
import { SessionArchivedError } from '../session/errors.ts';

describe('sessionFailureReply', () => {
  it('归档失败给出可操作路径，并说明消息未被处理', () => {
    const text = sessionFailureReply(new SessionArchivedError('session-1'));

    expect(text).toContain('当前会话已归档');
    expect(text).toContain('未被处理');
  });

  it('提示里的指令用可点击标签，点一下即可发送', () => {
    const text = sessionFailureReply(new SessionArchivedError('session-1'));

    expect(text).toContain('<qqbot-cmd-input text="/unarchive"');
    expect(text).toContain('<qqbot-cmd-input text="/new"');
  });

  it('其余失败沿用通用提示，不暴露内部错误', () => {
    expect(sessionFailureReply(new Error('EIO'))).toBe('⚠️ 处理消息时出现异常，请稍后重试。');
    expect(sessionFailureReply(undefined)).toBe('⚠️ 处理消息时出现异常，请稍后重试。');
  });
});
