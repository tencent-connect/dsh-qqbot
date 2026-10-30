import { describe, it, expect, vi } from 'vitest';
import {
  countVisible,
  deliverSegmentedReply,
  fitLimit,
  nextIntervalMs,
  planSegmentedReply,
  protectedRanges,
} from './segmented-reply.ts';
import type { SegmentedReplyConfig } from './segmented-reply.ts';
import type { Logger, ReplyTarget } from '../types.ts';

const base: SegmentedReplyConfig = {
  enable: true,
  onlyLlmResult: true,
  splitMode: 'regex',
  regex: '.*?(?:[。！？!?~…]+|\\n+)|.+$',
  splitWords: ['。', '？', '！', '~', '…'],
  contentCleanupRule: '[。]+$',
  wordsCountThreshold: 150,
  forwardThreshold: 1500,
  intervalMethod: 'random',
  intervalMin: 0,
  intervalMax: 0,
  logBase: 2.6,
  logJitter: 0.5,
  maxBubbles: 3,
};

const cfg = (over?: Partial<SegmentedReplyConfig>): SegmentedReplyConfig => ({ ...base, ...over });

function plan(text: string, over?: Partial<SegmentedReplyConfig>, limit = 4500) {
  return planSegmentedReply(text, cfg(over), { limit });
}

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const target: ReplyTarget = { scope: 'c2c', targetId: 'user1', msgId: 'm1' };

describe('countVisible', () => {
  it('按码点计数（CJK / emoji 各记 1），忽略首尾空白', () => {
    expect(countVisible(' 你好 ')).toBe(2);
    expect(countVisible('😀😀')).toBe(2);
    expect(countVisible('')).toBe(0);
  });
});

describe('protectedRanges', () => {
  it('围栏代码块与 GFM 表格各成一段', () => {
    const text = 'a\n\u0060\u0060\u0060js\nx\n\u0060\u0060\u0060\n| a | b |\n| - | - |';
    const ranges = protectedRanges(text);
    expect(ranges).toHaveLength(2);
    expect(text.slice(ranges[0]!.start, ranges[0]!.end)).toContain('x');
    expect(text.slice(ranges[1]!.start, ranges[1]!.end)).toContain('| - | - |');
  });
});

describe('planSegmentedReply: 切分', () => {
  it('总开关关闭 → 整条发送', () => {
    const p = plan('在呢。吃了吗？', { enable: false });
    expect(p.split).toBe(false);
    expect(p.reason).toBe('disabled');
    expect(p.bubbles).toEqual(['在呢。吃了吗？']);
  });

  it('空文本 → 不发', () => {
    expect(plan('   \n  ').bubbles).toEqual([]);
  });

  it('中文标点切分，句尾句号按清理规则剥掉', () => {
    const p = plan('在呢。吃了吗？睡吧');
    expect(p.split).toBe(true);
    expect(p.bubbles).toEqual(['在呢', '吃了吗？', '睡吧']);
  });

  it('换行切分：一句一行', () => {
    expect(plan('在呢\n吃了吗\n睡吧').bubbles).toEqual(['在呢', '吃了吗', '睡吧']);
  });

  it('line 模式：每行一条', () => {
    expect(plan('a。b。c\nd', { splitMode: 'line' }).bubbles).toEqual(['a。b。c', 'd']);
  });

  it('words 模式：按词表切（分隔符留在前段再被清理）', () => {
    expect(plan('好~真的吗？', { splitMode: 'words' }).bubbles).toEqual(['好~', '真的吗？']);
  });

  it('非法正则 → 退化为逐行切分并记录告警', () => {
    const p = plan('在呢\n吃了吗', { regex: '([' });
    expect(p.bubbles).toEqual(['在呢', '吃了吗']);
    expect(p.notes.some((n) => n.includes('regex'))).toBe(true);
  });

  it('非法清理规则 → 原样保留并记录告警', () => {
    const p = plan('在呢。\n吃了吗', { contentCleanupRule: '([' });
    expect(p.bubbles[0]).toBe('在呢。');
    expect(p.notes.some((n) => n.includes('contentCleanupRule'))).toBe(true);
  });

  it('围栏代码块内部不切（切分点推到块末）', () => {
    const fence = '\u0060\u0060\u0060js\nconst a = 1。\nconst b = 2。\n\u0060\u0060\u0060';
    const p = plan('看这个\n' + fence + '\n好了');
    expect(p.bubbles).toEqual(['看这个', fence, '好了']);
  });

  it('GFM 表格内部不切', () => {
    const table = '| a。 | b |\n| - | - |\n| 1。 | 2 |';
    const p = plan('对比\n' + table + '\n就这样');
    expect(p.bubbles).toEqual(['对比', table, '就这样']);
  });
});

