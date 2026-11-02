import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots';
import type { QQSessionStore } from './qq-session-store.ts';
/** Native view rosters are global; own the registration only while a QQ main/history session is selected. */
export function installQQConversationViewRegistration({ current, store, register }: {
  current: HostObservable<{ readonly key?: string }>;
  store: Pick<QQSessionStore, 'entry' | 'subscribe'>;
  register: () => () => void;
}): () => void {
  let stopView: (() => void) | undefined;
  const sync = (): void => {
    const key = current.getSnapshot().key;
    if (key && store.entry(key)) stopView ??= register();
    else { stopView?.(); stopView = undefined; }
  };
  const stopCurrent = current.subscribe(sync);
  const stopDirectory = store.subscribe(sync);
  sync();
  return () => { stopDirectory(); stopCurrent(); stopView?.(); stopView = undefined; };
}
