/**
 * 模型命令：/model — 查看或切换模型
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import { commandAllowlistAuth, selectionMenuAccess } from './auth.ts';
import { getScopePeer, sendMarkdownChunked } from '../shared/index.ts';
import type { ModelEntry, ModelRoute } from '../model/types.ts';
import type { ChatScope } from '../types.ts';

function currentModel(manager: CommandDeps['manager'], scope: ChatScope, peerId: string): ModelRoute | undefined {
  const status = manager.getStatus(scope, peerId);
  return status.active && status.provider && status.model
    ? { provider: status.provider, model: status.model }
    : manager.getEffectiveModel(scope, peerId);
}

export function modelCommand({ manager, config, logger, origin }: CommandDeps): CategorizedCommand {
  return {
    name: 'model',
    category: 'agent',
    // 管理类指令：私聊/群聊均可用，但仅限白名单用户（与 /preset 同构）
    scope: 'all',
    authorized: commandAllowlistAuth(config, logger),
    description: '查看或切换当前会话模型（/model provider/model，/model reset 恢复网页默认）',
    handler: async (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      const args = (cmdCtx.command?.raw ?? '').trim();
      try {
        await manager.restoreExisting(scope, peerId, {
          senderId: cmdCtx.message.senderId,
          replyTarget: { scope, targetId: peerId, msgId: cmdCtx.message.messageId },
        });
      } catch (error) {
        return `无法恢复当前会话：${error instanceof Error ? error.message : String(error)}`;
      }

      // 无参数：显示当前模型 + 可用模型列表（可点击）
      if (!args) {
        let models: ModelEntry[];
        let current: ModelRoute | undefined;
        let defaultRoute: ModelRoute;
        try {
          models = await manager.listAvailableModels();
          current = currentModel(manager, scope, peerId);
          defaultRoute = manager.getDefaultModel();
        } catch (error) {
          return `无法读取模型配置：${error instanceof Error ? error.message : String(error)}`;
        }

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
          `**QQ 网页默认:** ${defaultRoute.provider}/${defaultRoute.model}`,
          '手机命令仅覆盖当前私聊或群聊，不修改网页默认。',
        ];

        const access = selectionMenuAccess({ manager, origin }, scope, peerId, cmdCtx.message.senderId, 'model');
        const options = models.filter(model => access.allows(`${model.provider}/${model.id}`));
        if (options.length > 0) {
          lines.push('', `**本对话允许的模型（${access.editable ? '点击切换' : '只读'}）:**`);
          for (const m of options) {
            const modelPath = `${m.provider}/${m.id}`;
            const displayName = m.name ? `${m.name}` : modelPath;
            lines.push(access.editable ? `<qqbot-cmd-input text="/model ${modelPath}" show="/model ${displayName}"/>` : `${displayName} (${modelPath})`);
          }
        } else {
          lines.push('', '本对话当前没有已授权且可用的模型。');
        }

        const defaultPath = `${defaultRoute.provider}/${defaultRoute.model}`;
        if (!access.editable) lines.push('', '以上仅供查看；只有机器人所有者或此对话控制者可切换模型。');
        else {
          if (access.allows(defaultPath) && models.some(model => `${model.provider}/${model.id}` === defaultPath)) lines.push('', '<qqbot-cmd-input text="/model reset" show="恢复 QQ 网页默认"/>');
          else lines.push('', 'QQ 网页默认当前不可用或未获此对话授权，不能恢复。');
          lines.push('手动指定: `/model provider/model`；`/model reset` 清除当前会话覆盖，仍受本对话授权范围限制。');
        }

        await sendMarkdownChunked(cmdCtx, lines.join('\n'), config.textChunkLimit);
        return { kind: 'noop' as const };
      }

      if (args === 'reset' || args === 'default') {
        try {
          await manager.clearModelOverride(scope, peerId);
          const route = manager.getEffectiveModel(scope, peerId);
          return `✅ 已清除当前会话模型覆盖，恢复 QQ 网页默认${route ? `：${route.provider}/${route.model}` : ''}。\n网页未指定时继承 DSH 默认，对话上下文保留。`;
        } catch (error) {
          return `模型重置失败：${error instanceof Error ? error.message : String(error)}`;
        }
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
        let current: ModelRoute | undefined;
        try {
          current = currentModel(manager, scope, peerId);
        } catch (error) {
          return `无法解析模型提供方：${error instanceof Error ? error.message : String(error)}`;
        }
        provider = current?.provider ?? '';
        model = args;
      }

      if (!provider || !model) {
        return '用法: /model provider/model\n请先使用 /model 查看可用模型。';
      }

      try {
        await manager.setModelOverride(scope, peerId, { provider, model });
        return `✅ 当前会话模型已切换: ${provider}/${model}\n立即生效，对话上下文保留；QQ 网页默认不变。`;
      } catch (error) {
        return `模型切换失败：${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}
