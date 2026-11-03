/** QQ conversation contracts shared by Host and client. Never include credentials. */
import type { QQAgentSettings, QQDefaults } from './agent-settings.ts';
export const CONVERSATIONS_PATH = '/qqbot/im-qqbot/conversations';
export type ToolDecision = 'deny' | 'ask' | 'allow';
export type PolicyTemplate = 'chat' | 'roleplay' | 'readonly' | 'project' | 'custom';
export type ContextMode = 'interaction' | 'recent' | 'archive';
export type ConversationToolMode = 'restricted' | 'native';
export type ConversationSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
/** 角色设定。card 为 role-card markdown（可用 〔群聊〕/〔私聊〕 分节）；其余字段在 card 为空时兜底生成。 */
export interface RoleSettings { description: string; tone: string; world: string; prompt: string; card?: string }
export interface ResourcePolicy {
  readRoots: string[]; writeRoots: string[]; sendRoots: string[];
  executionEnabled: boolean; sandbox: ConversationSandboxMode;
  networkDomains: string[]; maxFiles: number; maxFileMB: number;
}
export interface ContextPolicy { mode: ContextMode; maxMessages: number; maxAgeMinutes: number; maxChars: number; retentionDays: number }
export interface ConversationPolicy {
  receiveEnabled?: boolean;
  version: number; template: PolicyTemplate; name: string; role: RoleSettings;
  tools: Record<string, ToolDecision>; resources: ResourcePolicy;
  controllers: string[]; approvers: string[]; allowedModels: string[]; allowedPresets: string[];
  /** Missing on legacy policies means restricted; native explicitly follows the selected Agent. */
  toolMode?: ConversationToolMode;
  /** Missing on existing policies retains the explicit tool ceiling. */
  nativeTools?: boolean;
  allowedPermissions: string[];
  /** Creation/default permission preset. Current selection lives in the native Session log. */
  permission: string; cwd: string; requireMention: boolean; replyEnabled?: boolean;
  context: ContextPolicy;
}
export interface ToolCatalogEntry {
  id: string; name: string; description: string;
  category: 'file' | 'search' | 'network' | 'execution' | 'mcp' | 'attachment' | 'other';
  constraint: 'read-path' | 'write-path' | 'send-path' | 'execution' | 'unsupported' | 'none';
  available: boolean; reason?: string;
}
export interface ConversationMember { id: string; name: string; lastSeen: number }
export interface ConversationLifecycle {
  rotateDays: number; maxMessages: number; retentionDays: number | null;
}
export interface NativeLogSettings { enabled: boolean; since: number | null }
export interface RecordingSettings { version: number; enabled: boolean; since: number | null; retentionDays: number }
export type RecordingBodyState = 'available' | 'expired' | 'disabled';
export type MessageProvenance = 'qq' | 'web' | 'automatic' | 'command' | 'interaction' | 'sdk' | 'legacy';
export interface DeliveryProvenance { sourceSessionId?: string; sourceMessageId?: string; turnId?: string; answerId?: string; provenance?: MessageProvenance }
export interface ConversationEntry {
  key: string; appId: string; scope: 'group' | 'c2c'; peerId: string;
  name: string; alias: string; currentSessionId: string | null;
  /** A legacy mapping is retained until the native Session has been resolved successfully. */
  legacySessionAssociation?: { state: 'pending'; sessionId: string };
  sessions: Array<{ sessionId: string; startedAt: number; endedAt?: number; receivedMessages?: number; role?: RoleSettings; prompt?: string }>;
  lifecycle?: ConversationLifecycle; nativeLog?: NativeLogSettings; recording?: RecordingSettings;
  workspaceId?: string;
  settings?: QQAgentSettings;
  defaultsPending?: boolean;
  lastMessage?: string; lastMessageAt?: number;
  members: ConversationMember[]; policy: ConversationPolicy;
  lastActivity: number; observedAllMessages: boolean;
}
export interface ConversationView extends ConversationEntry {
  admitted: boolean;
  recordingError?: string;
  archived?: boolean;
  permissionConflict?: string | null;
  effectiveRestriction?: { toolMode: ConversationToolMode; permission: string | null; sandbox: string | null };
  running: boolean; currentModel: string | null; currentPreset: string | null;
  nextPreset: string | null; deliveryState: DeliveryRecord['state'] | null;
  currentPermission?: string | null;
  selectablePresets?: string[];
  passiveReply?: { expiresAt: number | null };
  currentWorkspace?: { id: string; title: string; path: string } | null;
}
/** 消息附件：type 为 MIME/归类，url 可直接在 web 展示（图片/视频/语音/文件下载）。 */
export interface QQAttachment { name: string; type: string; url?: string; kind?: 'image' | 'video' | 'voice' | 'file' }

