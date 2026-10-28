import { randomUUID } from 'node:crypto';
import { type QQBot, type QQBotInboundMessage } from '@tencent-connect/qqbot-nodejs';
import { describe, expect, it, vi } from 'vitest';
import type { ImQQBotConfig } from '../config.ts';
import { getHistoryStore, historyGroupKey } from '../features/history-store.ts';
import type { SessionManager } from '../session/index.ts';
import { handleInbound } from './inbound.ts';

const { createMiddlewareContext } = await import(new URL(
  'middleware/types.js', import.meta.resolve('@tencent-connect/qqbot-nodejs'),
).href);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness() {
  const groupId = randomUUID();
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const sendMarkdown = vi.fn(async () => {});
  const followup = vi.fn<(message: unknown) => void>();
  const whenIdle = vi.fn(async () => {});
  const cancel = vi.fn();
  const record = { agent: { followup, whenIdle, cancel } };
  const getOrCreate = vi.fn(async () => record);
  const manager = { getOrCreate } as unknown as SessionManager;
  const config = { appId: 'inbound-test', groupSmartReply: true, requireMention: false } as ImQQBotConfig;
  const ctx = createMiddlewareContext({
    bot: { sendMarkdown } as unknown as QQBot,
    log: logger,
    message: {
      kind: 'group', rawEventType: 'GROUP_MESSAGE_CREATE', groupOpenid: groupId,
      senderId: 'current-user', senderName: '小王', content: '那具体怎么做？',
      messageId: 'current', timestamp: new Date().toISOString(),
      replyTarget: { scope: 'group', targetId: groupId, msgId: 'current' },
    } as QQBotInboundMessage,
  });
  ctx.state.mention = { wasMentioned: false };
  ctx.state.groupSmartReplyAccepted = true;
  const key = historyGroupKey(config.appId, groupId);
  const store = getHistoryStore();
  function entry(messageId: string, content: string) {
    return { messageId, content, senderId: 'previous-user', senderName: '小李', timestamp: Date.now() };
  }
  function body() {
    const message = followup.mock.calls[0]?.[0] as { content: Array<{ type: string; text?: string }> };
    return message.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
  }
  return { ctx, manager, config, logger, followup, whenIdle, getOrCreate, sendMarkdown, store, key, entry, body, record };
}

