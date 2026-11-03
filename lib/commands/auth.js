/** Selection commands query without arguments and mutate with an explicit selection. */
export function selectionCommandAuthority(ctx) {
    return (ctx.command?.raw ?? '').trim() ? 'manage' : 'query';
}
/** Menus and mutations share the service's authorization range. */
export function selectionMenuAccess(deps, scope, peerId, actor, kind) {
    const service = deps.manager.conversations;
    const unrestricted = service
        ? service.entry(scope, peerId).policy.nativeTools !== false || service.selectionUnrestricted(scope, peerId, kind)
        : deps.origin === 'web-owner';
    const allowed = service?.allowedSelections(scope, peerId, kind);
    return {
        editable: deps.origin === 'web-owner' || !!service?.isOwner(actor),
        allows: (value) => unrestricted || !!allowed?.includes(value),
    };
}
//# sourceMappingURL=auth.js.map