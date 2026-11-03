import Schema from '@deepseek-ai/schemastery';
import type { ConversationEntry, DeliveryRecord, GroupMessageRecord, RecordingSettings, RoleSettings } from '../shared/conversation-protocol.ts';
import { validatePolicy } from '../policy/validation.ts';
import { validateQQAgentSettings } from '../shared/agent-settings.ts';

const string = () => Schema.string().required();
const timestamp = () => Schema.natural().required();
const roleSchema = Schema.object({ description: string(), tone: string(), world: string(), prompt: string() });
const provenance = () => Schema.union(['qq', 'web', 'automatic', 'command', 'interaction', 'sdk', 'legacy']);
const bodyState = () => Schema.union(['available', 'expired', 'disabled']);
const messageSchema = Schema.object({
  id: string(), senderId: string(), senderName: string(), text: string(), at: timestamp(),
  mentioned: Schema.boolean().required(),
  contextEligible: Schema.boolean(), provenance: provenance(),
  sessionId: Schema.string(), turnId: Schema.string(), sourceMessageId: Schema.string(),
  bodyState: bodyState(), bodyHash: Schema.string(),
  attachments: Schema.array(Schema.object({ name: string(), type: string(), url: Schema.string(), kind: Schema.union(['image', 'video', 'voice', 'file']) })).required(),
});
const entrySchema = Schema.object({
  key: string(), appId: string(), scope: Schema.union(['group', 'c2c']).required(),
  peerId: string(), name: string(), alias: string(),
  currentSessionId: Schema.any<unknown>(),
  legacySessionAssociation: Schema.any<unknown>(),
  sessions: Schema.array(Schema.object({ sessionId: string(), startedAt: timestamp(), endedAt: Schema.natural(), receivedMessages: Schema.natural(), role: Schema.any<unknown>(), prompt: Schema.string() })).required(),
  members: Schema.array(Schema.object({ id: string(), name: string(), lastSeen: timestamp() })).required(),
  policy: Schema.any<unknown>().required(), lastActivity: timestamp(),
  observedAllMessages: Schema.boolean().required(),
  // Preserve absence for legacy records; object schemas otherwise synthesize {}.
  lifecycle: Schema.any<unknown>(),
  nativeLog: Schema.any<unknown>(), recording: Schema.any<unknown>(),
  lastMessage: Schema.string(), lastMessageAt: Schema.natural(),
  workspaceId: Schema.string(),
  settings: Schema.any<unknown>(), defaultsPending: Schema.boolean(),
});
const deliverySchema = Schema.object({
  id: string(), key: string(), text: string(), at: timestamp(), updatedAt: timestamp(),
  state: Schema.union(['pending', 'sending', 'accepted', 'failed', 'unknown']).required(),
  parts: Schema.array(Schema.object({
    index: Schema.natural().required(),
    state: Schema.union(['pending', 'accepted', 'failed', 'unknown']).required(), receiptId: Schema.string(),
  })).required(),
  error: Schema.string(), receiptId: Schema.string(),
  bodyState: bodyState(), bodyHash: Schema.string(), order: Schema.natural(), change: Schema.natural(),
  provenance: provenance(), sourceSessionId: Schema.string(), sourceMessageId: Schema.string(), turnId: Schema.string(), answerId: Schema.string(),
});

