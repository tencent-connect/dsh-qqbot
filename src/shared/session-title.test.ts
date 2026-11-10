import { describe, it, expect } from 'vitest';
import {
  foldSessionDisplayTitle,
  clipTitle,
  extractRecentMessages,
  DIGEST_MESSAGE_COUNT,
  TITLE_SCAN_EVENT_CAP,
} from './session-title.ts';

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

describe('extractRecentMessages', () => {
  it('兼容两种事件形态：user/message 裸 content，assistant/message 包 message.content', () => {
    const events = [
      { type: 'user/message', data: { content: [{ type: 'text', text: '第一问' }] } },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '第一答' }] } } },
    ];
    const { recent, total } = extractRecentMessages(events);
    expect(total).toBe(2);
    expect(recent).toEqual([
      { role: 'user', text: '第一问' },
      { role: 'assistant', text: '第一答' },
    ]);
  });

  it('取尾部 N 条并给出总数（更早计数 = total - recent）', () => {
    const events = Array.from({ length: 8 }, (_, i) => ({
      type: i % 2 === 0 ? 'user/message' : 'assistant/message',
      data: i % 2 === 0
        ? { content: [{ type: 'text', text: `问${i}` }] }
        : { message: { content: [{ type: 'text', text: `答${i}` }] } },
    }));
    const { recent, total } = extractRecentMessages(events, 5);
    expect(total).toBe(8);
    expect(recent).toHaveLength(5);
    expect(recent[0]).toMatchObject({ role: 'assistant', text: '答3' });
    expect(recent[4]).toMatchObject({ role: 'assistant', text: '答7' });
  });

  it('纯图片等无文本消息跳过；非消息事件忽略', () => {
    const events = [
      { type: 'user/message', data: { content: [{ type: 'image', url: 'x' }] } },
      { type: 'turn/start' },
      { type: 'tool/call', data: {} },
      { type: 'user/message', data: { content: [{ type: 'text', text: '唯一文本' }] } },
    ];
    const { recent, total } = extractRecentMessages(events);
    expect(total).toBe(1);
    expect(recent).toEqual([{ role: 'user', text: '唯一文本' }]);
  });

  it('默认条数为常量 5；空事件返回空', () => {
    expect(DIGEST_MESSAGE_COUNT).toBe(5);
    expect(extractRecentMessages([])).toEqual({ recent: [], total: 0 });
  });
});

describe('TITLE_SCAN_EVENT_CAP', () => {
  it('前缀扫描上限为正整数（持久层读取预算）', () => {
    expect(TITLE_SCAN_EVENT_CAP).toBeGreaterThan(0);
  });
});
