import { describe, expect, it, vi } from 'vitest';
import { SessionId } from '@deepseek-ai/dsh-session/types';
import { SessionManager } from '@deepseek-ai/dsh-api-session-controller/src/client/sessions/manager.ts';
import { QQNativeCatalogRehydrator } from './qq-native-catalog.ts';

const id = SessionId('historical-qq-session');
const entries = [{ currentSessionId: null, sessions: [{ sessionId: id, startedAt: 1 }] }];
function nativeRows(manager) { return Object.fromEntries(manager.getListSnapshot().items.map((entry) => [entry.sessionId, entry])); }
function coldList(title) {
  return { ok: true, value: { items: [{ sessionId: id, agentAvailable: false, running: false, blank: false, updatedAt: 1, cwd: '/historical-workspace',
    projections: { kind: 'cached', asOfSeq: 2, values: { title } } }] } };
}

describe('QQ native catalog rehydration', () => {
  it('restores a renamed historical title and cwd after the real stock manager removes the released Agent', async () => {
    let title = '原生旧标题';
    const list = vi.fn(async () => coldList(title));
    const remote = { session: { list, rename: vi.fn(async (request) => { title = request.title; return { ok: true, value: { title, seq: 2 } }; }) } };
    const manager = new SessionManager(remote);
    try {
      await manager.refreshList();
      await manager.rename(id, 'QQ 左栏原生标题验证');
      expect(nativeRows(manager)[id]?.title).toBe('QQ 左栏原生标题验证');
      manager.handleSessionRemoved(id);
      expect(nativeRows(manager)[id]).toBeUndefined();
      expect(manager.getListSnapshot().projectionsBySession[id]).toBeUndefined();
      const recovery = new QQNativeCatalogRehydrator({ refresh: () => manager.refreshList(), summaries: () => nativeRows(manager) });
      await recovery.update(entries, nativeRows(manager), 'ready');
      expect(nativeRows(manager)[id]).toMatchObject({ title: 'QQ 左栏原生标题验证', cwd: '/historical-workspace' });
      expect(list).toHaveBeenCalledTimes(2);
    } finally { await manager.dispose(); }
  });

  it('makes one fresh pull when a real in-flight catalog read replays the Agent removal', async () => {
    const list = vi.fn(async () => coldList('已保存标题'));
    const manager = new SessionManager({ session: { list } });
    try {
      await manager.refreshList();
      let resolve;
      const inflight = new Promise((complete) => { resolve = complete; });
      list.mockImplementationOnce(() => inflight);
      const earlierRead = manager.refreshList();
      manager.handleSessionRemoved(id);
      const refresh = vi.fn(() => manager.refreshList());
      const recovery = new QQNativeCatalogRehydrator({ refresh, summaries: () => nativeRows(manager) });
      const recovered = recovery.update(entries, nativeRows(manager), 'ready');
      resolve?.(coldList('已保存标题'));
      await earlierRead; await recovered;
      expect(refresh).toHaveBeenCalledTimes(2);
      expect(list).toHaveBeenCalledTimes(3);
      expect(nativeRows(manager)[id]?.title).toBe('已保存标题');
    } finally { await manager.dispose(); }
  });

  it('stops after two reads for an inaccessible id and does not retry unchanged directory polls', async () => {
    const refresh = vi.fn(async () => {});
    const recovery = new QQNativeCatalogRehydrator({ refresh, summaries: () => ({}) });
    expect(recovery.update(entries, {}, 'pending')).toBeUndefined();
    await recovery.update(entries, {}, 'ready');
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(recovery.update([...entries], {}, 'ready')).toBeUndefined();
    expect(recovery.update([...entries], {}, 'ready')).toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not refresh a genuinely untitled native row', () => {
    const refresh = vi.fn(async () => {});
    const summaries = { [id]: { updatedAt: 1, cwd: '/historical-workspace' } };
    const recovery = new QQNativeCatalogRehydrator({ refresh, summaries: () => summaries });
    expect(recovery.update(entries, summaries, 'ready')).toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
  });
});
