import type { Context } from '@deepseek-ai/cordis';
import { MediaFileType, QQBot, runMiddlewareChain, type InteractionEvent, type MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import { createServer, type RequestListener } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ConfigSchema, type AccessControlConfig } from '../config.ts';
import { encodeButtonData } from '../features/button-utils.ts';
import { QuestionChannel } from '../features/question-channel.ts';
import { ApprovalChannel } from '../features/approval-channel.ts';
import { SessionManager, type DshAgentRegistry } from '../session/index.ts';
import { assertDeliveryAllowed } from '../transport/delivery-context.ts';
import { ReplyIdCache } from '../transport/msgid-cache.ts';
import { TurnTracker } from '../transport/turn-tracker.ts';
import type { ReplyTarget } from '../types.ts';
import { bootstrapGateway } from './bootstrap.ts';
import { QqDisplayNames } from '../runtime/qq-display-names.ts';
import { QqTimeline } from '../runtime/qq-timeline.ts';

const sandbox = vi.hoisted(() => ({ dir: undefined as string | undefined, profile: undefined as string | undefined }));
vi.mock('../shared/dirs.ts', async original => {
  const actual = await original<typeof import('../shared/dirs.ts')>();
  return { ...actual, get PLUGIN_HOME() { return sandbox.dir ?? actual.PLUGIN_HOME; } };
});
vi.mock('../shared/index.ts', async original => ({ ...await original<object>(), getProfileDir: () => sandbox.profile }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (sandbox.dir) rmSync(sandbox.dir, { recursive: true, force: true });
  sandbox.dir = undefined;
  sandbox.profile = undefined;
});

async function gateway(
  access: Partial<AccessControlConfig> = {},
  receiving?: (target: ReplyTarget) => boolean,
  makeHistory?: (dir: string, logger: Parameters<typeof bootstrapGateway>[3]) => NonNullable<Parameters<typeof bootstrapGateway>[8]>,
) {
  sandbox.dir = mkdtempSync(join(tmpdir(), 'qq-gateway-'));
  const options = ConfigSchema({
    appId: 'gateway-test', appSecret: 'fixture', sessionIdleTimeout: 0,
    media: { enabled: false }, access,
  });
  const ask = vi.fn();
  const questions = { ask };
  const effects = new Map<string, () => Promise<void>>();
  const ctx = {
    inject: vi.fn(),
    on: vi.fn(),
    get: (name: string) => name === 'userQuestions' ? questions : undefined,
    effect: (mount: () => () => Promise<void>, name: string) => { effects.set(name, mount()); },
  } as unknown as Context;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const on = vi.spyOn(QQBot.prototype, 'on');
  const start = vi.spyOn(QQBot.prototype, 'start').mockResolvedValue(undefined);
  const stop = vi.spyOn(QQBot.prototype, 'stop');
  const ack = vi.spyOn(QQBot.prototype, 'acknowledgeInteraction').mockResolvedValue(undefined);
  const dispatch = vi.spyOn(QuestionChannel.prototype, 'handleInteraction').mockReturnValue(true);
  const cache = vi.spyOn(ReplyIdCache.prototype, 'cacheEventId');
  const dispose = vi.spyOn(SessionManager.prototype, 'disposeAll');
  const runtime = bootstrapGateway(ctx, { get: vi.fn() } as unknown as DshAgentRegistry, options, logger, undefined, undefined, undefined, receiving, makeHistory?.(sandbox.dir, logger));
  const callback = on.mock.calls.find(([event]) => event === 'interaction')?.[1] as
    ((ctx: unknown, event: InteractionEvent) => Promise<void>);
  const message = on.mock.calls.find(([event]) => event === 'message')?.[1] as (ctx: MiddlewareContext) => Promise<void>;

  return {
    stop, ack, dispatch, cache, dispose, ask, questions, runtime, bot: start.mock.contexts[0]!, message,
    unload: () => effects.get('im-qqbot.lifecycle')!(),
    click: (input: Partial<InteractionEvent>) => callback({}, {
      id: 'button', type: 1, version: 1,
      data: { type: 1, resolved: { button_data: encodeButtonData({ t: 'question', q: 'q', i: 0 }) } },
      ...input,
    }),
  };
}

