import type { SessionManager } from '../session/index.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import type { QQBotSender } from './outbound-buffer.ts';
import type { ToolsRegistryLike } from './tool-presenter.ts';
import type { DeliverablesDelivererLike } from './deliverables.ts';
import type { RawSessionEvent, StreamDelta } from './events.ts';

export type { QQBotSender } from './outbound-buffer.ts';
export type { ToolsRegistryLike } from './tool-presenter.ts';
export { parseStreamFrame } from './events.ts';

export interface SessionLike { header: { id: string } }
export type OutboundHandler = (session: SessionLike, event: RawSessionEvent) => void;
export interface OutboundHandlers {
  routeSessionEvent: OutboundHandler;
  routeStreamFrame(agentId: string, delta: StreamDelta): void;
}

/** Only a fully settled, verified turn may create an automatic QQ delivery. */
export function createOutboundHandler(
  manager: SessionManager,
  _sender: QQBotSender,
  _config: ImQQBotConfig,
  logger: Logger,
  _toolsRegistry?: ToolsRegistryLike,
  _deliverer?: DeliverablesDelivererLike,
): OutboundHandlers {
  return {
    routeSessionEvent(session, event) {
      void manager.conversations?.observeSessionEvent(session.header.id, event.type, event.data, event.seq)
        .catch(() => logger.warn(`QQ native event was not confirmed: ${session.header.id} ${event.type}`));
    },
    routeStreamFrame() {},
  };
}
