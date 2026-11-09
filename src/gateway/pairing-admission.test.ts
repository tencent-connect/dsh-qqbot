import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QQBot, runMiddlewareChain, type Middleware, type MiddlewareContext, type QQBotInboundMessage } from '@tencent-connect/qqbot-nodejs';
import { ConfigSchema, type ImQQBotConfig } from '../config.ts';
import { MemberStore } from '../runtime/member-store.ts';
import { AccountAccessService } from '../runtime/account-service.ts';
import { PairingService } from '../runtime/pairing-service.ts';
import type { SessionManager } from '../session/index.ts';
import { readProfileAccess, updateProfileConfig } from '../setup/persist.ts';
import { handleInbound } from '../transport/inbound.ts';
import { QqInputRegistry } from '../transport/qq-input-origin.ts';
import { DeliveryLedger } from '../transport/delivery-ledger.ts';
import { ReplyIdCache } from '../transport/msgid-cache.ts';
import { setupMiddlewares } from './middleware-setup.ts';

const profile = vi.hoisted(() => ({ dir: undefined as string | undefined }));
vi.mock('../shared/index.ts', async original => ({ ...await original<object>(), getProfileDir: () => profile.dir }));
afterEach(() => {
  if (profile.dir) rmSync(profile.dir, { recursive: true, force: true });
  profile.dir = undefined;
});

function fixture(onInbound?: (ctx: MiddlewareContext, manager: SessionManager, config: ImQQBotConfig) => Promise<void>) {
  profile.dir = mkdtempSync(join(tmpdir(), 'qq-pair-admission-'));
  const config = ConfigSchema({ appId: '12345', appSecret: 'fixture', access: {
    c2cMode: 'allowlist', c2cAllow: [], groupMode: 'allowlist', groupAllow: [], commandMode: 'disabled',
  } });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const store = new MemberStore(join(profile.dir, 'data'), config.appId);
  let now = Date.now();
  const service = Object.assign(Object.create(AccountAccessService.prototype) as AccountAccessService,
    { config, logger, store, pairing: new PairingService({ now: () => now }) });
  const manager = { accountAccess: service } as SessionManager;
  const bot = new QQBot({ appId: config.appId, appSecret: config.appSecret, logger });
  const chain: Middleware[] = [];
  vi.spyOn(bot, 'use').mockImplementation((...middleware) => { chain.push(...middleware); return bot; });
  const send = vi.spyOn(bot, 'sendText').mockResolvedValue({ id: 'reply', timestamp: '' });
  setupMiddlewares(bot, config, manager, logger, new ReplyIdCache());
  const agent = vi.fn();
  async function receive(content: string, options: { group?: boolean; mentioned?: boolean; id?: string; name?: string; senderId?: string; groupId?: string } = {}) {
    const group = options.group ?? false;
    const senderId = options.senderId ?? 'sender'; const groupId = options.groupId ?? 'team';
    const timestamp = new Date(now).toISOString();
    const message: QQBotInboundMessage = {
      kind: group ? 'group' : 'c2c', senderId, senderName: options.name,
      content, messageId: options.id ?? crypto.randomUUID(), timestamp,
      rawEventType: group ? options.mentioned ? 'GROUP_AT_MESSAGE_CREATE' : 'GROUP_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
      groupOpenid: group ? groupId : undefined,
      replyTarget: { scope: group ? 'group' : 'c2c', targetId: group ? groupId : senderId },
      raw: group
        ? { id: 'event', content, timestamp, author: { member_openid: senderId }, group_openid: groupId }
        : { id: 'event', content, timestamp, author: { user_openid: senderId } },
    };
    let stopped = false;
    let stopReason: string | undefined;
    const controller = new AbortController();
    const context: MiddlewareContext = {
      bot, message, replyTarget: message.replyTarget, state: {}, log: logger,
      receivedAt: now, signal: controller.signal,
      stop(reason) { stopped = true; stopReason = reason; },
      get stopped() { return stopped; }, get stopReason() { return stopReason; },
      abort(reason) { controller.abort(reason); this.stop(reason); },
      get aborted() { return controller.signal.aborted; },
    };
    if (await runMiddlewareChain([...chain, async ctx => {
      await onInbound?.(ctx, manager, config);
    }], context)) agent();
    return context;
  }
  return { service, store, send, agent, receive, logger, expire: () => { now += 11 * 60_000; } };
}

