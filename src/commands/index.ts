/**
 * 斜杠命令注册中心
 *
 * 每个命令拆分为独立文件，此处仅编排。工厂函数注入依赖，统一导出命令列表。
 *
 * 命令按 category 分两类：
 *   - agent：底层 dsh agent 通用能力（new/compact/model/stop）
 *   - qqbot：插件自身特有（ping/version/status/help）
 */
import type { CommandDeps, CategorizedCommand } from './types.js';
import { newCommand, compactCommand } from './session.js';
import { modelCommand } from './model.js';
import { presetCommand } from './preset.js';
import { statusCommand } from './status.js';
import { helpCommand } from './help.js';
import { pingCommand, versionCommand, stopCommand } from './misc.js';

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
    statusCommand(deps),
  ];

  // help 需要访问完整列表（含自身），通过闭包惰性引用
  commands.push(helpCommand(deps, () => commands));

  return commands;
}
