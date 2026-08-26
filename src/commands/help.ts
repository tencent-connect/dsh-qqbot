/**
 * /bot-help — 查看所有指令，按「通用能力 / QQBot 特有」分组展示
 *
 * 通用能力：对应底层 dsh agent 能力（new/compact/model/stop），无前缀
 * QQBot 特有：插件自身封装（bot-ping/bot-version/bot-status/bot-help），带 bot- 前缀
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import { sendMarkdownChunked, PLUGIN_VERSION } from '../shared/index.ts';

/** /bot-help — 分组查看所有指令 */
export function helpCommand(
  { config }: CommandDeps,
  allCommands: () => CategorizedCommand[],
): CategorizedCommand {
  return {
    name: 'bot-help',
    category: 'qqbot',
    description: '查看所有指令',
    handler: async (cmdCtx) => {
      const agentCmds: CategorizedCommand[] = [];
      const qqbotCmds: CategorizedCommand[] = [];
      for (const cmd of allCommands()) {
        if (cmd.hidden) continue;
        (cmd.category === 'agent' ? agentCmds : qqbotCmds).push(cmd);
      }

      const render = (cmds: CategorizedCommand[]): string[] => {
        const out: string[] = [];
        for (const cmd of cmds) {
          const name = Array.isArray(cmd.name) ? cmd.name[0] : cmd.name;
          out.push(`<qqbot-cmd-input text="/${name}" show="/${name}"/> ${cmd.description ?? ''}`);
        }
        return out;
      };

      const lines: string[] = ['### 🤖 QQBot 指令', ''];

      if (agentCmds.length > 0) {
        lines.push('**通用能力**', '', ...render(agentCmds), '');
      }
      if (qqbotCmds.length > 0) {
        lines.push('**插件内置指令**', '', ...render(qqbotCmds), '');
      }

      lines.push('', `> dsh-qqbot v${PLUGIN_VERSION}`);
      await sendMarkdownChunked(cmdCtx, lines.join('\n'), config.textChunkLimit);
      return { kind: 'noop' as const };
    },
  };
}
