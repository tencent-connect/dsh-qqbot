/**
 * 凭据绑定编排 — setup/ 模块入口
 *
 * apply() 检测到凭据缺失时调用 ensureCredentials：
 * 1. 创建 BindingService（单例接管，HMR 双 fiber 安全）
 * 2. Web 宿主（dsh web / Desktop）注册端内绑定页路由
 *    —— 经 ctx.inject(['webServer'], ...) 可选注入：服务未就绪时插件
 *       照常加载（CLI profile），就绪/替换时自动（重）注册路由
 * 3. 按宿主形态挂呈现策略（终端 / 浏览器降级）
 * 4. 生命周期与 ctx fiber 绑定（dispose 时 abort 轮询、注销路由）
 *
 * 凭据已配置的 fiber 调用 registerBoundCredentialRoutes 注册常驻路由
 * （bound 状态回显 + 手动编辑），与扫码流程共用持久化路径。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Logger } from '../types.ts';
import { BindingService } from './binding-service.ts';
import { registerBindRoutes, type WebServerLike } from './bind-routes.ts';
import { createRouteTrust } from './request-trust.ts';
import { createBrowserPresenter, createTerminalPresenter, isDesktopHost } from './presenters.ts';
import { persistCredentialsToProfile, type SetupCredentials } from './persist.ts';
import { getProfileDir } from '../shared/index.ts';

export type { SetupCredentials } from './persist.ts';
export { persistCredentialsToProfile } from './persist.ts';
export { isDesktopHost } from './presenters.ts';

/** 进程内活动绑定服务（HMR 接管用） */
let activeService: BindingService | null = null;

/** ensureCredentials 参数 */
export interface EnsureCredentialsOptions {
  logger: Logger;
  /** 二维码 URL 的 source 标识 */
  source?: string;
  /** 当前生效配置（apply 时 loader 合并值；config 路由 GET 回显用） */
  config: Record<string, unknown>;
}

/**
 * 执行扫码绑定编排，返回凭据就绪的 Promise；失败/取消 resolve null。
 *
 * 【同步契约】函数体必须保持无 await——绑定编排（服务接管、路由注册、
 * 呈现策略、ctx 生命周期挂载）在调用后的同步阶段全部完成，随后返回
 * `service.start()` 的挂起 Promise。调用方（插件 apply）因此可以不等待
 * 扫码结果直接完成加载：boot 的 `loader.await()` 会等所有插件 fiber
 * settle，若 apply 无限期等待用户扫码，Host ready 会被阻塞
 * （Desktop 界面无法进入、Web URL 延迟输出）。
 *
 * 凭据持久化由调用方在 Promise 的 then 链中执行——成功写入
 * cordis.patch.yml 会触发 HMR 热重载，新 fiber 以凭据启动网关。
 */
