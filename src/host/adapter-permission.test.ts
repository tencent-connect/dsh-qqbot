/**
 * applyPermissionKnobs 的真模块集成用例。
 *
 * 独立成文件：vitest 中任何一次 vi.doMock 都会激活 mocker，污染同文件内
 * 后续的原生动态 import（adapter 的 fail-soft import 兜底会误触发）。
 * 本文件禁止使用 vi.doMock（除最后一个"模块不可解析"用例）。
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

describe('host adapter: applyPermissionKnobs（真模块集成）', () => {
  beforeEach(() => {
    _resetAdapterCache();
    vi.unstubAllGlobals();
  });

  it('经真模块函数追加 sandbox/mode 与 approval/policy 两个事件', async () => {
    // devDeps 已装真包（导出即宿主唯一写路径），直接验证与真实函数的集成
    const adapter = createHostAdapter(makeCtx({}));
    const session = { append: vi.fn() };

    await expect(adapter.applyPermissionKnobs(session, { sandbox: 'read-only', approval: 'ask' })).resolves.toBe(true);
    expect(session.append).toHaveBeenCalledWith('sandbox/mode', { mode: 'read-only' });
    expect(session.append).toHaveBeenCalledWith('approval/policy', { policy: 'ask' });
  });

  it('非法 knob 值被宿主函数拒绝（验证抛错 → false，不抛出）', async () => {
    const logger = makeLogger();
    const adapter = createHostAdapter(makeCtx({}), logger);
    const session = { append: vi.fn() };
    await expect(adapter.applyPermissionKnobs(session, { sandbox: 'read-only', approval: 'bogus' })).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('策略模块不可解析返回 false（fail-soft；本用例须保持在本文件最后）', async () => {
    vi.doMock('@deepseek-ai/dsh-sandbox-policy', () => { throw new Error('module unavailable'); });
    _resetAdapterCache();
    const adapter = createHostAdapter(makeCtx({}));
    const session = { append: vi.fn() };
    await expect(adapter.applyPermissionKnobs(session, { sandbox: 'read-only', approval: 'ask' })).resolves.toBe(false);
  });
});
