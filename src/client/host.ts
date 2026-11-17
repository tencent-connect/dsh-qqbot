/**
 * 宿主服务的类型投影 + Context 模块增强 + 席位注册助手。
 *
 * 已 inject 声明的服务（slots、sidebarRightTabs）直接经 ctx 读取；
 * 未声明的服务（layout）只能在 ctx.inject 子 fiber 内读取；
 * 旧宿主可能不存在的席位名经 trySeat 包裹注册。
 */
import type { Context } from '@deepseek-ai/cordis';

/** ui-slots 的席位系统服务（局部投影） */
export interface SlotsLike {
  inject(slotName: string, register: () => (() => void)): () => void;
  register(spec: Record<string, unknown>, component: unknown): () => void;
}

/** ui-sidebar-right 的 Tab 注册表服务（局部投影） */
export interface TabRegistryLike {
  register(definition: {
    id: string;
    kind: string;
    title: (address: string) => string;
    guide?: ReadonlyArray<{
      id: string;
      order: number;
      title: () => string;
      description: () => string;
      icon: unknown;
    }>;
  }): () => void;
}

/** ui-layout 的面板导航（局部投影） */
export interface LayoutLike {
  selectPanel(panelId: string | null): void;
}

/** 浏览器 Connection 服务（局部投影：仅 RPC 调用面） */
export interface ClientConnectionLike {
  rpc: {
    call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>;
  };
}

/**
 * 模块增强：把 inject 声明的服务面写进 Context 类型（cordis 惯例，
 * 见 dsh-agent / dsh-llm 等包的同款声明），读取未声明服务（如 ctx.layout）
 * 由此成为编译错误。条目须与 index.ts 的 `export const inject` 对应。
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** ui-slots 席位系统（inject 声明，apply 时在场） */
    slots: SlotsLike;
    /** ui-sidebar-right Tab 注册表（inject 声明，apply 时在场） */
    sidebarRightTabs: TabRegistryLike;
    /** 浏览器 Connection 服务（inject 声明；宿主 web 外壳 0.2.0-rc.2+ 提供） */
    connection: ClientConnectionLike;
  }
}

/** layout 读取出口：仅限 ctx.inject(['layout'], cb) 子 fiber 内调用。 */
export function hostLayout(ctx: Context): LayoutLike {
  return (ctx as unknown as { layout: LayoutLike }).layout;
}

/**
 * 席位注册的防御包装：旧宿主上席位名未知时注册抛错，仅损失该席位。
 */
export function trySeat(register: () => () => void): (() => void) | undefined {
  try {
    return register();
  } catch {
    return undefined;
  }
}

/** 一次性清理链：各注册点 add，apply 的 effect 统一 run（后进先出）。 */
export interface Disposer {
  add(dispose?: (() => void) | undefined): void;
  run(): void;
}

export function chain(): Disposer {
  const disposers: Array<() => void> = [];
  let done = false;
  return {
    add(dispose) {
      if (dispose !== undefined) disposers.push(dispose);
    },
    run() {
      if (done) return;
      done = true;
      for (const dispose of disposers.reverse()) dispose();
    },
  };
}
