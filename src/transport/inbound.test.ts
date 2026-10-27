import { describe, it, expect, vi } from 'vitest';
import type { UserMessage } from '@deepseek-ai/dsh-llm';
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { SessionManager } from '../session/index.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import type { GroupHistoryEntry } from '../features/history-store.ts';
import { handleBufferedGroupHistory, handleInbound } from './inbound.ts';

type HistoryEntry = GroupHistoryEntry;

interface FixtureOptions {
  kind?: 'c2c' | 'group';
  timestamp?: string;
  content?: string;
  state?: Record<string, unknown>;
  config?: Partial<ImQQBotConfig>;
}

function setup(options: FixtureOptions = {}) {
  const { kind = 'c2c', timestamp, content } = {
    timestamp: '2026-02-03T04:05:06.000Z',
    content: 'hello',
    ...options,
  };
  const followup = vi.fn<(message: UserMessage) => void>();
  const getOrCreate = vi.fn().mockResolvedValue({
    agent: { followup, whenIdle: async () => {} },
  });
  const manager = { getOrCreate } as unknown as SessionManager;
  const config = { appId: 'timestamp-test', ...options.config } as unknown as ImQQBotConfig;
  const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ctx = {
    message: {
      kind,
      rawEventType: kind === 'group' ? 'GROUP_AT_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
      senderId: 'u1',
      senderName: 'Alice',
      messageId: 'm1',
      content,
      timestamp,
      ...(kind === 'group' ? { groupOpenid: 'g1' } : {}),
    },
    state: {
      ...(kind === 'group' ? { mention: { wasMentioned: true } } : {}),
      ...options.state,
    },
    bot: { sendMarkdown: vi.fn().mockResolvedValue(undefined) },
  } as unknown as MiddlewareContext;

  return {
    getOrCreate,
    followup,
    run: () => handleInbound(ctx, manager, config, logger),
    text: () => {
      expect(followup).toHaveBeenCalledTimes(1);
      const message = followup.mock.calls[0]?.[0];
      const block = message?.content.find(block => block.type === 'text');
      if (block?.type !== 'text') throw new Error('Expected a model-facing text block');
      return block.text;
    },
  };
}

const currentTime = '[Message time: 2026-02-03T12:05:06+08:00]\n';
const groupContent = '[Alice (u1)] hello (@you)';
const history: HistoryEntry[] = [
  {
    senderId: 'u2', senderName: 'Bob', content: 'earlier', messageId: 'm0',
    timestamp: Date.parse('2026-02-03T03:00:00Z'),
  },
  {
    senderId: 'u3', senderName: 'Carol', content: 'later', messageId: 'm2',
    timestamp: Date.parse('2026-02-03T03:30:00Z'),
  },
];
const imageHistory: HistoryEntry[] = [
  { ...history[0]!, images: [{ contentType: 'image/png', filename: 'earlier.png', size: 20, url: 'https://example.test/earlier.png', localPath: '/tmp/earlier.png' }] },
  { ...history[1]!, images: [{ contentType: 'image/jpeg', filename: 'later.jpg', size: 21, url: 'https://example.test/later.jpg' }] },
];

const historyText = '[Chat history begins]\n' +
  '[Message time: 2026-02-03T11:00:00+08:00] [Bob (u2)] earlier\n' +
  '[Message time: 2026-02-03T11:30:00+08:00] [Carol (u3)] later\n\n' +
  '[Chat history ends]\n[Current message]\n';

