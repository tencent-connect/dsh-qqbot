import { ApiError, type QQBot } from '@tencent-connect/qqbot-nodejs';
import type { QqDisplayNames } from '../runtime/qq-display-names.ts';
import type { ReplyTarget } from '../types.ts';

const RETRY_DELAY_MS = 5 * 60_000;
const GROUP_INFO_NOT_ALLOWED = 11253;

export function createGroupNameLookup(
  api: QQBot['api'], appId: string, names: QqDisplayNames, allowed: (target: ReplyTarget) => boolean,
) {
  const inFlight = new Map<string, Promise<void>>();
  const retryAt = new Map<string, number>();
  let permissionRetryAt = 0;

  return async (openId: string, refresh = false): Promise<void> => {
    const target = { scope: 'group', targetId: openId } as const;
    if (!allowed(target)) return;
    const pending = inFlight.get(openId);
    if (pending) return pending;
    const now = Date.now();
    if (now < permissionRetryAt) return;
    if (!refresh && (names.peer(appId, 'group', openId) || now < (retryAt.get(openId) ?? 0))) return;

    const lookup = (async () => {
      try {
        const info = await api.get(`/v2/groups/${encodeURIComponent(openId)}/info`);
        if (allowed(target) && info && typeof info === 'object' && 'group_openid' in info
          && info.group_openid === openId && 'group_name' in info) {
          names.savePeer(appId, 'group', openId, info.group_name);
        }
      } catch (error) {
        if (error instanceof ApiError && error.bizCode === GROUP_INFO_NOT_ALLOWED) {
          permissionRetryAt = Date.now() + RETRY_DELAY_MS;
        }
      }
    })().finally(() => {
      inFlight.delete(openId);
      if (names.peer(appId, 'group', openId)) retryAt.delete(openId);
      else retryAt.set(openId, Date.now() + RETRY_DELAY_MS);
    });

    inFlight.set(openId, lookup);
    return lookup;
  };
}
