export { parseStreamFrame } from "./events.js";
/** Only a fully settled, verified turn may create an automatic QQ delivery. */
export function createOutboundHandler(manager, _sender, _config, logger, _toolsRegistry, _deliverer) {
    return {
        routeSessionEvent(session, event) {
            void manager.conversations?.observeSessionEvent(session.header.id, event.type, event.data, event.seq)
                .catch(() => logger.warn(`QQ native event was not confirmed: ${session.header.id} ${event.type}`));
        },
        routeStreamFrame() { },
    };
}
//# sourceMappingURL=outbound.js.map