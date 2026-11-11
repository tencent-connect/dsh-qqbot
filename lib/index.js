/** QQ Bot transport plugin for DeepSeek Harness. */
import { join } from 'node:path';
import { ConfigSchema } from "./config.js";
import { getProfileDir, PLUGIN_HOME, resolveEnv } from "./shared/index.js";
import { ensureCredentials, persistCredentialsToProfile, registerBoundCredentialRoutes } from "./setup/index.js";
import { ensureVisionInputModal, registerDescribeImageTool } from "./media/vision-tool.js";
import { RobotConfigStore } from "./runtime/robot-config.js";
import { RobotRuntimes } from "./runtime/robot-runtimes.js";
import { registerWorkbenchDefaults, registerWorkbenchGroupGuideImages, registerWorkbenchRoutes, registerWorkbenchTools } from "./runtime/workbench-routes.js";
import { registerWorkbenchConversations, registerWorkbenchSend, workbenchTimelineService } from "./runtime/workbench-conversations.js";
import { registerWorkbenchAnswer } from "./runtime/workbench-answer.js";
import { registerWorkbenchExtensionSettings, WorkbenchExtensionSettings } from "./runtime/workbench-extension-settings.js";
export const name = 'im-qqbot';
export const inject = ['agents'];
export const Config = ConfigSchema;
export async function apply(ctx, config) {
    const services = ctx;
    const agents = services.agents;
    const logger = services.logger ?? console;
    const profileDir = getProfileDir() ?? undefined;
    const store = profileDir ? new RobotConfigStore(join(profileDir, 'qqbot-robots.json')) : undefined;
    const robots = new RobotRuntimes(ctx, agents, logger, store);
    const timeline = workbenchTimelineService(robots);
    const settings = new WorkbenchExtensionSettings(join(profileDir ?? PLUGIN_HOME, 'qqbot-workbench-extension-settings.json'));
    const qqbot = {
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
    void ensureCredentials(ctx, { logger, config: { ...config } }).then(async (credentials) => {
        if (!credentials)
            return;
        if (!persistCredentialsToProfile(credentials, profileDir, logger)) {
            logger.warn('凭据未能持久化，本次进程将直接启动网关（重启后需重新绑定）');
            robots.bindPrimary({ ...config, ...credentials });
            await robots.start();
        }
    }).catch((err) => {
        logger.error(`扫码绑定流程异常: ${err instanceof Error ? err.message : String(err)}`);
    });
    await robots.start();
}
//# sourceMappingURL=index.js.map