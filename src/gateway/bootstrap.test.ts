import type { Context } from '@deepseek-ai/cordis';
import { QQBot, type InteractionEvent } from '@tencent-connect/qqbot-nodejs';
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

const sandbox = vi.hoisted(() => ({ dir: undefined as string | undefined }));
vi.mock('../shared/dirs.ts', async original => {
  const actual = await original<typeof import('../shared/dirs.ts')>();
  return { ...actual, get PLUGIN_HOME() { return sandbox.dir ?? actual.PLUGIN_HOME; } };
});
vi.mock('../shared/index.ts', async original => ({ ...await original<object>(), getProfileDir: () => undefined }));

afterEach(() => {
  vi.restoreAllMocks();
  if (sandbox.dir) rmSync(sandbox.dir, { recursive: true, force: true });
  sandbox.dir = undefined;
});

async function gateway(access: Partial<AccessControlConfig> = {}, receiving?: (target: ReplyTarget) => boolean) {
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
  vi.spyOn(QQBot.prototype, 'start').mockResolvedValue(undefined);
  const stop = vi.spyOn(QQBot.prototype, 'stop');
  const ack = vi.spyOn(QQBot.prototype, 'acknowledgeInteraction').mockResolvedValue(undefined);
  const dispatch = vi.spyOn(QuestionChannel.prototype, 'handleInteraction').mockReturnValue(true);
  const cache = vi.spyOn(ReplyIdCache.prototype, 'cacheEventId');
  const dispose = vi.spyOn(SessionManager.prototype, 'disposeAll');
  const runtime = bootstrapGateway(ctx, { get: vi.fn() } as unknown as DshAgentRegistry, options, logger, undefined, undefined, undefined, receiving);
  const callback = on.mock.calls.find(([event]) => event === 'interaction')?.[1] as
    ((ctx: unknown, event: InteractionEvent) => Promise<void>);

  return {
    stop, ack, dispatch, cache, dispose, ask, questions, runtime,
    unload: () => effects.get('im-qqbot.lifecycle')!(),
    click: (input: Partial<InteractionEvent>) => callback({}, {
      id: 'button', type: 1, version: 1,
      data: { type: 1, resolved: { button_data: encodeButtonData({ t: 'question', q: 'q', i: 0 }) } },
      ...input,
    }),
  };
}

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
