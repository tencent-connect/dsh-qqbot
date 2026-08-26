import { describe, it, expect, vi } from 'vitest';
import type { InteractionEvent } from '@tencent-connect/qqbot-nodejs';
import {
  ApprovalChannel,
  type ApprovalOutcome,
  type ApprovalRequest,
  type ApprovalSessionRecordLike,
  type ApprovalChannelContext,
} from './approval-channel.ts';
import { buildApprovalKeyboard, buildApprovalText } from './approval-renderer.ts';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

interface SentMessage {
  text: string;
  opts?: { keyboard?: unknown };
}

function createSender(sent: SentMessage[]) {
  return {
    sendMarkdown: vi.fn(async (_target: ReplyTarget, content: string, o?: { keyboard?: unknown }) => {
      sent.push({ text: content, opts: o });
    }),
  };
}

const sessionKey = (scope: ChatScope, peerId: string): string => `qqbot:app:${scope}:${peerId}`;

function makeRecord(key: string, scope: ChatScope = 'c2c'): ApprovalSessionRecordLike {
  return { sessionKey: key, scope, replyTarget: { scope, targetId: 'x', msgId: 'm' } };
}

function createManager(opts?: {
  findBySessionId?: (id: string) => ApprovalSessionRecordLike | undefined;
  getSessionRecord?: (scope: ChatScope, peerId: string) => ApprovalSessionRecordLike | undefined;
}) {
  return {
    findBySessionId: opts?.findBySessionId ?? (() => undefined),
    getSessionRecord: opts?.getSessionRecord ?? ((scope: ChatScope, peerId: string) => makeRecord(sessionKey(scope, peerId), scope)),
  };
}

function makeRequest(opts?: {
  id?: string;
  toolName?: string;
  callId?: string;
  reason?: string;
  events?: ApprovalRequest['agent']['session']['events'];
  signal?: AbortSignal;
}): ApprovalRequest {
  return {
    agent: { id: opts?.id ?? 'sess-qq', session: { events: opts?.events ?? [] } },
    toolName: opts?.toolName ?? 'bash',
    ...(opts?.callId !== undefined ? { callId: opts.callId } : {}),
    ...(opts?.reason !== undefined ? { reason: opts.reason } : {}),
    ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
  };
}

function makeEvent(data: string | undefined, peer: { user?: string; group?: string }): InteractionEvent {
  return {
    id: 'i1',
    type: 1,
    version: 1,
    ...(peer.group ? { group_openid: peer.group } : {}),
    ...(peer.user ? { user_openid: peer.user } : {}),
    data: { type: 1, resolved: { ...(data !== undefined ? { button_data: data } : {}) } },
  } as InteractionEvent;
}

