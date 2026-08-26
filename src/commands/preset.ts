/**
 * Preset 命令：/preset — 查看或切换 agent preset
 *
 * 无参数列出可用 preset（可点击切换），有参数切换，reset/default 重置为默认。
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import { getScopePeer, sendMarkdownChunked } from '../shared/index.ts';

export function presetCommand({ manager, config }: CommandDeps): CategorizedCommand {
  return {
    name: 'preset',
    category: 'agent',
    description: '查看或切换 agent preset（用法: /preset [id]）',
    handler: async (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      const args = (cmdCtx.command?.raw ?? '').trim();

      // 无参数：列出可用 preset + 当前
      if (!args) {
        const presets = await manager.listPresets();
        if (presets.length === 0) {
          return '当前部署无可用的 agent preset';
        }

        const record = manager.getSessionRecord(scope, peerId);
        const currentId = record?.agentPreset ?? manager.getEffectivePreset(scope, peerId);

        const lines: string[] = ['### 🧩 Agent Preset', ''];
        lines.push(`**当前:** ${currentId ?? '默认'}`);
        lines.push('', '**可用 preset（点击切换）:**');
        for (const p of presets) {
          const display = p.name ? `${p.name} (${p.id})` : p.id;
          lines.push(`<qqbot-cmd-input text="/preset ${p.id}" show="/preset ${display}"/>`);
        }
        lines.push('', '手动指定: `/preset <id>`，重置默认: `/preset reset`');

        await sendMarkdownChunked(cmdCtx, lines.join('\n'), config.textChunkLimit);
        return { kind: 'noop' as const };
      }

      // reset / default：清除 per-peer 覆盖，回到默认
      if (args === 'reset' || args === 'default') {
        const outcome = await manager.clearPresetOverride(scope, peerId);
        return outcome.ok ? '✅ 已重置为默认 preset（新会话生效）' : '重置失败';
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

      return `✅ preset 已切换: ${args}\n新会话生效（当前会话保持原 preset，发送 /new 后生效）。`;
    },
  };
}
