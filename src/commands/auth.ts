/** Selection metadata used after the registry's owner check. */
import type { SlashCommandHandlerContext } from '@tencent-connect/qqbot-nodejs';
import type { ChatScope } from '../types.ts';
import type { CommandAuthority, CommandDeps } from './types.ts';

/** Selection commands query without arguments and mutate with an explicit selection. */
export function selectionCommandAuthority(ctx: SlashCommandHandlerContext): CommandAuthority {
  return (ctx.command?.raw ?? '').trim() ? 'manage' : 'query';
}

/** Menus and mutations share the service's authorization range. */
export function selectionMenuAccess(deps: Pick<CommandDeps, 'manager' | 'origin'>, scope: ChatScope, peerId: string, actor: string, kind: 'model' | 'preset') {
  const service = deps.manager.conversations;
  const unrestricted = service
    ? service.entry(scope, peerId).policy.nativeTools !== false || service.selectionUnrestricted(scope, peerId, kind)
    : deps.origin === 'web-owner';
  const allowed = service?.allowedSelections(scope, peerId, kind);
  return {
    editable: deps.origin === 'web-owner' || !!service?.isOwner(actor),
    allows: (value: string): boolean => unrestricted || !!allowed?.includes(value),
  };
}
