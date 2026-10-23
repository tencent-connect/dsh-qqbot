import { describe, it, expect, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { attachSessionToWorkspace, type WorkspaceLike, type WorkspaceRegistryLike } from './workspace-attach.ts';
import type { Logger } from '../types.ts';

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createWorkspace(path = 'D:\\proj'): WorkspaceLike & { attachSession: ReturnType<typeof vi.fn> } {
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
  it('attaches the session to the workspace of its cwd', async () => {
    const ws = createWorkspace();
    const registry = createRegistry(ws);
    const logger = createLogger();
    await attachSessionToWorkspace(createCtx({ workspaceRegistry: registry }), 'D:\\proj', 'sess-1', logger);
    expect(registry.create).toHaveBeenCalledWith('D:\\proj');
    expect(ws.attachSession).toHaveBeenCalledWith('sess-1');
  });

  it('skips silently when the workspaceRegistry service is absent', async () => {
    const logger = createLogger();
    await expect(attachSessionToWorkspace(createCtx({}), 'D:\\proj', 'sess-1', logger)).resolves.toBeUndefined();
  });

  it('skips silently when ctx.get throws', async () => {
    const logger = createLogger();
    const ctx = { get: () => { throw new Error('ctx gone'); } } as unknown as Context;
    await expect(attachSessionToWorkspace(ctx, 'D:\\proj', 'sess-1', logger)).resolves.toBeUndefined();
  });

  it('skips silently when the registry has no usable create()', async () => {
    const logger = createLogger();
    await expect(attachSessionToWorkspace(createCtx({ workspaceRegistry: {} }), 'D:\\proj', 'sess-1', logger))
      .resolves.toBeUndefined();
  });

  it('swallows create() failures without throwing', async () => {
    const logger = createLogger();
    const registry = { create: vi.fn().mockRejectedValue(new Error('not a directory')) };
    await expect(attachSessionToWorkspace(createCtx({ workspaceRegistry: registry }), 'D:\\proj', 'sess-1', logger))
      .resolves.toBeUndefined();
    expect(logger.debug).toHaveBeenCalled();
  });

  it('swallows attachSession() failures without throwing', async () => {
    const logger = createLogger();
    const ws = { path: 'D:\\proj', attachSession: vi.fn().mockRejectedValue(new Error('cwd mismatch')) };
    const registry = createRegistry(ws);
    await expect(attachSessionToWorkspace(createCtx({ workspaceRegistry: registry }), 'D:\\proj', 'sess-1', logger))
      .resolves.toBeUndefined();
    expect(logger.debug).toHaveBeenCalled();
  });
});