/** 注册 approval/request 监听并捕获 handler，供测试手动触发 */
function installAndCapture(ch: ApprovalChannel, sent: SentMessage[]): {
  handler: (req: unknown, next: unknown) => unknown;
} {
  const captured: { handler?: (req: unknown, next: unknown) => unknown } = {};
  const ctx: ApprovalChannelContext = {
    get: vi.fn((name: string) => (name === 'approval' ? {} : undefined)),
    on: vi.fn((event: string, handler: (req: unknown, next: unknown) => unknown) => {
      if (event === 'approval/request') captured.handler = handler;
    }),
  };
  ch.install(ctx);
  return { handler: captured.handler! };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('buildApprovalKeyboard', () => {
  it('builds two mutually-exclusive buttons with type-tagged data', () => {
    const kb = buildApprovalKeyboard();
    const buttons = kb.content.rows[0]?.buttons ?? [];
    expect(buttons).toHaveLength(2);

    const allow = buttons[0]!;
    expect(allow.group_id).toBe('approval');
    expect(allow.action.type).toBe(1);
    expect(allow.action.click_limit).toBe(1);
    expect(JSON.parse(allow.action.data)).toEqual({ t: 'approval', d: 'allow' });

    const deny = buttons[1]!;
    expect(deny.group_id).toBe('approval');
    expect(JSON.parse(deny.action.data)).toEqual({ t: 'approval', d: 'deny' });
  });
});

describe('buildApprovalText', () => {
  it('renders tool name, gated command and reason', () => {
    const req = makeRequest({ toolName: 'bash', reason: '用户要求列出文件' });
    const text = buildApprovalText(req, 'ls -la');
    expect(text).toContain('bash');
    expect(text).toContain('ls -la');
    expect(text).toContain('用户要求列出文件');
  });
});

describe('ApprovalChannel.install', () => {
  it('routes QQ sessions to park and delegates others to next', async () => {
    const sent: SentMessage[] = [];
    const ch = new ApprovalChannel(
      createManager({ findBySessionId: (id) => (id === 'sess-qq' ? makeRecord(sessionKey('c2c', 'peer-qq')) : undefined) }),
      createSender(sent),
      createLogger(),
    );
    const { handler } = installAndCapture(ch, sent);

    // 非 QQ 会话 → 委托 next
    const delegated = await handler(makeRequest({ id: 'sess-web' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    expect(delegated).toBe('unavailable');
    expect(sent).toHaveLength(0);

    // QQ 会话 → park（发消息 + 挂起）
    const p = handler(makeRequest({ id: 'sess-qq' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.opts?.keyboard).toBeDefined();

    // 点击 allow → resolve allowed-once
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ t: 'approval', d: 'allow' }), { user: 'peer-qq' }))).toBe(true);
    await expect(p).resolves.toBe('allowed-once');
  });

  it('recovers the gated command from the session log', async () => {
    const sent: SentMessage[] = [];
    const ch = new ApprovalChannel(
      createManager({ findBySessionId: (id) => (id === 'sess-qq' ? makeRecord(sessionKey('c2c', 'peer-qq')) : undefined) }),
      createSender(sent),
      createLogger(),
    );
    const { handler } = installAndCapture(ch, sent);

    const events = [{ type: 'tool/call', data: { callId: 'c1', arguments: JSON.stringify({ command: 'ls -la' }) } }];
    const p = handler(makeRequest({ id: 'sess-qq', callId: 'c1', events }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);
    expect(sent[0]!.text).toContain('ls -la');

    ch.cancelPending(sessionKey('c2c', 'peer-qq'));
    await expect(p).resolves.toBe('cancelled');
  });
});

describe('ApprovalChannel.handleInteraction', () => {
  it('settles deny as rejected and ignores unknown buttons', async () => {
    const sent: SentMessage[] = [];
    const ch = new ApprovalChannel(
      createManager({ findBySessionId: (id) => (id === 'sess-qq' ? makeRecord(sessionKey('c2c', 'peer-qq')) : undefined) }),
      createSender(sent),
      createLogger(),
    );
    const { handler } = installAndCapture(ch, sent);

    const p = handler(makeRequest({ id: 'sess-qq' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);

    // 非审批按钮 → false，不消费
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ t: 'question', q: 'x', i: 0 }), { user: 'peer-qq' }))).toBe(false);
    // 拒绝 → rejected
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ t: 'approval', d: 'deny' }), { user: 'peer-qq' }))).toBe(true);
    await expect(p).resolves.toBe('rejected');
  });
});

describe('ApprovalChannel.cancelPending', () => {
  it('cancels a pending approval on session eviction', async () => {
    const sent: SentMessage[] = [];
    const ch = new ApprovalChannel(
      createManager({ findBySessionId: (id) => (id === 'sess-qq' ? makeRecord(sessionKey('c2c', 'peer-qq')) : undefined) }),
      createSender(sent),
      createLogger(),
    );
    const { handler } = installAndCapture(ch, sent);

    const p = handler(makeRequest({ id: 'sess-qq' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);

    ch.cancelPending(sessionKey('c2c', 'peer-qq'));
    await expect(p).resolves.toBe('cancelled');
  });

  it('fails closed as unavailable when sending fails', async () => {
    const ch = new ApprovalChannel(
      createManager({ findBySessionId: (id) => (id === 'sess-qq' ? makeRecord(sessionKey('c2c', 'peer-qq')) : undefined) }),
      { sendMarkdown: vi.fn(async () => { throw new Error('network down'); }) },
      createLogger(),
    );
    const { handler } = installAndCapture(ch, []);

    await expect(handler(makeRequest({ id: 'sess-qq' }), () => Promise.resolve('unavailable' as ApprovalOutcome)))
      .resolves.toBe('unavailable');
  });
});
