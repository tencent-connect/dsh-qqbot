import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client';
import type { ConversationView } from '../shared/conversation-protocol.ts';
import type { QQNativeSessions } from './qq-sidebar-model.ts';

export interface QQNativeCatalogSource { readonly refresh: () => Promise<void>; readonly summaries: () => QQNativeSessions }

/** Re-read cold native rows after a live Agent's removal withdraws its catalog entry. */
export class QQNativeCatalogRehydrator {
  private missing = '';
  private generation = 0;
  constructor(private readonly source: QQNativeCatalogSource) {}

  update(entries: readonly Pick<ConversationView, 'currentSessionId' | 'sessions'>[], summaries: QQNativeSessions, phase: SessionListState['phase']): Promise<void> | undefined {
    if (phase !== 'ready') return;
    const ids = new Set(entries.flatMap((entry) => [...entry.sessions.map((session) => session.sessionId), ...(entry.currentSessionId ? [entry.currentSessionId] : [])]));
    const missing = JSON.stringify([...ids].filter((id) => summaries[id] === undefined).sort());
    if (missing === this.missing) return;
    this.missing = missing;
    const generation = ++this.generation;
    return missing === '[]' ? undefined : this.rehydrate(ids, generation);
  }

  private async rehydrate(ids: ReadonlySet<string>, generation: number): Promise<void> {
    await this.source.refresh();
    if (generation !== this.generation) return;
    // A pre-removal list request replays the removal over its baseline. One fresh pull repairs it.
    if ([...ids].some((id) => this.source.summaries()[id] === undefined)) await this.source.refresh();
  }
}
