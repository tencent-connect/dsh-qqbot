/**
 * apply 激活路径回归：在真实 cordis 生命周期下加载插件——
 * 已声明服务（slots / sidebarRightTabs / connection）直接读取；layout 只经
 * ctx.inject 子 fiber 读取；服务缺失时插件保持 pending 而非 failed。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { apply, inject, name } from './index.ts';

interface SlotsLike {
  inject(slot: string, register: () => (() => void) | undefined): () => void;
  register(spec: Record<string, unknown>, component: unknown): () => void;
}

function makeContext(services: Record<string, unknown>): Context {
  const ctx = new Context();
  for (const [key, value] of Object.entries(services)) ctx.provide(key, value);
  return ctx;
}

function makeSlots(registrations: string[]): SlotsLike {
  return {
    inject(slot, register) {
      const dispose = register();
      if (dispose !== undefined) registrations.push(`slots.inject:${slot}`);
      return dispose ?? (() => {});
    },
    register(spec) {
      registrations.push(`slots.register:${String(spec?.name)}`);
      return () => {};
    },
  };
}

/** 浏览器 Connection 服务替身（rpc.ts 只用 rpc.call 面） */
function makeConnection(): { rpc: { call(): Promise<unknown> } } {
  return { rpc: { call: async () => ({ ok: true, value: null }) } };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('client apply activation', () => {
  it('activates without reading services outside its inject declaration', async () => {
    const registrations: string[] = [];
    const ctx = makeContext({
      slots: makeSlots(registrations),
      sidebarRightTabs: { register: () => () => {} },
      connection: makeConnection(),
      // 故意不提供 layout：顶层读取它就是本次回归要拦截的错误
    });

    // 崩溃复现形态：apply 内的任何抛错都会让 plugin() reject 或 fiber failed
    await expect(ctx.plugin({ name, inject, apply })).resolves.toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 主席位注册成功；layout 缺失时子 fiber 挂起而非 failed
    expect(registrations).toContain('slots.inject:settings.section');
    expect(registrations).toContain('slots.inject:sidebar.right.pane.tab');
    expect(registrations).not.toContain('slots.inject:main');
  });

  it('wires the layout seats through the injected child fiber', async () => {
    const registrations: string[] = [];
    const ctx = makeContext({
      slots: makeSlots(registrations),
      sidebarRightTabs: { register: () => () => {} },
      connection: makeConnection(),
      layout: { selectPanel: () => {} },
    });

    await ctx.plugin({ name, inject, apply });
    // layout 服务在即：子 fiber 解析后补注册主面板席位
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(registrations).toContain('slots.inject:main');
    expect(registrations).toContain('slots.inject:plugins.detail.actions');
    expect(registrations).toContain('slots.inject:sidebar.panellist');
  });

  it('stays pending before its declared services arrive, then activates without failing', async () => {
    const registrations: string[] = [];
    const ctx = new Context();
    // 先启动插件（无任何服务）：fiber 保持 pending，apply 不得运行
    await ctx.plugin({ name, inject, apply });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(registrations).toEqual([]);

    // 声明的服务后补到位：fiber 激活，apply 运行且不抛（契约 A 类直读）
    ctx.provide('slots', makeSlots(registrations));
    ctx.provide('sidebarRightTabs', { register: () => () => {} });
    ctx.provide('connection', makeConnection());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(registrations).toContain('slots.inject:settings.section');
    expect(registrations).toContain('slots.inject:sidebar.right.pane.tab');
  });
});
