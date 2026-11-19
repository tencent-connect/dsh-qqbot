/** QQ Bot transport plugin for DeepSeek Harness. */
import { join } from 'node:path';
import { ConfigSchema } from "./config.js";
import { getProfileDir, resolveEnv } from "./shared/index.js";
import { ensureCredentials, persistCredentialsToProfile, registerBoundCredentialRoutes } from "./setup/index.js";
import { BindingService } from "./setup/binding-service.js";
import { ensureVisionInputModal, registerDescribeImageTool } from "./media/vision-tool.js";
import { RobotConfigStore } from "./runtime/robot-config.js";
import { RobotRuntimes } from "./runtime/robot-runtimes.js";
import { WorkbenchRequestError, registerWorkbenchDefaults, registerWorkbenchGroupGuideImages, registerWorkbenchPromptFiles, registerWorkbenchRobotBinding, registerWorkbenchRobotRemoval, registerWorkbenchRoutes, registerWorkbenchTools } from "./runtime/workbench-routes.js";
import { registerWorkbenchConversations, registerWorkbenchSend, workbenchTimelineService } from "./runtime/workbench-conversations.js";
import { registerWorkbenchAnswer } from "./runtime/workbench-answer.js";
import { registerWorkbenchExtensionSettings, WorkbenchExtensionSettings } from "./runtime/workbench-extension-settings.js";
import { dataDirectory, lockDataDirectories, profileDataDirectory, QqDataDirectoryBusy } from "./runtime/data-directory.js";
export const name = 'im-qqbot';
export const inject = ['agents'];
export const Config = ConfigSchema;
export async function apply(ctx, config) {
    const services = ctx;
    const agents = services.agents;
    const logger = services.logger ?? console;
    const profileDir = getProfileDir() ?? undefined;
    const directory = dataDirectory(profileDir);
    let release;
    try {
        release = lockDataDirectories(profileDir ? [directory, profileDataDirectory(profileDir)] : [directory]);
    }
    catch (error) {
        const message = error instanceof QqDataDirectoryBusy ? error.message : '无法打开 QQ 机器人数据目录，请检查目录权限。';
        logger.warn(message);
        registerWorkbenchRoutes(ctx, () => { throw new WorkbenchRequestError(503, message); });
        return;
    }
    let robots;
    ctx.effect(() => async () => {
        try {
            await robots?.close();
        }
        finally {
            release();
        }
    });
    const store = profileDir ? new RobotConfigStore(join(directory, 'qqbot-robots.json')) : undefined;
    const runtime = robots = new RobotRuntimes(ctx, agents, logger, store, directory);
    const timeline = workbenchTimelineService(runtime);
    const settings = new WorkbenchExtensionSettings(join(directory, 'qqbot-workbench-extension-settings.json'));
    const qqbot = {
        ...timeline,
        registerSettings: definition => settings.registerSettings(definition),
        getSettings: (id, scope) => settings.getSettings(id, scope),
    };
    ctx.provide('qqbot', qqbot);
    registerWorkbenchExtensionSettings(ctx, settings, appId => runtime.list().some(robot => robot.appId === appId));
    registerWorkbenchRoutes(ctx, () => runtime.list(), patch => runtime.save(patch));
    if (profileDir)
        registerWorkbenchRobotRemoval(ctx, (appId, revision, mode, binding) => runtime.remove(appId, revision, profileDir, mode, binding));
    if (store)
        registerWorkbenchRobotBinding(ctx, patch => runtime.save(patch), () => new BindingService({ source: 'dsh-qqbot', logger }), (appId, openId) => runtime.cachedScannerNickname(appId, openId));
    registerWorkbenchDefaults(ctx, runtime);
    registerWorkbenchGroupGuideImages(ctx);
    registerWorkbenchTools(ctx);
    registerWorkbenchPromptFiles(ctx);
    registerWorkbenchConversations(ctx, runtime, logger, timeline);
    registerWorkbenchSend(ctx, runtime);
    registerWorkbenchAnswer(ctx, runtime);
    const appId = resolveEnv(config.appId, 'QQBOT_APPID');
    const appSecret = resolveEnv(config.appSecret, 'QQBOT_SECRET');
    if (appId && appSecret) {
        await runtime.prepareLegacy(appId);
        if (!runtime.active)
            return;
        runtime.bindPrimary({ ...config, appId, appSecret });
        registerBoundCredentialRoutes(ctx, logger, appId, { ...config }, profileDir ? {
            boundAppId: () => runtime.list().some(robot => robot.primary && robot.appId === appId) ? appId : null,
            onUnbind: () => {
                try {
                    const robot = runtime.list().find(entry => entry.primary && entry.appId === appId);
                    if (robot === undefined)
                        return { persisted: false, error: '当前未绑定' };
                    runtime.remove(appId, robot.revision, profileDir);
                    return { persisted: true };
                }
                catch (error) {
                    return { persisted: false, error: error instanceof Error ? error.message : '解绑失败' };
                }
            },
            onManualCredentials: credentials => {
                if (credentials.appId !== appId)
                    return { persisted: false, error: '更换凭据只适用于当前机器人。请通过添加机器人绑定其他 AppID。' };
                if (!runtime.list().some(robot => robot.primary && robot.appId === appId)) {
                    return { persisted: false, error: '此机器人已解绑，请刷新设置。' };
                }
                return { persisted: persistCredentialsToProfile(credentials, profileDir, logger) };
            },
        } : {});
        ensureVisionInputModal(config.vision, logger);
        registerDescribeImageTool(ctx, config.vision, logger);
        await runtime.start();
        return;
    }
    // Host readiness must not wait for a QR scan.
    const prepareBinding = (appId) => runtime.prepareBinding(appId);
    void ensureCredentials(ctx, { logger, config: { ...config }, prepareBinding }).then(async (credentials) => {
        if (!credentials || !runtime.active)
            return;
        prepareBinding(credentials.appId);
        if (!persistCredentialsToProfile(credentials, profileDir, logger)) {
            logger.warn('凭据未能持久化，本次进程将直接启动网关（重启后需重新绑定）');
            await runtime.prepareLegacy(credentials.appId);
            if (!runtime.active)
                return;
            runtime.bindPrimary({ ...config, ...credentials });
            await runtime.start();
        }
    }).catch((err) => {
        logger.error(`扫码绑定流程异常: ${err instanceof Error ? err.message : String(err)}`);
    });
    await runtime.start();
}
//# sourceMappingURL=index.js.map