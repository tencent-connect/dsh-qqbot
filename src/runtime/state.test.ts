import { describe, expect, it } from 'vitest';
import { RuntimeState, RUNTIME_ERROR_HINTS } from './state.ts';

describe('RuntimeState', () => {
  it('starts unbound and exposes detached snapshots per plugin instance', () => {
    const state = new RuntimeState(() => 10);
    const snapshot = state.snapshot();
    expect(snapshot).toEqual({
      phase: 'unbound', updatedAt: 10, lastReceivedAt: null, lastSentAt: null, lastError: null,
    });
    snapshot.phase = 'ready';
    expect(state.snapshot().phase).toBe('unbound');
    state.setPhase('connecting');
    expect(new RuntimeState().snapshot().phase).toBe('unbound');
  });

  it('records receipt and successful sends separately from connection state', () => {
    let now = 0;
    const state = new RuntimeState(() => now);
    now = 1;
    state.setPhase('ready');
    now = 2;
    state.received();
    now = 3;
    state.sendFailed();
    expect(state.snapshot()).toMatchObject({
      phase: 'ready', lastReceivedAt: 2, lastSentAt: null, lastError: RUNTIME_ERROR_HINTS.send,
    });
    now = 4;
    state.sent();
    expect(state.snapshot()).toMatchObject({ lastReceivedAt: 2, lastSentAt: 4, updatedAt: 4, lastError: null });
    now = 5;
    state.setPhase('ready');
    expect(state.snapshot().lastError).toBeNull();
  });

  it.each([
    RUNTIME_ERROR_HINTS.connection,
    RUNTIME_ERROR_HINTS.disconnected,
    RUNTIME_ERROR_HINTS.terminal,
  ])('does not clear a gateway error after a completed send: %s', (error) => {
    const state = new RuntimeState(() => 10);
    state.setPhase('reconnecting', error);
    state.sent();
    expect(state.snapshot()).toMatchObject({ phase: 'reconnecting', lastSentAt: 10, lastError: error });
  });

  it('keeps stopped snapshots stable against late async callbacks', () => {
    let now = 1;
    const state = new RuntimeState(() => now);
    state.setPhase('stopped');
    const stopped = state.snapshot();
    now = 2;
    state.setPhase('ready');
    state.received();
    state.sent();
    state.sendFailed();
    expect(state.snapshot()).toEqual(stopped);
  });
});
