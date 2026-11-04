import type { SlashCommandDescriptor } from '../shared/conversation-protocol.ts';
/**
 * 斜杠命令注册中心
 *
 * 每个命令拆分为独立文件，此处仅编排。工厂函数注入依赖，统一导出命令列表。
 *
 * 命令按 category 分两类：
 *   - agent：底层 dsh agent 通用能力（new/compact/model/stop）
 *   - qqbot：插件自身特有（ping/version/status/help）
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import { newCommand, compactCommand } from './session.ts';
import { modelCommand } from './model.ts';
import { presetCommand } from './preset.ts';
import { statusCommand } from './status.ts';
import { helpCommand } from './help.ts';
import { pingCommand, versionCommand, stopCommand, meCommand } from './misc.ts';

/**
 * 构建标准命令列表
 */
export function buildCommandList(deps: CommandDeps): CategorizedCommand[] {
  const commands: CategorizedCommand[] = [
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
    command.handler = ctx => {
      const service = deps.manager.conversations;
      const error = service ? service.commandAccessError(ctx.message.senderId) : '斜杠命令服务尚未就绪。';
      return error ? Promise.resolve(error) : original(ctx);
    };
  }
  return commands;
}
export function describeCommands(deps: CommandDeps): SlashCommandDescriptor[] {
  return buildCommandList(deps).map((command): SlashCommandDescriptor => {
    const names = Array.isArray(command.name) ? command.name : [command.name];
    return {
      name: names[0] ?? '',
      aliases: names.slice(1),
      description: command.description ?? '',
      category: command.category,
      scope: (deps.config.access.commandMode ?? 'open') === 'open' ? 'all' : deps.config.access.commandMode === 'disabled' ? 'disabled' : 'owner',
      ...(command.hidden === true ? { hidden: true } : {}),
    };
  }).filter((descriptor) => descriptor.name !== '');
}
