import type { Context } from '@deepseek-ai/cordis';
import { Session, SessionId } from '@deepseek-ai/dsh-session';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { ConfigSchema } from '../config.ts';
import { ConversationStore } from '../conversations/index.ts';
import type { SessionManager } from '../session/session-manager.ts';
import type { SessionRecord } from '../session/types.ts';
import type { WebRoute } from '../setup/bind-routes.ts';
import { CONVERSATIONS_PATH } from '../shared/conversation-protocol.ts';
import { registerConversationRoutes } from './conversation-routes.ts';
import { ConversationService } from './conversation-service.ts';

const profile = vi.hoisted(() => ({ dir: null as string | null }));
vi.mock('../shared/index.ts', async original => ({ ...await original<typeof import('../shared/index.ts')>(), getProfileDir: vi.fn(() => profile.dir) }));
const roots: string[] = [];
afterEach(() => { profile.dir = null; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

type Mode = 'open' | 'allowlist' | 'disabled';
function fixture(scope: 'group' | 'c2c' = 'group', mode: Mode = 'open') {
  const root = mkdtempSync(join(tmpdir(), 'qq-admission-')); roots.push(root);
  const data = join(root, 'data'); mkdirSync(data);
  profile.dir = join(root, 'profile'); mkdirSync(profile.dir);
  const patchPath = join(profile.dir, 'cordis.patch.yml');
  const original = '# preserve unrelated profile config\n- id: unrelated\n  config:\n    value: kept\n- id: im-qqbot\n  config:\n    appId: admission\n';
  writeFileSync(patchPath, original);
  const routes = new Map<string, WebRoute>();
  const tools = { definitions: () => [], guard: () => () => {}, restrict: () => () => {} };
  let current: SessionRecord | undefined;
  const ctx = { get: (name: string) => name === 'tools' ? tools : name === 'webServer' ? { register: (route: WebRoute) => { routes.set(route.path, route); return () => {}; } } : undefined,
    on: () => () => {}, effect: () => {}, inject: (_names: string[], callback: (context: unknown) => void) => callback(ctx) } as unknown as Context;
  const config = ConfigSchema({ appId: 'admission', appSecret: 'dummy', cwd: data,
    access: { groupMode: scope === 'group' ? mode : 'open', groupAllow: ['other'], c2cMode: scope === 'c2c' ? mode : 'open', c2cAllow: ['other-user'] } });
  const cancelPending = vi.fn();
  const manager = { getDefaultModel: () => ({ provider: 'offline', model: 'dummy' }), getDefaultPreset: () => 'standard', getEffectiveModel: () => ({ provider: 'offline', model: 'dummy' }),
    getSessionRecord: () => current, getStatus: () => ({ active: !!current }), findBySessionId: () => current,
    questionChannel: { cancelPending }, approvalChannel: { cancelPending } } as unknown as SessionManager;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const service = new ConversationService(ctx, manager, config, logger, data); manager.conversations = service;
  const entry = service.entry(scope, 'peer'); const key = entry.key;
  const session = Session.create(SessionId('native'));
  const agent = { id: session.id, ctx, session, status: 'idle' as const, cancel: vi.fn(), followup: vi.fn(), whenIdle: async () => {}, runMaintenance: async <T>(task: (signal: AbortSignal) => Promise<T>) => task(new AbortController().signal) };
  current = { sessionKey: key, sessionId: session.id, scope, peerId: 'peer', senderId: 'actor', agent, handle: { agent, dispose: async () => {} }, lastActivity: Date.now(), replyTarget: { scope, targetId: 'peer' } };
  service.store.bindSession(key, session.id);
  registerConversationRoutes(ctx, service);
  const post = async (suffix: string, payload: Record<string, unknown>) => {
    const req = Object.assign(Readable.from([JSON.stringify(payload)]), { method: 'POST', url: `${CONVERSATIONS_PATH}${suffix}`, headers: { host: 'localhost' } }) as IncomingMessage;
    let body = '';
    const res = { statusCode: 0, setHeader: vi.fn(), end: (value: string) => { body = value; } };
    const route = routes.get(`${CONVERSATIONS_PATH}${suffix}`); if (!route) throw new Error('missing real route');
    await route.handler(req, res as unknown as ServerResponse);
    return { status: res.statusCode, body: JSON.parse(body) };
  };
  const request = (enabled: boolean) => post('/action', { action: 'admit', key, enabled });
  return { service, manager, config, agent, cancelPending, logger, root, data, patchPath, original, request, post, key };
}

describe('clearing message records through the real action route', () => {
  it('clears bodies while keeping message ids for dedupe, and persists across reopen', async () => {
    const f = fixture();
    const message = { senderId: 'actor', senderName: '', at: Date.now(), mentioned: false, attachments: [] };
    for (let index = 1; index <= 3; index++) f.service.store.recordMessage(f.key, { ...message, id: `in-${index}`, text: `body-${index}` });
    expect(f.service.store.timeline(f.key).items).toHaveLength(3);
    const before = f.service.requireEntry(f.key);
    const response = await f.post('/action', { action: 'clear-records', key: f.key, expectedRecordingVersion: before.recording!.version });
    expect(response.status).toBe(200);
    // 记录页清空
    expect(f.service.store.timeline(f.key).items).toHaveLength(0);
    // 去重身份保留：同一条消息再次到达不视为新消息
    expect(f.service.store.hasMessage(f.key, 'in-2')).toBe(true);
    // 重启后仍然清空且 id 保留
    const reopened = new ConversationStore(f.data, 'admission');
    expect(reopened.timeline(f.key).items).toHaveLength(0);
    expect(reopened.hasMessage(f.key, 'in-2')).toBe(true);
    // 清空不改变策略
    expect(f.service.requireEntry(f.key).policy.version).toBeGreaterThan(0);
    expect(f.agent.cancel).not.toHaveBeenCalled();
  });
});

describe('conversation admission through the real action route', () => {
  it.each(['group', 'c2c'] as const)('disables %s without a profile or rewriting global authority', async scope => {
    const f = fixture(scope, 'allowlist'); profile.dir = null;
    const before = structuredClone(f.config.access); Object.assign(f.agent, { status: 'running' });
    const response = await f.request(false);
    expect(response.status).toBe(200); expect(response.body.notice).toBeUndefined(); expect(f.config.access).toEqual(before);
    expect(readFileSync(f.patchPath, 'utf8')).toBe(f.original);
    expect(new ConversationStore(f.data, 'admission').get(f.key)?.policy.receiveEnabled).toBe(false);
    expect(f.agent.cancel).toHaveBeenCalledExactlyOnceWith({ kind: 'user' }); expect(f.cancelPending).toHaveBeenCalledTimes(2);
    expect(f.service.admitted(scope, 'peer')).toBe(false);
  });

  it.each(['open', 'allowlist', 'disabled'] satisfies Mode[])('enables from %s with coherent persisted and current authority', async mode => {
    const f = fixture('group', mode);
    f.service.setAdmission(f.key, false);
    const result = await f.request(true); expect(result.status).toBe(200);
    if (mode === 'open') expect(result.body.notice).toBeUndefined();
    else expect(result.body.notice).toBe('访问规则已保存；QQ消息接收规则将在连接重载后生效。');
    expect(f.service.admitted('group', 'peer')).toBe(true);
    expect(new ConversationStore(f.data, 'admission').get(f.key)?.policy.receiveEnabled).toBe(true);
    expect(f.config.access.c2cAllow).toEqual(['other-user']);
    if (mode === 'open') expect(readFileSync(f.patchPath, 'utf8')).toBe(f.original);
    else {
      const saved = parse(readFileSync(f.patchPath, 'utf8'));
      expect(saved[0]).toEqual({ id: 'unrelated', config: { value: 'kept' } });
      expect(saved[1].config.access).toMatchObject({ groupMode: 'allowlist', groupAllow: mode === 'disabled' ? ['peer'] : ['other', 'peer'], c2cAllow: ['other-user'] });
    }
  });

  it('enables an already allowed peer without a connection reload notice or profile write', async () => {
    const f = fixture('group', 'allowlist'); f.config.access.groupAllow.push('peer');
    f.service.setAdmission(f.key, false);
    const result = await f.request(true);
    expect(result.status).toBe(200); expect(result.body.notice).toBeUndefined();
    expect(f.service.admitted('group', 'peer')).toBe(true);
    expect(readFileSync(f.patchPath, 'utf8')).toBe(f.original);
  });

  it.each(['allowlist', 'disabled'] satisfies Mode[])('keeps receive disabled when a real %s profile save fails', async mode => {
    const f = fixture('group', mode); const broken = '- [invalid YAML'; writeFileSync(f.patchPath, broken);
    const result = await f.request(true);
    expect(result.status).toBe(400); expect(result.body.error).toContain('全局访问配置保存失败'); expect(result.body.error).toContain('此 QQ 对话仍停用');
    expect(f.service.admitted('group', 'peer')).toBe(false);
    expect(f.config.access.groupMode).toBe(mode);
    expect(readFileSync(f.patchPath, 'utf8')).toBe(broken);
    expect(new ConversationStore(f.data, 'admission').get(f.key)?.policy.receiveEnabled).toBe(false);
    expect(f.agent.cancel).toHaveBeenCalledOnce();
  });

  it('reports saved access plus disabled local state if the final policy write hits a real filesystem error', async () => {
    const f = fixture('group', 'disabled');
    f.logger.info.mockImplementation(message => { if (message.startsWith('✔ 配置已保存')) chmodSync(f.data, 0o500); });
    try {
      const result = await f.request(true);
      expect(result.status).toBe(400); expect(result.body.error).toContain('全局访问配置已保存'); expect(result.body.error).toContain('此 QQ 对话仍停用'); expect(result.body.error).toContain('已取消的任务不会恢复');
      expect(f.config.access.groupMode).toBe('allowlist'); expect(f.config.access.groupAllow).toEqual(['peer']);
      expect(f.service.admitted('group', 'peer')).toBe(false);
      expect(new ConversationStore(f.data, 'admission').get(f.key)?.policy.receiveEnabled).toBe(false);
      expect(parse(readFileSync(f.patchPath, 'utf8'))[1].config.access.groupAllow).toEqual(['peer']);
      expect(f.agent.cancel).toHaveBeenCalledOnce();
    } finally { chmodSync(f.data, 0o700); }
  });

  it.each([
    { name: 'explicit allowlist', allowed: ['preset-a', 'preset-b'], expected: ['preset-a', 'preset-b'] },
    // 空 allowlist = 不限：selectablePresets 为空数组，客户端视为全部可选。
    { name: 'empty allowlist (unrestricted)', allowed: [], expected: [] },
  ])('exposes selectable presets for $name in the backend snapshot', ({ allowed, expected }) => {
    const f = fixture(); const entry = f.service.requireEntry(f.key);
    f.service.store.updatePolicy(f.key, entry.policy.version, { ...entry.policy, allowedPresets: allowed });
    const view = f.service.snapshot().conversations.find(item => item.key === f.key);
    expect(view?.selectablePresets).toEqual(expected);
  });

  it('fails closed without a profile when global access must be expanded', async () => {
    const f = fixture('c2c', 'disabled'); profile.dir = null;
    const result = await f.request(true);
    expect(result.status).toBe(400); expect(result.body.error).toContain('仍停用');
    expect(f.service.admitted('c2c', 'peer')).toBe(false); expect(f.config.access.c2cMode).toBe('disabled');
    expect(readFileSync(f.patchPath, 'utf8')).toBe(f.original);
  });
});
