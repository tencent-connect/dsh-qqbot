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
/** Menus and mutations share the service's authorization range. */
export function selectionMenuAccess(deps, scope, peerId, actor, kind) {
    const service = deps.manager.conversations;
    const allowed = service?.allowedSelections(scope, peerId, kind);
    return {
        editable: !service || deps.origin === 'web-owner' || service.canManage(scope, peerId, actor),
        allows: (value) => !allowed || allowed.includes(value),
    };
}
//# sourceMappingURL=auth.js.map