import type {} from '@deepseek-ai/dsh-agent/types';
import type { Context } from '@deepseek-ai/cordis';
import { createAssistantMessage, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm';
import { Session, SessionId, type TurnEndReason } from '@deepseek-ai/dsh-session';
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema } from '../config.ts';
import type { SessionManager } from '../session/session-manager.ts';
import type { DshAgent, SessionRecord } from '../session/types.ts';
import { handleInbound } from '../transport/inbound.ts';
import { ConversationService } from './conversation-service.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

type PromptContext = { name: string; order: number; interpolate?: boolean; text: string | (() => string) };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'qq-turn-context-')); roots.push(root);
  const session = Session.create(SessionId('turn-context'));
  const nextTurn: UserMessage[] = [];
  const nextStep: UserMessage[] = [];
  const contexts = new Map<string, PromptContext>();
  const systemPrompt = {
    section: () => () => {},
    context: (entry: PromptContext) => { contexts.set(entry.name, entry); return () => contexts.delete(entry.name); },
  };
  const flush = vi.fn(async () => true);
  const sessions = { get: (id: string) => id === session.id ? session : undefined, flush };
  const tools = { definitions: () => [], guard: () => () => {}, restrict: () => () => {} };
  const live = new Map<string, DshAgent>();
  const ctx = { on: () => () => {}, get: (name: string) => {
    if (name === 'sessions') return sessions;
    if (name === 'agents') return { get: (id: string) => live.get(id) };
    if (name === 'tools') return tools;
    if (name === 'systemPrompt') return systemPrompt;
    return undefined;
  } } as unknown as Context;
  const agent: DshAgent = {
    id: session.id, ctx, session, status: 'idle', inbox: { nextTurn, nextStep },
    model: { current: () => ({ provider: 'offline', model: 'fixture' }) },
    followup: (message: UserMessage) => {
      session.append('agent/inbox/spliced', { target: 'next-turn', start: nextTurn.length, inserted: [message] });
      nextTurn.push(message);
    },
    cancel: vi.fn(), whenIdle: async () => {}, runMaintenance: async task => task(new AbortController().signal),
  };
  live.set(session.id, agent);
  const record: SessionRecord = { sessionKey: 'qqbot:context-fixture:group:g', sessionId: session.id, scope: 'group', peerId: 'g', senderId: 'first',
    agent, handle: { agent, dispose: async () => {} }, lastActivity: 0, replyTarget: { scope: 'group', targetId: 'g' } };
  const manager = {
    getDefaultModel: () => ({ provider: 'offline', model: 'fixture' }), getDefaultPreset: () => 'standard',
    getSessionRecord: () => record, findBySessionId: (id: string) => id === session.id ? record : undefined,
    getOrCreate: async () => record,
  } as unknown as SessionManager;
  const config = ConfigSchema.default({ appId: 'context-fixture', appSecret: 'dummy', cwd: root })();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const sendMarkdown = vi.fn(async () => undefined);
  let service: ConversationService;
  const attach = () => {
    service = new ConversationService(ctx, manager, config, logger, root);
    service.store.ensure('group', 'g', { allMessages: true });
    service.attach(record);
    service.setSender({ sendMarkdown, openStream: () => ({ update: async () => {}, complete: async () => {} }) });
    manager.conversations = service;
  };
  attach();
  const render = () => [...contexts.values()].sort((a, b) => a.order - b.order).map(entry => typeof entry.text === 'function' ? entry.text() : entry.text).filter(Boolean).join('\n');
  const recordMessage = (id: string, senderId: string, text: string, mentioned: boolean) => {
    service.store.recordMessage(record.sessionKey, { id, senderId, senderName: senderId, text, at: Date.now(), mentioned, attachments: [] });
    return service.store.snapshotBackground(record.sessionKey, id).cursor;
  };
  const inbound = (id: string, senderId: string, text: string) => {
    const cursor = recordMessage(id, senderId, text, true);
    const input = { message: { kind: 'group', senderId, senderName: senderId, groupOpenid: 'g', messageId: id, content: text,
      timestamp: new Date().toISOString(), rawEventType: 'GROUP_AT_MESSAGE_CREATE', attachments: [] },
    state: { qqRecord: { cursor }, mention: { wasMentioned: true } }, bot: { sendMarkdown: vi.fn() } } as unknown as MiddlewareContext;
    const result = handleInbound(input, manager, config, logger);
    void result.catch(() => {});
    return result;
  };
  const observe = async () => {
    const event = session.snapshotEvents().at(-1);
    if (!event) throw new Error('Missing event');
    await service.observeSessionEvent(session.id, event.type, { ...event.data }, event.seq);
  };
  const claim = async (turn: number) => {
    // Actual ReactAgent order: turn/start -> durable inbox claim -> assembly /
    // admission refresh -> step/start and user/message admission.
    session.append('turn/start', { turn }); await observe();
    expect(render()).toBe('');
    const message = nextTurn.shift();
    if (!message) throw new Error('No queued message');
    session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] });
    return message;
  };
  const admit = async (message: UserMessage, turn: number) => {
    session.append('step/start', { turn, step: 1 });
    session.append('user/message', message, { surfaceOp: 'append' }); await observe();
  };
  const finish = async (turn: number) => {
    session.append('step/end', { turn, step: 1 });
    session.append('turn/end', { turn, reason: { kind: 'completed' } }); await observe();
    expect(render()).toBe('');
  };
  const restart = () => { service.release(session.id); attach(); };
  return { get service() { return service; }, record, session, nextTurn, nextStep, contexts, flush, sendMarkdown, render, recordMessage, inbound, claim, admit, observe, finish, restart };
}

