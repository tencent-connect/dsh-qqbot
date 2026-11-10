/**
 * 入站组装（assembleAgentBody）用例 — 语音转录去重等重点行为。
 */
import { describe, it, expect } from 'vitest';
import { assembleAgentBody } from './inbound.ts';
import type { Logger } from '../types.ts';

const logger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

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