async function loopback(listener: RequestListener) {
  const server = createServer(listener);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a loopback TCP address');
  vi.stubEnv('QQBOT_BASE_URL', `http://127.0.0.1:${address.port}`);
  return async () => {
    const closed = new Promise<void>(resolve => server.close(() => resolve()));
    server.closeAllConnections();
    await closed;
  };
}

it('learns admitted private nicknames even when recording is off and keeps them when later events omit the name', async () => {
  const f = await gateway({ c2cMode: 'allowlist', c2cAllow: ['allowed'] }, undefined, (dir, logger) => ({
    names: new QqDisplayNames(join(dir, 'names.json'), logger),
    timeline: new QqTimeline(join(dir, 'timeline'), logger),
    recording: () => false,
  }));
  const send = async (id: string, openId: string, senderName?: string) => {
    const timestamp = new Date().toISOString();
    const replyTarget = { scope: 'c2c', targetId: openId, msgId: id } as const;
    const controller = new AbortController();
    let stopReason: string | undefined;
    const context: MiddlewareContext = {
      bot: f.bot, replyTarget, receivedAt: Date.now(), state: {}, signal: controller.signal,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      message: {
        kind: 'c2c', senderId: openId, senderName, messageId: id, content: 'hello', timestamp, replyTarget,
        rawEventType: 'C2C_MESSAGE_CREATE', raw: { id, content: 'hello', timestamp, author: { user_openid: openId } },
      },
      stop(reason) { stopReason = reason; },
      get stopped() { return stopReason !== undefined; },
      get stopReason() { return stopReason; },
      abort(reason) { controller.abort(reason); this.stop(reason); },
      get aborted() { return controller.signal.aborted; },
    };
    await runMiddlewareChain(f.bot.getMiddlewares(), context);
  };
  try {
    await send('named', 'allowed', '小明');
    await send('unnamed', 'allowed');
    await send('blocked', 'blocked', '无权限');
    const names = new QqDisplayNames(join(sandbox.dir!, 'names.json'), { info() {}, warn() {}, error() {}, debug() {} });
    expect(names.peer('gateway-test', 'c2c', 'allowed')).toBe('小明');
    expect(names.peer('gateway-test', 'c2c', 'blocked')).toBeUndefined();
    expect(names.peer('another-bot', 'c2c', 'allowed')).toBeUndefined();
  } finally {
    await f.unload();
  }
});

it('blocks an inbound error reply when access is revoked while the SDK gets its token', async () => {
  const request = vi.fn();
  const close = await loopback((req, res) => {
    request(req.url);
    res.end(JSON.stringify({ id: 'unexpected' }));
  });
  let allowed = true;
  const f = await gateway({ c2cMode: 'open' }, () => allowed);
  try {
    vi.spyOn(f.runtime.manager, 'getOrCreate').mockRejectedValueOnce(new Error('session fixture failed'));
    const acquiring = Promise.withResolvers<void>();
    const token = Promise.withResolvers<string>();
    vi.spyOn(f.bot.tokenManager, 'getAccessToken').mockImplementationOnce(() => {
      acquiring.resolve();
      return token.promise;
    });
    const replyTarget = { scope: 'c2c', targetId: 'shared', msgId: 'inbound' } as const;
    const result = f.message({
      bot: f.bot, replyTarget, state: {}, signal: new AbortController().signal,
      message: { kind: 'c2c', senderId: 'shared', messageId: 'inbound', content: 'test' },
    } as MiddlewareContext);
    await acquiring.promise;
    allowed = false;
    token.resolve('fixture-token');
    await result;
    expect(request).not.toHaveBeenCalled();
  } finally {
    await f.unload();
    await close();
  }
});

