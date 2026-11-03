/**
 * Preset 命令：/preset — 查看或切换 agent preset
 *
 * 无参数列出可用 preset（可点击切换），有参数切换，reset/default 重置为默认。
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import { selectionCommandAuthority, selectionMenuAccess } from './auth.ts';
import { getScopePeer, sendMarkdownChunked } from '../shared/index.ts';

export function presetCommand({ manager, config, origin }: CommandDeps): CategorizedCommand {
  return {
    name: 'preset',
    category: 'agent',
    authority: selectionCommandAuthority,
    // 私聊与群聊共用命令入口，由注册中心统一校验机器人超管。
    scope: 'all',
    description: '查看预设；/preset id 或 /preset reset 开始新会话，保留旧历史与工作区',
    handler: async (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      const args = (cmdCtx.command?.raw ?? '').trim();

      // 无参数：列出可用 preset + 当前
      if (!args) {
        const presets = await manager.listPresets();
        const record = await manager.restoreExisting(scope, peerId);
        const nextId = manager.getEffectivePreset(scope, peerId);

        const lines: string[] = ['### 🧩 Agent Preset', ''];
        lines.push(`**当前会话:** ${record ? record.agentPreset ?? '未挂载预设' : '尚未开始'}`);
        lines.push(`**新会话预设:** ${nextId || '继承 DSH 默认'}`);
        const access = selectionMenuAccess({ manager, origin }, scope, peerId, cmdCtx.message.senderId, 'preset');
        const options = presets.filter(preset => access.allows(preset.id));
        lines.push('', `**本对话允许的 preset（${access.editable ? '点击切换' : '只读'}）:**`);
        for (const p of options) {
          const display = p.name ? `${p.name} (${p.id})` : p.id;
          lines.push(access.editable ? `<qqbot-cmd-input text="/preset ${p.id}" show="/preset ${display}"/>` : display);
        }
        if (!options.length) lines.push('本对话当前没有已授权且可用的预设。');
        if (!access.editable) lines.push('', '以上仅供查看；只有机器人超管可切换预设。');
        else lines.push('', '手动指定: `/preset <id>`；`/preset reset` 清除会话覆盖，恢复获授权的 QQ 网页默认。');
        lines.push('空闲时切换或重置预设会开始新会话，不携带旧上下文，保留原会话历史和工作区。');

        await sendMarkdownChunked(cmdCtx, lines.join('\n'), config.textChunkLimit);
        return { kind: 'noop' as const };
      }

      // reset / default：清除 per-peer 覆盖，回到默认
      if (args === 'reset' || args === 'default') {
        const outcome = await manager.clearPresetOverride(scope, peerId);
        return outcome.ok
          ? `✅ 已清除预设覆盖，恢复 QQ 网页默认（网页未指定时继承 DSH 默认）。${outcome.sessionId ? '已开始新会话，原会话历史和工作区保留。' : '新会话将采用此预设。'}`
          : `重置失败: ${outcome.message ?? '未知错误'}`;
      }

      // 切换到指定 preset
      const outcome = await manager.setPresetOverride(scope, peerId, args);
      if (!outcome.ok) {
        switch (outcome.reason) {
          case 'unavailable':
            return '当前部署不支持 agent preset（agentPresets 服务未注入）';
          case 'unknown-preset':
            return `未知 preset: ${args}`;
          case 'broken':
            return `preset ${args} 加载失败: ${outcome.message ?? '未知错误'}`;
          default:
            return `切换失败: ${outcome.message ?? '未知错误'}`;
        }
      }

      return `✅ preset 已设置: ${outcome.presetId ?? args}\n${outcome.sessionId ? '已开始新会话，原会话历史和工作区保留。' : '新会话将采用此预设。'}`;
    },
  };
}
