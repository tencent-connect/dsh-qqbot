import { newCommand, compactCommand } from "./session.js";
import { modelCommand } from "./model.js";
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
        compactCommand(deps),
        modelCommand(deps),
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
        delete command.authorized;
        const original = command.handler;
        command.handler = ctx => deps.manager.conversations?.isOwner(ctx.message.senderId) ? original(ctx) : Promise.resolve('斜杠命令仅机器人超管可用。');
    }
    return commands;
}
export function describeCommands(deps) {
    return buildCommandList(deps).map((command) => {
        const names = Array.isArray(command.name) ? command.name : [command.name];
        return {
            name: names[0] ?? '',
            aliases: names.slice(1),
            description: command.description ?? '',
            category: command.category,
            scope: 'owner',
            ...(command.hidden === true ? { hidden: true } : {}),
        };
    }).filter((descriptor) => descriptor.name !== '');
}
//# sourceMappingURL=index.js.map