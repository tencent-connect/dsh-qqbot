import { readFileSync, statSync } from 'node:fs';
import type { Context } from '@deepseek-ai/cordis';
import type { AccessControlConfig } from '../config.ts';
import { atomicWrite } from '../shared/atomic-file.ts';
import {
  WORKBENCH_CONVERSATIONS_PATH, WORKBENCH_NEW_SESSION_PATH, isMessageRetention, retentionDays, shortensRetention,
  type MessageRetention, type WorkbenchConversation, type WorkbenchConversationPatch,
  type WorkbenchNewSession, type WorkbenchSession,
} from '../shared/workbench-conversation-protocol.ts';
import type { ChatScope, Logger } from '../types.ts';
import { allowsConversation } from './account-service.ts';
import { robotAppId, robotObject, robotRevision } from './robot-config.ts';
import type { RobotRuntimes } from './robot-runtimes.ts';
import { MAX_TIMELINE_IMAGES, QQ_MANUAL_ATTACHMENT_LIMIT, QQ_MANUAL_MESSAGE_LIMIT, WORKBENCH_SEND_PATH, WORKBENCH_TIMELINE_CLEAR_PATH, WORKBENCH_TIMELINE_PATH, type TimelineEntry } from '../shared/workbench-timeline-protocol.ts';
import { registerWorkbenchFetch, workbenchJson, WorkbenchRequestError } from './workbench-routes.ts';
import { parseAgentSettings } from './workbench-agent-settings.ts';
import type { WorkbenchAgentSettings, WorkbenchDefaults } from '../shared/workbench-agent-settings.ts';
import { workbenchImage } from './workbench-image.ts';
import type { QqbotTimelineService, QqConversationRef } from '../shared/workbench-extension.ts';
import type { ManualAttachment } from '../transport/manual-send.ts';

interface PeerSettings {
  alias: string;
  receiving: boolean;
  retention: MessageRetention;
  revision: number;
  agent?: WorkbenchAgentSettings;
}
const defaults: Readonly<PeerSettings> = Object.freeze({ alias: '', receiving: true, retention: '7d', revision: 0 });
const legacyDefaults: Readonly<PeerSettings> = Object.freeze({ ...defaults, retention: 'forever' });
export const peerKey = (appId: string, scope: ChatScope, openId: string): string => `qqbot:${appId}:${scope}:${openId}`;

