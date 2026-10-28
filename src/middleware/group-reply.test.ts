import { randomUUID } from 'node:crypto';
import {
  historyBuffer, runMiddlewareChain,
  type Middleware, type MiddlewareContext, type QQBot, type QQBotInboundMessage,
} from '@tencent-connect/qqbot-nodejs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImQQBotConfig } from '../config.ts';
import { getHistoryStore, historyGroupKey } from '../features/history-store.ts';
import { createGroupReplyGate, createSmartGroupQueue } from './group-reply.ts';
import { setupMiddlewares } from '../gateway/middleware-setup.ts';
import type { GroupReplyMessage, GroupReplyPolicy } from '../features/group-reply-policy.ts';
import type { SessionManager } from '../session/index.ts';

// The SDK uses this context factory internally but does not export it from its package root.
const { createMiddlewareContext } = await import(new URL(
  'middleware/types.js', import.meta.resolve('@tencent-connect/qqbot-nodejs'),
).href);

const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach((dispose) => dispose()); });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function config(overrides: Partial<ImQQBotConfig> = {}): ImQQBotConfig {
  return {
    appId: 'middleware-test', requireMention: false, groupSmartReply: true,
    maxQueue: 20, historyLimit: 10, processingTimeoutMs: 30_000, ...overrides,
  } as ImQQBotConfig;
}

function context(id: string, options: { group?: string; kind?: 'group' | 'c2c'; mentioned?: boolean } = {}) {
  const kind = options.kind ?? 'group';
  const target = options.group ?? 'test-group';
  const ctx = createMiddlewareContext({
    bot: { appId: 'middleware-test', sendMarkdown: vi.fn() } as unknown as QQBot,
    log: logger,
    message: {
      kind, rawEventType: options.mentioned ? 'GROUP_AT_MESSAGE_CREATE' : 'GROUP_MESSAGE_CREATE',
      senderId: `sender-${id}`, senderName: `name-${id}`, content: `message-${id}`, messageId: id,
      timestamp: new Date().toISOString(), groupOpenid: kind === 'group' ? target : undefined,
      replyTarget: { scope: kind, targetId: target, msgId: id },
    } as QQBotInboundMessage,
  });
  ctx.state.mention = { wasMentioned: options.mentioned ?? false };
  return ctx;
}

function queue(settings = config()) {
  const result = createSmartGroupQueue(settings, logger);
  cleanups.push(result.dispose);
  return result;
}

function messages(ctx: MiddlewareContext) {
  return ctx.state.groupReplyMessages as Array<{ messageId: string; senderId: string; wasMentioned: boolean }>;
}

