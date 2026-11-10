/**
 * QQ Bot 绑定服务 — 扫码状态机（宿主内唯一事实源）
 *
 * - 协议轮询只在宿主执行（appSecret 解密后绝不出宿主进程）
 * - 端内绑定页（bind-routes）只读投影本服务状态
 * - 生命周期可取消（HMR / 插件卸载时 abort 轮询，不留孤儿任务）
 * - refresh() 仅废弃当前二维码任务并重建（用户点击「刷新二维码」）
 */
import { startQrConnect } from '@tencent-connect/qqbot-connector';
import type { QrConnectCallbacks, QrConnectCredentials, QrConnectOptions } from '@tencent-connect/qqbot-connector';
import type { Logger } from '../types.ts';
import type { QrPresenter } from './presenters.ts';
import { renderQrSvgDataUrl } from './qr-svg.ts';
import type { SetupCredentials } from './persist.ts';

/** connector 连接函数签名（可注入便于测试） */
export type ConnectFn = (callbacks: QrConnectCallbacks, options?: QrConnectOptions) => () => void;

/** 绑定状态机相位 */
export type BindPhase =
  | { kind: 'idle' }
  | { kind: 'waiting'; url: string; qrSvg?: string; issuedAt: number }
  | { kind: 'saving' }
  | { kind: 'failed'; reason: string };

/** HTTP 路由序列化形态（线上协议，供端内绑定页消费） */
export type BindStateWire =
  | { phase: 'starting' }
  | { phase: 'waiting'; url: string; qrSvg?: string; issuedAt: number }
  | { phase: 'saving' }
  | { phase: 'failed'; reason: string };

/** 构造参数 */
export interface BindingServiceOptions {
  /** 调用来源标识，拼入二维码 URL */
  source: string;
  logger: Logger;
  /** connector 注入点（默认真实实现） */
  connect?: ConnectFn;
  /** 二维码渲染注入点（默认真实实现） */
  renderQr?: typeof renderQrSvgDataUrl;
}

/**
 * 单个绑定会话的状态机。
 *
 * start() 幂等；refresh() 通过 abort 当前 connectOnce 使 run 循环
 * 重建绑定任务（新二维码）；dispose() 终止一切轮询。
 */
export class BindingService {
  private phase: BindPhase = { kind: 'idle' };
  private readonly listeners = new Set<() => void>();
  private readonly presenters: QrPresenter[] = [];
  private readonly connectFn: ConnectFn;
  private readonly renderQrFn: typeof renderQrSvgDataUrl;
  private readonly source: string;
  private readonly logger: Logger;

  private readonly lifetime = new AbortController();
  private refreshCtl: AbortController | null = null;
  private runId = 0;
  private startPromise: Promise<SetupCredentials | null> | null = null;
  private disposed = false;

  constructor(options: BindingServiceOptions) {
    this.source = options.source;
    this.logger = options.logger;
    this.connectFn = options.connect ?? startQrConnect;
    this.renderQrFn = options.renderQr ?? renderQrSvgDataUrl;
  }

  /** 当前相位（路由轮询读取） */
  get currentPhase(): BindPhase {
    return this.phase;
  }

  /** 状态订阅（预留给 SSE 推送等增强） */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** 挂载呈现策略（须在 start() 前调用） */
  attach(presenter: QrPresenter): void {
    this.presenters.push(presenter);
  }

  /** 序列化为线上协议 */
  wireState(): BindStateWire {
    switch (this.phase.kind) {
      case 'idle':
        return { phase: 'starting' };
      case 'waiting':
        return { phase: 'waiting', url: this.phase.url, qrSvg: this.phase.qrSvg, issuedAt: this.phase.issuedAt };
      case 'saving':
        return { phase: 'saving' };
      case 'failed':
        return { phase: 'failed', reason: this.phase.reason };
    }
  }

  /** 启动绑定流程（幂等） */
  start(): Promise<SetupCredentials | null> {
    if (this.startPromise === null) {
      this.startPromise = this.run().finally(() => {
        this.refreshCtl = null;
      });
    }
    return this.startPromise;
  }

