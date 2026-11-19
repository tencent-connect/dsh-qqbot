import { getScopePeer, PLUGIN_VERSION, sendMarkdownChunked } from "../shared/index.js";
/** /bot-ping — 测试当前 dsh 与 QQ 连接的网络延迟 */
export function pingCommand() {
    return {
        name: 'bot-ping',
        category: 'qqbot',
        scope: 'all',
        description: '测试当前 dsh 与 QQ 连接的网络延迟',
        usage: [
            '/bot-ping',
            '',
            '测试 dsh 主机与 QQ 服务器之间的网络延迟。',
            '返回网络传输耗时和插件处理耗时。',
        ].join('\n'),
        handler: (ctx) => {
            const now = Date.now();
            const ts = ctx.message.timestamp;
            const eventTime = ts ? new Date(ts).getTime() : NaN;
            if (Number.isNaN(eventTime)) {
                return '✅ pong!';
            }
            const totalMs = now - eventTime;
            const qqToPlugin = ctx.receivedAt - eventTime;
            const pluginProcess = now - ctx.receivedAt;
            return [
                '✅ pong！',
                `⏱ 延迟: ${totalMs}ms`,
                `  ├ 网络传输: ${qqToPlugin}ms`,
                `  └ 插件处理: ${pluginProcess}ms`,
            ].join('\n');
        },
    };
}
/** /bot-version — 查看版本信息 */
export function versionCommand({ manager }) {
    return {
        name: 'bot-version',
        category: 'qqbot',
        scope: 'all',
        description: '查看版本信息',
        handler: () => {
            const current = manager.getEffectiveModel('c2c', '');
            const modelInfo = current ? `${current.provider}/${current.model}` : '宿主默认';
            return `dsh-qqbot v${PLUGIN_VERSION} | model: ${modelInfo}`;
        },
    };
}
/**
 * /bot-me — 查看发送者身份标识
 *
 * 私聊返回 user openid、群聊返回群成员 openid 与群 openid
 * （分别对应 access.c2cAllow / groupAllow 的名单 key）。
 */
export function meCommand({ config }) {
    return {
        name: 'bot-me',
        category: 'qqbot',
        scope: 'all',
        description: '查看你的 OpenID',
        handler: async (cmdCtx) => {
            const senderId = cmdCtx.message.senderId ?? 'unknown';
            const lines = [`🆔 你的 OpenID：**${senderId}**`];
            if (cmdCtx.message.groupOpenid) {
                lines.push(`👥 本群 OpenID：**${cmdCtx.message.groupOpenid}**`);
            }
            await sendMarkdownChunked(cmdCtx, lines.join('\n'), config.textChunkLimit);
            return { kind: 'noop' };
        },
    };
}
/** /stop — 中止当前生成 */
export function stopCommand({ manager }) {
    return {
        name: 'stop',
        category: 'agent',
        scope: 'all',
        description: '中止当前生成',
        handler: (cmdCtx) => {
            const { scope, peerId } = getScopePeer(cmdCtx);
            const record = manager.getSessionRecord(scope, peerId);
            // 会话存在不等于正在生成：只有 agent 处于 running 才算有进行中的回复
            if (record === undefined || record.agent.status !== 'running') {
                return '当前没有进行中的生成';
            }
            // cancel 会让当前轮以 turn/end (kind=interrupted) 收尾，
            // 出站侧据此 flush 已生成的文本并关闭流式会话。
            record.agent.cancel({ kind: 'user' });
            return '已中止 ⛔';
        },
    };
}
//# sourceMappingURL=misc.js.map