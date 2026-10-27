import type { Middleware, MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { GroupHistoryEntry, GroupHistoryStore } from '../features/history-store.ts';

export interface GroupWaitController {
  middleware: Middleware;
  dispose(): void;
}

interface GroupWaitState {
  key: string;
  groupId: string;
  timer: ReturnType<typeof setTimeout> | undefined;
  flushing: boolean;
  generation: number;
  log: MiddlewareContext['log'];
}

export function createGroupWaitController(options: {
  enabled: boolean;
  timeoutMs: number;
  historyLimit: number;
  store: GroupHistoryStore;
  groupKey: (ctx: MiddlewareContext) => string | undefined;
  groupId: (ctx: MiddlewareContext) => string | undefined;
  onTimeout: (groupId: string, entries: GroupHistoryEntry[]) => Promise<void>;
}): GroupWaitController {
  const groups = new Map<string, GroupWaitState>();
  let disposed = false;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(0, options.timeoutMs) : 0;

  const schedule = (state: GroupWaitState): void => {
    if (disposed || state.flushing || state.timer !== undefined) return;
    state.timer = setTimeout(() => {
      state.timer = undefined;
      void flush(state);
    }, timeoutMs);
  };

  const flush = async (state: GroupWaitState): Promise<void> => {
    if (disposed || state.flushing) return;
    state.flushing = true;
    const generation = state.generation;
    try {
      const entries = await options.store.list(state.key, options.historyLimit);
      if (disposed || state.generation !== generation) return;
      if (entries.length === 0) return;

      await options.store.clear?.(state.key);
      if (disposed || state.generation !== generation) return;

      try {
        await options.onTimeout(state.groupId, entries);
      } catch (err) {
        state.log.error(`[group-wait] timeout flush failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } catch (err) {
      state.log.error(`[group-wait] timeout check failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      state.flushing = false;
      schedule(state);
    }
  };

  const middleware: Middleware = async (ctx, next) => {
    if (!options.enabled || disposed) {
      await next();
      return;
    }

    const key = options.groupKey(ctx);
    const groupId = options.groupId(ctx);
    if (!key || !groupId) {
      await next();
      return;
    }

    let state = groups.get(key);
    if (!state) {
      state = {
        key,
        groupId,
        timer: undefined,
        flushing: false,
        generation: 0,
        log: ctx.log,
      };
      groups.set(key, state);
    } else {
      state.groupId = groupId;
      state.log = ctx.log;
    }

    if (ctx.state.mention?.wasMentioned === true) {
      state.generation += 1;
      if (state.timer !== undefined) {
        clearTimeout(state.timer);
        state.timer = undefined;
      }
      try {
        await next();
      } finally {
        schedule(state);
      }
      return;
    }

    ctx.stop('group-wait');
    schedule(state);
  };

  return {
    middleware: options.enabled ? middleware : async (_ctx, next) => { await next(); },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const state of groups.values()) {
        if (state.timer !== undefined) clearTimeout(state.timer);
      }
      groups.clear();
    },
  };
}
