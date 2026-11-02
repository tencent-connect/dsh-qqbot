import type { Context } from '@deepseek-ai/cordis';
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema } from '../config.ts';
import type { SessionManager } from '../session/session-manager.ts';
import { ConversationService } from '../runtime/conversation-service.ts';
import { getCachedReplyIds } from '../transport/msgid-cache.ts';
import { conversationGate } from './conversation-gate.ts';

const roots: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(peer: string) {
  vi.useFakeTimers({ now: Date.UTC(2020, 0, 1) });
  const root = mkdtempSync(join(tmpdir(), 'qq-reply-source-')); roots.push(root);
  const manager = { getDefaultModel: () => ({ provider: 'p', model: 'm' }), getDefaultPreset: () => 'standard',
    getSessionRecord: () => undefined, getStatus: () => ({ active: false }), getEffectiveModel: () => ({ provider: 'p', model: 'm' }) } as unknown as SessionManager;
  const context = { get: () => undefined, on: () => () => {} } as unknown as Context;
  const service = new ConversationService(context, manager, ConfigSchema({ appId: 'source', appSecret: 'dummy', cwd: root }), { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, root);
  manager.conversations = service;
  const input = (id: string, content = '普通消息') => ({ message: { kind: 'group', groupOpenid: peer, senderId: 'actor', senderName: 'member', messageId: id, content,
    timestamp: new Date().toISOString(), rawEventType: 'GROUP_MESSAGE_CREATE', mentions: [], attachments: [] }, state: {}, stop: vi.fn() }) as unknown as MiddlewareContext;
  return { service, manager, gate: conversationGate(manager), input, peer };
}
describe('passive reply sources before mention filtering', () => {
  it('records an admitted ordinary message without creating an Agent turn or enabling disk recording', async () => {
    const f = fixture('reply-source-unmentioned'); const input = f.input('passive-id'); const next = vi.fn();
    await f.gate(input, next);
    expect(next).not.toHaveBeenCalled();
    expect(input.stop).toHaveBeenCalledWith('mention-gate:no_mention');
    expect(getCachedReplyIds('group', f.peer)).toEqual([{ kind: 'msg', id: 'passive-id' }]);
    const entry = f.service.snapshot().conversations[0];
    expect(entry?.passiveReply?.expiresAt).toBe(Date.now() + 300000);
    expect(entry?.policy.context.mode).toBe('recent');
    expect(entry?.currentSessionId).toBeNull();
  });
  it('keeps an expired deadline visible and does not extend it on duplicate replay', async () => {
    const f = fixture('reply-source-dedupe'); const input = f.input('original-id');
    await f.gate(input, vi.fn()); const deadline = Date.now() + 300000;
    vi.advanceTimersByTime(300001);
    await f.gate(f.input('original-id'), vi.fn());
    expect(getCachedReplyIds('group', f.peer)).toEqual([]);
    expect(f.service.snapshot().conversations[0]?.passiveReply?.expiresAt).toBe(deadline);
  });
  it('does not cache a source from a disabled conversation', async () => {
    const f = fixture('reply-source-disabled'); const entry = f.service.entry('group', f.peer);
    f.service.updatePolicy(entry.key, entry.policy.version, { ...entry.policy, receiveEnabled: false });
    await f.gate(f.input('disabled-id'), vi.fn());
    expect(getCachedReplyIds('group', f.peer)).toEqual([]);
  });
  it('records a command source even when the command never reaches the final message handler', async () => {
    const f = fixture('reply-source-command');
    await f.gate(f.input('command-id', '/bot-status'), vi.fn());
    expect(getCachedReplyIds('group', f.peer)).toEqual([{ kind: 'msg', id: 'command-id' }]);
  });
});