export function validOpenId(value: unknown): value is string {
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

  constructor(private readonly path: string, private readonly logger?: Pick<Logger, 'warn'>) {}

  get(key: string): Readonly<PeerSettings> {
    const data = this.read();
    return settingAt(data.peers, data.invalidPeers, key) ?? defaults;
  }

  recordedDays(key: string): number | undefined {
    const settings = this.read().peers.get(key);
    return settings && retentionDays(settings.retention);
  }

  remember(key: string): Readonly<PeerSettings> {
    const data = this.read();
    const existing = settingAt(data.peers, data.invalidPeers, key);
    if (existing) return existing;
    this.write({ ...data, peers: new Map(data.peers).set(key, defaults) });
    return defaults;
  }

  preserveLegacy(keys: Iterable<string>): void {
    const data = this.read();
    const peers = new Map(data.peers);
    for (const key of keys) if (!peers.has(key) && !data.invalidPeers.has(key)) peers.set(key, legacyDefaults);
    if (peers.size !== data.peers.size) this.write({ ...data, peers });
  }

  expiringPeers(): QqConversationRef[] {
    const targets: QqConversationRef[] = [];
    for (const [key, settings] of this.read().peers) {
      if (retentionDays(settings.retention) === undefined) continue;
      const [, appId] = key.split(':', 2);
      if (!appId) continue;
      const peer = parsePeer(appId, key);
      if (peer) targets.push({ appId, ...peer });
    }
    return targets;
  }

  keys(appId: string): string[] {
    const { peers, invalidPeers } = this.read();
    return [...peers.keys(), ...invalidPeers.keys()].filter(key => key.startsWith(`qqbot:${appId}:`));
  }

  template(appId: string): WorkbenchDefaults | undefined {
    const data = this.read();
    return settingAt(data.templates, data.invalidTemplates, appId);
  }

  initialize(key: string, settings: WorkbenchAgentSettings, existingSession = false): void {
    if (existingSession) this.preserveLegacy([key]);
    const current = this.get(key);
    if (!current.agent) this.save(key, { revision: current.revision, agent: settings });
  }

  saveTemplate(appId: string, next: WorkbenchDefaults, established: ReadonlyMap<string, WorkbenchAgentSettings>): WorkbenchDefaults {
    const current = this.read();
    if (next.revision !== (settingAt(current.templates, current.invalidTemplates, appId)?.revision ?? 0)) {
      throw new WorkbenchRequestError(409, '机器人默认设置已更新，请重新加载后保存。');
    }
    const peers = new Map(current.peers);
    for (const [key, settings] of established) {
      if (current.invalidPeers.has(key)) continue;
      const peer = peers.get(key) ?? legacyDefaults;
      if (!peer.agent) peers.set(key, { ...peer, agent: settings, revision: robotRevision(peer.revision + 1) });
    }
    const saved = { revision: robotRevision(next.revision + 1), settings: next.settings };
    const templates = new Map(current.templates).set(appId, saved);
    this.write({ ...current, peers, templates });
    return saved;
  }

  save(key: string, patch: Omit<WorkbenchConversationPatch, 'appId' | 'scope' | 'openId'>): Readonly<PeerSettings> {
    const data = this.read();
    const peers = new Map(data.peers);
    const current = settingAt(peers, data.invalidPeers, key) ?? defaults;
    if (patch.revision !== current.revision) throw new WorkbenchRequestError(409, '会话设置已更新，请重新加载后再保存。');
    const retention = patch.retention ?? (patch.recording === false ? 'paused'
      : patch.recording === true && current.retention === 'paused' ? 'forever' : current.retention);
    const next = Object.freeze({
      alias: patch.alias ?? current.alias,
      receiving: patch.receiving ?? current.receiving,
      retention,
      revision: robotRevision(current.revision + 1),
      ...(patch.agent ?? current.agent ? { agent: patch.agent ?? current.agent } : {}),
    });
    peers.set(key, next);
    this.write({ ...data, peers });
    return next;
  }

  private write(data: SettingsData): void {
    atomicWrite(this.path, [JSON.stringify({
      version: 1,
      peers: Object.fromEntries([...data.peers, ...data.invalidPeers]),
      templates: Object.fromEntries([...data.templates, ...data.invalidTemplates]),
    })]);
    this.seenFile = true;
    this.cache = undefined;
  }

  private read(): SettingsData {
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !this.seenFile) {
        return { peers: new Map(), invalidPeers: new Map(), templates: new Map(), invalidTemplates: new Map() };
      }
      throw error;
    }
    this.seenFile = true;
    const signature = `${stats.ino}:${stats.mtimeMs}:${stats.size}`;
    if (this.cache?.signature === signature) return this.cache.data;
    const root = robotObject(JSON.parse(readFileSync(this.path, 'utf8')), ['version', 'peers', 'templates']);
    if (root.version !== 1 || !root.peers || typeof root.peers !== 'object' || Array.isArray(root.peers)) throw new Error('QQ 会话设置格式无效。');
    const { values: peers, invalid: invalidPeers } = readSettingsRows(root.peers, (_key, raw) => {
      const value = robotObject(raw, ['alias', 'receiving', 'recording', 'retention', 'revision', 'agent']);
      const retention = value.retention !== undefined ? retentionValue(value.retention)
        : value.recording !== undefined && !recordingValue(value.recording) ? 'paused' : 'forever';
      return Object.freeze({ alias: aliasValue(value.alias), receiving: receivingValue(value.receiving), retention, revision: robotRevision(value.revision),
        ...(value.agent === undefined ? {} : { agent: parseAgentSettings(value.agent) }),
      });
    });
    const rawTemplates = root.templates === undefined ? {} : root.templates;
    if (!rawTemplates || typeof rawTemplates !== 'object' || Array.isArray(rawTemplates)) throw new Error('QQ 默认设置格式无效。');
    const { values: templates, invalid: invalidTemplates } = readSettingsRows(rawTemplates, (appId, raw) => {
      robotAppId(appId);
      const row = robotObject(raw, ['revision', 'settings']);
      return { revision: robotRevision(row.revision), settings: parseAgentSettings(row.settings) };
    });
    if (invalidPeers.size || invalidTemplates.size) {
      this.logger?.warn(`QQBot found ${invalidPeers.size} invalid conversation settings and ${invalidTemplates.size} invalid robot defaults. Their saved records were preserved.`);
    }
    const data = { peers, invalidPeers, templates, invalidTemplates };
    this.cache = { signature, data };
    return data;
  }
}

