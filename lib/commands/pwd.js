import { getScopePeer } from "../shared/index.js";
export function pwdCommand({ manager }) {
    return {
        name: 'pwd',
        category: 'qqbot',
        scope: 'all',
        description: '显示当前位置（工作区 - 会话名）',
        handler: async (cmdCtx) => {
            const { scope, peerId } = getScopePeer(cmdCtx);
            const header = await manager.currentLocationHeader(scope, peerId);
            if (header === undefined) {
                return '当前无活跃会话；发送消息即开启新会话（可用 /sessions 查看与切换）。';
            }
            return header;
        },
    };
}
//# sourceMappingURL=pwd.js.map