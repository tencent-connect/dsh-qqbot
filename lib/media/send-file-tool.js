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
/** 注册 qqbot_send_file 工具（tools 服务缺失时优雅降级，不阻断插件启动） */
export function registerSendFileTool(ctx, bot, manager, config, logger) {
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
            // Outbound authority belongs to the admitted channel turn, never to a tool-supplied peer.
            const record = exec.agent ? manager.findByAgent(exec.agent) : undefined;
            const authorized = record && manager.conversations ? manager.conversations.interactionRecord(record.sessionId) : undefined;
            if (!record || !authorized)
                throw new Error('当前任务没有向 QQ 外发的资格');
            let replyTarget = authorized.replyTarget;
            if (target !== undefined && target !== '') {
                const selected = parseTarget(target);
                if (!selected || selected.scope !== replyTarget.scope || selected.targetId !== replyTarget.targetId)
                    throw new Error('QQ 文件只能发送到当前获准对话');
            }
            exec.signal?.throwIfAborted();
            // 2. 校验文件 + 路径白名单
            const absPath = resolve(file_path);
            const channelRecord = exec.agent ? manager.findByAgent(exec.agent) : undefined;
            const groupRoots = channelRecord && manager.conversations ? manager.conversations.entry(channelRecord.scope, channelRecord.peerId).policy.resources.sendRoots : [];
            if (!isPathAllowed(absPath, { ...config.sendFile, extraRoots: [...config.sendFile.extraRoots, ...groupRoots] }, cwd)) {
                throw new Error(`qqbot_send_file: file_path 不在允许的目录内: ${absPath}`);
            }
            if (!existsSync(absPath)) {
                throw new Error(`qqbot_send_file: 文件不存在: ${absPath}`);
            }
            // 3. 按扩展名分类发送（与交付物投递共用 send-media 的分发实现）
            const fileName = basename(absPath);
            exec.signal?.throwIfAborted();
            if (!manager.conversations?.interactionRecord(record.sessionId))
                throw new Error('QQ 外发资格已撤销');
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