interface SettingsData {
  peers: Map<string, PeerSettings>;
  invalidPeers: Map<string, unknown>;
  templates: Map<string, WorkbenchDefaults>;
  invalidTemplates: Map<string, unknown>;
}

function readSettingsRows<T>(rows: object, parse: (key: string, raw: unknown) => T) {
  const values = new Map<string, T>();
  const invalid = new Map<string, unknown>();
  for (const [key, raw] of Object.entries(rows)) {
    try { values.set(key, parse(key, raw)); }
    catch { invalid.set(key, raw); }
  }
  return { values, invalid };
}

function settingAt<T>(values: ReadonlyMap<string, T>, invalid: ReadonlyMap<string, unknown>, key: string): T | undefined {
  if (invalid.has(key)) throw new WorkbenchRequestError(409, '这条 QQ 设置记录无法读取，请检查配置文件。');
  return values.get(key);
}
function recordingValue(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('QQ 消息保存开关无效。');
  return value;
}

function retentionValue(value: unknown): MessageRetention {
  if (isMessageRetention(value)) return value;
  throw new Error('QQ 消息保留策略无效。');
}

interface ConversationAccount {
  access: AccessControlConfig;
  mediaRoot?: string;
  executionBlocked?(scope: ChatScope, openId: string): string | undefined;
  agentSettings?(scope: ChatScope, openId: string, existing: boolean): WorkbenchAgentSettings;
  validateAgent?(next: WorkbenchAgentSettings, current: WorkbenchAgentSettings): Promise<void>;
  peerName(scope: ChatScope, openId: string): string;
  refreshGroupName?(openId: string): Promise<void> | undefined;
  mentionName?(groupId: string, openId: string): string | undefined;
  liveSessionId(scope: ChatScope, openId: string): string | undefined;
  sessionChangePending?(scope: ChatScope, openId: string): boolean;
}
type RuntimeReader = Pick<RobotRuntimes, 'prefs' | 'conversationSettings' | 'timeline'> & Partial<Pick<RobotRuntimes, 'toolPolicies' | 'newSession'>> & {
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
  target?: Pick<WorkbenchConversation, 'scope' | 'openId'>,
  summary = false,
  refreshGroupNames = false,
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
      if (refreshGroupNames && scope === 'group' && allowsConversation(account.access, scope, openId)) {
        await account.refreshGroupName?.(openId);
      }
      const binding = bindings.get(key);
      const current = account.liveSessionId(scope, openId) ?? binding?.current ?? robots.prefs.legacySessionId(key);
      const ids = new Set(binding?.history ?? []);
      if (current !== undefined) ids.add(current);
      const sessionCount = ids.size;
      const sessions: WorkbenchSession[] = [];
      if (summary) ids.clear();
      if (summary && current !== undefined) ids.add(current);
      for (const id of ids) {
        const session = await readSession(id);
        if (session) sessions.push(session);
      }
      sessions.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
      const settings = robots.conversationSettings.get(key);
      const historyCount = binding?.history.length ?? 0;
      const established = sessions.length > 0 || (summary && historyCount > 0);
      const agent = account.agentSettings?.(scope, openId, established);
      return {
        scope, openId, name: account.peerName(scope, openId),
        ...settings, recording: settings.retention !== 'paused', agent,
        ...(!settings.agent && agent && !established
          ? { defaultsRevision: robots.conversationSettings.template(appId)?.revision ?? 0 } : {}),
        admitted: allowsConversation(account.access, scope, openId),
        executionBlocked: account.executionBlocked?.(scope, openId),
        currentSessionId: sessions.some(session => session.id === current) ? current : undefined,
        sessions,
        sessionCount,
      };
    })));
  }
  return conversations;
}

