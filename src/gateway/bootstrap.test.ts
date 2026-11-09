import type { Context } from '@deepseek-ai/cordis';
import { QQBot, type InteractionEvent } from '@tencent-connect/qqbot-nodejs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ConfigSchema, type AccessControlConfig } from '../config.ts';
import { encodeButtonData } from '../features/button-utils.ts';
import { QuestionChannel } from '../features/question-channel.ts';
import { SessionManager, type DshAgentRegistry } from '../session/index.ts';
import { ReplyIdCache } from '../transport/msgid-cache.ts';
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

async function gateway(access: Partial<AccessControlConfig> = {}) {
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
  await bootstrapGateway(ctx, { get: vi.fn() } as unknown as DshAgentRegistry, options, logger);
  const callback = on.mock.calls.find(([event]) => event === 'interaction')?.[1] as
    ((ctx: unknown, event: InteractionEvent) => Promise<void>);

  return {
    stop, ack, dispatch, cache, dispose, ask, questions,
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

it('restores the question service and disposes Sessions even if SDK stop throws', async () => {
  const f = await gateway();
  f.stop.mockImplementationOnce(() => { throw new Error('SDK stop failed'); });
  await expect(f.unload()).rejects.toThrow('SDK stop failed');
  expect(f.dispose).toHaveBeenCalledOnce();
  expect(f.questions).not.toHaveProperty('__qqQuestionPatched');
  await f.click({ user_openid: 'member' });
  expect(f.ack).not.toHaveBeenCalled();
});
