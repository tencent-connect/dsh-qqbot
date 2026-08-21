import { describe, it, expect, vi } from 'vitest';
import { handleInbound } from './inbound.js';
import type { SessionManager } from '../session/index.js';
import type { ImQQBotConfig } from '../config.js';
import type { Logger } from '../types.js';
import type { SessionRecord } from '../session/types.js';

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** 手动控制的 idle 门槛：resolve 之前 whenIdle() 一直挂着 */
function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 让所有挂起的微任务落定 */
const flush = () => new Promise((r) => setTimeout(r, 0));

function createRecord(key: string, peerId: string, idle: Promise<void>): SessionRecord {
  const agent = {
    id: `agent-${peerId}`,
    ctx: {},
    status: 'running',
    session: { id: `sess-${peerId}` },
    cancel: vi.fn(),
    followup: vi.fn(),
    whenIdle: vi.fn(() => idle),
    runMaintenance: vi.fn(),
  };
  return {
    sessionKey: key,
    sessionId: `sess-${peerId}`,
    agent: agent as unknown as SessionRecord['agent'],
    handle: { agent, dispose: vi.fn() } as unknown as SessionRecord['handle'],
    replyTarget: { scope: 'c2c', targetId: peerId, msgId: 'm0' },
    scope: 'c2c',
    peerId,
    senderId: peerId,
    lastActivity: Date.now(),
  };
}

function createManager(record: SessionRecord, current?: () => SessionRecord | undefined) {
  return {
    getOrCreate: vi.fn(async () => record),
    getSessionRecord: vi.fn(() => (current ? current() : record)),
  } as unknown as SessionManager;
}

const config = { appId: 'test-app' } as ImQQBotConfig;

function inboundMsg(peerId: string, text: string, msgId: string) {
  return { kind: 'c2c', senderId: peerId, content: text, messageId: msgId, timestamp: '' };
}

describe('handleInbound followup 串行化', () => {
  it('上一轮未 idle 时新消息排队，idle 后按到达顺序投递', async () => {
    const idle = createDeferred();
    const record = createRecord('qqbot:test-app:c2c:userA', 'userA', idle.promise);
    const manager = createManager(record);

    await handleInbound(inboundMsg('userA', 'one', 'm1'), manager, config, createLogger());
    await handleInbound(inboundMsg('userA', 'two', 'm2'), manager, config, createLogger());

    // 第一个 turn 仍在运行：两条 followup 都不允许投递
    expect(record.agent.followup).not.toHaveBeenCalled();

    idle.resolve();
    await flush();

    expect(record.agent.followup).toHaveBeenCalledTimes(2);
    const texts = record.agent.followup.mock.calls.map(
      (call) => (call[0] as { content: Array<{ text?: string }> }).content[0]?.text,
    );
    expect(texts).toEqual(['one', 'two']);
  });

  it('等待期间会话被替换（回收/fork）时丢弃排队消息，不投给失效 agent', async () => {
    const idle = createDeferred();
    const record = createRecord('qqbot:test-app:c2c:userB', 'userB', idle.promise);
    const replacement = createRecord('qqbot:test-app:c2c:userB', 'userB', Promise.resolve());
    let current: SessionRecord | undefined = record;
    const manager = createManager(record, () => current);

    await handleInbound(inboundMsg('userB', 'queued', 'm1'), manager, config, createLogger());
    expect(record.agent.followup).not.toHaveBeenCalled();

    // 模拟排队期间会话被 idle 回收或模型切换 fork 替换
    current = replacement;
    idle.resolve();
    await flush();

    expect(record.agent.followup).not.toHaveBeenCalled();
    expect(replacement.agent.followup).not.toHaveBeenCalled();
  });
});