async function parsePatch(request: Request): Promise<WorkbenchConversationPatch> {
  const text = await request.text();
  if (Buffer.byteLength(text) > 512 * 1024) throw new Error('会话设置请求过大。');
  const value = robotObject(JSON.parse(text), ['appId', 'scope', 'openId', 'revision', 'defaultsRevision', 'alias', 'receiving', 'recording', 'retention', 'confirmRetention', 'agent']);
  if ((value.scope !== 'c2c' && value.scope !== 'group') || !validOpenId(value.openId)) throw new Error('QQ 会话地址无效。');
  if (value.alias === undefined && value.receiving === undefined && value.recording === undefined && value.retention === undefined && value.agent === undefined) {
    throw new Error('缺少要保存的会话设置。');
  }
  if ((value.retention !== undefined && value.recording !== undefined)
    || (value.confirmRetention !== undefined && (value.confirmRetention !== true || value.retention === undefined))) {
    throw new Error('QQ 消息保留策略请求无效。');
  }
  return {
    appId: robotAppId(value.appId), scope: value.scope, openId: value.openId, revision: robotRevision(value.revision),
    ...(value.defaultsRevision === undefined ? {} : { defaultsRevision: robotRevision(value.defaultsRevision) }),
    ...(value.alias === undefined ? {} : { alias: aliasValue(value.alias) }),
    ...(value.receiving === undefined ? {} : { receiving: receivingValue(value.receiving) }),
    ...(value.recording === undefined ? {} : { recording: recordingValue(value.recording) }),
    ...(value.retention === undefined ? {} : { retention: retentionValue(value.retention) }),
    ...(value.confirmRetention === true ? { confirmRetention: true as const } : {}),
    ...(value.agent === undefined ? {} : { agent: parseAgentSettings(value.agent) }),
  };
}

export function workbenchTimelineService(robots: Pick<RuntimeReader, 'conversationAccount' | 'timeline'>): QqbotTimelineService {
  const displayMentions = (row: TimelineEntry, account: ConversationAccount, groupId: string): TimelineEntry => {
    const format = (text: string) => text.replace(/<@!?([A-Za-z0-9_-]{1,256})>/g, (_, id: string) =>
      `@${account.mentionName?.(groupId, id) || `成员 ${id.slice(-8)}`}`);
    const displayText = format(row.text);
    const quoteText = row.quote && format(row.quote.text);
    return {
      ...row,
      ...(displayText === row.text ? {} : { displayText }),
      ...(row.quote && quoteText !== row.quote.text ? { quote: { ...row.quote, displayText: quoteText } } : {}),
    };
  };
  return {
    timelinePage({ appId, scope, openId }, before) {
      const account = robots.conversationAccount(appId);
      if (!account) return undefined;
      const page = robots.timeline.page(appId, { scope, targetId: openId }, before);
      return page && scope === 'group' ? { ...page, entries: page.entries.map(row => displayMentions(row, account, openId)) } : page;
    },
    timelineEntry({ appId, scope, openId }, entryId) {
      const account = robots.conversationAccount(appId);
      if (!account) return undefined;
      const row = robots.timeline.entry(appId, { scope, targetId: openId }, entryId);
      return row && scope === 'group' ? displayMentions(row, account, openId) : row;
    },
    async timelineImage({ appId, scope, openId }, entryId, index) {
      const account = robots.conversationAccount(appId);
      if (!account?.mediaRoot) return undefined;
      const file = robots.timeline.imageFile(appId, { scope, targetId: openId }, entryId, index);
      return file ? workbenchImage(account.mediaRoot, file) : undefined;
    },
  };
}