describe('handleInbound message timestamps', () => {
  it.each([
    { kind: 'c2c' as const, content: 'hello' },
    { kind: 'group' as const, content: groupContent },
  ])('$kind 当前消息使用秒级 UTC+08:00 时间', async ({ kind, content }) => {
    const fixture = setup({ kind });
    await fixture.run();
    expect(fixture.text()).toBe(currentTime + content);
  });

  it.each([
    { timestamp: '2026-02-03T12:05:06+08:00', time: '2026-02-03T12:05:06+08:00' },
    { timestamp: '2026-02-03T20:05:06.999Z', time: '2026-02-04T04:05:06+08:00' },
  ])('正确处理偏移和跨日：$timestamp', async ({ timestamp, time }) => {
    const fixture = setup({ timestamp });
    await fixture.run();
    expect(fixture.text()).toBe(`[Message time: ${time}]\nhello`);
  });

  describe.each(['c2c', 'group'] as const)('%s 无有效当前时间', (kind) => {
    it.each([undefined, '', 'not-a-date', '+275760-09-13T00:00:00.000Z'])(
      '时间 %s 不影响消息发送，也不补造时间', async (timestamp) => {
        const fixture = setup({ kind, timestamp });
        await fixture.run();
        expect(fixture.text()).toBe(kind === 'group' ? groupContent : 'hello');
      },
    );
  });

  it('逐条绑定历史时间、发送者、正文，并保留完整分隔符', async () => {
    const fixture = setup({ kind: 'group', state: { history } });
    await fixture.run();
    expect(fixture.text()).toBe(historyText + currentTime + groupContent);
  });

  it('renders history images after each sender/content line with local path or URL fallback', async () => {
    const fixture = setup({ kind: 'group', state: { history: imageHistory } });
    await fixture.run();
    const text = fixture.text();
    expect(text).toContain('[Bob (u2)] earlier\n- Image: /tmp/earlier.png');
    expect(text).toContain('[Carol (u3)] later\n- Image: https://example.test/later.jpg');
  });

  it('historyLimit 为 12 时完整保留整批历史的独立时间', async () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      senderId: `u${index + 2}`,
      senderName: `Sender${index}`,
      content: `message ${index}`,
      messageId: `history-${index}`,
      timestamp: Date.parse('2026-02-03T03:00:00Z') + index * 60_000,
    }));
    const fixture = setup({ kind: 'group', state: { history: entries }, config: { historyLimit: 12 } });
    await fixture.run();
    const expectedLines = Array.from({ length: 12 }, (_, index) =>
      `[Message time: 2026-02-03T11:${String(index).padStart(2, '0')}:00+08:00] ` +
      `[Sender${index} (u${index + 2})] message ${index}`,
    );
    expect(fixture.text()).toBe([
      '[Chat history begins]', ...expectedLines, '',
      '[Chat history ends]', '[Current message]', currentTime + groupContent,
    ].join('\n'));
  });

  it('历史跨午夜保留完整日期和输入顺序', async () => {
    const entries = history.map((entry, index) => ({
      ...entry,
      timestamp: Date.parse(index === 0 ? '2026-02-03T15:59:59Z' : '2026-02-03T16:00:01Z'),
    }));
    const fixture = setup({ kind: 'group', state: { history: entries } });
    await fixture.run();
    expect(fixture.text()).toBe(
      '[Chat history begins]\n' +
      '[Message time: 2026-02-03T23:59:59+08:00] [Bob (u2)] earlier\n' +
      '[Message time: 2026-02-04T00:00:01+08:00] [Carol (u3)] later\n\n' +
      '[Chat history ends]\n[Current message]\n' + currentTime + groupContent,
    );
  });

  it('不按历史时间重排，同一发送者的多行正文只添加一次前缀', async () => {
    const fixture = setup({
      kind: 'group',
      state: { history: [history[1], { ...history[1], content: 'first line\nsecond line', timestamp: history[0]!.timestamp }] },
    });
    await fixture.run();
    expect(fixture.text()).toBe(
      '[Chat history begins]\n' +
      '[Message time: 2026-02-03T11:30:00+08:00] [Carol (u3)] later\n' +
      '[Message time: 2026-02-03T11:00:00+08:00] [Carol (u3)] first line\nsecond line\n\n' +
      '[Chat history ends]\n[Current message]\n' + currentTime + groupContent,
    );
  });

  it('异常历史时间仅省略该条前缀，数字零仍是有效毫秒时间', async () => {
    const timestamps = [Date.parse('2026-02-03T03:00:00Z'), undefined, NaN, Infinity, 1e20, 8.64e15, -1e20, 0];
    // 仅在输入边界模拟 SDK 缺失字段，不放宽生产 HistoryEntry.timestamp 类型。
    const entries = timestamps.map((timestamp, index) => ({
      senderId: `u${index + 2}`, senderName: `Sender${index}`, content: `message ${index}`,
      messageId: `history-${index}`, timestamp,
    })) as unknown as HistoryEntry[];
    const fixture = setup({ kind: 'group', state: { history: entries } });
    await fixture.run();
    expect(fixture.text()).toBe([
      '[Chat history begins]',
      '[Message time: 2026-02-03T11:00:00+08:00] [Sender0 (u2)] message 0',
      '[Sender1 (u3)] message 1',
      '[Sender2 (u4)] message 2',
      '[Sender3 (u5)] message 3',
      '[Sender4 (u6)] message 4',
      '[Sender5 (u7)] message 5',
      '[Sender6 (u8)] message 6',
      '[Message time: 1970-01-01T08:00:00+08:00] [Sender7 (u9)] message 7',
      '', '[Chat history ends]', '[Current message]', currentTime + groupContent,
    ].join('\n'));
  });

  it('当前时间非法不影响各条有效历史时间', async () => {
    const fixture = setup({ kind: 'group', timestamp: 'not-a-date', state: { history } });
    await fixture.run();
    expect(fixture.text()).toBe(historyText + groupContent);
  });

  it.each([
    { name: '没有历史', kind: 'group' as const, state: {}, content: groupContent },
    { name: '空历史', kind: 'group' as const, state: { history: [] }, content: groupContent },
    { name: '私聊带历史', kind: 'c2c' as const, state: { history }, content: 'hello' },
    {
      name: '群聊未被 @', kind: 'group' as const,
      state: { history, mention: { wasMentioned: false } }, content: '[Alice (u1)] hello',
    },
  ])('$name 不生成历史块', async ({ kind, state, content }) => {
    const fixture = setup({ kind, state });
    await fixture.run();
    expect(fixture.text()).toBe(currentTime + content);
  });

  it('引用正文不添加推测时间，当前时间放在 Current message 之后', async () => {
    const fixture = setup({ state: { quote: { text: 'old text' } } });
    await fixture.run();
    expect(fixture.text()).toBe(
      '[Quoted message begins]\nold text\n[Quoted message ends]\n[Current message]\n' +
      currentTime + 'hello',
    );
  });

  it('只有有效时间的空私聊不创建会话或触发 followup', async () => {
    const fixture = setup({ content: '' });
    await fixture.run();
    expect(fixture.getOrCreate).not.toHaveBeenCalled();
    expect(fixture.followup).not.toHaveBeenCalled();
  });