describe('planSegmentedReply: 阈值与封顶', () => {
  it('可见字数超过 wordsCountThreshold → 整改条发送', () => {
    const text = '一'.repeat(151);
    const p = plan(text);
    expect(p.reason).toBe('above-words-threshold');
    expect(p.bubbles).toEqual([text]);
  });

  it('可见字数超过 forwardThreshold → 整条发送', () => {
    const p = plan('一'.repeat(1501));
    expect(p.reason).toBe('above-forward-threshold');
  });

  it('阈值边界：恰好等于阈值仍可分条', () => {
    const text = '一'.repeat(149) + '。\n好';
    expect(countVisible(text)).toBe(152);
    const p = plan(text, { wordsCountThreshold: 152 });
    expect(p.split).toBe(true);
  });

  it('maxBubbles 封顶：尾巴并进最后一条', () => {
    const p = plan('a\nb\nc\nd', { maxBubbles: 3 });
    expect(p.bubbles).toEqual(['a', 'b', 'c\nd']);
  });

  it('maxBubbles=1 → 合并为一条整文', () => {
    const p = plan('a\nb', { maxBubbles: 1 });
    expect(p.bubbles).toEqual(['a\nb']);
    expect(p.split).toBe(false);
  });

  it('单条超限时按字符上限兜底切块', () => {
    const pieces = fitLimit('x'.repeat(30), 10);
    expect(pieces).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(10)]);
  });
});

describe('nextIntervalMs', () => {
  it('random：rng 取端点得到上下限，且 min/max 颠倒也能工作', () => {
    expect(nextIntervalMs(cfg({ intervalMin: 2.5, intervalMax: 5 }), 10, () => 0)).toBe(2500);
    expect(nextIntervalMs(cfg({ intervalMin: 2.5, intervalMax: 5 }), 10, () => 1)).toBe(5000);
    expect(nextIntervalMs(cfg({ intervalMin: 5, intervalMax: 2.5 }), 10, () => 0)).toBe(2500);
  });

  it('log：log(字数+1, logBase) 秒，并夹在 [0, 60] 秒', () => {
    const ms = nextIntervalMs(cfg({ intervalMethod: 'log', logBase: 2.6, logJitter: 0 }), 20, () => 0);
    expect(ms).toBeGreaterThan(3000);
    expect(ms).toBeLessThan(3400);
    // 底数贴近 1 时间隔会爆掉，必须被夹到 60 秒上限
    expect(nextIntervalMs(cfg({ intervalMethod: 'log', logBase: 1.01, logJitter: 0 }), 100000, () => 0)).toBe(60000);
  });

  it('log 模式追加 [0, logJitter] 随机抖动', () => {
    const a = nextIntervalMs(cfg({ intervalMethod: 'log', logJitter: 0.5 }), 20, () => 0);
    const b = nextIntervalMs(cfg({ intervalMethod: 'log', logJitter: 0.5 }), 20, () => 1);
    expect(b - a).toBe(500);
  });
});

describe('deliverSegmentedReply', () => {
  it('串行逐条发送，条间按策略停顿，只发一次汇总日志', async () => {
    const logger = createLogger();
    const sent: string[] = [];
    let now = 0;
    const sleep = vi.fn(async (ms: number) => { now += ms; });
    const sender = {
      sendMarkdown: vi.fn(async (_t: ReplyTarget, text: string) => {
        sent.push(text + '@' + now);
      }),
    };

    await deliverSegmentedReply({
      sender,
      target,
      plan: plan('a\nb\nc'),
      config: cfg({ intervalMin: 1, intervalMax: 1 }),
      logger,
      tag: 'test',
      rng: () => 0,
      sleep,
    });

    expect(sent).toEqual(['a@0', 'b@1000', 'c@2000']);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('单条不停顿、不打汇总日志', async () => {
    const logger = createLogger();
    const sleep = vi.fn(async () => {});
    await deliverSegmentedReply({
      sender: { sendMarkdown: vi.fn(async () => {}) },
      target,
      plan: plan('只有一条'),
      config: cfg({ intervalMin: 5, intervalMax: 5 }),
      logger,
      tag: 'test',
      sleep,
    });
    expect(sleep).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('单条失败不中断后续分段', async () => {
    const logger = createLogger();
    const sendMarkdown = vi.fn(async (_t: ReplyTarget, text: string) => {
      if (text === 'b') throw new Error('boom');
    });
    await deliverSegmentedReply({
      sender: { sendMarkdown },
      target,
      plan: plan('a\nb\nc'),
      config: cfg({ intervalMin: 0, intervalMax: 0 }),
      logger,
      tag: 'test',
      sleep: async () => {},
    });
    expect(sendMarkdown).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('空计划不发任何消息', async () => {
    const logger = createLogger();
    const sendMarkdown = vi.fn();
    await deliverSegmentedReply({
      sender: { sendMarkdown },
      target,
      plan: plan('   '),
      config: cfg(),
      logger,
      tag: 'test',
    });
    expect(sendMarkdown).not.toHaveBeenCalled();
  });
});