it.each([false, true])('checks the whitelist before submitting a pairing confirmation (revoked=%s)', async revoked => {
  const request = vi.fn();
  const close = await loopback((req, res) => {
    request(req.url);
    res.end(JSON.stringify({ id: 'confirmation' }));
  });
  const f = await gateway({ c2cMode: 'allowlist', c2cAllow: [] });
  try {
    sandbox.profile = sandbox.dir;
    const access = f.runtime.manager.accountAccess!;
    const { code } = access.issuePairCode('allow-c2c');
    const acquiring = Promise.withResolvers<void>();
    const token = Promise.withResolvers<string>();
    vi.spyOn(f.bot.tokenManager, 'getAccessToken').mockResolvedValue('fixture-token').mockImplementationOnce(() => {
      acquiring.resolve();
      return token.promise;
    });
    const receivedAt = Date.now();
    const timestamp = new Date(receivedAt).toISOString();
    const replyTarget = { scope: 'c2c', targetId: 'shared', msgId: 'inbound' } as const;
    const controller = new AbortController();
    let stopReason: string | undefined;
    const context: MiddlewareContext = {
      bot: f.bot, replyTarget, receivedAt, state: {}, signal: controller.signal,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      message: {
        kind: 'c2c', senderId: 'shared', messageId: 'inbound', content: code, timestamp, replyTarget,
        rawEventType: 'C2C_MESSAGE_CREATE', raw: { id: 'inbound', content: code, timestamp, author: { user_openid: 'shared' } },
      },
      stop(reason) { stopReason = reason; },
      get stopped() { return stopReason !== undefined; },
      get stopReason() { return stopReason; },
      abort(reason) { controller.abort(reason); this.stop(reason); },
      get aborted() { return controller.signal.aborted; },
    };
    const result = runMiddlewareChain(f.bot.getMiddlewares(), context);
    await acquiring.promise;
    expect(access.allowsConversation('c2c', 'shared')).toBe(true);
    if (revoked) expect(access.revokePair('shared', 'allow-c2c').ok).toBe(true);
    token.resolve('fixture-token');
    await result;
    expect(context.stopReason).toBe('claim-result');
    expect(access.allowsConversation('c2c', 'shared')).toBe(!revoked);
    expect(request.mock.calls).toEqual(revoked ? [] : [['/v2/users/shared/messages']]);
  } finally {
    await f.unload();
    await close();
  }
});

it.each(['text', 'upload'] as const)('does not follow an HTTP redirect after the initial %s POST', async kind => {
  const posts: string[] = [];
  let allowed = true;
  const close = await loopback((req, res) => {
    posts.push(`${req.method} ${req.url}`);
    if (posts.length === 1) {
      allowed = false;
      res.writeHead(307, { Location: '/unexpected' });
      res.end();
    } else {
      res.end(JSON.stringify({ id: 'unexpected', file_info: 'unexpected' }));
    }
  });
  const f = await gateway({ c2cMode: 'open' }, () => allowed);
  try {
    vi.spyOn(f.bot.tokenManager, 'getAccessToken').mockResolvedValue('fixture-token');
    const target = { scope: 'c2c', targetId: 'shared', msgId: 'inbound' } as const;
    const sent = kind === 'text'
      ? f.bot.sendMarkdown(target, 'test')
      : f.bot.uploadMedia({ target, fileType: MediaFileType.FILE, buffer: Buffer.from('test'), srvSendMsg: false });
    const result = await sent.catch((error: unknown) => error);
    expect(posts).toEqual([kind === 'text' ? 'POST /v2/users/shared/messages' : 'POST /v2/users/shared/files']);
    // The media SDK retries, but the fresh admission check blocks the next POST.
    if (kind === 'upload') expect(result).toMatchObject({ message: expect.stringContaining('no longer authorized') });
    else expect(result).toMatchObject({ httpStatus: 307 });
  } finally {
    await f.unload();
    await close();
  }
}, 8000);

