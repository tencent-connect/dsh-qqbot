/**
 * 模型命令：/model — 查看或切换模型
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import { getScopePeer, sendMarkdownChunked } from '../shared/index.ts';

export function modelCommand({ manager, config }: CommandDeps): CategorizedCommand {
  return {
    name: 'model',
    category: 'agent',
    description: '查看或切换模型（用法: /model [provider/model]）',
    handler: async (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      const args = (cmdCtx.command?.raw ?? '').trim();

      // 无参数：显示当前模型 + 可用模型列表（可点击）
      if (!args) {
        const current = manager.getEffectiveModel(scope, peerId);
        const models = await manager.listAvailableModels();

        // 当前模型展示：优先用别名（name），找不到别名时回退到 provider/model id
        let currentDisplay = '宿主默认配置';
        if (current) {
          const matched = models.find((m) => m.provider === current.provider && m.id === current.model);
          currentDisplay = matched?.name ?? `${current.provider}/${current.model}`;
        }

        const lines: string[] = [
          '### 🤖 模型配置',
          '',
          `**当前模型:** ${currentDisplay}`,
        ];

        if (models.length > 0) {
          lines.push('', '**可用模型（点击切换）:**');
          for (const m of models) {
            const modelPath = `${m.provider}/${m.id}`;
            const displayName = m.name ? `${m.name}` : modelPath;
            lines.push(`<qqbot-cmd-input text="/model ${modelPath}" show="/model ${displayName}"/>`);
          }
        }

        lines.push('', '手动指定: `/model provider/model`');

        await sendMarkdownChunked(cmdCtx, lines.join('\n'), config.textChunkLimit);
        return { kind: 'noop' as const };
      }

      // 解析 provider/model 格式
      let provider: string;
      let model: string;

      if (args.includes('/')) {
        const parts = args.split('/');
        provider = parts[0] ?? '';
        model = parts.slice(1).join('/');
      } else {
        // 仅指定 model 名，provider 从当前路由继承
        const current = manager.getEffectiveModel(scope, peerId);
        provider = current?.provider ?? 'deepseek-official';
        model = args;
      }

      if (!provider || !model) {
        return '用法: /model provider/model\n示例: /model deepseek-official/deepseek-v4-flash';
      }

      await manager.setModelOverride(scope, peerId, { provider, model });
      return `✅ 模型已切换: ${provider}/${model}\n立即生效，对话上下文保留。`;
    },
  };
}