async function waitForQueue(f: ReturnType<typeof fixture>) { await vi.waitFor(() => expect(f.nextTurn).toHaveLength(1)); }

describe('QQ runtime context follows verified native inbox claims', () => {
  it.each(([
    { kind: 'blocked' },
    { kind: 'aborted', reason: { kind: 'user' } },
    { kind: 'error', error: { code: 'UNKNOWN', message: 'pre-step failed' } },
  ] satisfies TurnEndReason[]).flatMap(reason => [false, true].map(restored => ({ reason, restored }))))('cleans an unadmitted $reason.kind turn without consuming background, reload=$restored', async ({ reason, restored }) => {
    const f = fixture(); f.recordMessage('ordinary', '旁观成员', '未入模的背景', false);
    const pending = f.inbound('qq-first', '甲', '问题'); await waitForQueue(f);
    if (restored) f.restart();
    await f.claim(1);
    expect(f.render()).toContain('未入模的背景');
    f.session.append('turn/end', { turn: 1, reason }); await f.observe();
    if (!restored) await expect(pending).rejects.toThrow('未确认进入模型');
    expect(f.service.store.snapshotBackground(f.record.sessionKey, '').text).toContain('未入模的背景');
    expect(JSON.stringify(f.service.operations.all())).not.toContain('未入模的背景');
    f.restart();
    expect(f.render()).toBe('');
    expect(JSON.stringify(f.service.operations.all())).not.toContain('未入模的背景');
  });

  it.each([false, true])('keeps a claimed opening context when only another queued QQ request is canceled, reload=$restored', async restored => {
    const f = fixture(); f.recordMessage('ordinary', '旁观成员', '本轮背景', false);
    const first = f.inbound('qq-first', '甲', '甲的问题'); await waitForQueue(f);
    if (restored) f.restart();
    const opening = await f.claim(1);
    const firstContext = f.render();
    expect(firstContext).toContain('本轮背景');
    const secondMessage = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '乙的排队问题' }] });
    const second = f.service.enqueueQQ(f.record, secondMessage, { messageId: 'qq-second', senderId: '乙' }, 0, [], { turnMetaText: '发送者：乙', backgroundText: '乙的排队背景' });
    void second.catch(() => {});
    expect(f.nextTurn).toHaveLength(1);
    f.nextTurn.splice(0);
    f.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' });
    await f.observe(); await expect(second).rejects.toThrow('已取消或修改');
    expect(f.render()).toBe(firstContext);
    expect(JSON.stringify(f.service.operations.all())).not.toContain('乙的排队背景');
    await f.admit(opening, 1);
    if (!restored) await first;
    await f.finish(1);
    expect(JSON.stringify(f.service.operations.all())).not.toContain('本轮背景');
  });

  it('cleans an ended context even when its admission flush and waiter finish later', async () => {
    const f = fixture(); f.recordMessage('ordinary', '旁观成员', '等待持久化的背景', false);
    const pending = f.inbound('qq-first', '甲', '问题'); await waitForQueue(f);
    const message = await f.claim(1);
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    f.flush.mockImplementationOnce(async () => { await barrier; return true; });
    const admitted = f.admit(message, 1);
    try {
      f.session.append('step/end', { turn: 1, step: 1 });
      f.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }); await f.observe();
      expect(JSON.stringify(f.service.operations.all())).not.toContain('等待持久化的背景');
    } finally { release(); await admitted; await pending; }
  });

  it('uses the exact canceled event seq when later queue splices already exist and ignores missing seq', async () => {
    const f = fixture(); f.recordMessage('ordinary', '旁观成员', '甲的本轮背景', false);
    const first = f.inbound('qq-first', '甲', '甲的问题'); await waitForQueue(f);
    const opening = await f.claim(1); const firstContext = f.render();
    const queued = (id: string, text: string) => {
      const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: `${id} question` }] });
      const pending = f.service.enqueueQQ(f.record, message, { messageId: id, senderId: id }, 0, [], { turnMetaText: id, backgroundText: text });
      void pending.catch(() => {});
      return pending;
    };
    const second = queued('qq-second', '乙的待取消背景');
    f.nextTurn.splice(0);
    const canceledSecond = f.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' });
    const third = queued('qq-third', '丙的待取消背景');
    f.nextTurn.splice(0);
    const canceledThird = f.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' });
    await f.service.observeSessionEvent(f.session.id, canceledSecond.type, { ...canceledSecond.data });
    expect(JSON.stringify(f.service.operations.all())).toContain('乙的待取消背景');
    await f.service.observeSessionEvent(f.session.id, canceledSecond.type, { ...canceledSecond.data }, canceledSecond.seq);
    await expect(second).rejects.toThrow('已取消或修改');
    expect(JSON.stringify(f.service.operations.all())).not.toContain('乙的待取消背景');
    expect(JSON.stringify(f.service.operations.all())).toContain('丙的待取消背景');
    expect(f.render()).toBe(firstContext);
    await f.service.observeSessionEvent(f.session.id, canceledThird.type, { ...canceledThird.data }, canceledThird.seq);
    await expect(third).rejects.toThrow('已取消或修改');
    expect(JSON.stringify(f.service.operations.all())).not.toContain('丙的待取消背景');
    expect(f.render()).toBe(firstContext);
    await f.admit(opening, 1); await first; await f.finish(1);
  });

  it('cleans a restored unadmitted turn after delayed settlement without clearing the next admitted turn', async () => {
    const f = fixture(); f.recordMessage('ordinary', '旁观成员', '重载前背景', false);
    void f.inbound('qq-first', '甲', '甲的问题'); await waitForQueue(f);
    f.restart(); await f.claim(1);
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    f.flush.mockImplementationOnce(async () => { await barrier; return true; });
    f.session.append('turn/end', { turn: 1, reason: { kind: 'blocked' } });
    const settled = f.observe();
    try {
      const second = f.inbound('qq-second', '乙', '乙的问题'); await waitForQueue(f);
      const opening = await f.claim(2); await f.admit(opening, 2); await second;
      const secondContext = f.render();
      expect(secondContext).toContain('发送者：乙（QQ 乙）');
      release(); await settled;
      expect(f.render()).toBe(secondContext);
      const operations = f.service.operations.all();
      expect(operations.find(operation => operation.message.content.some(block => block.type === 'text' && block.text === '甲的问题'))?.promptContext).toBeUndefined();
      await f.finish(2); f.restart();
      expect(f.service.operations.all().every(operation => operation.promptContext === undefined)).toBe(true);
    } finally { release(); await settled; }
  });

  it.each(['flush', 'send'] as const)('keeps the next admitted turn context when the previous %s settles during a tool step', async delayed => {
    const f = fixture();
    const first = f.inbound('qq-first', '甲', '甲的问题'); await waitForQueue(f);
    const opening = await f.claim(1); await f.admit(opening, 1); await first;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    if (delayed === 'flush') f.flush.mockImplementationOnce(async () => { await barrier; return true; });
    else f.sendMarkdown.mockImplementationOnce(async () => { await barrier; });
    const answer = createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [{ type: 'text', text: '第一轮回答' }] });
    f.session.append('assistant/message', { turn: 1, step: 1, message: answer, stream: [] }, { surfaceOp: 'append' });
    f.session.append('step/end', { turn: 1, step: 1 });
    f.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
    const settled = f.observe();
    try {
      if (delayed === 'send') await vi.waitFor(() => expect(f.sendMarkdown).toHaveBeenCalledOnce());
      f.recordMessage('second-background', '旁观成员', '乙的本轮背景', false);
      const second = f.inbound('qq-second', '乙', '乙的问题'); await waitForQueue(f);
      const following = await f.claim(2); await f.admit(following, 2); await second;
      const secondContext = f.render();
      expect(secondContext).toContain('发送者：乙（QQ 乙）');
      expect(secondContext).toContain('乙的本轮背景');
      expect(f.nextTurn).toHaveLength(0);
      release(); await settled;
      expect(f.render()).toBe(secondContext);
      f.session.append('step/end', { turn: 2, step: 1 });
      f.session.append('step/start', { turn: 2, step: 2 });
      expect(f.render()).toBe(secondContext);
      f.session.append('step/end', { turn: 2, step: 2 });
      f.session.append('turn/end', { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } }); await f.observe();
      expect(f.render()).toBe('');
      expect(JSON.stringify(f.service.operations.all())).not.toContain('乙的本轮背景');
    } finally { release(); await settled; }
  });

  it.each([false, true])('cleans a failed followup only when native submission evidence is absent; already submitted=%s', async submitted => {
    const f = fixture(); f.recordMessage('ordinary', '旁观成员', '提交失败的背景', false);
    const followup = f.record.agent.followup.bind(f.record.agent);
    vi.spyOn(f.record.agent, 'followup').mockImplementation(message => {
      if (submitted) followup(message);
      throw new Error('followup failed');
    });
    await expect(f.inbound('qq-first', '甲', '问题')).rejects.toThrow('followup failed');
    if (!submitted) {
      expect(JSON.stringify(f.service.operations.all())).not.toContain('提交失败的背景');
      f.restart();
      expect(JSON.stringify(f.service.operations.all())).not.toContain('提交失败的背景');
      expect(f.render()).toBe('');
    } else {
      expect(JSON.stringify(f.service.operations.all())).toContain('提交失败的背景');
      f.restart();
      const message = await f.claim(1);
      expect(f.render()).toContain('提交失败的背景');
      await f.admit(message, 1); await f.finish(1);
      expect(JSON.stringify(f.service.operations.all())).not.toContain('提交失败的背景');
    }
  });

  it('injects ordinary background and the correct member before first input admission, across consecutive members and tool steps', async () => {
    const f = fixture();
    f.recordMessage('ordinary', '旁观成员', '普通群消息 {{literal}}', false);
    const first = f.inbound('qq-first', '甲', '甲的问题'); await waitForQueue(f);
    expect(f.render()).toBe('');
    const opening = await f.claim(1);
    const firstContext = f.render();
    expect(firstContext).toContain('发送者：甲（QQ 甲）');
    expect(firstContext).toContain('「甲」 @ 了你');
    expect(firstContext).toContain('[来源消息: ordinary]');
    expect(firstContext).toContain('普通群消息 {{literal}}');
    expect(opening.content).toEqual([{ type: 'text', text: '甲的问题' }]);
    expect(JSON.stringify(f.session.snapshotEvents())).not.toContain('普通群消息');
    expect(f.contexts.get('qqbot:background')?.interpolate).toBe(false);
    expect(f.session.snapshotEvents().some(event => event.type === 'user/message')).toBe(false);
    await f.admit(opening, 1); await first;
    expect(f.service.store.snapshotBackground(f.record.sessionKey, '').text).toBe('');
    const second = f.inbound('qq-second', '乙', '乙的问题'); await waitForQueue(f);
    expect(f.render()).toBe(firstContext);
    f.session.append('step/end', { turn: 1, step: 1 });
    f.session.append('step/start', { turn: 1, step: 2 });
    expect(f.render()).toBe(firstContext);
    f.session.append('step/end', { turn: 1, step: 2 });
    f.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }); await f.observe();
    const following = await f.claim(2);
    expect(f.render()).toContain('发送者：乙（QQ 乙）');
    expect(f.render()).toContain('「乙」 @ 了你');
    expect(f.render()).not.toContain('发送者：甲');
    expect(f.render()).not.toContain('普通群消息');
    await f.admit(following, 2); await second; await f.finish(2);
  });

  it('restores queued source facts from the persisted operation after plugin reload', async () => {
    const f = fixture();
    f.recordMessage('ordinary', '旁观成员', '重启前背景', false);
    const pending = f.inbound('queued', '乙', '重启后处理'); await waitForQueue(f);
    f.restart();
    const message = await f.claim(1);
    expect(f.render()).toContain('发送者：乙（QQ 乙）');
    expect(f.render()).toContain('重启前背景');
    await f.admit(message, 1);
    // The original caller belongs to the disposed service. Settle it using the
    // already persisted input; the replacement provider owns no transient slot.
    await f.finish(1);
    void pending;
  });

  it('does not reuse QQ facts for the next Web turn or for an input lacking QQ source facts', async () => {
    const f = fixture(); const pending = f.inbound('qq-first', '甲', '问题'); await waitForQueue(f);
    const message = await f.claim(1); await f.admit(message, 1); await pending; await f.finish(1);
    const web = createUserMessage({ content: [{ type: 'text', text: 'Web question' }], source: { kind: 'user' } });
    f.nextTurn.push(web);
    f.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [web] });
    const claimed = await f.claim(2);
    expect(f.render()).toBe(''); await f.admit(claimed, 2); expect(f.render()).toBe(''); await f.finish(2);
  });

  it('does not borrow source facts after a Web edit retains the native message id', async () => {
    const f = fixture(); const pending = f.inbound('qq-first', '甲', '原始问题'); await waitForQueue(f);
    const original = f.nextTurn[0]; if (!original) throw new Error('Missing queued input');
    const edited = { ...original, content: [{ type: 'text' as const, text: '网页修改' }] };
    f.nextTurn.splice(0, 1, edited);
    f.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [edited], outcome: 'canceled' });
    await f.observe(); await expect(pending).rejects.toThrow();
    const claimed = await f.claim(1);
    expect(f.render()).toBe(''); await f.admit(claimed, 1); expect(f.render()).toBe(''); await f.finish(1);
  });

  it('cancels one member without shifting the next member context or consuming background', async () => {
    const f = fixture(); f.recordMessage('ordinary', '旁观成员', '仍未消费的背景', false);
    const first = f.inbound('qq-first', '甲', '待取消'); await waitForQueue(f);
    f.nextTurn.splice(0);
    f.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' });
    await f.observe(); await expect(first).rejects.toThrow();
    expect(f.render()).toBe('');
    expect(JSON.stringify(f.service.operations.all())).not.toContain('仍未消费的背景');
    expect(JSON.stringify(f.session.snapshotEvents())).not.toContain('仍未消费的背景');
    expect(f.service.store.snapshotBackground(f.record.sessionKey, '').text).toContain('仍未消费的背景');
    const second = f.inbound('qq-second', '乙', '乙的问题'); await waitForQueue(f);
    const message = await f.claim(1);
    expect(f.render()).toContain('发送者：乙（QQ 乙）');
    expect(f.render()).not.toContain('发送者：甲');
    expect(f.render()).toContain('仍未消费的背景');
    await f.admit(message, 1); await second; await f.finish(1);
    expect(JSON.stringify(f.service.operations.all())).not.toContain('仍未消费的背景');
  });

  it('cleans a canceled queued context after reload even without an original admission waiter', async () => {
    const f = fixture(); f.recordMessage('ordinary', '旁观成员', '重载后取消的背景', false);
    void f.inbound('queued', '甲', '待取消'); await waitForQueue(f);
    f.restart();
    expect(JSON.stringify(f.service.operations.all())).toContain('重载后取消的背景');
    f.nextTurn.splice(0);
    f.session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' });
    await f.observe();
    expect(JSON.stringify(f.service.operations.all())).not.toContain('重载后取消的背景');
    expect(f.render()).toBe('');
    f.restart();
    expect(JSON.stringify(f.service.operations.all())).not.toContain('重载后取消的背景');
  });
});
