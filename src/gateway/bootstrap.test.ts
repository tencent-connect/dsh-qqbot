/**
 * bootstrapGateway 的多 bot 装配回归
 *
 * 钉死三处装配语义：
 * 1. prefs 状态路径按实例传入（单 bot → undefined 走 legacy 共享文件）；
 * 2. 进程级全局注册（媒体清理/视觉/qqbot_* 工具）只由 primary 执行，其余实例不得重复注册；
 * 3. 生命周期 effect 名不撞：单 bot 用原名，多 bot 追加 appId。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { ConfigSchema, type ImQQBotConfig } from '../config.ts';
import type { Logger } from '../types.ts';

const env = vi.hoisted(() => ({ home: '' }));

const calls = vi.hoisted(() => ({
  managers: [] as { appId: string; multiBot?: boolean; prefsPath?: string }[],
  effectNames: [] as (string | undefined)[],
  mediaCleanup: 0,
  visionModal: 0,
  describeImageTool: 0,
  sendFileTool: 0,
  started: [] as string[],
}));

// prefs 命名空间派生：与 shared/dirs.ts 同规则，但根目录换成临时目录
vi.mock('../shared/dirs.ts', async () => {
  const { resolve } = await import('node:path');
  return {
    get PLUGIN_HOME() { return env.home; },
    resolveAgentCwd: (cwd?: string) => cwd || resolve(env.home, 'workspace'),
    resolvePrefsPath: (appId: string, multiBot?: boolean) =>
      (multiBot === true && appId ? resolve(env.home, 'bots', appId, 'model-prefs.json') : undefined),
  };
});

vi.mock('@tencent-connect/qqbot-nodejs', () => ({
  QQBot: class {
    private readonly appId: string;
    public constructor(opts: { appId: string }) { this.appId = opts.appId; }
    public on(): void { /* 事件回调不在本用例关注面 */ }
    public start(): Promise<void> { calls.started.push(this.appId); return Promise.resolve(); }
    public stop(): void { /* noop */ }
    public acknowledgeInteraction(): Promise<void> { return Promise.resolve(); }
  },
}));

vi.mock('../session/index.ts', () => ({
  SessionManager: class {
    public questionChannel?: unknown;
    public approvalChannel?: unknown;
    public constructor(
      _ctx: unknown,
      _agents: unknown,
      config: { appId: string; multiBot?: boolean },
      _logger: unknown,
      prefsPath?: string,
    ) {
      calls.managers.push({ appId: config.appId, multiBot: config.multiBot, prefsPath });
    }
    public disposeAll(): Promise<void> { return Promise.resolve(); }
    public findBySessionId(): undefined { return undefined; }
  },
}));

vi.mock('../transport/index.ts', () => ({
  handleInbound: async (): Promise<void> => { /* noop */ },
  createOutboundHandler: () => ({ routeSessionEvent: () => {}, routeStreamFrame: () => {} }),
  createTurnTracker: () => ({}),
}));

vi.mock('../transport/qq-input-origin.ts', () => ({
  QqInputRegistry: class { public constructor() { /* noop */ } },
  inputOriginTtlMs: (): number => 1000,
}));
vi.mock('../transport/events.ts', () => ({ parseStreamFrame: (): undefined => undefined }));
vi.mock('../transport/reply-limiter.ts', () => ({ ReplyLimiter: class { public constructor() { /* noop */ } } }));
vi.mock('../transport/msgid-cache.ts', () => ({ cacheMsgId: () => {}, cacheEventId: () => {} }));
vi.mock('../transport/reply-target.ts', () => ({
  resolveReplyTarget: (target: unknown): unknown => target,
  sendResolvedMarkdown: async (): Promise<void> => { /* noop */ },
}));
vi.mock('../features/question-channel.ts', () => ({
  QuestionChannel: class { public install(): void { /* noop */ } public handleInteraction(): boolean { return false; } },
}));
vi.mock('../features/approval-channel.ts', () => ({
  ApprovalChannel: class { public install(): void { /* noop */ } public handleInteraction(): boolean { return false; } },
}));
vi.mock('../features/button-utils.ts', () => ({ decodeButtonData: (): undefined => undefined }));
vi.mock('./middleware-setup.ts', () => ({ setupMiddlewares: (): void => { /* noop */ } }));
vi.mock('../media/media-cleaner.ts', () => ({
  startMediaCleanup: (): void => { calls.mediaCleanup += 1; },
}));
vi.mock('../media/vision-tool.ts', () => ({
  ensureVisionInputModal: (): void => { calls.visionModal += 1; },
  registerDescribeImageTool: (): void => { calls.describeImageTool += 1; },
}));
vi.mock('../media/send-file-tool.ts', () => ({
  registerSendFileTool: (): void => { calls.sendFileTool += 1; },
}));
vi.mock('../transport/deliverables.ts', () => ({ DeliverablesDeliverer: class { public constructor() { /* noop */ } } }));