export async function ensureCredentials(
  ctx: Context,
  options: EnsureCredentialsOptions,
): Promise<SetupCredentials | null> {
  const logger = options.logger;
  const source = options.source ?? 'dsh-qqbot';

  // 单例接管：HMR 双 fiber 窗口下，新实例终止旧实例的轮询
  const service = new BindingService({ source, logger });
  if (activeService !== null && activeService !== service) {
    activeService.dispose();
  }
  activeService = service;

  // 生命周期：fiber dispose 时 abort 轮询
  (ctx as unknown as { effect(fn: () => () => void, name?: string): void }).effect(() => () => {
    service.dispose();
    if (activeService === service) activeService = null;
  }, 'im-qqbot.binding');

  // 呈现策略：
  // - 终端通道（CLI / dsh web 运营者）；Desktop 无可见终端，跳过
  // - 浏览器降级通道（QQBOT_BIND_OPEN_BROWSER=1 显式启用）
  if (!isDesktopHost()) {
    service.attach(createTerminalPresenter());
  }
  if (process.env.QQBOT_BIND_OPEN_BROWSER === '1') {
    service.attach(createBrowserPresenter(logger));
  }

  // 端内绑定页路由：webServer 可选注入。
  // cordis 访问守卫要求服务经 inject 声明后方可访问；deps 未就绪时
  // 回调不运行但插件照常加载（CLI profile），服务就绪/替换时回调
  // 重跑（自动清理旧路由、注册新路由），与 webserver 的注入生命周期对齐。
  (ctx as unknown as {
    inject(deps: readonly string[], callback: (scoped: Context) => void): unknown;
  }).inject(['webServer'], (scoped) => {
    const webServer = (scoped as unknown as { webServer?: unknown }).webServer as WebServerLike | undefined;
    if (webServer === undefined || typeof webServer.register !== 'function') return;
    // 与宿主 /api 对齐的来源信任围栏：优先采用宿主 connection 判定，其次复刻
    // webServer.host/protocol + webStartup.trustedHosts，旧宿主回落同源比较
    const isTrustedRequest = createRouteTrust({
      connection: safeService(scoped, 'connection'),
      webStartup: safeService(scoped, 'webStartup'),
      webServer: safeService(scoped, 'webServer'),
    });
    const disposeRoutes = registerBindRoutes(webServer, service, logger, {
      // 未绑定流程中的手动提交：终止扫码轮询，走同一持久化路径
      onManualCredentials: (credentials) => {
        service.dispose();
        return persistCredentials(credentials, logger);
      },
      currentConfig: () => options.config,
      isTrustedRequest,
    });
    // 回调作用域（服务卸载/替换、插件卸载）连带注销路由
    (scoped as unknown as { effect(fn: () => () => void, name?: string): void }).effect(() => {
      return disposeRoutes;
    }, 'im-qqbot.bind-routes');
  });

  return service.start();
}

/**
 * 凭据已配置的 fiber 注册常驻路由（状态回显 + 手动编辑/更换）。
 *
 * 在 apply 的 bootstrapGateway 之前调用；写入经同一 persist 路径，
 * 保存后触发 HMR 重载、新 fiber 以新凭据重启网关。
 */
export function registerBoundCredentialRoutes(ctx: Context, logger: Logger, appId: string, config: Record<string, unknown>): void {
  (ctx as unknown as {
    inject(deps: readonly string[], callback: (scoped: Context) => void): unknown;
  }).inject(['webServer'], (scoped) => {
    const webServer = (scoped as unknown as { webServer?: unknown }).webServer as WebServerLike | undefined;
    if (webServer === undefined || typeof webServer.register !== 'function') return;
    const isTrustedRequest = createRouteTrust({
      connection: safeService(scoped, 'connection'),
      webStartup: safeService(scoped, 'webStartup'),
      webServer: safeService(scoped, 'webServer'),
    });
    const disposeRoutes = registerBindRoutes(webServer, null, logger, {
      boundAppId: () => appId,
      onManualCredentials: (credentials) => persistCredentials(credentials, logger),
      currentConfig: () => config,
      isTrustedRequest,
    });
    (scoped as unknown as { effect(fn: () => () => void, name?: string): void }).effect(() => {
      return disposeRoutes;
    }, 'im-qqbot.bind-routes');
  });
}

/** 手动凭据持久化（失败时返回可展示的错误） */
function persistCredentials(credentials: SetupCredentials, logger: Logger): { persisted: boolean; error?: string } {
  const persisted = persistCredentialsToProfile(credentials, getProfileDir() ?? undefined, logger);
  return persisted
    ? { persisted: true }
    : { persisted: false, error: '无法定位 profile 目录或写入失败，请改用环境变量配置' };
}

/**
 * ctx.get 的非抛出版本：宿主服务缺失/访问被守卫拒绝时返回 undefined，
 * 让信任围栏按能力降级而不是让路由注册失败。
 */
function safeService(ctx: Context, name: string): unknown {
  try {
    return (ctx as unknown as { get(service: string): unknown }).get(name);
  } catch {
    return undefined;
  }
}
