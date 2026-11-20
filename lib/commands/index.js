import { newCommand, compactCommand, unarchiveCommand } from "./session.js";
import { modelCommand } from "./model.js";
import { effortCommand } from "./effort.js";
import { presetCommand } from "./preset.js";
import { statusCommand } from "./status.js";
import { helpCommand } from "./help.js";
import { pingCommand, versionCommand, stopCommand, meCommand } from "./misc.js";
/**
 * 构建标准命令列表
 */
export function buildCommandList(deps) {
    const commands = [
        // 通用能力（底层 agent）
        newCommand(deps),
        unarchiveCommand(deps),
        compactCommand(deps),
        modelCommand(deps),
        effortCommand(deps),
        presetCommand(deps),
        stopCommand(deps),
        // QQBot 特有
        pingCommand(),
        versionCommand(deps),
        meCommand(deps),
        statusCommand(deps),
    ];
    // help 需要访问完整列表（含自身），通过闭包惰性引用
    commands.push(helpCommand(deps, () => commands));
    for (const command of commands) {
        const original = command.handler;
        command.handler = ctx => {
            const service = deps.manager.accountAccess;
            const error = service ? service.commandAccessError(ctx.message.senderId) : '斜杠命令服务尚未就绪。';
            return error ? Promise.resolve(error) : original(ctx);
        };
    }
    return commands;
}
export function describeCommands(deps) {
    const { commandMode } = deps.manager.accountAccess?.currentAccess() ?? deps.config.access;
    const scope = commandMode === 'open' ? 'all' : commandMode === 'disabled' ? 'disabled' : 'owner';
    return buildCommandList(deps).map((command) => {
        const names = Array.isArray(command.name) ? command.name : [command.name];
        return {
            name: names[0] ?? '',
            aliases: names.slice(1),
            description: command.description ?? '',
            category: command.category,
            scope,
            ...(command.hidden === true ? { hidden: true } : {}),
        };
    }).filter((descriptor) => descriptor.name !== '');
}
//# sourceMappingURL=index.js.map