/**
 * applyPermissionKnobs 与真实宿主策略模块的集成 smoke test。
 * 本文件禁止 vi.doMock：避免激活 vitest mocker 污染原生动态 import。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHostAdapter, _resetAdapterCache } from './adapter.ts';

describe('host adapter: applyPermissionKnobs（真模块 smoke）', () => {
  beforeEach(() => {
    _resetAdapterCache();
  });

  it('使用 devDeps 中真实 rc.6 模块追加两个合法 knob 事件', async () => {
    const ctx = {
      get: (name: string) => {
        if (name === 'sandboxPolicy' || name === 'approval') return {};
        throw new Error(`cannot get property "${name}" without inject`);
      },
    } as never;
    const adapter = createHostAdapter(ctx);
    const session = { append: vi.fn() };

    await expect(adapter.applyPermissionKnobs(session, {
      sandbox: 'workspace-write',
      approval: 'ask',
    })).resolves.toBe(true);
    expect(session.append).toHaveBeenCalledWith('sandbox/mode', { mode: 'workspace-write' });
    expect(session.append).toHaveBeenCalledWith('approval/policy', { policy: 'ask' });
  });
});