describe('handleBufferedGroupHistory', () => {
  function setupBuffered() {
    const followup = vi.fn<(message: UserMessage) => void>();
    const getOrCreate = vi.fn().mockResolvedValue({
      agent: { followup, whenIdle: async () => {} },
    });
    const manager = { getOrCreate } as unknown as SessionManager;
    const bot = { sendMarkdown: vi.fn().mockResolvedValue(undefined) } as unknown as MiddlewareContext['bot'];
    const config = { appId: 'buffered-test' } as unknown as ImQQBotConfig;
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return { followup, getOrCreate, bot, manager, config, logger };
  }

  it('uses the last entry as current and keeps earlier entries in order without @ tag', async () => {
    const fixture = setupBuffered();
    const entries: HistoryEntry[] = [
      { senderId: 'u1', senderName: 'Alice', content: 'A', messageId: 'm1', timestamp: Date.parse('2026-02-03T03:00:00Z') },
      { senderId: 'u2', senderName: 'Bob', content: 'B', messageId: 'm2', timestamp: Date.parse('2026-02-03T03:01:00Z') },
      { senderId: 'u3', senderName: 'Carol', content: 'C', messageId: 'm3', timestamp: Date.parse('2026-02-03T03:02:00Z') },
    ];

    await handleBufferedGroupHistory(fixture.bot, fixture.manager, fixture.config, fixture.logger, 'g1', entries);

    expect(fixture.getOrCreate).toHaveBeenCalledWith('group', 'g1', 'u3', {
      scope: 'group', targetId: 'g1', msgId: 'm3',
    });
    const message = fixture.followup.mock.calls[0]?.[0];
    const block = message?.content.find(item => item.type === 'text');
    expect(block).toMatchObject({ type: 'text' });
    if (block?.type !== 'text') throw new Error('Expected a model-facing text block');
    expect(block.text).toContain('[Chat history begins]');
    expect(block.text.indexOf('[Alice (u1)] A')).toBeLessThan(block.text.indexOf('[Bob (u2)] B'));
    expect(block.text).toContain('[Carol (u3)] C');
    expect(block.text).not.toContain('(@you)');
  });

  it('restores the buffered final image as current attachment context without mention tag', async () => {
    const fixture = setupBuffered();
    const entries: HistoryEntry[] = [
      { senderId: 'u1', senderName: 'Alice', content: '看图', messageId: 'm1', timestamp: Date.parse('2026-02-03T03:00:00Z'), images: [{ contentType: 'image/png', filename: 'a.png', size: 12, url: 'https://example.test/a.png', localPath: '/tmp/a.png' }] },
    ];
    await handleBufferedGroupHistory(fixture.bot, fixture.manager, fixture.config, fixture.logger, 'g1', entries);
    const message = fixture.followup.mock.calls[0]?.[0];
    const block = message?.content.find(item => item.type === 'text');
    if (block?.type !== 'text') throw new Error('Expected a model-facing text block');
    expect(block.text).toContain('Image: /tmp/a.png');
    expect(block.text).not.toContain('(@you)');
  });

  it('does not create a session or follow up for an empty batch', async () => {
    const fixture = setupBuffered();
    await handleBufferedGroupHistory(fixture.bot, fixture.manager, fixture.config, fixture.logger, 'g1', []);
    expect(fixture.getOrCreate).not.toHaveBeenCalled();
    expect(fixture.followup).not.toHaveBeenCalled();
  });
});
});
