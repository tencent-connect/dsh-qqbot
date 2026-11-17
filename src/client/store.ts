/**
 * 绑定状态存储 —— 全插件唯一的绑定轮询器（引用计数）。
 *
 * 旧行为：useBindState 以 hook 形态被复制到每个展示位（设置栏目 / 主面板 /
 * 侧栏），最坏同时跑 2-3 份轮询器，且 HMR 窗口期各表面相位可能互相矛盾。
 * 现在：轮询器是模块级单例，首个订阅者启动、最后一个退订停止并清空缓存；
 * 全部表面经同一快照渲染，重挂载从加载态重新读取，不复用旧账号或二维码。
 *
 * 状态机语义自 useBindState 原样平移（404 双语义 / sawRoute / recheck
 * 快速收敛窗口 / 相位节拍），修改须对照 store.test.ts 的行为锚点。
 * 本模块不依赖 react：组件经 useSyncExternalStore 订阅（见 bind-page.ts）。
 */
import { rpcCall, RpcError } from './rpc.ts';
import { BIND_METHODS, BIND_RPC_ENDPOINT } from '../shared/rpc-protocol.ts';
import type { BindStateWire } from '../shared/bind-protocol.ts';

/** 轮询快照（getBindSnapshot 在两次 publish 之间返回同一引用） */
export interface BindSnapshot {
  readonly state: BindStateWire | null;
  readonly gone: boolean;
  readonly error: string | null;
}

/** 活跃轮询间隔（毫秒） / 失败退避 / saving 快轮询 / bound 稳定态降频 */
const ACTIVE_POLL_MS = 2000;
const RETRY_POLL_MS = 3000;
const SAVING_POLL_MS = 500;
const BOUND_POLL_MS = 30_000;
/** recheck 后的快速收敛窗口：解绑等动作改变的是服务端状态（经 HMR
 * 异步生效），窗口期内强制快轮询直到相位真正变化 */
const URGENT_WINDOW_MS = 15_000;

const listeners = new Set<() => void>();
let snapshot: BindSnapshot = { state: null, gone: false, error: null };

// 轮询器内部状态（仅 listeners 非空时有意义）
let running = false;
let restartAfterFlight = false;
let sawRoute = false;
let urgentUntil = 0;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
/** 在途请求的取消器：最后退订 / recheck 废弃请求时 abort，请求落地后清空 */
let controller: AbortController | undefined;

/** 语义相等（wire 各相位字段少，直接逐字段；相等时保留旧引用以稳定快照） */
function sameWire(a: BindStateWire | null, b: BindStateWire | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.phase !== b.phase) return false;
  switch (a.phase) {
    case 'waiting': {
      const other = b as Extract<BindStateWire, { phase: 'waiting' }>;
      return a.url === other.url && a.qrSvg === other.qrSvg && a.issuedAt === other.issuedAt;
    }
    case 'failed': {
      const other = b as Extract<BindStateWire, { phase: 'failed' }>;
      return a.reason === other.reason;
    }
    case 'bound': {
      const other = b as Extract<BindStateWire, { phase: 'bound' }>;
      return a.appId === other.appId;
    }
    default:
      return true;
  }
}

function publish(next: BindStateWire | null, gone: boolean, error: string | null): void {
  const state = sameWire(snapshot.state, next) ? snapshot.state : next;
  if (state === snapshot.state && gone === snapshot.gone && error === snapshot.error) return;
  snapshot = { state, gone, error };
  for (const listener of listeners) listener();
}

function intervalFor(phase: BindStateWire['phase'] | undefined): number {
  const base = phase === 'saving' ? SAVING_POLL_MS
    : phase === 'bound' ? BOUND_POLL_MS
      : ACTIVE_POLL_MS;
  return Date.now() < urgentUntil ? Math.min(base, ACTIVE_POLL_MS) : base;
}

function schedule(ms: number): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(() => { void tick(); }, ms);
}

function pageVisible(): boolean {
  return typeof document === 'undefined' || !document.hidden;
}

async function tick(): Promise<void> {
  if (running || listeners.size === 0) return;
  running = true;
  const myGeneration = generation;
  const alive = (): boolean => myGeneration === generation && listeners.size > 0;
  try {
    // 页面隐藏时跳过请求，按当前相位节拍重排（避免 hidden 下 2s 空转）
    if (!pageVisible()) {
      schedule(Math.max(intervalFor(snapshot.state?.phase), ACTIVE_POLL_MS));
      return;
    }
    const request = new AbortController();
    controller = request;
    const body = await rpcCall<BindStateWire>(BIND_RPC_ENDPOINT, BIND_METHODS.state, {}, 10_000, request.signal);
    if (!alive()) return;
    sawRoute = true;
    publish(body, false, null);
    schedule(intervalFor(body.phase));
    return;
  } catch (cause) {
    if (alive()) {
      const message = cause instanceof Error ? cause.message : '无法获取绑定状态';
      // gone 双语义：从未拿到过端点 = 插件未启用（终态）；
      // 曾经拿到过 = HMR 重载窗口期，保留最后快照等待恢复
      const routeMissing = cause instanceof RpcError && cause.gone;
      publish(snapshot.state, snapshot.gone || (!sawRoute && routeMissing), message);
    }
  } finally {
    controller = undefined;
    running = false;
    // 在飞期间被 recheck/start 取代：接力启动新轮询链（否则链会断）
    if (restartAfterFlight && listeners.size > 0) {
      restartAfterFlight = false;
      void tick();
      return;
    }
  }
  if (alive()) schedule(RETRY_POLL_MS);
}

function startPoller(): void {
  sawRoute = false;
  urgentUntil = 0;
  restartAfterFlight = false;
  // 上一轮请求仍在飞：等它落地后由 finally 接力，避免双计时器
  if (running) {
    restartAfterFlight = true;
    return;
  }
  void tick();
}

function stopPoller(): void {
  generation += 1;
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  // 取消在途请求：否则下一次挂载的首读要等它落地（挂起时最长 10s）
  controller?.abort();
  restartAfterFlight = false;
  sawRoute = false;
  urgentUntil = 0;
  publish(null, false, null);
}

/** 订阅绑定状态：首个订阅启动轮询器，最后一个退订停止。 */
export function subscribeBindStore(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) startPoller();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopPoller();
  };
}

/** 当前快照（引用稳定，直到下一次 publish）。 */
export function getBindSnapshot(): BindSnapshot {
  return snapshot;
}

/**
 * 立即重置轮询节拍：废弃当前计时器，在飞请求作废，进入快速收敛窗口。
 * 解绑/保存凭据等动作后调用，让新相位尽快可见（bound 30s 降频下尤其关键）。
 */
export function recheckBindState(): void {
  if (listeners.size === 0) return;
  generation += 1;
  urgentUntil = Date.now() + URGENT_WINDOW_MS;
  publish(snapshot.state, false, null);
  if (running) {
    // 废弃在途请求：abort 使其快速 reject，经 finally 接力立即发起新轮询
    controller?.abort();
    restartAfterFlight = true;
    return;
  }
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  void tick();
}
