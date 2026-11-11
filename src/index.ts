/** QQ Bot transport plugin for DeepSeek Harness. */
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { ConfigSchema, type ImQQBotConfig } from './config.ts';
import type { DshAgentRegistry } from './session/index.ts';
import { getProfileDir, PLUGIN_HOME, resolveEnv } from './shared/index.ts';
import { ensureCredentials, persistCredentialsToProfile, registerBoundCredentialRoutes } from './setup/index.ts';
import { ensureVisionInputModal, registerDescribeImageTool } from './media/vision-tool.ts';
import { RobotConfigStore } from './runtime/robot-config.ts';
import { RobotRuntimes } from './runtime/robot-runtimes.ts';
import { registerWorkbenchDefaults, registerWorkbenchGroupGuideImages, registerWorkbenchRoutes, registerWorkbenchTools } from './runtime/workbench-routes.ts';
import { registerWorkbenchConversations, registerWorkbenchSend, workbenchTimelineService } from './runtime/workbench-conversations.ts';
import { registerWorkbenchAnswer } from './runtime/workbench-answer.ts';
import { registerWorkbenchExtensionSettings, WorkbenchExtensionSettings } from './runtime/workbench-extension-settings.ts';
import type { QqbotService } from './shared/workbench-extension.ts';
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
  const timeline = workbenchTimelineService(robots);
  const settings = new WorkbenchExtensionSettings(join(profileDir ?? PLUGIN_HOME, 'qqbot-workbench-extension-settings.json'));
  const qqbot: QqbotService = {
    ...timeline,
    registerSettings: definition => settings.registerSettings(definition),
    getSettings: (id, scope) => settings.getSettings(id, scope),
  };
  ctx.provide('qqbot', qqbot);
  registerWorkbenchExtensionSettings(ctx, settings, appId => robots.list().some(robot => robot.appId === appId));
  registerWorkbenchRoutes(ctx, () => robots.list(), patch => robots.save(patch));
  registerWorkbenchDefaults(ctx, robots);
  registerWorkbenchGroupGuideImages(ctx);
  registerWorkbenchTools(ctx);
  registerWorkbenchConversations(ctx, robots, logger, timeline);
  registerWorkbenchSend(ctx, robots);
  registerWorkbenchAnswer(ctx, robots);

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
