import { readFileSync, statSync } from 'node:fs';
import type { Context } from '@deepseek-ai/cordis';
import type { AccessControlConfig } from '../config.ts';
import { legacyDerivedSessionId } from '../session/session-id.ts';
import { atomicWrite } from '../shared/atomic-file.ts';
import {
  WORKBENCH_CONVERSATIONS_PATH, type WorkbenchConversation, type WorkbenchConversationPatch, type WorkbenchSession,
} from '../shared/workbench-conversation-protocol.ts';
import type { ChatScope, Logger } from '../types.ts';
import { allowsConversation } from './account-service.ts';
import { robotAppId, robotObject, robotRevision } from './robot-config.ts';
import type { RobotRuntimes } from './robot-runtimes.ts';
import { QQ_MANUAL_MESSAGE_LIMIT, WORKBENCH_SEND_PATH, WORKBENCH_TIMELINE_PATH } from '../shared/workbench-timeline-protocol.ts';
import { registerWorkbenchFetch, workbenchJson, WorkbenchRequestError } from './workbench-routes.ts';
import { parseAgentSettings } from './workbench-agent-settings.ts';
import type { WorkbenchAgentSettings, WorkbenchDefaults } from '../shared/workbench-agent-settings.ts';

interface PeerSettings {
  alias: string;
  receiving: boolean;
  recording: boolean;
  revision: number;
  agent?: WorkbenchAgentSettings;
}
const defaults: Readonly<PeerSettings> = Object.freeze({ alias: '', receiving: true, recording: true, revision: 0 });
export const peerKey = (appId: string, scope: ChatScope, openId: string): string => `qqbot:${appId}:${scope}:${openId}`;

function validOpenId(value: unknown): value is string {
  return typeof value === 'string' && /^\S{1,1024}$/.test(value) && !/[\x00-\x1f\x7f]/.test(value);
}
function parsePeer(appId: string, key: string): { scope: ChatScope; openId: string } | undefined {
  const prefix = `qqbot:${appId}:`;
  if (!key.startsWith(prefix)) return undefined;
  const value = key.slice(prefix.length);
  const separator = value.indexOf(':');
  const scope = value.slice(0, separator);
  const openId = value.slice(separator + 1);
  if ((scope !== 'c2c' && scope !== 'group') || !validOpenId(openId)) return undefined;
  return { scope, openId };
}
function aliasValue(value: unknown): string {
  if (typeof value !== 'string' || value.length > 120 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('会话别名格式无效。');
  return value.trim();
}
function receivingValue(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('会话接收状态无效。');
  return value;
}

export class ConversationSettingsStore {
  private cache?: { signature: string; data: SettingsData };
  private seenFile = false;

  constructor(private readonly path: string) {}

  get(key: string): Readonly<PeerSettings> {
    return this.read().peers.get(key) ?? defaults;
  }

  keys(appId: string): string[] {
    return [...this.read().peers.keys()].filter(key => key.startsWith(`qqbot:${appId}:`));
  }

  template(appId: string): WorkbenchDefaults | undefined {
    return this.read().templates.get(appId);
  }

  initialize(key: string, settings: WorkbenchAgentSettings): void {
    const current = this.get(key);
    if (!current.agent) this.save(key, { revision: current.revision, agent: settings });
  }

  saveTemplate(appId: string, next: WorkbenchDefaults, established: ReadonlyMap<string, WorkbenchAgentSettings>): WorkbenchDefaults {
    const current = this.read();
    if (next.revision !== (current.templates.get(appId)?.revision ?? 0)) {
      throw new WorkbenchRequestError(409, '机器人默认设置已更新，请重新加载后保存。');
    }
    const peers = new Map(current.peers);
    for (const [key, settings] of established) {
      const peer = peers.get(key) ?? defaults;
      if (!peer.agent) peers.set(key, { ...peer, agent: settings, revision: robotRevision(peer.revision + 1) });
    }
    const saved = { revision: robotRevision(next.revision + 1), settings: next.settings };
    const templates = new Map(current.templates).set(appId, saved);
    this.write({ peers, templates });
    return saved;
  }

  save(key: string, patch: Omit<WorkbenchConversationPatch, 'appId' | 'scope' | 'openId'>): Readonly<PeerSettings> {
    const data = this.read();
    const peers = new Map(data.peers);
    const current = peers.get(key) ?? defaults;
    if (patch.revision !== current.revision) throw new WorkbenchRequestError(409, '会话设置已更新，请重新加载后再保存。');
    const next = Object.freeze({
      alias: patch.alias ?? current.alias,
      receiving: patch.receiving ?? current.receiving,
      recording: patch.recording ?? current.recording,
      revision: robotRevision(current.revision + 1),
      ...(patch.agent ?? current.agent ? { agent: patch.agent ?? current.agent } : {}),
    });
    peers.set(key, next);
    this.write({ ...data, peers });
    return next;
  }

  private write(data: SettingsData): void {
    atomicWrite(this.path, [JSON.stringify({ version: 1, peers: Object.fromEntries(data.peers), templates: Object.fromEntries(data.templates) })]);
    this.seenFile = true;
    this.cache = undefined;
  }

  private read(): SettingsData {
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !this.seenFile) return { peers: new Map(), templates: new Map() };
      throw error;
    }
    this.seenFile = true;
    const signature = `${stats.ino}:${stats.mtimeMs}:${stats.size}`;
    if (this.cache?.signature === signature) return this.cache.data;
    const root = robotObject(JSON.parse(readFileSync(this.path, 'utf8')), ['version', 'peers', 'templates']);
    if (root.version !== 1 || !root.peers || typeof root.peers !== 'object' || Array.isArray(root.peers)) throw new Error('QQ 会话设置格式无效。');
    const peers = new Map(Object.entries(root.peers).map(([key, raw]) => {
      const value = robotObject(raw, ['alias', 'receiving', 'recording', 'revision', 'agent']);
      return [key, Object.freeze({ alias: aliasValue(value.alias), receiving: receivingValue(value.receiving), recording: value.recording === undefined ? true : recordingValue(value.recording), revision: robotRevision(value.revision),
        ...(value.agent === undefined ? {} : { agent: parseAgentSettings(value.agent) }),
      })];
    }));
    const rawTemplates = root.templates === undefined ? {} : root.templates;
    if (!rawTemplates || typeof rawTemplates !== 'object' || Array.isArray(rawTemplates)) throw new Error('QQ 默认设置格式无效。');
    const templates = new Map(Object.entries(rawTemplates).map(([appId, raw]) => {
      const row = robotObject(raw, ['revision', 'settings']);
      return [robotAppId(appId), { revision: robotRevision(row.revision), settings: parseAgentSettings(row.settings) }];
    }));
    const data = { peers, templates };
    this.cache = { signature, data };
    return data;
  }
}

