/**
 * dsh-im-qqbot — QQ Bot IM channel plugin for deepseek-harness
 *
 * Cordis 插件入口。将 QQ 消息平台作为 dsh 的前端协议驱动。
 * 网关组装（中间件编排 + 事件 + 出站 + 生命周期）见 src/gateway/；
 * 凭据绑定编排（扫码状态机 + 端内绑定页路由）见 src/setup/。
 */
import type { Context } from '@deepseek-ai/cordis';
import { ConfigSchema, resolveBotIdentities, type ImQQBotConfig } from './config.ts';
import { bootstrapGateway } from './gateway/index.ts';
import type { DshAgentRegistry } from './session/index.ts';
import { getProfileDir, resolveEnv } from './shared/index.ts';
import { ensureCredentials, persistCredentialsToProfile, registerBoundCredentialRoutes } from './setup/index.ts';
import type { Logger } from './types.ts';

// ── Cordis 插件元数据 ──
export const name = 'im-qqbot';
export const inject = ['agents'];
export const Config = ConfigSchema;

export type { ImQQBotConfig } from './config.ts';

// ── 插件主体 ──
export async function apply(ctx: Context, config: ImQQBotConfig): Promise<void> {
  const agents = (ctx as unknown as Record<string, unknown>).agents as DshAgentRegistry;
  const logger: Logger = ((ctx as unknown as Record<string, unknown>).logger as Logger) ?? console;

  let appId = resolveEnv(config.appId, 'QQBOT_APPID');
  let appSecret = resolveEnv(config.appSecret, 'QQBOT_SECRET');

  // ── 凭据缺失时唤起扫码绑定（bots[] 已有凭据则不触发） ──
  if ((!appId || !appSecret) && (config.bots ?? []).length === 0) {
    logger.info('凭据未配置，启动扫码绑定...');

    // 关键：不 await 扫码结果。boot 会等 Loader 树稳定（loader.await()），
    // 无限期等待用户扫码会阻塞 Host ready——Desktop 界面无法进入、
    // Web 的 URL 延迟输出。绑定编排（路由/呈现/生命周期）在
    // ensureCredentials 的同步阶段即完成，凭据就绪后由异步链接管。
    void ensureCredentials(ctx, { logger, config: { ...config } })
      .then((credentials): void => {
        if (!credentials) {
          // null 包括：扫码取消、手动提交（已另行持久化）、流程失败
          logger.info('扫码绑定流程结束（未获取凭据或已手动配置）');
          return;
        }

        // 持久化到 profile：成功则等待热更新重载，失败则用凭据直接启动。
        // 注意：不写入 process.env——resolveEnv 的 env 回退属于用户显式
        // export 的配置语义，运行时写入会与解绑清理不对齐（解绑后 HMR
        // 重载的新 fiber 仍从 env 读到旧凭据，状态停留 bound）
        const persisted = persistCredentialsToProfile(credentials, getProfileDir() ?? undefined, logger);
        if (persisted) {
          // 写入 cordis.patch.yml 会触发 dsh 热更新，自动重新加载本插件。
          logger.info('配置已保存，等待热更新重新加载...');
          return;
        }
        logger.warn('凭据未能持久化，本次进程将使用环境变量凭据启动（重启后需重新绑定）');
        // 本 fiber 已激活（ctx 有效），直接以凭据启动网关
        void bootstrapGateway(ctx, agents, {
          ...config,
          appId: credentials.appId,
          appSecret: credentials.appSecret,
        }, logger).catch((err: unknown) => {
          logger.error(`网关启动失败: ${err instanceof Error ? err.message : String(err)}`);
        });
      })
      .catch((err: unknown) => {
        // 全兜：unhandled rejection 会被宿主 fail-loud 判致命
        logger.error(`扫码绑定流程异常: ${err instanceof Error ? err.message : String(err)}`);
      });

    // apply 立即完成，插件 fiber 进入 ACTIVE，Host ready 不再被阻塞
    return;
  }

  // 已绑定：注册常驻路由（状态回显 + 手动编辑/更换凭据 + 配置编辑）
  registerBoundCredentialRoutes(ctx, logger, appId, { ...config });

  const resolvedConfig: ImQQBotConfig = { ...config, appId, appSecret };

  // ── 多 bot 装配：legacy 单字段在前，bots[] 追加（去重）──
  // 单条目时行为与历史完全一致（无命名空间、primary 全局注册）；
  // ≥2 时进入多实例模式：per-appId 状态命名空间 + 全局注册仅首位执行。
  const identities = resolveBotIdentities(resolvedConfig);
  if (identities.length === 0) {
    logger.error('无可用的 QQ Bot 凭据（appId/appSecret 或 bots[]），插件未启动');
    return;
  }
  if (identities.length > 1) {
    logger.info(`multi-bot mode: launching ${identities.length} bots (${identities.map((b) => b.appId).join(', ')})`);
  }
  for (const [i, bot] of identities.entries()) {
    await bootstrapGateway(ctx, agents, {
      ...resolvedConfig,
      appId: bot.appId,
      appSecret: bot.appSecret,
      multiBot: identities.length > 1,
      primaryBot: i === 0,
    }, logger);
  }
}
