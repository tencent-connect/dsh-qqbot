import { getScopePeer } from "../shared/index.js";
/** /new（别名 /reset /clear）— 开始新会话 */
export function newCommand({ manager }) {
    return {
        name: ['new', 'reset', 'clear'],
        category: 'agent',
        scope: 'all',
        description: '开始新会话（清空上下文）',
        handler: (cmdCtx) => {
            const { scope, peerId } = getScopePeer(cmdCtx);
            void manager.remove(scope, peerId);
            return '已开启新会话 ✓';
        },
    };
}
/**
 * /unarchive（别名 /restore）— 取消当前会话的归档
 *
 * 归档会话的消息会被宿主门禁丢弃（不进会话、模型不跑），在 QQ 里除了开新会话
 * 没有别的出路；这条命令把「去 DSH 手动取消归档」这一步搬到聊天里。
 */
export function unarchiveCommand({ manager }) {
    return {
        name: ['unarchive', 'restore'],
        category: 'agent',
        scope: 'all',
        description: '取消归档当前会话（归档后消息不会被处理）',
        handler: async (cmdCtx) => {
            const { scope, peerId } = getScopePeer(cmdCtx);
            const outcome = await manager.unarchive(scope, peerId);
            switch (outcome) {
                case 'ok':
                    return '✅ 已恢复这条对话，接着说就行。刚才没处理的那条消息需要重发一次。';
                case 'not-archived':
                    return '这条对话没有被归档，直接发消息就能继续。';
                case 'no-session':
                    return '还没有开始过对话，直接发消息就能聊。';
                default:
                    return '⚠️ 没能恢复这条对话。请在 DSH 的「已归档」里恢复它，然后再试。';
            }
        },
    };
}
/** /compact — 原地压缩会话历史 */
export function compactCommand({ manager }) {
    return {
        name: 'compact',
        category: 'agent',
        scope: 'all',
        description: '压缩会话历史（摘要替换旧记录，保留上下文）',
        handler: async (cmdCtx) => {
            const { scope, peerId } = getScopePeer(cmdCtx);
            const msg = cmdCtx.message;
            const outcome = await manager.compact(scope, peerId, {
                senderId: msg.senderId,
                replyTarget: { scope, targetId: peerId, msgId: msg.messageId },
            });
            if (outcome.ok) {
                if (!outcome.shadowed)
                    return '没有可压缩的历史';
                return `✅ 已压缩 ${outcome.shadowed} 条历史记录（约 ${outcome.tokens ?? 0} tokens）`;
            }
            switch (outcome.reason) {
                case 'no-session':
                    return '当前无活跃会话';
                case 'busy':
                    return '正在生成中，无法压缩';
                case 'archived':
                    return '这条对话已归档，暂时不能压缩。先恢复它（/unarchive），或直接开一段新对话（/new）。';
                case 'in-use':
                    return '这条对话正被另一个窗口使用，暂时不能压缩。等那边关掉后再试。';
                case 'unavailable':
                    return '压缩能力不可用（当前会话的 agent preset 未加载 compaction 服务）';
                default:
                    return `压缩失败: ${outcome.message ?? '未知错误'}`;
            }
        },
    };
}
//# sourceMappingURL=session.js.map