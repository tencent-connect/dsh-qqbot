/**
 * 内置 qqbot_send_file 工具 — 将本地文件发送给 QQ 用户或群。
 *
 *   - 发送目标默认自动定位（exec.agent → SessionManager.findByAgent → replyTarget），
 *     无需模型手动传 openid；显式 target 参数作为覆盖。
 *   - 按扩展名分发到 SDK 的 sendImage / sendVideo / sendVoice / sendFile。
 *   - 路径白名单：默认只允许访问 media 目录 + agent cwd，可开关 + 扩展白名单。
 */
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { isPathAllowed, resolveAgentCwd, sendMediaFile } from "./send-media.js";
/** 工具名（qqbot 前缀避免与其他通道的同名工具冲突） */
export const SEND_FILE_TOOL_NAME = 'qqbot_send_file';
const DESCRIPTION = 'Send a local file (image, video, voice, or generic file) to the QQ user or group '
    + 'of the current conversation. Pass the absolute path of a file that already exists on disk. '
    + 'Use this when the user asks you to deliver a generated file (chart, report, exported data, '
    + 'screenshot, etc.) or to send an existing media/file back to them.';
/** 解析显式 target（"c2c:openid" / "group:openid"），非法返回 undefined */
function parseTarget(input) {
    const idx = input.indexOf(':');
    if (idx <= 0)
        return undefined;
    const scope = input.slice(0, idx);
    const targetId = input.slice(idx + 1);
    if (!targetId || (scope !== 'c2c' && scope !== 'group'))
        return undefined;
    return { scope, targetId };
}
/**
 * 当前会话的发送目标：优先回合投递解析（覆盖桌面恢复、不在会话表里的 agent，
 * 以及主动推送回合），否则回退到会话表里的 replyTarget。
 */
function currentTarget(agent, manager, targets) {
    const agentId = agent?.id;
    if (targets !== undefined && typeof agentId === 'string' && agentId !== '') {
        return targets.targetFor(agentId);
    }
    return manager.findByAgent(agent)?.replyTarget;
}
/** 注册 qqbot_send_file 工具（tools 服务缺失时优雅降级，不阻断插件启动） */
export function registerSendFileTool(ctx, bot, manager, config, logger, targets) {
    const tools = ctx.get('tools');
    if (!tools?.register) {
        logger.warn('im-qqbot: tools 服务不可用，qqbot_send_file 工具未注册');
        return;
    }
    const cwd = resolveAgentCwd(config.cwd);
    const definition = {
        name: SEND_FILE_TOOL_NAME,
        description: DESCRIPTION,
        parameters: {
            type: 'object',
            properties: {
                file_path: {
                    type: 'string',
                    description: 'Absolute path to the local file to send (image/video/voice/generic file).',
                },
                target: {
                    type: 'string',
                    description: 'Optional send target as "c2c:openid" or "group:openid". Omit to send to the current conversation.',
                },
            },
            required: ['file_path'],
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    fileName: { type: 'string' },
                    fileSize: { type: 'integer' },
                    target: { type: 'string' },
                    fileUuid: { type: 'string' },
                    messageId: { type: 'string' },
                },
                required: ['fileName', 'fileSize', 'target', 'fileUuid'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const v = value;
                return [{ type: 'text', text: `已发送 ${v.fileName} → ${v.target}` }];
            },
        },
        async execute(args, exec) {
            const { file_path, target } = args;
            if (typeof file_path !== 'string' || file_path.length === 0) {
                throw new Error('qqbot_send_file: `file_path` must be a non-empty string');
            }
            // 1. 解析发送目标：显式 target > 当前会话（exec.agent → SessionRecord）
            let replyTarget;
            if (target !== undefined && target !== '') {
                replyTarget = parseTarget(target);
                if (replyTarget === undefined) {
                    throw new Error(`qqbot_send_file: target 格式错误，需要 c2c:openid 或 group:openid，收到: ${target}`);
                }
            }
            else if (exec.agent !== undefined) {
                replyTarget = currentTarget(exec.agent, manager, targets);
            }
            if (replyTarget === undefined) {
                throw new Error('qqbot_send_file: 无法确定发送目标，请显式传 target 参数');
            }
            // 2. 校验文件 + 路径白名单
            const absPath = resolve(file_path);
            if (!isPathAllowed(absPath, config.sendFile, cwd)) {
                throw new Error(`qqbot_send_file: file_path 不在允许的目录内: ${absPath}`);
            }
            if (!existsSync(absPath)) {
                throw new Error(`qqbot_send_file: 文件不存在: ${absPath}`);
            }
            // 3. 按扩展名分类发送（与交付物投递共用 send-media 的分发实现）
            const fileName = basename(absPath);
            const result = await sendMediaFile(bot, replyTarget, absPath);
            if (result.outcome === 'missing') {
                throw new Error(`qqbot_send_file: 文件不存在或不可读: ${absPath}`);
            }
            if (result.outcome === 'failed') {
                throw new Error(`qqbot_send_file: 发送失败: ${result.error}`);
            }
            logger.info(`im-qqbot: qqbot_send_file 发送 ${fileName} (${result.size} bytes) → ${replyTarget.scope}:${replyTarget.targetId}`);
            return {
                fileName,
                fileSize: result.size,
                target: `${replyTarget.scope}:${replyTarget.targetId}`,
                fileUuid: result.fileUuid ?? '',
                ...(result.messageId !== undefined ? { messageId: result.messageId } : {}),
            };
        },
    };
    tools.register(definition);
    logger.info('im-qqbot: qqbot_send_file 工具已注册');
}
//# sourceMappingURL=send-file-tool.js.map