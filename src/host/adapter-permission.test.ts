/**
 * applyPermissionKnobs 的模块契约用例。
 *
 * 独立成文件：vitest 的 vi.doMock 会污染同文件内后续原生动态 import。
 * 本文件统一 mock 两个宿主策略模块，不依赖把可选宿主包装进 devDependencies。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHostAdapter, _resetAdapterCache } from './adapter.ts';

function makeCtx(services: Record<string, unknown>) {
  return {
    get: (name: string) => {
      if (!(name in services)) throw new Error(`cannot get property "${name}" without inject`);
      return services[name];
    },
  } as never;
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } as never;
}

describe('host adapter: applyPermissionKnobs（隔离模块契约）', () => {
  beforeEach(() => {
    _resetAdapterCache();
    vi.unstubAllGlobals();
    vi.doMock('@deepseek-ai/dsh-sandbox-policy', () => ({
      SANDBOX_MODES: ['read-only', 'workspace-write', 'danger-full-access'],
      setSandboxMode: (session: { append: unknown }, mode: string) =>
        (session.append as (...args: unknown[]) => void)('sandbox/mode', { mode }),
    }));
    vi.doMock('@deepseek-ai/dsh-user-approval', () => ({
      APPROVAL_POLICIES: ['ask', 'never'],
      setApprovalPolicy: (session: { append: unknown }, policy: string) =>
        (session.append as (...args: unknown[]) => void)('approval/policy', { policy }),
    }));
  });

  it('经宿主模块函数追加 sandbox/mode 与 approval/policy 两个事件', async () => {
    const adapter = createHostAdapter(makeCtx({ sandboxPolicy: {}, approval: {} }));
    const session = { append: vi.fn() };

    await expect(adapter.applyPermissionKnobs(session, { sandbox: 'read-only', approval: 'ask' })).resolves.toBe(true);
    expect(session.append).toHaveBeenCalledWith('sandbox/mode', { mode: 'read-only' });
    expect(session.append).toHaveBeenCalledWith('approval/policy', { policy: 'ask' });
  });

  it('非法 knob 值在 append 前拒绝（不留下半应用事件）', async () => {
    const logger = makeLogger();
    const adapter = createHostAdapter(makeCtx({ sandboxPolicy: {}, approval: {} }), logger);
    const session = { append: vi.fn() };
    await expect(adapter.applyPermissionKnobs(session, { sandbox: 'read-only', approval: 'bogus' })).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalled();
    expect(session.append).not.toHaveBeenCalled();
  });

  it('模块可解析但宿主未组合 sandboxPolicy/approval 服务时降级（不假成功）', async () => {
    const logger = makeLogger();
    const adapter = createHostAdapter(makeCtx({}), logger);
    const session = { append: vi.fn() };
    await expect(adapter.applyPermissionKnobs(session, { sandbox: 'read-only', approval: 'ask' })).resolves.toBe(false);
    expect(session.append).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('not composed'));
  });
});
