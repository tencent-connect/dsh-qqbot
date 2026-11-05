import { commandAllowlistAuth } from "./auth.js";
import { getScopePeer, sendMarkdownChunked } from "../shared/index.js";
/** 恢复模型默认档的输入词 */
const RESET_WORDS = new Set(['default', 'auto', 'reset', '默认', '自动']);
export function thinkCommand({ manager, config, logger }) {
    return {
        name: ['think', 'effort', 'reasoning', '思考'],
        category: 'agent',
        // 管理类指令：私聊/群聊均可用，但仅限白名单用户（与 /model 同构）
        scope: 'all',
        authorized: commandAllowlistAuth(config, logger),
        description: '查看或调整思考深度（用法: /think [档位|default]）',
        handler: async (cmdCtx) => {
            const { scope, peerId } = getScopePeer(cmdCtx);
            const args = (cmdCtx.command?.raw ?? '').trim().toLowerCase();
            const route = manager.getEffectiveModel(scope, peerId);
            const reasoning = await manager.getReasoningInfo(scope, peerId);
            const modelName = route ? `${route.provider}/${route.model}` : '宿主默认';
            const efforts = reasoning?.efforts ?? [];
            const current = manager.getEffectiveEffort(scope, peerId);
            // 无参数：当前档位 + 可选项
            if (!args) {
                const lines = ['### 🧠 思考深度', '', `**当前模型:** ${modelName}`];
                if (efforts.length === 0) {
                    lines.push('', '当前模型没有公布可调档位（由适配器/提供商默认行为决定）。');
                    await sendMarkdownChunked(cmdCtx, lines.join('\n'), config.textChunkLimit);
                    return { kind: 'noop' };
                }
                const currentLabel = current ?? reasoning?.defaultEffort ?? '适配器默认';
                lines.push(`**当前档位:** ${currentLabel}${current ? '' : '（未手动设置）'}`);
                lines.push('', '**可选档位（点击切换）:**');
                for (const effort of efforts) {
                    const display = effort.name ?? effort.id;
                    const suffix = effort.description ? ` — ${effort.description}` : '';
                    lines.push(`<qqbot-cmd-input text="/think ${effort.id}" show="/think ${display}"/>${suffix}`);
                }
                lines.push('', '手动指定: `/think <档位>`，恢复默认: `/think default`');
                lines.push('> 调整从下一步生效，对话上下文保留。');
                await sendMarkdownChunked(cmdCtx, lines.join('\n'), config.textChunkLimit);
                return { kind: 'noop' };
            }
            const apply = (label, outcome) => {
                if (!outcome.ok) {
                    if (outcome.reason === 'unsupported') {
                        return '⚠️ 当前 dsh 宿主版本不支持动态调整思考深度（需要 0.2.x 及以上）。';
                    }
                    return `切换失败: ${outcome.message ?? '未知错误'}`;
                }
                return outcome.live
                    ? `✅ ${label}\n立即生效（下一步起），对话上下文保留。`
                    : `✅ ${label}\n下次对话开始时生效。`;
            };
            // 恢复默认
            if (RESET_WORDS.has(args)) {
                if (!current)
                    return '当前未手动设置思考深度，已是默认档';
                const outcome = await manager.setEffortOverride(scope, peerId, null);
                return apply('已恢复默认思考深度', outcome);
            }
            // 设置指定档位
            if (efforts.length === 0) {
                return `当前模型不支持调节思考深度\n模型: ${modelName}\n用 /model 换一个公布档位的模型再试`;
            }
            const hit = efforts.find((effort) => effort.id.toLowerCase() === args);
            if (!hit) {
                return `未知档位: ${args}\n当前模型支持的档位: ${efforts.map((effort) => effort.id).join(' / ')}`;
            }
            const outcome = await manager.setEffortOverride(scope, peerId, hit.id);
            return apply(`思考深度已切换: ${hit.name ?? hit.id}${hit.name && hit.name !== hit.id ? ` (${hit.id})` : ''}`, outcome);
        },
    };
}
//# sourceMappingURL=think.js.map