export function registerWorkbenchConversations(
  ctx: Context,
  robots: RuntimeReader,
  logger: Logger,
  timeline = workbenchTimelineService(robots),
): void {
  registerWorkbenchFetch(ctx, WORKBENCH_TIMELINE_CLEAR_PATH, ['POST'], async (request, assertWritable) => {
    let ref: QqConversationRef;
    let revision: number;
    try {
      const body = await request.text();
      if (Buffer.byteLength(body) > 8 * 1024) throw new Error();
      const { appId, scope, openId, revision: version, confirmed } = robotObject(JSON.parse(body),
        ['appId', 'scope', 'openId', 'revision', 'confirmed']);
      if ((scope !== 'c2c' && scope !== 'group') || !validOpenId(openId) || confirmed !== true) throw new Error();
      ref = { appId: robotAppId(appId), scope, openId };
      revision = robotRevision(version);
    } catch {
      throw new WorkbenchRequestError(400, '请选择要清空的 QQ 会话并确认。');
    }
    const { appId, scope, openId } = ref;
    assertWritable();
    if (!robots.conversationAccount(appId)) throw new WorkbenchRequestError(404, '找不到这个 QQ 机器人。');
    if (robots.conversationSettings.get(peerKey(appId, scope, openId)).revision !== revision) {
      throw new WorkbenchRequestError(409, '会话设置已更新，请刷新后重新确认清空。');
    }
    robots.timeline.clearPeer(appId, { scope, targetId: openId });
    return workbenchJson({ cleared: true });
  });
  registerWorkbenchFetch(ctx, WORKBENCH_TIMELINE_PATH, ['GET'], async request => {
    if (request.method !== 'GET') return workbenchJson({ error: '不支持的请求方法。' }, 405);
    const query = new URL(request.url).searchParams;
    let appId: string;
    const scope = query.get('scope');
    const openId = query.get('openId');
    const before = query.get('before') ?? undefined;
    const entryId = query.get('entryId') ?? undefined;
    const image = query.get('image');
    try {
      if (['appId', 'scope', 'openId', 'before', 'entryId', 'image'].some(key => query.getAll(key).length > 1)) throw new Error();
      appId = robotAppId(query.get('appId'));
      if ((scope !== 'group' && scope !== 'c2c') || !validOpenId(openId)
        || (before !== undefined && !/^[a-f0-9-]{36,64}$/.test(before))
        || (entryId !== undefined && (before !== undefined || !/^[a-f0-9-]{36,64}$/.test(entryId)))
        || (image !== null && (entryId === undefined || !/^\d$/.test(image) || Number(image) >= MAX_TIMELINE_IMAGES))) throw new Error();
    } catch {
      return workbenchJson({ error: 'QQ 流水查询参数无效。' }, 400);
    }
    if (!robots.conversationAccount(appId)) return workbenchJson({ error: '找不到这个 QQ 机器人。' }, 404);
    try {
      const target: QqConversationRef = { appId, scope, openId };
      if (entryId !== undefined) {
        if (image !== null) {
          const preview = await timeline.timelineImage(target, entryId, Number(image));
          return preview ?? workbenchJson({ error: '图片已过期或无法预览。' }, 404);
        }
        const entry = timeline.timelineEntry(target, entryId);
        return entry ? workbenchJson(entry) : workbenchJson({ error: '这条记录已不可用。' }, 404);
      }
      const page = timeline.timelinePage(target, before);
      return page ? workbenchJson(page) : workbenchJson({ error: '该页记录已不可用，请刷新。' }, 404);
    } catch {
      return workbenchJson({ error: 'QQ 流水读取失败，记录可能不完整。' }, 503);
    }
  });
  registerWorkbenchFetch(ctx, WORKBENCH_NEW_SESSION_PATH, ['POST'], async (request, assertWritable) => {
    let input: WorkbenchNewSession;
    try {
      const text = await request.text();
      if (Buffer.byteLength(text) > 16 * 1024) throw new Error();
      const row = robotObject(JSON.parse(text), ['appId', 'scope', 'openId', 'revision', 'currentSessionId', 'cwd', 'preset']);
      if ((row.scope !== 'c2c' && row.scope !== 'group') || !validOpenId(row.openId)
        || (row.currentSessionId !== null && !validOpenId(row.currentSessionId))
        || typeof row.cwd !== 'string' || row.cwd.length > 4096 || row.cwd.includes('\0')
        || typeof row.preset !== 'string' || row.preset.length > 256 || row.preset.includes('\0')) throw new Error();
      input = {
        appId: robotAppId(row.appId), scope: row.scope, openId: row.openId, revision: robotRevision(row.revision),
        currentSessionId: row.currentSessionId, cwd: row.cwd, preset: row.preset,
      };
    } catch {
      throw new WorkbenchRequestError(400, '新建 Session 的参数无效。');
    }
    const [peer] = await projectConversations(robots, input.appId, getPersistence(ctx), input);
    if (!peer) throw new WorkbenchRequestError(404, '这个 QQ 会话尚未登记。');
    if (peer.revision !== input.revision || (peer.currentSessionId ?? null) !== input.currentSessionId) {
      throw new WorkbenchRequestError(409, '会话或设置已变化，请刷新后重试。');
    }
    if (!robots.newSession) throw new WorkbenchRequestError(503, '此宿主暂不支持新建 QQ Session。');
    const sessionId = await robots.newSession(input, peer, assertWritable);
    return workbenchJson({ sessionId }, 201);
  });
  registerWorkbenchFetch(ctx, WORKBENCH_CONVERSATIONS_PATH, ['GET', 'POST'], async (request, assertWritable) => {
    const persistence = getPersistence(ctx);
    if (request.method === 'GET') {
      const query = new URL(request.url).searchParams;
      const scope = query.get('scope');
      const openId = query.get('openId');
      let appId: string;
      let target: { scope: ChatScope; openId: string } | undefined;
      try {
        const ids = query.getAll('appId');
        if (ids.length !== 1) throw new Error();
        appId = robotAppId(ids[0]);
        if (scope !== null || openId !== null) {
          if ((scope !== 'group' && scope !== 'c2c') || !validOpenId(openId)) throw new Error();
          target = { scope, openId };
        }
      } catch {
        return workbenchJson({ error: '请指定一个有效的 AppID 和会话。' }, 400);
      }
      try {
        const summary = !target && query.get('summary') === '1';
        const refreshGroupNames = query.get('refreshGroupNames') === '1';
        return workbenchJson({ conversations: await projectConversations(robots, appId, persistence, target, summary, refreshGroupNames) });
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
    if (patch.retention !== undefined && shortensRetention(conversation.retention, patch.retention) && !patch.confirmRetention) {
      throw new WorkbenchRequestError(400, '缩短消息保留期前需要确认清理范围。');
    }
    const key = peerKey(patch.appId, patch.scope, patch.openId);
    const sessionBindings = () => {
      const account = robots.conversationAccount(patch.appId);
      const binding = robots.prefs.listSessionBindings(patch.appId).find(row => row.key === key);
      const live = account?.liveSessionId(patch.scope, patch.openId);
      const pending = account?.sessionChangePending?.(patch.scope, patch.openId);
      return { current: binding?.current, history: binding?.history ?? [], live, pending };
    };
    const baseline = patch.agent ? sessionBindings() : undefined;
    const sessions = [...new Set([...conversation.sessions.map(session => session.id), ...(baseline?.history ?? []),
      ...(baseline?.current ? [baseline.current] : []), ...(baseline?.live ? [baseline.live] : [])])];
    const assertCurrent = () => {
      assertWritable();
      if (robots.conversationSettings.get(key).revision !== patch.revision) {
        throw new WorkbenchRequestError(409, '会话设置已更新，请重新加载后再保存。');
      }
      if ((patch.defaultsRevision !== undefined && patch.defaultsRevision !== conversation.defaultsRevision)
        || (conversation.defaultsRevision !== undefined
          && (robots.conversationSettings.template(patch.appId)?.revision ?? 0) !== conversation.defaultsRevision)) {
        throw new WorkbenchRequestError(409, '机器人默认设置已更新，请合并会话草稿。');
      }
      if (baseline) {
        const current = sessionBindings();
        if (baseline.pending || current.pending || JSON.stringify(current) !== JSON.stringify(baseline)) {
          throw new WorkbenchRequestError(409, 'Session 正在切换或已更新，请重新加载后再保存。');
        }
      }
    };
    try {
      let afterSave: (() => void) | undefined;
      assertCurrent();
      if (patch.agent && conversation.agent) {
        try {
          await robots.conversationAccount(patch.appId)?.validateAgent?.(patch.agent, conversation.agent);
        } catch (error) {
          throw new WorkbenchRequestError(400, error instanceof Error ? error.message : 'Agent 设置无效。');
        }
        assertCurrent();
        try {
          const validate = await robots.toolPolicies?.beforeSave(key, sessions, patch.agent);
          afterSave = validate?.();
        } catch (error) {
          throw new WorkbenchRequestError(409, error instanceof Error ? error.message : '会话正在运行，请稍后重试。');
        }
      }
      assertCurrent();
      const settings = robots.conversationSettings.save(key, { ...patch, agent: patch.agent ?? conversation.agent });
      afterSave?.();
      if (patch.retention !== undefined) robots.timeline.expire(patch.appId, { scope: patch.scope, targetId: patch.openId });
      return workbenchJson({ conversation: {
        ...conversation, ...settings, recording: settings.retention !== 'paused',
        defaultsRevision: settings.agent ? undefined : conversation.defaultsRevision,
      } });
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
    let attachment: ManualAttachment | undefined;
    let replyTo: string | undefined;
    try {
      const fields = ['appId', 'scope', 'openId', 'operation'];
      let row: Record<string, unknown>;
      if (request.method === 'GET') {
        const query = new URL(request.url).searchParams;
        if (fields.some(field => query.getAll(field).length !== 1)) throw new Error();
        row = Object.fromEntries(query);
      } else {
        const contentType = request.headers.get('content-type') ?? '';
        if (/^multipart\/form-data\s*;/i.test(contentType)) {
          const limit = QQ_MANUAL_ATTACHMENT_LIMIT + 16 * 1024;
          if (Number(request.headers.get('content-length')) > limit) throw new WorkbenchRequestError(400, '附件最多 4 MiB。');
          const raw = await request.arrayBuffer();
          if (raw.byteLength > limit) throw new WorkbenchRequestError(400, '附件最多 4 MiB。');
          const form = await new Response(raw, { headers: { 'Content-Type': contentType } }).formData();
          const formFields = [...fields, 'text', 'attachment'];
          if ([...form.keys()].some(key => !formFields.includes(key)) || formFields.some(key => form.getAll(key).length !== 1)) throw new Error();
          const file = form.get('attachment');
          if (!(file instanceof File) || file.size === 0 || file.size > QQ_MANUAL_ATTACHMENT_LIMIT) {
            throw new WorkbenchRequestError(400, '请选择一个非空附件，最多 4 MiB。');
          }
          const name = file.name.trim();
          if (!name || name === '.' || name === '..' || Buffer.byteLength(name) > 255 || /[\\/:\x00-\x1f\x7f]/.test(name)) {
            throw new WorkbenchRequestError(400, '附件名称无效。');
          }
          attachment = { name, bytes: Buffer.from(await file.arrayBuffer()) };
          row = Object.fromEntries([...fields, 'text'].map(key => [key, form.get(key)]));
        } else {
          const raw = await request.text();
          if (Buffer.byteLength(raw) > 16 * 1024) throw new Error();
          row = robotObject(JSON.parse(raw), [...fields, 'text', 'replyTo']);
          if (row.replyTo !== undefined) {
            if (typeof row.replyTo !== 'string' || !/^[a-f0-9]{64}$/.test(row.replyTo)) throw new Error();
            replyTo = row.replyTo;
          }
        }
        if (typeof row.text !== 'string' || row.text.length > QQ_MANUAL_MESSAGE_LIMIT || row.text.includes('\0') || (!attachment && !row.text.trim())) throw new Error();
        message = row.text;
      }
      appId = robotAppId(row.appId);
      if ((row.scope !== 'c2c' && row.scope !== 'group') || typeof row.openId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(row.openId)
        || typeof row.operation !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(row.operation)) throw new Error();
      target = { scope: row.scope, targetId: row.openId };
      operation = row.operation;
    } catch (error) {
      if (error instanceof WorkbenchRequestError) throw error;
      return workbenchJson({ error: '发送参数无效，请检查对话和消息长度。' }, 400);
    }
    if (message === undefined) {
      const result = robots.manualStatus(appId, target, operation);
      return result ? workbenchJson(result) : workbenchJson({ error: '未找到此发送操作。' }, 404);
    }
    assertWritable();
    return workbenchJson(await robots.manualSend(appId, target, operation, message, assertWritable, undefined, attachment, replyTo));
  });
}