it('dispatches permitted QQ callbacks and stops acknowledging them when that gateway unloads', async () => {
  const f = await gateway({ groupMode: 'open', c2cMode: 'open' });
  const group = { scene: 'group', group_openid: 'team', user_openid: 'member' };
  const direct = { scene: 'c2c', user_openid: 'member' };
  await f.click(group);
  await f.click(direct);
  await f.click({ scene: 'group', user_openid: 'member' });
  expect(f.cache.mock.calls).toEqual([['group', 'team', 'button'], ['c2c', 'member', 'button']]);
  expect(f.dispatch).toHaveBeenCalledTimes(2);
  expect(f.ack.mock.calls).toEqual([['button', 0], ['button', 0], ['button', 3]]);

  const unloading = f.unload();
  await f.click(group);
  await unloading;
  expect(f.cache).toHaveBeenCalledTimes(2);
  expect(f.dispatch).toHaveBeenCalledTimes(2);
  expect(f.ack).toHaveBeenCalledTimes(3);
  expect(f.stop).toHaveBeenCalledOnce();
  expect(f.dispose).toHaveBeenCalledOnce();
  expect(f.questions).not.toHaveProperty('__qqQuestionPatched');
  await f.questions.ask();
  expect(f.ask).toHaveBeenCalledOnce();
});

it('rejects unauthorized groups before caching or dispatching even without scene', async () => {
  const f = await gateway({ groupMode: 'disabled', c2cMode: 'open' });
  await f.click({ group_openid: 'team', user_openid: 'member' });
  expect(f.cache).not.toHaveBeenCalled();
  expect(f.dispatch).not.toHaveBeenCalled();
  expect(f.ack.mock.calls).toEqual([['button', 3]]);
  await f.unload();
});

it('rechecks peer pause for native delivery and rejects question and approval callbacks', async () => {
  let paused = false;
  const f = await gateway({ c2cMode: 'open' }, () => !paused);
  try {
    vi.spyOn(f.runtime.manager, 'deliveryAddress').mockReturnValue({ scope: 'c2c', targetId: 'member' });
    const approvals = vi.spyOn(ApprovalChannel.prototype, 'handleInteraction');
    const turns = f.runtime.targets;
    expect(turns).toBeInstanceOf(TurnTracker);
    if (!(turns instanceof TurnTracker)) throw new Error('missing TurnTracker');
    turns.begin('session', 1);
    turns.note('session', { id: 'native-message', source: { kind: 'user' } });
    const bound = turns.targetFor('session');
    expect(bound).toBeDefined();
    if (!bound) throw new Error('missing delivery target');
    expect(() => assertDeliveryAllowed(bound)).not.toThrow();

    paused = true;
    expect(turns.targetFor('session')).toBeUndefined();
    expect(() => assertDeliveryAllowed(bound)).toThrow('no longer authorized');
    await f.click({ user_openid: 'member' });
    await f.click({ user_openid: 'member', data: { type: 1, resolved: { button_data: encodeButtonData({ t: 'approval', d: 'allow' }) } } });
    expect(f.dispatch).not.toHaveBeenCalled();
    expect(approvals).not.toHaveBeenCalled();
    expect(f.ack.mock.calls).toEqual([['button', 3], ['button', 3]]);
  } finally {
    await f.unload();
  }
});

it('restores the question service and disposes Sessions even if SDK stop throws', async () => {
  const f = await gateway();
  f.stop.mockImplementationOnce(() => { throw new Error('SDK stop failed'); });
  await expect(f.unload()).rejects.toThrow('SDK stop failed');
  expect(f.dispose).toHaveBeenCalledOnce();
  expect(f.questions).not.toHaveProperty('__qqQuestionPatched');
  await f.click({ user_openid: 'member' });
  expect(f.ack).not.toHaveBeenCalled();
});
