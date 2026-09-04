/**
 * dsh-im-qqbot — QQ Bot IM channel plugin for deepseek-harness
 *
 * Cordis 插件入口。将 QQ 消息平台作为 dsh 的前端协议驱动。
 * 网关组装（中间件编排 + 事件 + 出站 + 生命周期）见 src/gateway/。
 */
import type { Context } from '@deepseek-ai/cordis';
import { ConfigSchema, resolveBotIdentities, type ImQQBotConfig } from './config.ts';
import { bootstrapGateway } from './gateway/index.ts';
import type { DshAgentRegistry } from './session/index.ts';
import { getProfileDir, resolveEnv } from './shared/index.ts';
import { runQrSetup, persistCredentialsToProfile } from './setup.ts';
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

  console.log('[im-qqbot] apply() called');

  let appId = resolveEnv(config.appId, 'QQBOT_APPID');
  let appSecret = resolveEnv(config.appSecret, 'QQBOT_SECRET');

  // ── 凭据缺失时唤起扫码绑定（bots[] 已有凭据则不触发） ──
  if ((!appId || !appSecret) && (config.bots ?? []).length === 0) {
    logger.info('凭据未配置，尝试扫码绑定...');
    const credentials = await runQrSetup();

    if (!credentials) {
      logger.error('无法获取 QQ Bot 凭据，插件未启动');
      return;
    }

    // 写入环境变量（供热更新后的下次 apply 或本次直接启动读取）
    process.env.QQBOT_APPID = credentials.appId;
    process.env.QQBOT_SECRET = credentials.appSecret;
    appId = credentials.appId;
    appSecret = credentials.appSecret;

    // 持久化到 profile：成功则等待热更新重载，失败则用 env 凭据直接启动
    const persisted = persistCredentialsToProfile(credentials, getProfileDir() ?? undefined, logger);
    if (persisted) {
      // 写入 cordis.patch.yml 会触发 dsh 热更新，自动重新加载本插件。
      // 直接返回，避免与热更新产生竞态。
      logger.info('配置已保存，等待热更新重新加载...');
      return;
    }
    logger.warn('凭据未能持久化，本次进程将使用环境变量凭据启动（重启后需重新绑定）');
  }

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