interface SettingsData {
  peers: Map<string, PeerSettings>;
  templates: Map<string, WorkbenchDefaults>;
}
function recordingValue(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('QQ 消息保存开关无效。');
  return value;
}

interface ConversationAccount {
  access: AccessControlConfig;
  agentSettings?(scope: ChatScope, openId: string, existing: boolean): WorkbenchAgentSettings;
  validateAgent?(next: WorkbenchAgentSettings, current: WorkbenchAgentSettings): Promise<void>;
  peerName(scope: ChatScope, openId: string): string;
  liveSessionId(scope: ChatScope, openId: string): string | undefined;
}
type RuntimeReader = Pick<RobotRuntimes, 'prefs' | 'conversationSettings' | 'timeline'> & Partial<Pick<RobotRuntimes, 'toolPolicies'>> & {
  conversationAccount(appId: string): ConversationAccount | undefined;
};
interface SessionPersistence {
  stat(id: string): Promise<{ header?: { id?: string; createdAt?: number; cwd?: string; agentPreset?: string } } | undefined>;
}

function getPersistence(ctx: Context): SessionPersistence | undefined {
  try {
    const value = ctx.get('sessionPersistence') as SessionPersistence | undefined;
    return typeof value?.stat === 'function' ? value : undefined;
  } catch {
    return undefined;
  }
}