  /** 用户请求刷新：废弃当前二维码任务，run 循环会重建 */
  refresh(): void {
    if (this.disposed || this.startPromise === null || this.phase.kind === 'saving') return;
    console.log('正在刷新二维码…\n');
    this.setPhase({ kind: 'idle' });
    this.refreshCtl?.abort();
  }

  /** 终止绑定（插件卸载 / HMR 接管 / 替换） */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.refreshCtl?.abort();
    this.lifetime.abort();
    this.presenters.length = 0;
    this.listeners.clear();
  }

  private async run(): Promise<SetupCredentials | null> {
    while (!this.disposed) {
      const generation = ++this.runId;
      let credentials: SetupCredentials | null;
      try {
        credentials = await this.connectOnce(generation);
      } catch (err) {
        if (this.disposed) return null;
        const reason = err instanceof Error ? err.message : String(err);
        this.runId += 1;
        this.setPhase({ kind: 'failed', reason });
        console.error(`[im-qqbot] 扫码绑定失败: ${reason}`);
        await this.waitForRefresh();
        continue;
      }
      if (this.disposed) return null;
      if (credentials !== null) {
        console.log(`\n✔ 扫码绑定成功! AppID: ${credentials.appId}\n`);
        this.setPhase({ kind: 'saving' });
        return credentials;
      }
      // null = refresh 触发的重启，循环重建新二维码任务
    }
    return null;
  }

  private waitForRefresh(): Promise<void> {
    const signal = this.refreshCtl?.signal;
    if (signal === undefined || signal.aborted || this.lifetime.signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = (): void => {
        signal.removeEventListener('abort', finish);
        this.lifetime.signal.removeEventListener('abort', finish);
        resolve();
      };
      signal.addEventListener('abort', finish, { once: true });
      this.lifetime.signal.addEventListener('abort', finish, { once: true });
    });
  }

  private connectOnce(generation: number): Promise<SetupCredentials | null> {
    return new Promise((resolve, reject) => {
      const refreshCtl = new AbortController();
      this.refreshCtl = refreshCtl;
      const signal = AbortSignal.any([this.lifetime.signal, refreshCtl.signal]);

      this.connectFn(
        {
          onSuccess: (credentials: QrConnectCredentials[]) => {
            const cred = credentials[0];
            if (!cred) {
              // 空凭据等待用户刷新，避免自动无限重试。
              reject(new Error('扫码未返回有效凭据'));
              return;
            }
            resolve({ appId: cred.appId, appSecret: cred.appSecret, userOpenid: cred.userOpenid });
          },
          onFailure: (error: Error) => {
            // refresh / dispose 触发的取消按「重启」或「静默退出」处理
            if (this.lifetime.signal.aborted || refreshCtl.signal.aborted) {
              resolve(null);
              return;
            }
            reject(error);
          },
          onQrDisplayed: (url: string) => { void this.handleQrDisplayed(generation, url); },
          onQrExpired: () => { this.handleQrExpired(generation); },
        },
        {
          displayQrCodeToConsole: this.presenters.some((p) => p.printQrToConsole),
          signal,
          source: this.source,
        },
      );
    });
  }

  private async handleQrDisplayed(generation: number, url: string): Promise<void> {
    // 终端链接指引先于 SVG 渲染：指引是二维码渲染错位时的自救通道，
    // 必须与 connector 的二维码打印同步衔接，不隔任何异步间隙
    for (const presenter of this.presenters) presenter.onQrDisplayed(url);

    let qrSvg: string | undefined;
    try {
      qrSvg = await this.renderQrFn(url);
    } catch (err) {
      this.logger.warn(`im-qqbot: 二维码 SVG 渲染失败（页面将降级为链接）: ${err instanceof Error ? err.message : String(err)}`);
    }
    // 渲染期间可能已被 refresh/dispose 淘汰
    if (generation !== this.runId || this.disposed) return;
    this.setPhase({ kind: 'waiting', url, qrSvg, issuedAt: Date.now() });
  }

  private handleQrExpired(generation: number): void {
    if (generation !== this.runId) return;
    for (const presenter of this.presenters) presenter.onQrExpired?.();
  }

  private setPhase(phase: BindPhase): void {
    this.phase = phase;
    for (const listener of this.listeners) listener();
  }
}
