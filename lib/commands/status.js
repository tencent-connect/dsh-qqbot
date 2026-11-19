import { getScopePeer, formatRelativeTime } from "../shared/index.js";
import { reasoningLabel } from "./effort.js";
/** /bot-status — 查看当前会话状态 */
export function statusCommand({ manager }) {
    return {
        name: 'bot-status',
        category: 'qqbot',
        scope: 'all',
        description: '查看当前会话状态',
        handler: async (cmdCtx) => {
            const { scope, peerId } = getScopePeer(cmdCtx);
            const status = manager.getStatus(scope, peerId);
            if (!status)
                return '当前无活跃会话';
            const { selection } = status;
            const reasoning = selection ? await manager.resolveReasoning(selection).catch(() => undefined) : undefined;
            return [
                '📊 会话状态',
                `会话: ${status.sessionId.slice(0, 8)}`,
                `模型: ${selection ? `${selection.provider}/${selection.model}` : '宿主默认'}`,
                `推理强度: ${reasoningLabel(selection?.reasoningEffort, reasoning?.defaultEffort)}`,
                `Preset: ${status.preset ?? '无'}`,
                `生成状态: ${status.running ? '正在生成' : '空闲'}`,
                `排队消息: ${status.queued ?? '暂无数据'}`,
                `上下文占用: ${status.contextOccupancy === undefined ? '暂无数据' : `约 ${status.contextOccupancy}%`}`,
                `消息数: ${status.messageCount}`,
                `最后活动: ${formatRelativeTime(status.lastActivity)}`,
            ].join('\n');
        },
    };
}
//# sourceMappingURL=status.js.map