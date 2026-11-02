import { describe, it, expect, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { attachSessionToWorkspace, type WorkspaceLike, type WorkspaceRegistryLike } from './workspace-attach.ts';
import type { Logger } from '../types.ts';

function createLogger(): Logger & { debug: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createWorkspace(path = '/proj'): WorkspaceLike & { attachSession: ReturnType<typeof vi.fn> } {
  return { path, attachSession: vi.fn().mockResolvedValue(undefined) };
}

function createRegistry(workspace: WorkspaceLike): WorkspaceRegistryLike & { create: ReturnType<typeof vi.fn> } {
  return { create: vi.fn().mockResolvedValue(workspace) };
}

/** 按需返回服务的 stub ctx；未登记的服务像宿主一样抛错 */
function createCtx(services: Record<string, unknown>): Context {
  return {
    get: (name: string) => {
      if (!(name in services)) throw new Error(`service '${name}' not available`);
      return services[name];
    },
  } as unknown as Context;
}

describe('attachSessionToWorkspace', () => {
  it('把会话挂载到其 cwd 对应的工作区', async () => {
    const ws = createWorkspace();
    const registry = createRegistry(ws);
    const logger = createLogger();
    await attachSessionToWorkspace(createCtx({ workspaceRegistry: registry }), '/proj', 'sess-1', logger);
    expect(registry.create).toHaveBeenCalledWith('/proj');
    expect(ws.attachSession).toHaveBeenCalledWith('sess-1');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('服务缺失时静默降级（debug，不 warn）', async () => {
    const logger = createLogger();
    await expect(attachSessionToWorkspace(createCtx({}), '/proj', 'sess-1', logger)).resolves.toBeUndefined();
    expect(logger.debug).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('ctx.get 抛错时静默降级', async () => {
    const logger = createLogger();
    const ctx = { get: () => { throw new Error('ctx gone'); } } as unknown as Context;
    await expect(attachSessionToWorkspace(ctx, '/proj', 'sess-1', logger)).resolves.toBeUndefined();
    expect(logger.debug).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('registry 无可用 create() 时静默降级', async () => {
    const logger = createLogger();
    await expect(attachSessionToWorkspace(createCtx({ workspaceRegistry: {} }), '/proj', 'sess-1', logger))
      .resolves.toBeUndefined();
    expect(logger.debug).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('create() 失败时吞掉异常并 warn', async () => {
    const logger = createLogger();
    const registry = { create: vi.fn().mockRejectedValue(new Error('not a directory')) };
    await expect(attachSessionToWorkspace(createCtx({ workspaceRegistry: registry }), '/proj', 'sess-1', logger))
      .resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('attachSession() 失败时吞掉异常并 warn', async () => {
    const logger = createLogger();
    const ws = { path: '/proj', attachSession: vi.fn().mockRejectedValue(new Error('cwd mismatch')) };
    const registry = createRegistry(ws);
    await expect(attachSessionToWorkspace(createCtx({ workspaceRegistry: registry }), '/proj', 'sess-1', logger))
      .resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('create() 返回不含 attachSession 的对象时 warn（接口演进防护）', async () => {
    const logger = createLogger();
    const registry = { create: vi.fn().mockResolvedValue({ path: '/proj' }) };
    await expect(attachSessionToWorkspace(createCtx({ workspaceRegistry: registry }), '/proj', 'sess-1', logger))
      .resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
