import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { ConfigSchema } from '../config.ts';
import type { SessionManager } from '../session/session-manager.ts';
import { ConversationService } from './conversation-service.ts';
import { registerGroupHistoryTool } from './history-tool.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe('history authorization independent of context and recording', () => {
  it('queries retained bodies in recent or interaction mode after recording is disabled, only with an explicit tool grant', async () => {
    const root = mkdtempSync(join(tmpdir(), 'qq-history-tool-')); roots.push(root);
    const register = vi.fn<(tool: { execute(input: unknown, exec: { signal: AbortSignal; agent: { id: string } }): Promise<{ text: string }> }) => void>();
    const ctx = { get: (name: string) => name === 'tools' ? { register } : undefined, on: () => () => {} } as unknown as Context;
    const manager = { getDefaultModel: () => ({ provider: 'p', model: 'm' }), getDefaultPreset: () => 'standard' } as unknown as SessionManager;
    const service = new ConversationService(ctx, manager, ConfigSchema({ appId: 'history', appSecret: 'dummy', cwd: root }), { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, root);
    manager.conversations = service;
    const entry = service.entry('group', 'g'); service.store.bindSession(entry.key, 'native');
    service.store.recordMessage(entry.key, { id: 'recorded', senderId: 'actor', senderName: '', text: 'retained source body', at: Date.now(), mentioned: false, attachments: [] });
    registerGroupHistoryTool(ctx, manager);
    const tool = register.mock.calls[0]?.[0]; if (!tool) throw new Error('History tool missing');
    const exec = { signal: new AbortController().signal, agent: { id: 'native' } };
    await expect(tool.execute({}, exec)).rejects.toThrow('未授权');
    service.store.updateRecording(entry.key, entry.recording!.version, { enabled: false, retentionDays: 7 });
    for (const mode of ['recent', 'interaction'] as const) {
      const current = service.requireEntry(entry.key);
      service.store.updatePolicy(entry.key, current.policy.version, { ...current.policy, tools: { qqbot_group_history: 'allow' }, context: { ...current.policy.context, mode } });
      expect(JSON.parse((await tool.execute({}, exec)).text).messages).toMatchObject([{ id: 'recorded', text: 'retained source body' }]);
      expect(service.requireEntry(entry.key).recording?.enabled).toBe(false);
    }
  });
});
