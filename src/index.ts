/** QQ Bot transport plugin for DeepSeek Harness. */
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { ConfigSchema, type ImQQBotConfig } from './config.ts';
import type { DshAgentRegistry } from './session/index.ts';
import { getProfileDir, resolveEnv } from './shared/index.ts';
import { ensureCredentials, persistCredentialsToProfile, registerBoundCredentialRoutes } from './setup/index.ts';
import { ensureVisionInputModal, registerDescribeImageTool } from './media/vision-tool.ts';
import { RobotConfigStore } from './runtime/robot-config.ts';
import { RobotRuntimes } from './runtime/robot-runtimes.ts';
import { registerWorkbenchDefaults, registerWorkbenchRoutes, registerWorkbenchTools } from './runtime/workbench-routes.ts';
import { registerWorkbenchConversations } from './runtime/workbench-conversations.ts';
import type { Logger } from './types.ts';

export const name = 'im-qqbot';
export const inject = ['agents'];
export const Config = ConfigSchema;

export type { ImQQBotConfig } from './config.ts';

export async function apply(ctx: Context, config: ImQQBotConfig): Promise<void> {
  const services = ctx as unknown as Record<string, unknown>;
  const agents = services.agents as DshAgentRegistry;
  const logger = (services.logger as Logger | undefined) ?? console;
  const profileDir = getProfileDir() ?? undefined;
  const store = profileDir ? new RobotConfigStore(join(profileDir, 'qqbot-robots.json')) : undefined;
  const robots = new RobotRuntimes(ctx, agents, logger, store);
  registerWorkbenchRoutes(ctx, () => robots.list(), patch => robots.save(patch));
  registerWorkbenchDefaults(ctx, robots);
  registerWorkbenchTools(ctx);
  registerWorkbenchConversations(ctx, robots, logger);

  const appId = resolveEnv(config.appId, 'QQBOT_APPID');
  const appSecret = resolveEnv(config.appSecret, 'QQBOT_SECRET');
  if (appId && appSecret) {
    registerBoundCredentialRoutes(ctx, logger, appId, { ...config });
    robots.bindPrimary({ ...config, appId, appSecret });
    ensureVisionInputModal(config.vision, logger);
    registerDescribeImageTool(ctx, config.vision, logger);
    await robots.start();
    return;
  }

  // Host readiness must not wait for a QR scan.
  void ensureCredentials(ctx, { logger, config: { ...config } }).then(async credentials => {
    if (!credentials) return;
    if (!persistCredentialsToProfile(credentials, profileDir, logger)) {
      logger.warn('凭据未能持久化，本次进程将直接启动网关（重启后需重新绑定）');
      robots.bindPrimary({ ...config, ...credentials });
      await robots.start();
    }
  }).catch((err: unknown) => {
    logger.error(`扫码绑定流程异常: ${err instanceof Error ? err.message : String(err)}`);
  });
  await robots.start();
}