export function parseMessage(value: unknown): GroupMessageRecord {
  const result = messageSchema['~standard'].validate(value);
  if (result instanceof Promise) throw new Error('Message schema must be synchronous');
  if (result.issues) throw new TypeError('Invalid QQ message record');
  const { id, senderId, senderName, text, at, mentioned, attachments, contextEligible, provenance, sessionId, turnId, sourceMessageId, bodyState, bodyHash } = result.value as ReturnType<typeof messageSchema>;
  const attachmentsTooLarge = attachments.some((item) => item.name.length > 1_024 || item.type.length > 256 || (item.url?.length ?? 0) > 4_096 || (item.url !== undefined && !/^https?:\/\//i.test(item.url)));
  if (!id || id.length > 1_024 || senderId.length > 1_024 || senderName.length > 300 || text.length > 100_000
    || attachments.length > 100 || attachmentsTooLarge) throw new TypeError('QQ message exceeds storage limits');
  // Explicit projection drops transport tokens and arbitrary raw fields, but keeps the media url/kind so the
  // web UI can render images/video/voice/file the way QQ shows them.
  return {
    ...(contextEligible === undefined ? {} : { contextEligible }), ...(provenance === undefined ? {} : { provenance }),
    ...(sessionId === undefined ? {} : { sessionId }), ...(turnId === undefined ? {} : { turnId }), ...(sourceMessageId === undefined ? {} : { sourceMessageId }),
    ...(bodyState === undefined ? {} : { bodyState }), ...(bodyHash === undefined ? {} : { bodyHash }),
    id, senderId, senderName, text, at, mentioned, attachments: attachments.map(({ name, type, url, kind }) => ({ name, type, ...(url ? { url } : {}), ...(kind ? { kind } : {}) })) };
}

export function parseEntry(value: unknown): ConversationEntry {
  const result = entrySchema['~standard'].validate(value);
  if (result instanceof Promise) throw new Error('Entry schema must be synchronous');
  if (result.issues) throw new TypeError('Invalid QQ conversation record');
  const data = result.value as ReturnType<typeof entrySchema>;
  const scope = data.scope === 'group' ? 'group' : 'c2c';
  if (data.currentSessionId !== null && typeof data.currentSessionId !== 'string') throw new TypeError('Invalid current QQ Session');
  const legacySessionAssociation = data.legacySessionAssociation === undefined ? undefined : parseLegacySessionAssociation(data.legacySessionAssociation);
  if (legacySessionAssociation && legacySessionAssociation.sessionId !== data.currentSessionId) throw new TypeError('Legacy QQ Session association mismatch');
  if (data.workspaceId !== undefined && (!data.workspaceId.trim() || data.workspaceId.length > 256 || data.workspaceId.includes('\0'))) throw new TypeError('Invalid QQ workspace identity');
  return {
    ...(data.workspaceId === undefined ? {} : { workspaceId: data.workspaceId }),
    ...(data.settings === undefined ? {} : { settings: validateQQAgentSettings(data.settings) }),
    ...(data.defaultsPending === undefined ? {} : { defaultsPending: data.defaultsPending }),
    ...(legacySessionAssociation === undefined ? {} : { legacySessionAssociation }),
    key: data.key, appId: data.appId, scope, peerId: data.peerId, name: data.name,
    alias: data.alias, currentSessionId: data.currentSessionId,
    sessions: data.sessions.map(({ sessionId, startedAt, endedAt, receivedMessages, role, prompt }) => ({ sessionId, startedAt, ...(endedAt === undefined ? {} : { endedAt }), ...(receivedMessages === undefined ? {} : { receivedMessages }), ...(role === undefined ? {} : { role: parseRole(role) }), ...(prompt === undefined ? {} : { prompt }) })),
    members: data.members.map(({ id, name, lastSeen }) => ({ id, name, lastSeen })),
    lifecycle: parseLifecycle(data.lifecycle ?? { rotateDays: 7, maxMessages: 1000, retentionDays: null }),
    ...(data.recording === undefined ? {} : { recording: parseRecording(data.recording) }),
    nativeLog: data.nativeLog == null ? { enabled: false, since: null } : parseNativeLog(data.nativeLog),
    ...(data.lastMessageAt === undefined ? {} : { lastMessageAt: data.lastMessageAt }),
    lastMessage: typeof data.lastMessage === 'string' ? data.lastMessage.slice(0, 300) : '',
    policy: validatePolicy(data.policy), lastActivity: data.lastActivity, observedAllMessages: data.observedAllMessages,
  };
}

function parseLegacySessionAssociation(value: unknown): NonNullable<ConversationEntry['legacySessionAssociation']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid legacy QQ Session association');
  const data = Object.fromEntries(Object.entries(value));
  if (data.state !== 'pending' || typeof data.sessionId !== 'string' || !data.sessionId.trim() || data.sessionId.length > 1_024 || data.sessionId.includes('\0')) throw new TypeError('Invalid legacy QQ Session association');
  return { state: 'pending', sessionId: data.sessionId };
}

export function parseDelivery(value: unknown): DeliveryRecord {
  const result = deliverySchema['~standard'].validate(value);
  if (result instanceof Promise) throw new Error('Delivery schema must be synchronous');
  if (result.issues) throw new TypeError('Invalid QQ delivery record');
  const data = result.value as ReturnType<typeof deliverySchema>;
  if (!data.id || data.id.length > 256 || data.text.length > 100_000) throw new TypeError('QQ delivery exceeds storage limits');
  return {
    id: data.id, key: data.key, text: data.text, at: data.at, updatedAt: data.updatedAt,
    state: data.state,
    parts: data.parts.map(({ index, state, receiptId }) => ({ index, state, ...(receiptId === undefined ? {} : { receiptId }) })),
    ...Object.fromEntries(Object.entries(data).filter(([key, value]) => value !== undefined && ['receiptId', 'bodyState', 'bodyHash', 'order', 'change', 'provenance', 'sourceSessionId', 'sourceMessageId', 'turnId', 'answerId'].includes(key))),
    ...(data.error ? { error: data.error } : {}),
  };
}

export function parseLifecycle(value: unknown): import('../shared/conversation-protocol.ts').ConversationLifecycle {
  if (!value || typeof value !== 'object') throw new TypeError('会话生命周期配置无效');
  const data = Object.fromEntries(Object.entries(value));
  for (const key of ['rotateDays', 'maxMessages']) {
    if (typeof data[key] !== 'number' || !Number.isSafeInteger(data[key]) || data[key] < 0 || data[key] > 1000000) throw new TypeError('会话换新限制无效');
  }
  if (data.retentionDays !== null && (typeof data.retentionDays !== 'number' || !Number.isSafeInteger(data.retentionDays) || data.retentionDays < 1 || data.retentionDays > 36500)) throw new TypeError('历史保留天数无效');
  return { rotateDays: data.rotateDays as number, maxMessages: data.maxMessages as number, retentionDays: data.retentionDays as number | null };
}
function parseNativeLog(value: unknown): import('../shared/conversation-protocol.ts').NativeLogSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('原生日志配置无效');
  const { enabled, since } = value as Record<string, unknown>;
  if (typeof enabled !== 'boolean' || (since !== null && (typeof since !== 'number' || !Number.isSafeInteger(since) || since < 0))) throw new TypeError('原生日志配置无效');
  return { enabled, since: since as number | null };
}
function parseRole(value: unknown): RoleSettings {
  const result = roleSchema['~standard'].validate(value);
  if (result instanceof Promise) throw new Error('Role schema must be synchronous');
  if (result.issues) throw new TypeError('Invalid stored QQ Session role');
  const { description, tone, world, prompt } = result.value as ReturnType<typeof roleSchema>;
  return { description, tone, world, prompt };
}

export function parseRecording(value: unknown): RecordingSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('QQ 记录配置无效');
  const data = Object.fromEntries(Object.entries(value));
  const { version, enabled, since, retentionDays } = data;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1
    || typeof enabled !== 'boolean'
    || (since !== null && (typeof since !== 'number' || !Number.isSafeInteger(since) || since < 0))
    || typeof retentionDays !== 'number' || !Number.isSafeInteger(retentionDays) || retentionDays < 0 || retentionDays > 36500) throw new TypeError('QQ 记录配置无效');
  return { version, enabled, since, retentionDays };
}