async function projectConversations(
  robots: RuntimeReader,
  appId: string,
  persistence?: SessionPersistence,
  target?: WorkbenchConversationPatch,
): Promise<WorkbenchConversation[]> {
  const account = robots.conversationAccount(appId);
  if (!account) throw new WorkbenchRequestError(404, '找不到这个 QQ 机器人。');
  if (!persistence) throw new WorkbenchRequestError(503, '此 DSH 宿主没有可用的会话持久化接口，暂时无法读取 Session。');
  const bindings = new Map(robots.prefs.listSessionBindings(appId).map(binding => [binding.key, binding]));
  const keys = new Set([
    ...bindings.keys(), ...robots.conversationSettings.keys(appId),
    ...robots.timeline.peers(appId).map(({ scope, openId }) => peerKey(appId, scope, openId)),
    ...account.access.groupAllow.map(id => peerKey(appId, 'group', id)),
    ...account.access.c2cAllow.map(id => peerKey(appId, 'c2c', id)),
  ]);
  const readSession = async (id: string): Promise<WorkbenchSession | undefined> => {
    const header = (await persistence.stat(id))?.header;
    const createdAt = header?.createdAt;
    if (!header || (header.id !== undefined && header.id !== id) || typeof createdAt !== 'number' || !Number.isSafeInteger(createdAt) || createdAt < 0) return undefined;
    return { id, createdAt, cwd: header.cwd, preset: header.agentPreset };
  };
  const peers = [];
  for (const key of keys) {
    const peer = parsePeer(appId, key);
    if (peer && (!target || (peer.scope === target.scope && peer.openId === target.openId))) peers.push({ key, ...peer });
  }

  const conversations: WorkbenchConversation[] = [];
  // Bound concurrent stat calls independently of the number of retained peer mappings.
  for (let offset = 0; offset < peers.length; offset += 12) {
    conversations.push(...await Promise.all(peers.slice(offset, offset + 12).map(async ({ key, scope, openId }) => {
      const binding = bindings.get(key);
      const current = account.liveSessionId(scope, openId) ?? binding?.current ?? legacyDerivedSessionId(key);
      const ids = new Set([current, ...(binding?.history ?? [])]);
      const sessions: WorkbenchSession[] = [];
      for (const id of ids) {
        const session = await readSession(id);
        if (session) sessions.push(session);
      }
      sessions.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
      return {
        scope, openId, name: account.peerName(scope, openId),
        ...robots.conversationSettings.get(key),
        agent: account.agentSettings?.(scope, openId, sessions.length > 0),
        admitted: allowsConversation(account.access, scope, openId),
        currentSessionId: sessions.some(session => session.id === current) ? current : undefined,
        sessions,
      };
    })));
  }
  return conversations;
}

async function parsePatch(request: Request): Promise<WorkbenchConversationPatch> {
  const text = await request.text();
  if (Buffer.byteLength(text) > 512 * 1024) throw new Error('会话设置请求过大。');
  const value = robotObject(JSON.parse(text), ['appId', 'scope', 'openId', 'revision', 'alias', 'receiving', 'recording', 'agent']);
  if ((value.scope !== 'c2c' && value.scope !== 'group') || !validOpenId(value.openId)) throw new Error('QQ 会话地址无效。');
  if (value.alias === undefined && value.receiving === undefined && value.recording === undefined && value.agent === undefined) throw new Error('缺少要保存的会话设置。');
  return {
    appId: robotAppId(value.appId), scope: value.scope, openId: value.openId, revision: robotRevision(value.revision),
    ...(value.alias === undefined ? {} : { alias: aliasValue(value.alias) }),
    ...(value.receiving === undefined ? {} : { receiving: receivingValue(value.receiving) }),
    ...(value.recording === undefined ? {} : { recording: recordingValue(value.recording) }),
    ...(value.agent === undefined ? {} : { agent: parseAgentSettings(value.agent) }),
  };
}