describe('pairing before conversation admission', () => {
  it.each([false, true])('admits two previously unknown identities with the same code (group=%s) without running an Agent', async group => {
    const f = fixture(); const code = f.service.issuePairCode(group ? 'allow-group' : 'allow-c2c').code;
    await f.receive(code, { group, mentioned: group, senderId: 'first', groupId: 'first-group', name: '小明' });
    await f.receive(code, { group, mentioned: group, senderId: 'second', groupId: 'second-group', name: 'Alice' });
    const access = readProfileAccess(undefined, profile.dir);
    expect(group ? access.groupAllow : access.c2cAllow).toEqual(group ? ['first-group', 'second-group'] : ['first', 'second']);
    expect(f.service.pairStatus().challenges[0]?.claims).toHaveLength(2);
    expect(f.service.isActivePairCode(code)).toBe(true);
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.agent).not.toHaveBeenCalled();
  });
  it.each([false, true])('does not reopen a disabled scope with a previously issued code (group=%s)', async group => {
    const f = fixture();
    const purpose = group ? 'allow-group' : 'allow-c2c';
    const mode = group ? 'groupMode' : 'c2cMode';
    const list = group ? 'groupAllow' : 'c2cAllow';
    const code = f.service.issuePairCode(purpose).code;
    updateProfileConfig({ access: { ...f.service.config.access, [mode]: 'disabled' } }, profile.dir);
    await f.receive(code, { group, mentioned: group });
    expect(f.send).toHaveBeenLastCalledWith(expect.anything(), expect.stringContaining('已关闭'));
    await f.receive('hello', { group, mentioned: group });
    expect(readProfileAccess(undefined, profile.dir)).toMatchObject({ [mode]: 'disabled', [list]: [] });
    expect(f.service.pairStatus().challenges[0]?.claims).toEqual([]);
    expect(f.agent).not.toHaveBeenCalled();
  });

  it.each([false, true])('uses the current whitelist on the next message without rebuilding the SDK chain (group=%s)', async group => {
    const f = fixture();
    const purpose = group ? 'allow-group' : 'allow-c2c';
    const id = group ? 'team' : 'sender';
    expect(f.service.addManualMember(purpose, id).ok).toBe(true);
    await f.receive('first', { group, mentioned: group });
    expect(f.agent).toHaveBeenCalledOnce();
    expect(f.service.revokePair(id, purpose).ok).toBe(true);
    await f.receive('second', { group, mentioned: group });
    expect(f.agent).toHaveBeenCalledOnce();
  });

  it('checks command access once for registered and unknown commands', async () => {
    const f = fixture();
    f.service.addManualMember('allow-c2c', 'sender');
    const check = vi.spyOn(f.service, 'commandAccessError');
    await f.receive('/bot-ping');
    await f.receive('/not-a-command');
    expect(check).toHaveBeenCalledTimes(2);
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.agent).not.toHaveBeenCalled();
  });

  it('allows a current private invitation through an empty whitelist without starting an Agent', async () => {
    const f = fixture();
    const code = f.service.issuePairCode('allow-c2c').code;
    await f.receive(code, { name: 'Test Nickname', id: 'claim' });
    expect(readProfileAccess(undefined, profile.dir).c2cAllow).toEqual(['sender']);
    expect(f.send).toHaveBeenCalledWith(expect.anything(), '✅ 已将「Test Nickname」加入私聊白名单。');
    expect(f.agent).not.toHaveBeenCalled();
    await f.receive(code, { id: 'claim' });
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it('keeps ordinary, invalid and expired messages blocked without admitting their sender', async () => {
    const f = fixture();
    const code = f.service.issuePairCode('allow-c2c').code;
    await f.receive('hello');
    await f.receive(`quoted code ${code}`);
    await f.receive('NOT-A-CODE');
    f.expire();
    await f.receive(code);
    expect(f.send).not.toHaveBeenCalled();
    expect(f.agent).not.toHaveBeenCalled();
    expect(f.service.pairStatus().allowC2c).toEqual([]);
    expect(f.store.memberProfiles()).toEqual({});
  });

  it('requires the group mention and strips only the bot marker before redeeming an invitation', async () => {
    const f = fixture();
    const code = f.service.issuePairCode('allow-group').code;
    await f.receive(code, { group: true });
    expect(f.service.isActivePairCode(code)).toBe(true);
    expect(f.send).not.toHaveBeenCalled();
    await f.receive(`<@!12345> ${code}`, { group: true, mentioned: true });
    expect(readProfileAccess(undefined, profile.dir).groupAllow).toEqual(['team']);
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.agent).not.toHaveBeenCalled();
  });

  it('does not consume a group invitation sent privately and accepts it in the target group', async () => {
    const f = fixture();
    const code = f.service.issuePairCode('allow-group').code;
    await f.receive(code);
    expect(f.send).toHaveBeenLastCalledWith(expect.anything(), expect.stringContaining('目标群聊'));
    expect(f.service.isActivePairCode(code)).toBe(true);
    expect(f.store.memberProfiles()).toEqual({});
    await f.receive(code, { group: true, mentioned: true });
    expect(readProfileAccess(undefined, profile.dir).groupAllow).toEqual(['team']);
    expect(f.agent).not.toHaveBeenCalled();
  });
});

