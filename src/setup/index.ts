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
import { createBindRpcHandler } from './bind-routes.ts';
import { createConfigRpcHandler } from '../runtime/config-routes.ts';
import { createModelOptionsProvider } from '../runtime/model-options.ts';
import { registerPluginRpc } from '../rpc-carrier.ts';
import { BIND_RPC_ENDPOINT, CONFIG_RPC_ENDPOINT } from '../shared/rpc-protocol.ts';
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
 * 执行扫码绑定编排；失败后等待刷新，成功返回凭据，取消 resolve null。
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

  // 端内绑定 RPC：经宿主 Connection 共享通道注册（来源围栏与认证由宿主
  // 施加）。connection 服务缺席时静默跳过（CLI profile 照常加载），
  // 就绪/替换时子 fiber 生命周期自动重挂。
  registerPluginRpc(ctx, BIND_RPC_ENDPOINT, createBindRpcHandler(service, logger, {
    // 未绑定流程中的手动提交：终止扫码轮询，走同一持久化路径
    onManualCredentials: (credentials) => {
      service.dispose();
      return persistCredentials(credentials, logger);
    },
  }));

  // 未绑定态也提供配置回显（绑定完成前设置页可能预读）；命令清单与
  // 模型候选由已绑定 fiber 的 CONFIG 端点提供
  registerPluginRpc(ctx, CONFIG_RPC_ENDPOINT, createConfigRpcHandler(logger, {
    currentConfig: () => options.config,
    boundAppId: () => null,
    commands: () => [],
    modelOptions: createModelOptionsProvider(ctx, logger),
  }));

  return service.start();
}

/**
 * 凭据已配置的 fiber 注册常驻路由（状态回显 + 手动编辑/更换）。
 *
 * 在 apply 的 bootstrapGateway 之前调用；写入经同一 persist 路径，
 * 保存后触发 HMR 重载、新 fiber 以新凭据重启网关。配置端点
 * （config.get/set + 候选数据）由 bootstrapGateway 注册（需要 manager）。
 */
export function registerBoundCredentialRoutes(ctx: Context, logger: Logger, appId: string): void {
  registerPluginRpc(ctx, BIND_RPC_ENDPOINT, createBindRpcHandler(null, logger, {
    boundAppId: () => appId,
    onManualCredentials: (credentials) => persistCredentials(credentials, logger),
  }));
}

/** 手动凭据持久化（失败时返回可展示的错误） */
function persistCredentials(credentials: SetupCredentials, logger: Logger): { persisted: boolean; error?: string } {
  const persisted = persistCredentialsToProfile(credentials, getProfileDir() ?? undefined, logger);
  return persisted
    ? { persisted: true }
    : { persisted: false, error: '无法定位 profile 目录或写入失败，请改用环境变量配置' };
}
