import { describe, expect, it, vi } from 'vitest';
import { installQQConversationViewRegistration } from './qq-conversation-registration.ts';
function source(initial) {
  let snapshot = initial;
  const listeners = new Set();
  return { getSnapshot: () => snapshot, subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set: (value) => { snapshot = value; for (const listener of listeners) listener(); }, size: () => listeners.size };
}
describe('native QQ view registration', () => {
  it('registers only QQ current/history sessions, reacts to a late directory, and disposes every lease', () => {
    const current = source({ key: 'qq-current' }); const directory = source({});
    const entries = new Set(); const stopView = vi.fn(); const register = vi.fn(() => stopView);
    // The session store indexes only main QQ Sessions, including its retained histories.
    const stop = installQQConversationViewRegistration({ current, store: { entry: key => entries.has(key) ? {} : undefined, subscribe: directory.subscribe }, register });
    expect(register).not.toHaveBeenCalled();
    entries.add('qq-current'); entries.add('qq-history'); directory.set({});
    expect(register).toHaveBeenCalledTimes(1);
    current.set({ key: 'qq-history' }); directory.set({});
    expect(register).toHaveBeenCalledTimes(1);
    current.set({ key: 'ordinary-session' }); expect(stopView).toHaveBeenCalledTimes(1);
    current.set({}); expect(register).toHaveBeenCalledTimes(1);
    current.set({ key: 'qq-history' }); expect(register).toHaveBeenCalledTimes(2);
    entries.clear(); directory.set({}); expect(stopView).toHaveBeenCalledTimes(2);
    entries.add('qq-history'); directory.set({}); expect(register).toHaveBeenCalledTimes(3);
    stop(); expect(stopView).toHaveBeenCalledTimes(3); expect(current.size()).toBe(0); expect(directory.size()).toBe(0);
    current.set({ key: 'ordinary-session' }); directory.set({}); expect(stopView).toHaveBeenCalledTimes(3);
  });
});