it.each([false, true])('rechecks admission before handing a queued message to Inbox (group=%s)', async group => {
  const followup = vi.fn();
  const held = Promise.withResolvers<void>();
  const inputs = new QqInputRegistry({ ledger: new DeliveryLedger() });
  const f = fixture(async (ctx, manager, config) => {
    manager.getOrCreate = async () => ({
      sessionId: 'session',
      agent: { followup, whenIdle: () => ctx.message.content === 'hold' ? held.promise : Promise.resolve() },
    }) as never;
    await handleInbound(ctx, manager, config, ctx.log, inputs, target =>
      manager.accountAccess!.allowsConversation(target.scope, target.targetId));
  });
  const purpose = group ? 'allow-group' : 'allow-c2c';
  const peer = group ? 'team' : 'sender';
  expect(f.service.addManualMember(purpose, peer).ok).toBe(true);
  const first = f.receive('hold', { group, mentioned: group });
  let queued: ReturnType<typeof f.receive> | undefined;
  try {
    await vi.waitFor(() => expect(followup).toHaveBeenCalledOnce());
    queued = f.receive('pending-after-revoke', { group, mentioned: group });
    await vi.waitFor(() => expect(f.logger.debug).toHaveBeenCalledWith(expect.stringContaining('[concurrency] queued message')));
    expect(f.service.revokePair(peer, purpose).ok).toBe(true);
  } finally {
    held.resolve();
    await Promise.all([first, queued]);
  }
  expect(followup).toHaveBeenCalledOnce();
});

it('checks live admission again if access changes while the Session is opening', async () => {
  const opening = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const followup = vi.fn();
  const inputs = new QqInputRegistry({ ledger: new DeliveryLedger() });
  const f = fixture(async (ctx, manager, config) => {
    manager.getOrCreate = async () => {
      opening.resolve();
      await resume.promise;
      return { sessionId: 'session', agent: { followup, whenIdle: async () => {} } } as never;
    };
    await handleInbound(ctx, manager, config, ctx.log, inputs, target =>
      manager.accountAccess!.allowsConversation(target.scope, target.targetId));
  });
  expect(f.service.addManualMember('allow-c2c', 'sender').ok).toBe(true);
  const pending = f.receive('delayed open');
  try {
    await opening.promise;
    expect(f.service.revokePair('sender', 'allow-c2c').ok).toBe(true);
  } finally {
    resume.resolve();
    await pending;
  }
  expect(followup).not.toHaveBeenCalled();
});