export interface GroupMessageRecord {
  cursor?: number;
  contextEligible?: boolean; provenance?: MessageProvenance;
  sessionId?: string; turnId?: string; sourceMessageId?: string;
  bodyState?: RecordingBodyState; bodyHash?: string;
  id: string; senderId: string; senderName: string; text: string; at: number;
  mentioned: boolean; attachments: Array<QQAttachment>;
}
export interface DeliveryRecord extends DeliveryProvenance {
  id: string; key: string; text: string; at: number; updatedAt: number;
  state: 'pending' | 'sending' | 'accepted' | 'failed' | 'unknown';
  parts: Array<{ index: number; state: 'pending' | 'accepted' | 'failed' | 'unknown'; receiptId?: string }>;
  receiptId?: string; bodyState?: RecordingBodyState; bodyHash?: string;
  order?: number; change?: number;
  error?: string;
}
export type TimelineEntry =
  | { direction: 'inbound'; order: number; change: number; message: GroupMessageRecord }
  | { direction: 'outbound'; order: number; change: number; delivery: DeliveryRecord };
export interface TimelineQuery { before?: number; snapshot?: number; after?: number; query?: string; limit?: number }
export interface TimelinePage { items: TimelineEntry[]; snapshot: number; hasMore: boolean; nextBefore?: number; nextAfter?: number }
/** UI-facing slash-command metadata derived from the command registry (no handlers). */
export interface SlashCommandDescriptor { name: string; aliases: string[]; description: string; category: 'agent' | 'qqbot'; scope: 'owner'; hidden?: boolean }
export interface ConversationSnapshot { conversations: ConversationView[]; tools: ToolCatalogEntry[]; ownerIds: string[]; defaults?: QQDefaults; commands?: SlashCommandDescriptor[]; /** QQ default working directory used when a conversation leaves cwd empty. */ defaultCwd?: string; errors?: string[] }
export interface QQPeerSettingsPatch {
  alias?: string;
  receiveEnabled?: boolean;
  promptGroup?: string;
  promptDirect?: string;
  toolScope?: { kind: 'native' } | { kind: 'custom'; tools: string[] };
  permission?: ConversationSandboxMode;
  nativePermission?: string;
  expectedPermission?: string | null;
}
export type ConversationAction =
  | { action: 'defaults'; expectedVersion: number; settings: QQAgentSettings }
  | { action: 'settings'; key: string; expectedVersion: number; settings: QQAgentSettings; alias: string; receiveEnabled: boolean }
  | { action: 'peer-settings'; key: string; expectedVersion: number; patch: QQPeerSettingsPatch }
  | { action: 'clear-records'; key: string; expectedRecordingVersion: number }
  | { action: 'recording'; key: string; expectedRecordingVersion: number; enabled: boolean; retentionDays: number }
  | { action: 'timeline'; key: string; before?: number; snapshot?: number; after?: number; query?: string; limit?: number }
  | { action: 'create-session'; key: string; operationId: string; expectedCurrentSessionId: string | null; expectedPolicyVersion: number; workspaceId: string; presetId: string }
  | { action: 'unarchive'; key: string; sessionId: string }
  | { action: 'lifecycle'; key: string; expectedVersion: number; lifecycle: ConversationLifecycle; nativeLog?: boolean }
  | { action: 'admit'; key: string; enabled: boolean }
  | { action: 'owners'; ownerIds: string[] }
  | { action: 'policy'; key: string; expectedVersion: number; policy: ConversationPolicy; alias: string }
  | { action: 'reset' | 'stop'; key: string; sessionId?: string }
  | { action: 'model'; key: string; sessionId?: string; value: string; reasoningEffort?: string }
  | { action: 'preset' | 'permission'; key: string; sessionId?: string; value: string }
  | { action: 'workspace'; key: string; sessionId?: string; workspaceId: string }
  | { action: 'send'; key: string; operationId: string; text: string; sourceSessionId?: string; sourceMessageId?: string }
  | { action: 'messages'; key: string; before?: number; query?: string }
  | { action: 'deliveries'; key: string };
export interface ConversationActionResult { timeline?: TimelinePage; sessionId?: string; messages?: GroupMessageRecord[]; deliveries?: DeliveryRecord[]; delivery?: DeliveryRecord; snapshot?: ConversationSnapshot; notice?: string }
