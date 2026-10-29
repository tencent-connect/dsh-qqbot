import { describe, it, expect, vi } from 'vitest';
import type { EventOptions } from '@deepseek-ai/cordis';
import type { InteractionEvent } from '@tencent-connect/qqbot-nodejs';
import {
  ApprovalChannel,
  type ApprovalOutcome,
  type ApprovalRequest,
  type ApprovalSessionRecordLike,
  type ApprovalChannelConfigLike,
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

/** 默认开放模式（不校验）；allowlist 模式用 makeConfig('allowlist', [...]) */
function makeConfig(c2cMode: 'open' | 'allowlist' | 'disabled' = 'open', c2cAllow: string[] = []): ApprovalChannelConfigLike {
  return { access: { c2cMode, c2cAllow } };
}

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
  events?: ReturnType<NonNullable<ApprovalRequest['agent']['session']>['snapshotEvents']>;
  signal?: AbortSignal;
  /** 模拟拿不到 live session 的审批上下文（跨进程/投影后的 Agent）。 */
  noSession?: boolean;
}): ApprovalRequest {
  return {
    agent: opts?.noSession === true
      ? { id: opts?.id ?? 'sess-qq' }
      : { id: opts?.id ?? 'sess-qq', session: { snapshotEvents: () => opts?.events ?? [] } },
    toolName: opts?.toolName ?? 'bash',
    ...(opts?.callId !== undefined ? { callId: opts.callId } : {}),
    ...(opts?.reason !== undefined ? { reason: opts.reason } : {}),
    ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
  };
}

function makeEvent(data: string | undefined, peer: { user?: string; group?: string; member?: string }): InteractionEvent {
  return {
    id: 'i1',
    type: 1,
    version: 1,
    ...(peer.group ? { group_openid: peer.group } : {}),
    ...(peer.user ? { user_openid: peer.user } : {}),
    ...(peer.member ? { group_member_openid: peer.member } : {}),
    data: { type: 1, resolved: { ...(data !== undefined ? { button_data: data } : {}) } },
  } as InteractionEvent;
}

/** 注册 approval/request 监听并捕获 handler，供测试手动触发 */
function installAndCapture(ch: ApprovalChannel, sent: SentMessage[]): {
  handler: (req: unknown, next: unknown) => unknown;
  options?: EventOptions;
} {
  const captured: {
    handler?: (req: unknown, next: unknown) => unknown;
    options?: EventOptions;
  } = {};
  const ctx: ApprovalChannelContext = {
    on: vi.fn((event: string, handler: (req: unknown, next: unknown) => unknown, options?: EventOptions) => {
      if (event === 'approval/request') {
        captured.handler = handler;
        captured.options = options;
      }
      return () => true;
    }),
  };
  ch.install(ctx);
  return { handler: captured.handler!, ...(captured.options !== undefined ? { options: captured.options } : {}) };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('buildApprovalKeyboard', () => {
  it('builds two type-tagged buttons without the unsupported group_id', () => {
    const kb = buildApprovalKeyboard();
    const buttons = kb.content.rows[0]?.buttons ?? [];
    expect(buttons).toHaveLength(2);

    const allow = buttons[0]!;
    expect(allow).not.toHaveProperty('group_id');
    expect(allow.action.type).toBe(1);
    expect(allow.action.click_limit).toBe(1);
    expect(JSON.parse(allow.action.data)).toEqual({ t: 'approval', d: 'allow' });

    const deny = buttons[1]!;
    expect(deny).not.toHaveProperty('group_id');
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
      makeConfig(),
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
      makeConfig(),
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

  it('registers a global waterfall listener without probing the approval service', () => {
    const ch = new ApprovalChannel(
      createManager({ findBySessionId: () => undefined }),
      createSender([]),
      makeConfig(),
      createLogger(),
    );
    const { handler, options } = installAndCapture(ch, []);
    expect(handler).toBeTypeOf('function');
    expect(options).toEqual({ global: true, prepend: true });
  });

  it('allowlist 模式：非授权成员点击群审批按钮无效，授权成员放行（#83）', async () => {
    const sent: SentMessage[] = [];
    const ch = new ApprovalChannel(
      createManager({
        findBySessionId: (id) => (id === 'sess-qq' ? makeRecord(sessionKey('group', 'group-1'), 'group') : undefined),
      }),
      createSender(sent),
      makeConfig('allowlist', ['owner-1']),
      createLogger(),
    );
    const { handler } = installAndCapture(ch, sent);

    const p = handler(makeRequest({ id: 'sess-qq' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);
    expect(sent).toHaveLength(1);

    // 群互动事件点击者字段为 group_member_openid（user_openid 不填）：
    // 非授权成员点击 → 拒绝（审批保持挂起）
    const stranger = ch.handleInteraction(makeEvent(JSON.stringify({ t: 'approval', d: 'allow' }), { group: 'group-1', member: 'stranger-9' }));
    expect(stranger).toBe(false);

    // 授权成员（群成员标识在名单内）点击 → 放行
    const owner = ch.handleInteraction(makeEvent(JSON.stringify({ t: 'approval', d: 'allow' }), { group: 'group-1', member: 'owner-1' }));
    expect(owner).toBe(true);
    await expect(p).resolves.toBe('allowed-once');
  });

  it('allowlist 模式：私聊卡片转发给他人点击无效', async () => {
    const sent: SentMessage[] = [];
    const ch = new ApprovalChannel(
      createManager({
        findBySessionId: (id) => (id === 'sess-qq' ? makeRecord(sessionKey('c2c', 'peer-qq')) : undefined),
      }),
      createSender(sent),
      makeConfig('allowlist', ['peer-qq']),
      createLogger(),
    );
    const { handler } = installAndCapture(ch, sent);

    const p = handler(makeRequest({ id: 'sess-qq' }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);

    // 转发场景：点击者 user_openid ≠ 名单成员 → 无效
    expect(ch.handleInteraction(makeEvent(JSON.stringify({ t: 'approval', d: 'allow' }), { user: 'forwarded-user' }))).toBe(false);

    ch.cancelPending(sessionKey('c2c', 'peer-qq'));
    await expect(p).resolves.toBe('cancelled');
  });

  it('still sends the prompt when the session log is unavailable', async () => {
    const sent: SentMessage[] = [];
    const ch = new ApprovalChannel(
      createManager({ findBySessionId: (id) => (id === 'sess-qq' ? makeRecord(sessionKey('c2c', 'peer-qq')) : undefined) }),
      createSender(sent),
      makeConfig(),
      createLogger(),
    );
    const { handler } = installAndCapture(ch, sent);

    const p = handler(makeRequest({ id: 'sess-qq', noSession: true }), () => Promise.resolve('unavailable' as ApprovalOutcome));
    await sleep(20);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('bash');

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
      makeConfig(),
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
      makeConfig(),
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
      makeConfig(),
      createLogger(),
    );
    const { handler } = installAndCapture(ch, []);

    await expect(handler(makeRequest({ id: 'sess-qq' }), () => Promise.resolve('unavailable' as ApprovalOutcome)))
      .resolves.toBe('unavailable');
  });
});