describe('smart group inbound context', () => {
  it('includes silent group context when a non-mention message is accepted', async () => {
    const test = harness();
    const previous = test.entry('previous', '我们正在讨论如何给项目部署监控。');
    await test.store.append(test.key, previous, 10);
    await test.store.append(test.key, test.entry('current', test.ctx.message.content), 10);
    test.ctx.state.history = [previous];

    await handleInbound(test.ctx, test.manager, test.config, test.logger);

    expect(test.followup).toHaveBeenCalledOnce();
    expect(test.body()).toContain(previous.content);
    expect(test.body()).toContain('那具体怎么做？');
    expect(test.body()).toContain('previous-user');
    expect(test.sendMarkdown).not.toHaveBeenCalled();
    expect(await test.store.list(test.key, 10)).toEqual([]);
  });

  it('consumes only messages actually supplied to the agent, preserving later arrivals', async () => {
    const test = harness();
    const previous = test.entry('previous', '已有上下文');
    const duringCreate = test.entry('during-create', '创建会话时刚到的消息');
    const duringTurn = test.entry('during-turn', '生成回复时刚到的消息');
    await test.store.append(test.key, previous, 10);
    await test.store.append(test.key, test.entry('current', test.ctx.message.content), 10);
    test.ctx.state.history = [previous];
    test.getOrCreate.mockImplementation(async () => {
      await test.store.append(test.key, duringCreate, 10);
      return test.record;
    });
    test.whenIdle.mockImplementation(async () => {
      await test.store.append(test.key, duringTurn, 10);
    });

    await handleInbound(test.ctx, test.manager, test.config, test.logger);

    expect(test.body()).toContain(previous.content);
    expect(test.body()).not.toContain(duringCreate.content);
    expect(test.body()).not.toContain(duringTurn.content);
    expect((await test.store.list(test.key, 10)).map((entry) => entry.messageId))
      .toEqual(['during-create', 'during-turn']);
  });

  it('preserves each sender and mention in a merged group batch and consumes both message IDs', async () => {
    const test = harness();
    const batch = [
      { messageId: 'first-member', senderId: 'member-a', senderName: '小陈', content: '我们想比较两个部署方案。', wasMentioned: false },
      { messageId: 'current', senderId: 'member-b', senderName: '小张', content: '请帮我们分析一下。', wasMentioned: true },
    ];
    test.ctx.state.groupReplyMessages = batch;
    test.ctx.state.mention = { wasMentioned: true };
    test.ctx.message.content = batch.map((message) => message.content).join('\n');
    for (const message of batch) {
      await test.store.append(test.key, { ...message, timestamp: Date.now() }, 10);
    }

    await handleInbound(test.ctx, test.manager, test.config, test.logger);

    const body = test.body();
    expect(body).toContain('member-a');
    expect(body).toContain('member-b');
    expect(body).toContain(batch[0]!.content);
    expect(body).toContain(batch[1]!.content);
    expect(body).toContain('(@you)');
    expect(await test.store.list(test.key, 10)).toEqual([]);
  });

  it('does not create a session or follow up when cancelled before dispatch', async () => {
    const test = harness();
    test.ctx.abort('test-cancelled');

    await handleInbound(test.ctx, test.manager, test.config, test.logger);

    expect(test.getOrCreate).not.toHaveBeenCalled();
    expect(test.followup).not.toHaveBeenCalled();
    expect(test.sendMarkdown).not.toHaveBeenCalled();
  });

  it('keeps each quoted text attached to its own sender when composing a merged turn', async () => {
    const test = harness();
    test.ctx.state.groupReplyMessages = [
      { messageId: 'first-member', senderId: 'member-a', content: '第一个问题', wasMentioned: false, quote: { text: '第一个被引用的回答' } },
      { messageId: 'current', senderId: 'member-b', content: '第二个问题', wasMentioned: false, quote: { text: '第二个被引用的回答' } },
    ];
    test.ctx.state.quote = {
      refKey: 'last', source: 'msg_elements', text: '第二个被引用的回答',
      attachments: [{ contentType: 'image/png', filename: 'quoted-chart.png', url: 'https://example.invalid/chart.png' }],
    };
    test.ctx.state.downloadedQuoteFiles = [{ filename: 'quoted-chart.png', localPath: '/tmp/quoted-chart.png' }];

    await handleInbound(test.ctx, test.manager, test.config, test.logger);

    const body = test.body();
    const firstQuote = body.indexOf('第一个被引用的回答');
    const firstQuestion = body.indexOf('第一个问题');
    const secondQuote = body.indexOf('第二个被引用的回答');
    const secondQuestion = body.indexOf('第二个问题');
    expect(firstQuote).toBeGreaterThanOrEqual(0);
    expect(firstQuestion).toBeGreaterThan(firstQuote);
    expect(secondQuote).toBeGreaterThan(firstQuestion);
    expect(secondQuestion).toBeGreaterThan(secondQuote);
    expect(body).toContain('Image: /tmp/quoted-chart.png');
  });

  it('does not follow up if cancelled while a session is being created', async () => {
    const test = harness();
    const creating = deferred();
    const release = deferred();
    test.getOrCreate.mockImplementation(async () => {
      creating.resolve();
      await release.promise;
      return test.record;
    });
    const task = handleInbound(test.ctx, test.manager, test.config, test.logger);
    await creating.promise;
    test.ctx.abort('test-cancelled');
    release.resolve();
    await task;

    expect(test.followup).not.toHaveBeenCalled();
    expect(test.sendMarkdown).not.toHaveBeenCalled();
  });
});
