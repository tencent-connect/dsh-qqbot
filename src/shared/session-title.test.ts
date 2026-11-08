import { describe, it, expect } from 'vitest';
import { foldSessionDisplayTitle, clipTitle, TITLE_SCAN_EVENT_CAP } from './session-title.ts';

describe('foldSessionDisplayTitle', () => {
  it('最后一条 session/title 胜出（last-wins）', () => {
    const events = [
      { type: 'user/message', data: { content: [{ type: 'text', text: '首条消息' }] } },
      { type: 'session/title', data: { title: '旧标题' } },
      { type: 'assistant/message', data: {} },
      { type: 'session/title', data: { title: '新标题' } },
    ];
    expect(foldSessionDisplayTitle(events)).toBe('新标题');
  });

  it('无标题事件 → 首条 user/message 文本（多块拼接、空白折叠）', () => {
    const events = [
      { type: 'turn/start' },
      { type: 'user/message', data: { content: [{ type: 'text', text: '  帮我 ' }, { type: 'text', text: '分析日志\n并总结' }] } },
      { type: 'user/message', data: { content: [{ type: 'text', text: '第二条' }] } },
    ];
    expect(foldSessionDisplayTitle(events)).toBe('帮我 分析日志 并总结');
  });

  it('非文本块 / 空标题 / 空文本均不命中 → undefined', () => {
    expect(foldSessionDisplayTitle([
      { type: 'user/message', data: { content: [{ type: 'image', url: 'x' }] } },
      { type: 'session/title', data: { title: '   ' } },
    ])).toBeUndefined();
    expect(foldSessionDisplayTitle([])).toBeUndefined();
    expect(foldSessionDisplayTitle([{ type: 'tool/call', data: {} }])).toBeUndefined();
  });
});

describe('clipTitle', () => {
  it('按 Unicode 码点截断并保留省略号', () => {
    expect(clipTitle('短标题', 10)).toBe('短标题');
    const clipped = clipTitle('😀'.repeat(12), 10);
    expect(Array.from(clipped)).toHaveLength(10);
    expect(clipped.endsWith('…')).toBe(true);
  });
});

describe('TITLE_SCAN_EVENT_CAP', () => {
  it('前缀扫描上限为正整数（持久层读取预算）', () => {
    expect(TITLE_SCAN_EVENT_CAP).toBeGreaterThan(0);
  });
});
