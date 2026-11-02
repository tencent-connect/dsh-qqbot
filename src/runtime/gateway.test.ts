import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigSchema } from '../config.ts';
import { RuntimeState, RUNTIME_ERROR_HINTS } from './state.ts';

const fake = vi.hoisted(() => ({
  dataDir: '',
  handlers: new Map<string, (...args: unknown[]) => void>(),
  cleanup: undefined as (() => Promise<void>) | undefined,
  rejectStart: undefined as ((error: Error) => void) | undefined,
  stop: vi.fn(),
  disposeAll: vi.fn(async () => {}),
}));

vi.mock('../shared/dirs.ts', async importOriginal => {
  const original = await importOriginal<typeof import('../shared/dirs.ts')>();
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  fake.dataDir = mkdtempSync(join(tmpdir(), 'qq-gateway-unit-'));
  return { ...original, PLUGIN_HOME: fake.dataDir, resolveAgentCwd: (cwd?: string) => cwd || join(fake.dataDir, 'workspace') };
});
afterAll(async () => { if (fake.dataDir) (await import('node:fs')).rmSync(fake.dataDir, {recursive: true, force: true}); });

vi.mock('@tencent-connect/qqbot-nodejs', () => ({
  MsgType: { MARKDOWN: 2 },
  QQBot: class {
    use() { return this; }
    on(event: string, handler: (...args: unknown[]) => void) {
      const existing = fake.handlers.get(event);
      fake.handlers.set(event, (...args) => { existing?.(...args); handler(...args); });
      return this;
    }
    async send() {}
    async sendText() {}
    async sendMarkdown() {}
    async sendTextWithKeyboard() {}
    async sendMedia() {}
    async sendChannelMessage() {}
    async sendDmMessage() {}
    openStream() { return { update: async () => {}, complete: async () => {} }; }
    start() { return new Promise<void>((_resolve, reject) => { fake.rejectStart = reject; }); }
    stop() { fake.stop(); }
  },
}));
vi.mock('../session/index.ts', () => ({ SessionManager: class { disposeAll = fake.disposeAll; } }));
vi.mock('../gateway/middleware-setup.ts', () => ({ setupMiddlewares: vi.fn() }));
vi.mock('../features/question-channel.ts', () => ({ QuestionChannel: class { install() {} } }));
vi.mock('../features/approval-channel.ts', () => ({ ApprovalChannel: class { install() {} } }));
vi.mock('../media/media-cleaner.ts', () => ({ startMediaCleanup: vi.fn() }));
vi.mock('../media/vision-tool.ts', () => ({ ensureVisionInputModal: vi.fn(), registerDescribeImageTool: vi.fn() }));
vi.mock('../media/send-file-tool.ts', () => ({ registerSendFileTool: vi.fn() }));

import { bootstrapGateway } from '../gateway/bootstrap.ts';

async function start(runtime: RuntimeState): Promise<void> {
  const ctx = {
    get: (name: string) => name === 'channelMessages' ? { protocolVersion: 1 } : name === 'sessionController' ? { registerPromptGuard: () => () => {}, registerManagedSessionGuard: () => () => {} } : undefined,
    inject: vi.fn(),
    on: vi.fn(),
    effect: (effect: () => (() => Promise<void>) | undefined) => { fake.cleanup = effect(); },
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const config = ConfigSchema({ appId: 'fake-app', appSecret: 'fake-secret' });
  await bootstrapGateway(ctx as never, {} as never, config, logger, runtime);
}

beforeEach(() => {
  fake.handlers.clear();
  fake.cleanup = undefined;
  fake.rejectStart = undefined;
  fake.stop.mockClear();
  fake.disposeAll.mockClear();
});

describe('gateway runtime signals', () => {
  it('tracks ready, reconnecting, recovered, and fatal disconnection from SDK events', async () => {
    const runtime = new RuntimeState();
    await start(runtime);
    expect(runtime.snapshot().phase).toBe('connecting');
    fake.handlers.get('ready')?.({});
    expect(runtime.snapshot().phase).toBe('ready');
    fake.handlers.get('disconnected')?.({ code: 4009, reason: 'private payload', willReconnect: true });
    expect(runtime.snapshot()).toMatchObject({ phase: 'reconnecting', lastError: RUNTIME_ERROR_HINTS.disconnected });
    fake.handlers.get('resumed')?.({});
    expect(runtime.snapshot()).toMatchObject({ phase: 'ready', lastError: null });
    fake.handlers.get('disconnected')?.({ code: 4915, reason: 'private payload', willReconnect: false });
    expect(runtime.snapshot()).toMatchObject({ phase: 'failed', lastError: RUNTIME_ERROR_HINTS.terminal });
    expect(JSON.stringify(runtime.snapshot())).not.toContain('private payload');
    await fake.cleanup?.();
    expect(runtime.snapshot().phase).toBe('stopped');
    expect(fake.stop).toHaveBeenCalledOnce();
    expect(fake.disposeAll).toHaveBeenCalledOnce();
  });

  it('reports startup failure safely and ignores callbacks after cleanup', async () => {
    const runtime = new RuntimeState();
    await start(runtime);
    fake.rejectStart?.(new Error('private secret'));
    await Promise.resolve();
    expect(runtime.snapshot()).toMatchObject({ phase: 'failed', lastError: RUNTIME_ERROR_HINTS.terminal });
    await fake.cleanup?.();
    fake.handlers.get('ready')?.({});
    expect(runtime.snapshot().phase).toBe('stopped');
  });
});
