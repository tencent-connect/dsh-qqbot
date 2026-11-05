import { describe, it, expect } from 'vitest';
import {
  MIRROR_WEB_PREFIX,
  extractUserMessageText,
  formatMirrorWebText,
  isMirrorableOrigin,
} from './mirror-web.ts';

describe('mirror-web: 来源判定', () => {
  it('只有 external 值得镜像', () => {
    expect(isMirrorableOrigin('external')).toBe(true);
  });

  it('qq（QQ 端已有该消息）与 internal（插件注入）都不镜像', () => {
    expect(isMirrorableOrigin('qq')).toBe(false);
    expect(isMirrorableOrigin('internal')).toBe(false);
    expect(isMirrorableOrigin(undefined)).toBe(false);
  });
});

describe('mirror-web: 正文提取', () => {
  it('取顶层 content 的文本块，用换行拼接', () => {
    expect(extractUserMessageText({
      content: [{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }],
    })).toBe('第一段\n第二段');
  });

  it('兼容 { message: { content } } 包裹形态', () => {
    expect(extractUserMessageText({
      message: { content: [{ type: 'text', text: '包裹里的问题' }] },
    })).toBe('包裹里的问题');
  });

  it('跳过非文本块（附件/图片）', () => {
    expect(extractUserMessageText({
      content: [
        { type: 'image', url: 'https://example.com/a.png' },
        { type: 'text', text: '图里是什么' },
      ],
    })).toBe('图里是什么');
  });

  it('没有可用文本时返回 undefined（仅附件的消息不镜像）', () => {
    expect(extractUserMessageText({ content: [{ type: 'image', url: 'x' }] })).toBeUndefined();
    expect(extractUserMessageText({ content: [{ type: 'text', text: '   ' }] })).toBeUndefined();
    expect(extractUserMessageText({})).toBeUndefined();
  });
});

describe('mirror-web: 正文格式', () => {
  it('按 🌐 来自 Web：<原文> 组装，原文逐字保留', () => {
    expect(formatMirrorWebText('为什么天空是蓝的？')).toBe('🌐 来自 Web：为什么天空是蓝的？');
    expect(formatMirrorWebText('问题').startsWith(MIRROR_WEB_PREFIX)).toBe(true);
  });
});