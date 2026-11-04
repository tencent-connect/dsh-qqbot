const DENIED = '⚠️ 无权限执行此命令';
/** 构造命令白名单鉴权回调 */
export function commandAllowlistAuth(config, logger) {
    return (ctx) => {
        if (config.access.c2cMode !== 'allowlist')
            return true;
        const senderId = ctx.message.senderId;
        if (!senderId || !config.access.c2cAllow.includes(senderId)) {
            logger?.warn(`im-qqbot: command auth denied: sender=${senderId ?? '(missing)'}`);
            return DENIED;
        }
        return true;
    };
}
/** Applies after conversation admission and also guards direct command-handler calls. */
export function commandAccessError(mode, senderId, allowed) {
    if (mode === 'disabled')
        return 'QQ 斜杠命令已关闭。';
    if (!senderId)
        return '无法确认发送者身份，不能执行斜杠命令。';
    if (mode === undefined || mode === 'open')
        return undefined;
    if (mode === 'allowlist' && allowed)
        return undefined;
    return '你不在斜杠命令白名单中，请联系机器人管理者。';
}
//# sourceMappingURL=auth.js.map