describe('smart group queue', () => {
  it('serializes whole downstream turns and merges pending messages without dropping senders or mentions', async () => {
    const serial = queue();
    const firstEntered = deferred();
    const firstRelease = deferred();
    const batchEntered = deferred();
    const batchRelease = deferred();
    let active = 0;
    let maxActive = 0;
    const batches: ReturnType<typeof messages>[] = [];
    const tail = async (ctx: MiddlewareContext) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      batches.push(messages(ctx).map((message) => ({ ...message })));
      if (batches.length === 1) {
        firstEntered.resolve();
        await firstRelease.promise;
      } else if (batches.length === 2) {
        batchEntered.resolve();
        await batchRelease.promise;
      }
      active -= 1;
    };
    const first = runMiddlewareChain([serial.middleware, tail], context('first'));
    await firstEntered.promise;
    const second = runMiddlewareChain([serial.middleware, tail], context('second'));
    const third = runMiddlewareChain([serial.middleware, tail], context('third', { mentioned: true }));
    expect(batches).toHaveLength(1);
    firstRelease.resolve();
    await batchEntered.promise;
    const fourth = runMiddlewareChain([serial.middleware, tail], context('fourth'));
    expect(batches).toHaveLength(2);
    batchRelease.resolve();
    await Promise.all([first, second, third, fourth]);

    expect(maxActive).toBe(1);
    expect(batches.map((batch) => batch.map((message) => message.messageId)))
      .toEqual([['first'], ['second', 'third'], ['fourth']]);
    expect(batches[1]).toEqual([
      expect.objectContaining({ messageId: 'second', senderId: 'sender-second', wasMentioned: false }),
      expect.objectContaining({ messageId: 'third', senderId: 'sender-third', wasMentioned: true }),
    ]);
  });

  it('lets different groups run independently', async () => {
    const serial = queue();
    const release = deferred();
    const allEntered = deferred();
    const entered: string[] = [];
    const tail = async (ctx: MiddlewareContext) => {
      entered.push(ctx.message.groupOpenid!);
      if (entered.length === 2) allEntered.resolve();
      await release.promise;
    };
    const first = runMiddlewareChain([serial.middleware, tail], context('a', { group: 'group-a' }));
    const second = runMiddlewareChain([serial.middleware, tail], context('b', { group: 'group-b' }));
    await allEntered.promise;
    expect(entered.sort()).toEqual(['group-a', 'group-b']);
    release.resolve();
    await Promise.all([first, second]);
  });

  it('aborts active and queued contexts on dispose without dispatching queued messages', async () => {
    const serial = queue();
    const entered = deferred();
    const seen: string[] = [];
    const tail = async (ctx: MiddlewareContext) => {
      seen.push(ctx.message.messageId);
      entered.resolve();
      await new Promise<void>((resolve) => {
        if (ctx.signal.aborted) resolve();
        else ctx.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    };
    const active = context('active');
    const pending = context('pending');
    const first = runMiddlewareChain([serial.middleware, tail], active);
    await entered.promise;
    const second = runMiddlewareChain([serial.middleware, tail], pending);
    serial.dispose();
    await Promise.all([first, second]);

    expect(active.signal.aborted).toBe(true);
    expect(pending.signal.aborted).toBe(true);
    expect(seen).toEqual(['active']);
  });
});

describe('smart group gate', () => {
  it('preserves every quoted message and its attachments through the real middleware chain', async () => {
    const settings = config({
      access: { c2cMode: 'open', c2cAllow: [], groupMode: 'open', groupAllow: [] },
      media: { enabled: false, maxMB: 1, ttlHours: 1 },
    });
    const chain: Middleware[] = [];
    const bot = { use: (middleware: Middleware) => { chain.push(middleware); } } as unknown as QQBot;
    const policy = { decide: vi.fn(async () => true), dispose: vi.fn() };
    cleanups.push(setupMiddlewares(bot, settings, {} as SessionManager, logger, policy as unknown as GroupReplyPolicy));
    const entered = deferred();
    const release = deferred();
    const batches: GroupReplyMessage[][] = [];
    const attachments: unknown[][] = [];
    chain.push(async (ctx) => {
      batches.push(ctx.state.groupReplyMessages as GroupReplyMessage[]);
      attachments.push(ctx.state.quote?.attachments ?? []);
      if (batches.length === 1) { entered.resolve(); await release.promise; }
    });
    const group = randomUUID();
    const active = runMiddlewareChain(chain, context('active', { group }));
    await entered.promise;
    const first = context('quoted-first', { group });
    first.message.refMsgIdx = 'earlier-bot-answer';
    first.message.msgElements = [{
      content: '第一条引用：链式法则。',
      attachments: [{ content_type: 'image/png', filename: 'quoted-chart.png', url: 'https://example.invalid/chart.png' }],
    }];
    const last = context('quoted-last', { group });
    last.message.refMsgIdx = 'another-answer';
    last.message.msgElements = [{ content: '最后一条引用：晚饭吃面。' }];
    const second = runMiddlewareChain(chain, first);
    const third = runMiddlewareChain(chain, last);
    // Both quote lookups must reach the queue before releasing the active turn.
    await vi.waitFor(() => expect(first.state.quote?.text).toContain('链式法则'));
    await vi.waitFor(() => expect(last.state.quote?.text).toContain('晚饭吃面'));
    release.resolve();
    await Promise.all([active, second, third]);

    expect(batches).toHaveLength(2);
    const batch = batches[1]!;
    expect(batch.find((message) => message.messageId === 'quoted-first')?.quote?.text).toContain('链式法则');
    expect(batch.find((message) => message.messageId === 'quoted-last')?.quote?.text).toContain('晚饭吃面');
    expect(attachments[1]).toEqual([
      expect.objectContaining({ contentType: 'image/png', filename: 'quoted-chart.png', url: 'https://example.invalid/chart.png' }),
    ]);
    expect(policy.decide).toHaveBeenLastCalledWith(expect.objectContaining({ messages: batch }));
  });

  it('stops a silent decision without output while retaining the message in group history', async () => {
    const settings = config();
    const group = randomUUID();
    const key = historyGroupKey(settings.appId, group);
    const store = getHistoryStore();
    const decide = vi.fn(async () => false);
    const next = vi.fn(async () => {});
    const ctx = context('silent', { group });
    await store.append(key, {
      messageId: 'previous', senderId: 'other', content: '群友在互相聊天', timestamp: Date.now(),
    }, 10);
    const completed = await runMiddlewareChain([
      historyBuffer({ store, limit: 10, groupKey: () => key }),
      createGroupReplyGate(settings, { decide }), next,
    ], ctx);

    expect(completed).toBe(false);
    expect(ctx.stopped).toBe(true);
    expect(next).not.toHaveBeenCalled();
    expect(decide).toHaveBeenCalledOnce();
    expect(ctx.bot.sendMarkdown).not.toHaveBeenCalled();
    expect((await store.list(key, 10)).map((entry) => entry.messageId)).toEqual(['previous', 'silent']);
    expect(ctx.state.groupSmartReplyAccepted).not.toBe(true);
  });

  it('marks an accepted non-mention message before continuing to the agent', async () => {
    const decide = vi.fn(async () => true);
    const ctx = context('accepted');
    const next = vi.fn(async () => {
      expect(ctx.state.groupSmartReplyAccepted).toBe(true);
    });
    await createGroupReplyGate(config(), { decide })(ctx, next);
    expect(decide).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
    expect(ctx.stopped).toBe(false);
  });

  it('does not use newer pending messages as history when a busy group has evicted the active message', async () => {
    const settings = config({ historyLimit: 2 });
    const group = randomUUID();
    const key = historyGroupKey(settings.appId, group);
    const store = getHistoryStore();
    const ctx = context('active-old', { group });
    for (const id of ['active-old', 'newer-one', 'newer-two']) {
      await store.append(key, { messageId: id, senderId: id, content: id, timestamp: Date.now() }, 2);
    }
    const decide = vi.fn(async () => false);
    await createGroupReplyGate(settings, { decide })(ctx, async () => {});
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ history: [] }));
  });

  it.each([
    { overrides: { groupSmartReply: false }, kind: 'group' as const },
    { overrides: { requireMention: true }, kind: 'group' as const },
    { overrides: {}, kind: 'c2c' as const },
  ])('bypasses decision when disabled, mention-only, or private %#', async ({ overrides, kind }) => {
    const decide = vi.fn();
    const gate = createGroupReplyGate(config(overrides), { decide });
    const next = vi.fn(async () => {});
    const ctx = context('bypass', { kind });
    await gate(ctx, next);
    expect(next).toHaveBeenCalledOnce();
    expect(decide).not.toHaveBeenCalled();
  });

  it('bypasses the model when any message in a merged batch explicitly mentions the bot', async () => {
    const serial = queue();
    const decide = vi.fn();
    const gate = createGroupReplyGate(config(), { decide });
    const entered = deferred();
    const release = deferred();
    const first = runMiddlewareChain([serial.middleware, async () => {
      entered.resolve();
      await release.promise;
    }], context('active'));
    await entered.promise;
    const handled = vi.fn(async () => {});
    const ordinary = context('ordinary');
    const mentioned = context('mentioned', { mentioned: true });
    const second = runMiddlewareChain([serial.middleware, gate, handled], ordinary);
    const third = runMiddlewareChain([serial.middleware, gate, handled], mentioned);
    release.resolve();
    await Promise.all([first, second, third]);

    expect(handled).toHaveBeenCalledOnce();
    expect(decide).not.toHaveBeenCalled();
  });
});
