/**
 * 命令依赖类型
 *
 * 每个命令工厂函数接收 CommandDeps，由 commands/index.ts 统一注入。
 */
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { SessionManager } from '../session/index.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import type { MediaSenderLike } from '../media/send-media.ts';

export interface CommandDeps {
  manager: SessionManager;
  config: ImQQBotConfig;
  logger?: Logger;
  /**
   * 附件发送器取值函数（/sendfile 用）。
   *
   * 命令在中间件装配阶段注册，而发送器要等出站适配器构造完成才存在，故注入
   * 取值函数、命令执行时再解析；取不到时命令自行降级为提示。
   */
  getMediaSender?: () => MediaSenderLike | undefined;
}

/** 命令分类：agent = 底层 agent 通用能力，qqbot = 插件特有 */
export type CommandCategory = 'agent' | 'qqbot';

/** 带分类的斜杠命令（category 供 help 分组展示，SDK 忽略未知字段） */
export interface CategorizedCommand extends SlashCommand {
  category: CommandCategory;
}
