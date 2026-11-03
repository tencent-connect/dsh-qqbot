/**
 * 宿主 API 适配层 — 收口所有版本漂移点，一次探测按需复用。
 *
 * 宿主新旧版本 API 形态不同（本插件踩过的漂移：events → snapshotEvents、
 * presets.serviceFor 实例方法 → serviceForAgent 模块函数）。
 * 调用方只依赖本模块的稳定签名，不再直接假设宿主形态。
 */
import type { Context } from '@deepseek-ai/cordis';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { DshAgent } from '../session/types.ts';

/** 日志最小接口 */
export interface AdapterLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface HostAdapter {
  /** 会话事件读取：新宿主 snapshotEvents()，旧宿主 events getter */
  sessionEvents(session: { snapshotEvents?: () => readonly unknown[]; events?: readonly unknown[] }): readonly unknown[];
  /** preset 作用域服务解析：旧宿主实例方法 / 新宿主模块函数 */
  serviceFor(agent: { ctx: unknown }, name: string): Promise<unknown | undefined>;
  /** 全局服务读取（未注册返回 undefined，不抛） */
  globalService(name: string): unknown | undefined;
  /** 通过原生控制器合并并发恢复，避免与默认会话页创建不同 Agent。 */
  resolveAgent(sessionId: string): Promise<DshAgent | undefined>;
  /** 探测结果摘要（启动契约检查用） */
  readonly capabilities: string[];
}

/** 模块级函数的动态 import 结果缓存（spec 变量路径绕开本地依赖类型检查） */
export function createHostAdapter(ctx: Context, _logger?: AdapterLogger): HostAdapter {
  const capabilities: string[] = [];

  // events 读取路径只有运行时才能确定，sessionEvents 内自适应
  capabilities.push('sessionEvents(s自适应)');

  let resolveFn: ((agent: { ctx: unknown }, name: string) => unknown | undefined) | undefined;
  const presets = safeGet(ctx, 'agentPresets') as
    | { serviceFor?: (agent: unknown, name: string) => unknown }
    | undefined;
  if (presets && typeof presets.serviceFor === 'function') {
    resolveFn = (agent, name) => presets.serviceFor!(agent, name);
    capabilities.push('serviceFor(presets实例方法)');
  } else {
    capabilities.push('serviceFor(Agent作用域)');
  }

  return {
    capabilities,

    sessionEvents(session) {
      if (typeof session.snapshotEvents === 'function') return session.snapshotEvents();
      const legacy = session.events;
      return Array.isArray(legacy) ? legacy : [];
    },

    async serviceFor(agent, name) {
      const scoped = agent.ctx;
      if (scoped && typeof scoped === 'object' && 'get' in scoped && typeof scoped.get === 'function') {
        try {
          const value: unknown = scoped.get(name);
          if (value !== undefined && value !== null) return value;
        } catch { /* Legacy preset lookup remains available when scoped injection is absent. */ }
      }
      if (!resolveFn) return undefined;
      try {
        return resolveFn(agent, name);
      } catch {
        return undefined;
      }
    },

    async resolveAgent(sessionId) {
      const controller = safeGet(ctx, 'sessionController') as {
        resolveAgent?(id: SessionId): Promise<{ agent: DshAgent } | { error: Error & { code?: string } }>;
      } | undefined;
      if (!controller?.resolveAgent) throw new Error('当前宿主缺少原生会话恢复接口，原会话保持不变。');
      const result = await controller.resolveAgent(SessionId(sessionId));
      if ('agent' in result) return result.agent;
      if (result.error.code === 'session/not-found') return undefined;
      throw result.error;
    },

    globalService(name) {
      return safeGet(ctx, name);
    },

  };
}

/** ctx.get 的非抛出版本 */
function safeGet(ctx: Context, name: string): unknown {
  try {
    return ctx.get(name) as unknown;
  } catch {
    return undefined;
  }
}

/** 测试辅助：模块缓存已移除，保留空实现以兼容既有测试调用。 */
export function _resetAdapterCache(): void { /* no-op */ }