const { bootstrapGateway } = await import('./bootstrap.ts');

const logger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

function makeCtx(): Context {
  return {
    get: (): undefined => undefined,
    on: (): void => { /* noop */ },
    effect: (execute: () => unknown, name?: string): void => {
      calls.effectNames.push(name);
      execute();
    },
  } as unknown as Context;
}

const configFor = (over: Record<string, unknown>): ImQQBotConfig =>
  ({ ...(ConfigSchema({ appId: '1001', appSecret: 'secret' }) as ImQQBotConfig), ...over });

beforeEach(() => {
  env.home = 'C:\\fake-home';
  calls.managers.length = 0;
  calls.effectNames.length = 0;
  calls.mediaCleanup = 0;
  calls.visionModal = 0;
  calls.describeImageTool = 0;
  calls.sendFileTool = 0;
  calls.started.length = 0;
});

afterEach(() => {
  env.home = '';
});

describe('bootstrapGateway 单 bot（未配置 bots[] / 无运行时标记）', () => {
  it('prefs 不传路径（走 legacy 共享文件）、effect 名不变、进程级注册照常执行', async () => {
    await bootstrapGateway(makeCtx(), {} as never, configFor({}), logger());

    expect(calls.managers).toHaveLength(1);
    expect(calls.managers[0]!.prefsPath).toBeUndefined();
    expect(calls.effectNames).toEqual(['im-qqbot.lifecycle']);
    expect(calls.mediaCleanup).toBe(1);
    expect(calls.visionModal).toBe(1);
    expect(calls.describeImageTool).toBe(1);
    expect(calls.sendFileTool).toBe(1);
    expect(calls.started).toEqual(['1001']);
  });
});

describe('bootstrapGateway 多 bot', () => {
  it('primary 实例：prefs 落 per-appId 文件，effect 名带 appId，进程级注册执行一次', async () => {
    await bootstrapGateway(
      makeCtx(), {} as never,
      configFor({ multiBot: true, primaryBot: true }), logger(),
    );

    expect(calls.managers[0]!.prefsPath).toBe(join(env.home, 'bots', '1001', 'model-prefs.json'));
    expect(calls.effectNames).toEqual(['im-qqbot.lifecycle:1001']);
    expect(calls.mediaCleanup).toBe(1);
    expect(calls.sendFileTool).toBe(1);
  });

  it('非 primary 实例：prefs 各自命名空间，但不再重复做进程级注册', async () => {
    await bootstrapGateway(
      makeCtx(), {} as never,
      configFor({ appId: '1002', multiBot: true, primaryBot: false }), logger(),
    );

    expect(calls.managers[0]!.prefsPath).toBe(join(env.home, 'bots', '1002', 'model-prefs.json'));
    expect(calls.effectNames).toEqual(['im-qqbot.lifecycle:1002']);
    expect(calls.mediaCleanup).toBe(0);
    expect(calls.visionModal).toBe(0);
    expect(calls.describeImageTool).toBe(0);
    expect(calls.sendFileTool).toBe(0);
    // 生命周期仍按实例各自挂载（每个 bot 都要自己 start/stop）
    expect(calls.started).toEqual(['1002']);
  });
});