export function registerWorkbenchConversations(ctx: Context, robots: RuntimeReader, logger: Logger): void {
  registerWorkbenchFetch(ctx, WORKBENCH_TIMELINE_PATH, ['GET'], async request => {
    if (request.method !== 'GET') return workbenchJson({ error: '不支持的请求方法。' }, 405);
    const query = new URL(request.url).searchParams;
    let appId: string;
    const scope = query.get('scope');
    const openId = query.get('openId');
    const before = query.get('before') ?? undefined;
    try {
      if (['appId', 'scope', 'openId', 'before'].some(key => query.getAll(key).length > 1)) throw new Error();
      appId = robotAppId(query.get('appId'));
      if ((scope !== 'group' && scope !== 'c2c') || !validOpenId(openId)
        || (before !== undefined && !/^[a-f0-9-]{36,64}$/.test(before))) throw new Error();
    } catch {
      return workbenchJson({ error: 'QQ 流水查询参数无效。' }, 400);
    }
    if (!robots.conversationAccount(appId)) return workbenchJson({ error: '找不到这个 QQ 机器人。' }, 404);
    try {
      const page = robots.timeline.page(appId, { scope, targetId: openId }, before);
      return page ? workbenchJson(page) : workbenchJson({ error: '该页记录已不可用，请刷新。' }, 404);
    } catch {
      return workbenchJson({ error: 'QQ 流水读取失败，记录可能不完整。' }, 503);
    }
  });
  registerWorkbenchFetch(ctx, WORKBENCH_CONVERSATIONS_PATH, ['GET', 'POST'], async (request, assertWritable) => {
    const persistence = getPersistence(ctx);
    if (request.method === 'GET') {
      let appId: string;
      try {
        const ids = new URL(request.url).searchParams.getAll('appId');
        if (ids.length !== 1) throw new Error();
        appId = robotAppId(ids[0]);
      } catch {
        return workbenchJson({ error: '请指定一个有效的 AppID。' }, 400);
      }
      try {
        return workbenchJson({ conversations: await projectConversations(robots, appId, persistence) });
      } catch (error) {
        if (!(error instanceof WorkbenchRequestError)) logger.warn('QQ 工作台无法读取会话或宿主持久化。');
        throw error;
      }
    }
    if (request.method !== 'POST') return workbenchJson({ error: '不支持的请求方法。' }, 405);
    let patch: WorkbenchConversationPatch;
    try {
      patch = await parsePatch(request);
    } catch (error) {
      return workbenchJson({ error: error instanceof Error && !(error instanceof SyntaxError) ? error.message : '会话设置格式无效。' }, 400);
    }
    const [conversation] = await projectConversations(robots, patch.appId, persistence, patch);
    if (!conversation) throw new WorkbenchRequestError(404, '这个 QQ 会话尚未登记。');
    const key = peerKey(patch.appId, patch.scope, patch.openId);
    const binding = robots.prefs.listSessionBindings(patch.appId).find(row => row.key === key);
    const sessions = [...new Set([...conversation.sessions.map(session => session.id),
      ...(binding?.history ?? []), ...(binding?.current ? [binding.current] : [])])];
    const assertCurrent = () => {
      assertWritable();
      if (robots.conversationSettings.get(key).revision !== patch.revision) {
        throw new WorkbenchRequestError(409, '会话设置已更新，请重新加载后再保存。');
      }
    };
    try {
      let checkIdle: (() => void) | undefined;
      if (patch.agent && conversation.agent) {
        try {
          await robots.conversationAccount(patch.appId)?.validateAgent?.(patch.agent, conversation.agent);
        } catch (error) {
          throw new WorkbenchRequestError(400, error instanceof Error ? error.message : 'Agent 设置无效。');
        }
        assertCurrent();
        try {
          checkIdle = await robots.toolPolicies?.beforeSave(key, sessions, patch.agent);
          checkIdle?.();
        } catch (error) {
          throw new WorkbenchRequestError(409, error instanceof Error ? error.message : '会话正在运行，请稍后重试。');
        }
      }
      assertCurrent();
      const settings = robots.conversationSettings.save(key, { ...patch, agent: patch.agent ?? conversation.agent });
      return workbenchJson({ conversation: { ...conversation, ...settings } });
    } finally {
      if (patch.agent) robots.toolPolicies?.reconcile(key, sessions);
    }
  });
}

export function registerWorkbenchSend(ctx: Context, robots: Pick<RobotRuntimes, 'manualStatus' | 'manualSend'>): void {
  registerWorkbenchFetch(ctx, WORKBENCH_SEND_PATH, ['GET', 'POST'], async (request, assertWritable) => {
    let appId: string;
    let target: { scope: ChatScope; targetId: string };
    let operation: string;
    let message: string | undefined;
    try {
      const fields = ['appId', 'scope', 'openId', 'operation'];
      let row: Record<string, unknown>;
      if (request.method === 'GET') {
        const query = new URL(request.url).searchParams;
        if (fields.some(field => query.getAll(field).length !== 1)) throw new Error();
        row = Object.fromEntries(query);
      } else {
        const raw = await request.text();
        if (Buffer.byteLength(raw) > 16 * 1024) throw new Error();
        row = robotObject(JSON.parse(raw), [...fields, 'text']);
        if (typeof row.text !== 'string' || row.text.length > QQ_MANUAL_MESSAGE_LIMIT || !row.text.trim() || row.text.includes('\0')) throw new Error();
        message = row.text;
      }
      appId = robotAppId(row.appId);
      if ((row.scope !== 'c2c' && row.scope !== 'group') || typeof row.openId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(row.openId)
        || typeof row.operation !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(row.operation)) throw new Error();
      target = { scope: row.scope, targetId: row.openId };
      operation = row.operation;
    } catch {
      return workbenchJson({ error: '发送参数无效，请检查对话和消息长度。' }, 400);
    }
    if (message === undefined) {
      const result = robots.manualStatus(appId, target, operation);
      return result ? workbenchJson(result) : workbenchJson({ error: '未找到此发送操作。' }, 404);
    }
    assertWritable();
    return workbenchJson(await robots.manualSend(appId, target, operation, message, assertWritable));
  });
}
