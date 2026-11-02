import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { ConversationEntry, ConversationPolicy, DeliveryRecord, DeliveryProvenance, GroupMessageRecord, RecordingSettings, TimelineEntry, TimelinePage, TimelineQuery } from '../shared/conversation-protocol.ts';
import { defaultPolicy, validatePolicy } from '../policy/index.ts';
import { appendRecord, atomicWrite, forwardLines, reversedLines } from './files.ts';
import { parseDelivery, parseEntry, parseMessage, parseLifecycle, parseRecording } from './validation.ts';
import { defaultQQAgentSettings, validateQQAgentSettings, validateQQDefaults, type QQAgentSettings, type QQDefaults } from '../shared/agent-settings.ts';

type StoredMessage = { cursor: number; message: GroupMessageRecord; order?: number; change?: number };
interface TimelineState { nextOrder: number; nextChange: number }
interface DeliveryReservation { key: string; hash: string; publish?: boolean; published?: boolean; at?: number; order?: number; change?: number; state?: DeliveryRecord['state']; parts?: DeliveryRecord['parts']; retired?: boolean }
interface BackgroundState { next: number; consumed: number; published: StoredMessage[]; seen: string[] }
/** 认领成员展示资料（授权真相仍是 owners / access 白名单；这里只存昵称/场景用于 UI）。 */
export interface MemberProfile { nickname: string; scene: 'group' | 'c2c'; sceneName: string; claimedAt: number }
interface Catalog {
  format: 2; appId: string; owners: string[]; entries: ConversationEntry[];
  /** openid -> 展示资料；可选（旧目录无此字段）。 */
  memberProfiles?: Record<string, MemberProfile>;
  defaults: QQDefaults;
  background: Record<string, BackgroundState>;
  operations: Record<string, DeliveryReservation>;
  timeline: Record<string, TimelineState>;
}
export interface StoreOptions { defaultPolicy?: () => ConversationPolicy; now?: () => number; defaultSettings?: () => QQAgentSettings; resolveSettings?: (settings: QQAgentSettings, entry: ConversationEntry) => QQAgentSettings; projectSettings?: (entry: ConversationEntry) => QQAgentSettings }
export interface EnsureOptions { senderId?: string; senderName?: string; name?: string; allMessages?: boolean; admitted?: boolean }
export interface BackgroundSnapshot { text: string; cursor: number; messageIds: string[] }
export interface MessageQuery { before?: number; query?: string; limit?: number }
export interface DeliveryUpdate extends DeliveryProvenance { receiptId?: string; state: DeliveryRecord['state']; parts?: DeliveryRecord['parts']; error?: string }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid QQ conversation storage object');
  return value as Record<string, unknown>;
}
function natural(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid QQ conversation cursor');
  return value;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) throw new TypeError('Invalid QQ owner identities');
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function validOperationId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
    && value !== '__proto__' && value !== 'prototype' && value !== 'constructor';
}
function clone<T>(value: T): T { return structuredClone(value); }
function parseStoredMessage(value: unknown): StoredMessage {
  const data = object(value);
  return { cursor: natural(data.cursor), message: parseMessage(data.message), ...(data.order === undefined ? {} : { order: natural(data.order) }), ...(data.change === undefined ? {} : { change: natural(data.change) }) };
}

/** One instance is the sole writer for one account in one QQBOT_DATA_DIR. */
export class ConversationStore {
  private catalog: Catalog;
  private readonly path: string;
  private readonly now: () => number;
  private readonly createPolicy: () => ConversationPolicy;
  private readonly recent = new Map<string, StoredMessage[]>();
  private readonly seen = new Map<string, Set<string>>();
  private readonly lastPrune = new Map<string, number>();
  private reconcileNeeded = false;
  private catalogNeedsMigration = false;
  private migrationFailed = false;
  private readonly storageErrors = new Map<string, string>();

  public constructor(private readonly dataDir: string, private readonly appId: string, private readonly options: StoreOptions = {}) {
    if (!appId) throw new TypeError('QQ AppID is required');
    this.path = join(dataDir, `conversations-${hash(appId)}.json`);
    this.now = options.now ?? Date.now;
    this.createPolicy = options.defaultPolicy ?? (() => defaultPolicy());
    this.resumeRecordingMigration();
    this.catalog = this.load();
    this.migrateSettings();
    this.migrateRecording();
    this.reconcileArchiveCursors();
    this.pruneExpired();
    this.recoverDeliveries();
  }

  public key(scope: ConversationEntry['scope'], peerId: string): string {
    if (!peerId || peerId.length > 1_024) throw new TypeError('Invalid QQ conversation target');
    return `qqbot:${this.appId}:${scope}:${peerId}`;
  }

  public list(): ConversationEntry[] { return clone(this.catalog.entries).sort((a, b) => b.lastActivity - a.lastActivity); }
  public get(key: string): ConversationEntry | undefined { const entry = this.find(key); return entry ? clone(entry) : undefined; }
  public getBySessionId(sessionId: string): ConversationEntry | undefined {
    const entry = this.catalog.entries.find((item) => item.sessions.some((session) => session.sessionId === sessionId));
    return entry ? clone(entry) : undefined;
  }
  public errors(): string[] { return [...this.storageErrors.values()]; }
  public recordingError(key: string): string | undefined { return this.storageErrors.get(key) ?? this.storageErrors.get('catalog'); }
  public ownerIds(): string[] { return [...this.catalog.owners]; }
  public defaults(): QQDefaults { return clone(this.catalog.defaults); }
  public updateDefaults(expectedVersion: number, input: unknown): QQDefaults {
    this.assertWritable();
    if (this.catalog.defaults.version !== expectedVersion) throw new ConversationConflictError();
    const defaults = { version: expectedVersion + 1, settings: validateQQAgentSettings(input) };
    this.commit({ ...this.catalog, defaults });
    return clone(defaults);
  }
  public updateSettings(key: string, expectedVersion: number, input: unknown, alias: string, receiveEnabled: boolean): ConversationEntry {
    const entry = this.previewSettings(key, expectedVersion, input, alias, receiveEnabled);
    this.replace(entry);
    return clone(entry);
  }
  public previewSettings(key: string, expectedVersion: number, input: unknown, alias: string, receiveEnabled: boolean): ConversationEntry {
    this.assertWritable();
    const entry = this.require(key);
    if (entry.policy.version !== expectedVersion) throw new ConversationConflictError();
    const settings = validateQQAgentSettings(input);
    if (typeof alias !== 'string' || alias.length > 300 || alias.includes('\0') || typeof receiveEnabled !== 'boolean') throw new TypeError('QQ 对话设置无效');
    const policy = this.settingsPolicy(entry.policy, settings);
    entry.settings = settings; entry.defaultsPending = false; entry.alias = alias;
    entry.policy = { ...policy, version: expectedVersion + 1, receiveEnabled };
    return clone(entry);
  }
  public setOwnerIds(ids: string[]): void {
    this.assertWritable();
    const owners = strings(ids);
    if (owners.some((id) => id.length > 1_024) || owners.length > 100) throw new TypeError('Too many QQ owner identities');
    const profiles = { ...(this.catalog.memberProfiles ?? {}) };
    // 删除已不在名单里的 profile，避免残留展示资料。
    for (const id of Object.keys(profiles)) if (!owners.includes(id)) delete profiles[id];
    this.commit({ ...this.catalog, owners, memberProfiles: profiles });
  }
  /** 全部认领成员资料（openid -> profile）。 */
  public memberProfiles(): Record<string, MemberProfile> { return clone(this.catalog.memberProfiles ?? {}); }
  /** 更新某成员的展示昵称（不改 openid 身份）。 */
  public setMemberNickname(openid: string, nickname: string): void {
    this.assertWritable();
    const profiles = { ...(this.catalog.memberProfiles ?? {}) };
    const prev = profiles[openid];
    profiles[openid] = { nickname, scene: prev?.scene ?? 'c2c', sceneName: prev?.sceneName ?? '', claimedAt: prev?.claimedAt ?? Date.now() };
    this.commit({ ...this.catalog, memberProfiles: profiles });
  }
  /** 认领：把 openid 加入 owners 并记录展示资料（幂等，重复认领更新资料/时间）。 */
  public claimOwner(openid: string, profile: MemberProfile): void {
    this.assertWritable();
    const [id] = strings([openid]);
    if (id === undefined) throw new TypeError('QQ 用户标识无效');
    const owners = [...new Set([...this.catalog.owners, id])];
    if (owners.length > 100) throw new TypeError('Too many QQ owner identities');
    const profiles = { ...(this.catalog.memberProfiles ?? {}), [id]: profile };
    this.commit({ ...this.catalog, owners, memberProfiles: profiles });
  }
  /** 撤销超管：从 owners 移除并删展示资料。 */
  public revokeOwner(openid: string): void {
    this.assertWritable();
    const owners = this.catalog.owners.filter((id) => id !== openid);
    const profiles = { ...(this.catalog.memberProfiles ?? {}) };
    delete profiles[openid];
    this.commit({ ...this.catalog, owners, memberProfiles: profiles });
  }

  public ensure(scope: ConversationEntry['scope'], peerId: string, options: EnsureOptions = {}): ConversationEntry {
    this.assertWritable();
    const key = this.key(scope, peerId);
    const existing = this.find(key);
    const at = this.now();
    const entry: ConversationEntry = existing ? clone(existing) : {
      key, appId: this.appId, scope, peerId, name: options.name ?? '', alias: '', currentSessionId: null,
      sessions: [], lifecycle: { rotateDays: 7, maxMessages: 1000, retentionDays: null }, nativeLog: { enabled: false, since: null }, recording: { version: 1, enabled: true, since: at, retentionDays: 0 }, members: [], policy: validatePolicy(this.createPolicy()), lastActivity: at, observedAllMessages: false,
    };
    if (!existing || (entry.defaultsPending && options.admitted === true)) {
      entry.settings = this.resolveSettings(this.catalog.defaults.settings, entry);
      entry.policy = this.settingsPolicy(entry.policy, entry.settings);
      entry.defaultsPending = options.admitted === false;
    }
    if (options.name) entry.name = options.name.slice(0, 300);
    if (scope === 'c2c' && options.senderName) entry.name = options.senderName.slice(0, 300);
    if (options.senderId) {
      const id = options.senderId;
      const member = entry.members.find((item) => item.id === id);
      if (member) { member.lastSeen = at; if (options.senderName) member.name = options.senderName.slice(0, 300); }
      else entry.members.push({ id, name: options.senderName?.slice(0, 300) ?? '', lastSeen: at });
      entry.members = entry.members.sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 2_000);
    }
    entry.observedAllMessages ||= options.allMessages === true;
    entry.lastActivity = at;
    this.replace(entry);
    return clone(entry);
  }

  public bindSession(key: string, sessionId: string, workspaceId?: string, cwd?: string, presetId?: string): ConversationEntry {
    this.assertWritable();
    const entry = this.require(key);
    if (!sessionId || sessionId.length > 1_024) throw new TypeError('Invalid QQ Session identity');
    const other = this.catalog.entries.find((item) => item.key !== key && item.sessions.some((session) => session.sessionId === sessionId));
    if (other) throw new Error('QQ Session already belongs to another conversation');
    if (!entry.sessions.some((item) => item.sessionId === sessionId)) entry.sessions.push({ sessionId, startedAt: this.now(), receivedMessages: 0, role: clone(entry.policy.role), ...(entry.settings ? { prompt: entry.scope === 'group' ? entry.settings.promptGroup : entry.settings.promptDirect } : {}) });
    if (entry.currentSessionId && entry.currentSessionId !== sessionId) {
      const previous = entry.sessions.find(item => item.sessionId === entry.currentSessionId);
      if (previous) previous.endedAt = this.now();
    }
    if (workspaceId !== undefined) {
      if (!workspaceId.trim() || workspaceId.length > 256 || workspaceId.includes('\0')) throw new TypeError('Invalid QQ workspace identity');
      entry.workspaceId = workspaceId;
      if (cwd && entry.settings && (sessionId !== entry.currentSessionId || workspaceId !== this.require(key).workspaceId)) {
        if (entry.settings.cwd !== cwd) entry.policy.version++;
        entry.settings.cwd = cwd; entry.policy.cwd = cwd;
      }
    }
    if (presetId !== undefined && entry.settings && entry.settings.preset !== presetId) {
      entry.settings.preset = presetId; entry.policy.version++;
    }
    entry.currentSessionId = sessionId;
    this.replace(entry);
    return clone(entry);
  }

  public updatePolicy(key: string, expectedVersion: number, policy: ConversationPolicy, alias?: string): ConversationEntry {
    this.assertWritable();
    const entry = this.require(key);
    if (entry.policy.version !== expectedVersion) throw new ConversationConflictError();
    const validated = validatePolicy(policy);
    const checked = { ...validated, nativeTools: validated.nativeTools ?? true };
    const changedRole = JSON.stringify(entry.policy.role) !== JSON.stringify(checked.role);
    entry.policy = { ...checked, version: expectedVersion + 1 };
    if (entry.settings) {
      const legacy = this.projectSettings(entry);
      entry.settings = { ...entry.settings, cwd: checked.cwd, ...(changedRole ? { promptGroup: legacy.promptGroup, promptDirect: legacy.promptDirect } : {}), execution: legacy.execution };
    }
    if (alias !== undefined) {
      if (typeof alias !== 'string' || alias.length > 300) throw new TypeError('QQ alias is too long');
      entry.alias = alias;
    }
    this.replace(entry);
    return clone(entry);
  }

  public updateLifecycle(key: string, expectedVersion: number, value: unknown, nativeLog?: boolean): ConversationEntry {
    this.assertWritable();
    const entry = this.require(key);
    if (entry.policy.version !== expectedVersion) throw new ConversationConflictError();
    entry.lifecycle = parseLifecycle(value);
    if (nativeLog !== undefined) entry.nativeLog = { enabled: nativeLog, since: nativeLog ? entry.nativeLog?.since ?? this.now() : entry.nativeLog?.since ?? null };
    entry.policy.version++;
    this.replace(entry);
    return clone(entry);
  }
  /** 更新记录开关与按天保留期限（不再有按条数上限；条数概念已移除）。 */
  public updateRecording(key: string, expectedVersion: number, input: Pick<RecordingSettings, 'enabled' | 'retentionDays'>): ConversationEntry {
    this.assertWritable();
    const entry = this.require(key);
    const recording = this.recording(entry);
    if (recording.version !== expectedVersion) throw new ConversationConflictError();
    entry.recording = parseRecording({ enabled: input.enabled, retentionDays: input.retentionDays, version: expectedVersion + 1, since: input.enabled ? recording.since ?? this.now() : recording.since });
    this.replace(entry);
    this.lastPrune.delete(key);
    this.prune(key, entry.recording.retentionDays);
    return clone(entry);
  }
  /** 清空某对话的消息记录：把所有消息/投递正文置为 expired（保留 id 供去重），记录页随之清空。 */
  public clearRecords(key: string): ConversationEntry {
    this.assertWritable();
    this.require(key);
    const next = clone(this.catalog);
    const now = this.now();
    const inbound = [...forwardLines(this.messagePath(key))].map(line => parseStoredMessage(JSON.parse(line)));
    const deliveries = [...forwardLines(this.deliveryPath(key))].map(line => parseDelivery(JSON.parse(line)));
    const changes = new Map<string, number>();
    const timeline = next.timeline[key] ?? { nextOrder: 1, nextChange: 1 };
    const expireChange = (id: string): number => { const existing = changes.get(id); if (existing !== undefined) return existing; const change = timeline.nextChange++; changes.set(id, change); return change; };
    for (const row of inbound) {
      if (row.message.bodyState === 'expired' && !row.message.text && !row.message.senderName && !row.message.attachments.length) continue;
      row.change = expireChange(`inbound:${row.message.id}`);
      row.message = { ...row.message, text: '', senderName: '', attachments: [], bodyState: 'expired', bodyHash: row.message.bodyHash ?? hash(row.message.text) };
    }
    for (const row of deliveries) {
      if (row.bodyState === 'expired' && !row.text && !row.error) continue;
      row.change = expireChange(`outbound:${row.id}`);
      row.bodyHash ??= hash(row.text); row.text = ''; row.bodyState = 'expired'; delete row.error;
    }
    next.timeline[key] = timeline;
    const target = next.entries.find(row => row.key === key);
    if (target) { target.lastMessage = ''; target.lastMessageAt = now; }
    const state = next.background[key];
    if (state) state.published = [];
    this.writeMigration(next, [
      { path: this.messagePath(key), rows: inbound },
      { path: this.deliveryPath(key), rows: deliveries },
    ]);
    this.catalog = next;
    this.seen.delete(key); this.recent.delete(key);
    return clone(this.require(key));
  }
  public noteReceived(key: string, sessionId: string, priorCount = 0): void {
    this.assertWritable();
    const entry = this.require(key); const row = entry.sessions.find(item => item.sessionId === sessionId);
    if (!row) throw new Error('消息会话归属无效');
    row.receivedMessages = (row.receivedMessages ?? priorCount) + 1; this.replace(entry);
  }
  public noteMessage(key: string, text: string, at: number): void {
    this.assertWritable();
    const entry = this.require(key);
    entry.lastMessage = this.recording(entry).enabled ? text.slice(0, 300) : ''; entry.lastMessageAt = at; entry.lastActivity = at;
    this.replace(entry);
  }
  public forgetSession(key: string, sessionId: string): void {
    this.assertWritable();
    const entry = this.require(key);
    if (entry.currentSessionId === sessionId) throw new Error('不能清理当前会话');
    entry.sessions = entry.sessions.filter(item => item.sessionId !== sessionId);
    this.replace(entry);
  }

  /** Import only verified exact account prefixes; no title/name heuristics. */
  public migratePrefs(input?: unknown): number {
    this.assertWritable();
    let value = input;
    if (value === undefined) {
      const path = join(this.dataDir, 'model-prefs.json');
      if (!existsSync(path)) return 0;
      value = JSON.parse(readFileSync(path, 'utf8'));
    }
    const data = object(value);
    if (data.sessionIds === undefined) return 0;
    const ids = object(data.sessionIds);
    let count = 0;
    for (const scope of ['group', 'c2c'] satisfies ConversationEntry['scope'][]) {
      const prefix = `qqbot:${this.appId}:${scope}:`;
      for (const [key, sessionId] of Object.entries(ids)) {
        if (!key.startsWith(prefix) || typeof sessionId !== 'string' || !sessionId) continue;
        const peerId = key.slice(prefix.length);
        if (!peerId || this.find(key)?.sessions.some((item) => item.sessionId === sessionId)) continue;
        const existed = this.find(key);
        const migrated = this.ensure(scope, peerId);
        if (!existed) { migrated.policy = validatePolicy(this.createPolicy()); migrated.settings = this.projectSettings(migrated); migrated.defaultsPending = false; }
        migrated.nativeLog = { enabled: false, since: null };
        this.replace(migrated);
        this.bindSession(key, sessionId);
        count += 1;
      }
    }
    return count;
  }

  public recordMessage(key: string, input: GroupMessageRecord): boolean {
    this.assertWritable();
    const entry = this.require(key);
    const message = parseMessage(input);
    const seen = this.seenFor(key);
    if (seen.has(message.id)) return false;
    const recording = this.recording(entry);
    this.prune(key, recording.retentionDays);
    const recent = this.recentFor(key);
    this.reconcileArchiveCursors();
    const state = this.background(key);
    const expired = recording.retentionDays > 0 && message.at < this.now() - recording.retentionDays * 86_400_000;
    const retainedMessage: GroupMessageRecord = expired ? { ...message, text: '', senderName: '', attachments: [], bodyState: 'expired', bodyHash: hash(message.text) } : message;
    const stored = { cursor: state.next, message: retainedMessage };
    const timeline = this.timelineState(key);
    if (recording.enabled) {
      this.append(key, this.messagePath(key), { ...stored, order: timeline.nextOrder, change: timeline.nextChange, message: { ...message, ...(expired ? { text: '', senderName: '', attachments: [] } : {}), bodyState: expired ? 'expired' : 'available', bodyHash: hash(message.text) } });
      seen.add(message.id); // The ledger append is durable even if the catalog replacement fails.
    }
    const nextCatalog = clone(this.catalog);
    if (recording.enabled) nextCatalog.timeline[key] = { nextOrder: timeline.nextOrder + 1, nextChange: timeline.nextChange + 1 };
    nextCatalog.background[key] = { ...state, next: state.next + 1, seen: [...state.seen, message.id].slice(-10_000) };
    const updated = nextCatalog.entries.find((item) => item.key === key);
    if (updated) updated.lastActivity = this.now();
    this.commit(nextCatalog);
    seen.add(message.id);
    // Durable ledger identities also cover retained tombstones beyond the catalog's bounded cache.
    recent.push(stored);
    this.recent.set(key, recent.slice(-Math.max(100, entry.policy.context.maxMessages + 1)));
    return true;
  }

  public hasMessage(key: string, messageId: string): boolean { return this.seenFor(key).has(messageId); }
  public expiredMessageIds(key: string): ReadonlySet<string> {
    const entry = this.require(key);
    this.prune(key, this.recording(entry).retentionDays);
    const ids = new Set<string>();
    for (const line of forwardLines(this.messagePath(key))) {
      const row = parseStoredMessage(JSON.parse(line));
      if (row.message.bodyState === 'expired') ids.add(row.message.id);
    }
    return ids;
  }
  public consumedCursor(key: string): number { this.require(key); return this.background(key).consumed; }

  /** Claim a command/event identity without retaining its content or advancing context. */
  public claimMessage(key: string, messageId: string): boolean {
    this.assertWritable();
    this.require(key);
    if (!messageId || messageId.length > 1_024) throw new TypeError('Invalid QQ message identity');
    const seen = this.seenFor(key);
    if (seen.has(messageId)) return false;
    const state = this.background(key);
    const next = clone(this.catalog);
    next.background[key] = { ...state, seen: [...state.seen, messageId].slice(-10_000) };
    this.commit(next);
    seen.add(messageId);

    return true;
  }

  public snapshotBackground(key: string, currentMessageId: string, throughCursor?: number): BackgroundSnapshot {
    const entry = this.require(key);
    const state = this.background(key);
    const recent = this.recentFor(key);
    const current = recent.find((item) => item.message.id === currentMessageId);
    const cursor = throughCursor === undefined ? current?.cursor ?? state.next - 1 : natural(throughCursor);
    if (cursor >= state.next) throw new TypeError('Background cursor has not been observed');
    const cutoff = this.now() - entry.policy.context.maxAgeMinutes * 60_000;
    const unique = new Map<number, StoredMessage>();
    const source = entry.policy.context.mode === 'interaction' ? state.published : [...recent, ...state.published];
    for (const item of source) unique.set(item.cursor, item);
    const eligible = [...unique.values()].filter((item) => item.cursor > state.consumed && item.cursor <= cursor
      && item.message.id !== currentMessageId && item.message.at >= cutoff && item.message.contextEligible !== false && item.message.bodyState !== 'expired')
      .sort((a, b) => a.cursor - b.cursor).slice(-entry.policy.context.maxMessages);
    const lines: string[] = [];
    const messageIds: string[] = [];
    let remaining = entry.policy.context.maxChars;
    for (const item of eligible.reverse()) {
      const prefix = `[来源消息: ${item.message.id}][${item.message.senderName || item.message.senderId} (${item.message.senderId})] `;
      const available = remaining - (lines.length ? 1 : 0);
      if (available <= 0) break;
      const line = `${prefix}${item.message.text}`.slice(0, available);
      lines.unshift(line); messageIds.unshift(item.message.id); remaining -= line.length + (lines.length > 1 ? 1 : 0);
    }
    return { text: lines.join('\n'), cursor, messageIds };
  }

  public commitBackground(key: string, cursor: number): void {
    this.assertWritable();
    this.require(key); natural(cursor);
    const state = this.background(key);
    if (cursor >= state.next) throw new TypeError('Background cursor has not been observed');
    if (cursor <= state.consumed) return;
    const next = clone(this.catalog);
    next.background[key] = { ...state, consumed: cursor, published: state.published.filter((item) => item.cursor > cursor) };
    this.commit(next);
  }

  public resetBackground(key: string): void {
    this.assertWritable();
    this.require(key);
    const state = this.background(key);
    const next = clone(this.catalog);
    next.background[key] = { ...state, consumed: state.next - 1, published: [] };
    this.commit(next);
  }

  /** Compatibility history endpoint; model access is gated by the runtime. */
  public messages(key: string, options: MessageQuery = {}): Array<GroupMessageRecord & { cursor: number }> {
    const entry = this.require(key);
    this.prune(key, this.recording(entry).retentionDays);
    const before = options.before === undefined ? Infinity : natural(options.before);
    const requestedLimit = options.limit === undefined ? 50 : natural(options.limit);
    if (requestedLimit < 1) throw new TypeError('QQ timeline page size must be positive');
    const limit = Math.min(1000, requestedLimit);
    const query = options.query?.toLocaleLowerCase() ?? '';
    const result: Array<GroupMessageRecord & { cursor: number }> = [];
    for (const line of reversedLines(this.messagePath(key))) {
      const item = parseStoredMessage(JSON.parse(line));
      if (item.cursor >= before || item.message.bodyState === 'expired') continue;
      if (query && !`${item.message.senderName}\n${item.message.text}`.toLocaleLowerCase().includes(query)) continue;
      result.push({ ...item.message, cursor: item.cursor });
      if (result.length >= limit) break;
    }
    return result;
  }

  /** A snapshot freezes change visibility; order cursors never depend on timestamps. */
  public timeline(key: string, options: TimelineQuery = {}): TimelinePage {
    const entry = this.require(key);
    this.prune(key, this.recording(entry).retentionDays);
    const high = this.timelineState(key).nextChange - 1;
    const snapshot = options.snapshot === undefined ? high : natural(options.snapshot);
    if (snapshot > high) throw new TypeError('QQ timeline snapshot has not been observed');
    const before = options.before === undefined ? Infinity : natural(options.before);
    const after = options.after === undefined ? undefined : natural(options.after);
    if (after !== undefined && options.before !== undefined) throw new TypeError('QQ timeline cannot mix before and after');
    const requestedLimit = options.limit === undefined ? 50 : natural(options.limit);
    if (requestedLimit < 1) throw new TypeError('QQ timeline page size must be positive');
    const limit = Math.min(1000, requestedLimit);
    const query = options.query?.toLocaleLowerCase() ?? '';
    const rows = new Map<string, TimelineEntry>();
    for (const line of forwardLines(this.messagePath(key))) {
      const row = parseStoredMessage(JSON.parse(line));
      if (row.order === undefined || row.change === undefined) throw new Error('QQ timeline migration incomplete');
      if (row.change <= snapshot) rows.set(`inbound:${row.message.id}`, { direction: 'inbound', order: row.order, change: row.change, message: { ...row.message, cursor: row.cursor } });
    }
    for (const line of forwardLines(this.deliveryPath(key))) {
      const delivery = parseDelivery(JSON.parse(line));
      if (delivery.key !== key || delivery.order === undefined || delivery.change === undefined) throw new Error('Invalid QQ timeline delivery');
      if (delivery.change <= snapshot) rows.set(`outbound:${delivery.id}`, { direction: 'outbound', order: delivery.order, change: delivery.change, delivery });
    }
    for (const [id, operation] of Object.entries(this.catalog.operations)) {
      if (operation.key !== key || rows.has(`outbound:${id}`) || operation.order === undefined || operation.change === undefined || operation.change > snapshot) continue;
      rows.set(`outbound:${id}`, { direction: 'outbound', order: operation.order, change: operation.change, delivery: this.retiredDelivery(id, operation) });
    }
    let items = [...rows.values()].filter(row => row.order < before && (after === undefined || row.change > after));
    // 记录默认不按条数清理；被清空/过期（expired）的正文不再出现在时间线。
    if (after === undefined) items = items.filter(row => (row.direction === 'inbound' ? row.message.bodyState : row.delivery.bodyState) !== 'expired');
    // Incremental pages must include replacements that no longer match the search.
    if (query && after === undefined) items = items.filter(row => {
      const text = row.direction === 'inbound' ? `${row.message.senderName}\n${row.message.text}` : row.delivery.text;
      return text.toLocaleLowerCase().includes(query);
    });
    items.sort(after === undefined ? (a, b) => b.order - a.order : (a, b) => a.change - b.change);
    const hasMore = items.length > limit;
    items = items.slice(0, limit);
    const last = items.at(-1);
    return { items, snapshot, hasMore, ...(last ? { nextBefore: last.order } : {}), ...(after === undefined ? {} : { nextAfter: hasMore && last ? last.change : snapshot }) };
  }

  public beginDelivery(key: string, operationId: string, text: string, partCount = 1, publish = true, provenance: DeliveryProvenance = {}): { record: DeliveryRecord; created: boolean } {
    this.assertWritable();
    const entry = this.require(key);
    if (!validOperationId(operationId) || !text.trim() || text.length > 100_000) throw new TypeError('Invalid QQ send request');
    if (!Number.isSafeInteger(partCount) || partCount < 1 || partCount > 1_000) throw new TypeError('Invalid QQ delivery part count');
    if (typeof publish !== 'boolean') throw new TypeError('Invalid QQ delivery publication mode');
    const previous = Object.hasOwn(this.catalog.operations, operationId) ? this.catalog.operations[operationId] : undefined;
    if (previous && (previous.key !== key || previous.hash !== hash(text) || (previous.publish !== false) !== publish)) throw new ConversationConflictError('发送标识已用于其他目标、内容或发送方式');
    const existing = this.findDelivery(key, operationId);
    if (existing) {
      if (existing.bodyHash ? existing.bodyHash !== hash(text) : existing.text !== text) throw new ConversationConflictError('发送标识已用于其他内容');
      return { record: clone(existing), created: false };
    }
    if (previous) {
      const record = this.retiredDelivery(operationId, previous);
      return { record, created: false };
    }
    const at = this.now();
    const timeline = this.timelineState(key);
    const enabled = this.recording(entry).enabled;
    const record: DeliveryRecord = {
      ...provenance, id: operationId, key, text: enabled ? text : '', bodyHash: hash(text), bodyState: enabled ? 'available' : 'disabled', at, updatedAt: at, state: 'pending', order: timeline.nextOrder, change: timeline.nextChange,
      parts: Array.from({ length: partCount }, (_, index) => ({ index, state: 'pending' })),
    };
    const next = clone(this.catalog);
    next.operations[operationId] = { key, hash: hash(text), publish, at, order: record.order, change: record.change, state: record.state, parts: record.parts };
    next.timeline[key] = { nextOrder: timeline.nextOrder + 1, nextChange: timeline.nextChange + 1 };
    this.commit(next);
    this.append(key, this.deliveryPath(key), record);
    return { record: clone(record), created: true };
  }

  public updateDelivery(key: string, id: string, update: DeliveryUpdate): DeliveryRecord {
    this.assertWritable();
    this.require(key);
    const existing = this.findDelivery(key, id);
    if (!existing) throw new Error('QQ delivery not found');
    if ((existing.state === 'unknown' || existing.state === 'failed') && (update.state === 'pending' || update.state === 'sending')) throw new Error('QQ delivery cannot be retried under the same operation identity');
    if (existing.state === 'accepted' && update.state !== 'accepted') throw new Error('Accepted QQ delivery cannot be retried');
    if (existing.bodyState === 'expired') throw new Error('QQ delivery body has expired; it cannot be resent');
    const timeline = this.timelineState(key);
    const record = parseDelivery({ ...existing, ...update, updatedAt: this.now(), change: timeline.nextChange });
    this.append(key, this.deliveryPath(key), record);
    const next = clone(this.catalog);
    next.timeline[key] = { ...timeline, nextChange: timeline.nextChange + 1 };
    const operation = next.operations[id];
    if (operation) Object.assign(operation, { state: record.state, parts: record.parts, change: record.change });
    this.commit(next);
    if (record.state === 'accepted' && existing.state !== 'accepted') this.publish(key, record);
    return clone(this.findDelivery(key, id) ?? record);
  }

  public deliveries(key: string): DeliveryRecord[] {
    this.require(key);
    const result: DeliveryRecord[] = [];
    const seen = new Set<string>();
    for (const line of reversedLines(this.deliveryPath(key))) {
      const delivery = parseDelivery(JSON.parse(line));
      if (delivery.key !== key) throw new Error('QQ delivery target mismatch');
      if (seen.has(delivery.id)) continue;
      seen.add(delivery.id); result.push(delivery);
    }
    return result;
  }

  /** Called at startup and by the Host's hourly maintenance effect. */
  public pruneExpired(): void {
    this.assertWritable();
    for (const entry of this.catalog.entries) this.prune(entry.key, this.recording(entry).retentionDays);
  }

  private publish(key: string, delivery: DeliveryRecord): void {
    const state = this.background(key);
    const id = `published:${delivery.id}`;
    const operation = this.catalog.operations[delivery.id];
    if (operation?.published || operation?.publish === false || delivery.bodyState === 'expired' || delivery.bodyState === 'disabled') return;
    const message: GroupMessageRecord = { id, senderId: 'bot', senderName: '机器人已发送', text: delivery.text, at: delivery.at, mentioned: false, attachments: [] };
    const next = clone(this.catalog);
    if (!state.published.some((item) => item.message.id === id)) {
      next.background[key] = { ...state, next: state.next + 1, published: [...state.published, { cursor: state.next, message }].slice(-100) };
    }
    next.operations[delivery.id] = { ...operation, key, hash: operation?.hash ?? hash(delivery.text), publish: true, published: true };
    this.commit(next);
  }

  private find(key: string): ConversationEntry | undefined { return this.catalog.entries.find((entry) => entry.key === key); }
  private resolveSettings(settings: QQAgentSettings, entry: ConversationEntry): QQAgentSettings {
    return validateQQAgentSettings(this.options.resolveSettings?.(clone(settings), clone(entry)) ?? settings);
  }
  private projectSettings(entry: ConversationEntry): QQAgentSettings {
    if (this.options.projectSettings) return validateQQAgentSettings(this.options.projectSettings(clone(entry)));
    // 人设由 personaCardOf(policy.role) 提供；此兜底不再烘焙 prompt。
    return { ...defaultQQAgentSettings(), cwd: entry.policy.cwd, promptGroup: '', promptDirect: '', execution: entry.policy.nativeTools ? { kind: 'native', permission: entry.policy.resources.sandbox } : { kind: 'custom', permission: entry.policy.resources.sandbox, tools: Object.entries(entry.policy.tools).filter(([, decision]) => decision !== 'deny').map(([id]) => id) } };
  }
  private settingsPolicy(before: ConversationPolicy, settings: QQAgentSettings): ConversationPolicy {
    const permission = settings.execution.permission;
    const selected = settings.execution.kind === 'custom' ? settings.execution.tools : [];
    return validatePolicy({ ...before, template: 'custom', name: 'QQ Agent', toolMode: 'native', nativeTools: settings.execution.kind === 'native', permission, allowedPermissions: ['read-only', 'workspace-write', 'danger-full-access'], allowedModels: [], allowedPresets: [], cwd: settings.cwd,
      tools: settings.execution.kind === 'native' ? {} : Object.fromEntries(selected.map(id => [id, before.tools[id] === 'ask' ? 'ask' : 'allow'])),
      resources: { ...before.resources, readRoots: [], writeRoots: [], executionEnabled: true, sandbox: permission, networkDomains: [] },
    });
  }
  private migrateSettings(): void {
    const next = clone(this.catalog);
    let changed = false;
    // Development builds have no legacy tool-ceiling policies: every conversation follows native tools.
    for (const entry of next.entries) if (entry.policy.nativeTools !== true) { entry.policy = { ...entry.policy, nativeTools: true }; changed = true; }
    for (const entry of next.entries) if (!entry.settings) {
      entry.settings = this.projectSettings(entry);
      for (const row of entry.sessions) if (row.prompt === undefined) {
        const historical = { ...entry, policy: { ...entry.policy, role: row.role ?? entry.policy.role } };
        row.prompt = entry.scope === 'group' ? this.projectSettings(historical).promptGroup : this.projectSettings(historical).promptDirect;
      }
      changed = true;
    }
    if (changed) this.commit(next);
  }
  private require(key: string): ConversationEntry { const entry = this.find(key); if (!entry) throw new Error('QQ conversation not found'); return clone(entry); }
  private replace(entry: ConversationEntry): void {
    const next = clone(this.catalog);
    const index = next.entries.findIndex((item) => item.key === entry.key);
    if (index < 0) next.entries.push(entry); else next.entries[index] = entry;
    next.background[entry.key] ??= { next: 1, consumed: 0, published: [], seen: [] };
    next.timeline[entry.key] ??= { nextOrder: 1, nextChange: 1 };
    this.commit(next);
  }
  private assertWritable(): void {
    if (this.migrationFailed) throw new Error('QQ 记录迁移不完整，需重启恢复');
  }
  private commit(next: Catalog): void {
    this.assertWritable();
    try { atomicWrite(this.path, [JSON.stringify(next)]); this.catalog = next; this.storageErrors.delete('catalog'); }
    catch (error) { this.reconcileNeeded = true; this.storageErrors.set('catalog', `QQ 记录写入失败：${error instanceof Error ? error.message : String(error)}`); throw error; }
  }
  private append(key: string, path: string, value: unknown): void {
    this.assertWritable();
    try { appendRecord(path, value); this.storageErrors.delete(key); }
    catch (error) { this.storageErrors.set(key, `QQ 记录写入失败：${error instanceof Error ? error.message : String(error)}`); throw error; }
  }
  private recording(entry: ConversationEntry): RecordingSettings {
    if (!entry.recording) throw new Error('QQ recording migration incomplete');
    return entry.recording;
  }
  private timelineState(key: string): TimelineState {
    const state = clone(this.catalog.timeline[key] ?? { nextOrder: 1, nextChange: 1 });
    // A completed append can survive a failed catalog commit. Re-scan only after a failure.
    if (!this.reconcileNeeded) return state;
    for (const line of forwardLines(this.messagePath(key))) {
      const row = parseStoredMessage(JSON.parse(line));
      state.nextOrder = Math.max(state.nextOrder, (row.order ?? 0) + 1);
      state.nextChange = Math.max(state.nextChange, (row.change ?? 0) + 1);
    }
    for (const line of forwardLines(this.deliveryPath(key))) {
      const row = parseDelivery(JSON.parse(line));
      state.nextOrder = Math.max(state.nextOrder, (row.order ?? 0) + 1);
      state.nextChange = Math.max(state.nextChange, (row.change ?? 0) + 1);
    }
    return state;
  }
  private retiredDelivery(id: string, operation: DeliveryReservation): DeliveryRecord {
    return { id, key: operation.key, text: '', bodyHash: operation.hash, bodyState: operation.retired ? 'expired' : 'disabled', at: operation.at ?? 0, updatedAt: operation.at ?? 0, state: operation.state === 'accepted' || operation.state === 'failed' ? operation.state : 'unknown', parts: operation.parts ?? [], ...(operation.order === undefined ? {} : { order: operation.order }), ...(operation.change === undefined ? {} : { change: operation.change }), error: '发送标识已有持久预留，正文不可用；不能重发。' };
  }
  private background(key: string): BackgroundState { return clone(this.catalog.background[key] ?? { next: 1, consumed: 0, published: [], seen: [] }); }
  private messagePath(key: string): string { return join(this.dataDir, 'conversations', hash(key), 'messages.jsonl'); }
  private deliveryPath(key: string): string { return join(this.dataDir, 'conversations', hash(key), 'deliveries.jsonl'); }
  private seenFor(key: string): Set<string> {
    let seen = this.seen.get(key);
    if (seen) return seen;
    seen = new Set(this.background(key).seen);
    for (const line of forwardLines(this.messagePath(key))) seen.add(parseStoredMessage(JSON.parse(line)).message.id);
    this.seen.set(key, seen);
    return seen;
  }
  private recentFor(key: string): StoredMessage[] {
    const cached = this.recent.get(key);
    if (cached) return cached;
    const entry = this.require(key);
    const items: StoredMessage[] = [];
    if (this.recording(entry).enabled) {
      for (const line of reversedLines(this.messagePath(key))) {
        const item = parseStoredMessage(JSON.parse(line));
        if (item.message.bodyState !== 'expired') items.push(item);
        if (items.length >= Math.max(100, entry.policy.context.maxMessages + 1)) break;
      }
    }
    items.reverse(); this.recent.set(key, items);
    return items;
  }
  private findDelivery(key: string, id: string): DeliveryRecord | undefined {
    for (const line of reversedLines(this.deliveryPath(key))) {
      const record = parseDelivery(JSON.parse(line));
      if (record.key !== key) throw new Error('QQ delivery target mismatch');
      if (record.id === id) return record;
    }
    return undefined;
  }
  private recoverDeliveries(): void {
    for (const entry of this.catalog.entries) {
      for (const record of this.deliveries(entry.key)) {
        if ((record.state === 'sending' || record.state === 'pending') && record.bodyState !== 'expired') this.updateDelivery(entry.key, record.id, {
          state: 'unknown', error: '宿主在发送期间退出，结果未知；请先核对 QQ。',
          parts: record.parts.map((part) => part.state === 'pending' ? { ...part, state: 'unknown' } : part),
        });
        else if (record.state === 'accepted') this.publish(entry.key, record);
      }
    }
  }
  private reconcileArchiveCursors(): void {
    const next = clone(this.catalog);
    let changed = false;
    for (const entry of this.catalog.entries) {
      const [line] = reversedLines(this.messagePath(entry.key));
      if (line === undefined) continue;
      const latest = parseStoredMessage(JSON.parse(line));
      const state = next.background[entry.key];
      if (state && latest.cursor >= state.next) {
        state.next = latest.cursor + 1;
        changed = true;
      }
    }
    if (changed) this.commit(next);
  }
  private prune(key: string, retentionDays: number): void {
    this.assertWritable();
    const now = this.now();
    this.require(key);
    // 记录默认不按条数清理：只按 retentionDays（历史遗留，通常为 0=不清理）过期，不做数量淘汰。
    if (now - (this.lastPrune.get(key) ?? 0) < 3_600_000) return;
    const cutoff = retentionDays > 0 ? now - retentionDays * 86_400_000 : -Infinity;
    const next = clone(this.catalog);
    let changed = false;
    const inbound = [...forwardLines(this.messagePath(key))].map(line => parseStoredMessage(JSON.parse(line)));
    const deliveries = [...forwardLines(this.deliveryPath(key))].map(line => parseDelivery(JSON.parse(line)));
    const latestInbound = new Map(inbound.map(row => [row.message.id, row]));
    const latestDelivery = new Map(deliveries.map(row => [row.id, row]));
    const expiredInbound = new Set<string>();
    const expiredDelivery = new Set<string>();
    for (const [id, row] of latestInbound) {
      if (row.message.bodyState === 'expired' || row.message.at < cutoff) expiredInbound.add(id);
    }
    for (const [id, row] of latestDelivery) {
      if (row.bodyState === 'expired' || row.at < cutoff) expiredDelivery.add(id);
    }
    const entry = next.entries.find(row => row.key === key);
    if (entry?.lastMessage && ((entry.lastMessageAt ?? 0) < cutoff || inbound.some(row => expiredInbound.has(row.message.id)
      && row.message.at === entry.lastMessageAt && row.message.text.slice(0, 300) === entry.lastMessage))) {
      entry.lastMessage = ''; changed = true;
    }
    const changes = new Map<string, number>();
    const expireChange = (id: string): number => {
      const existing = changes.get(id);
      if (existing !== undefined) return existing;
      const timeline = next.timeline[key] ?? { nextOrder: 1, nextChange: 1 };
      const change = timeline.nextChange++;
      next.timeline[key] = timeline; changes.set(id, change);
      return change;
    };
    for (const row of inbound) {
      if (!expiredInbound.has(row.message.id) || (row.message.bodyState === 'expired' && !row.message.text && !row.message.senderName && !row.message.attachments.length)) continue;
      row.change = expireChange(`inbound:${row.message.id}`);
      row.message = { ...row.message, text: '', senderName: '', attachments: [], bodyState: 'expired', bodyHash: row.message.bodyHash ?? hash(row.message.text) };
      changed = true;
    }
    for (const row of deliveries) {
      if (!expiredDelivery.has(row.id) || (row.bodyState === 'expired' && !row.text && !row.error)) continue;
      row.change = expireChange(`outbound:${row.id}`);
      row.bodyHash ??= hash(row.text); row.text = ''; row.bodyState = 'expired'; delete row.error;
      if (row.state === 'pending' || row.state === 'sending') {
        row.state = 'unknown'; row.updatedAt = now;
        row.parts = row.parts.map(part => part.state === 'pending' ? { ...part, state: 'unknown' } : part);
      }
      changed = true;
    }
    for (const [id, row] of latestDelivery) {
      if (!expiredDelivery.has(id)) continue;
      const operation = next.operations[id];
      if (operation && (!operation.retired || operation.state !== row.state || operation.change !== row.change)) {
        Object.assign(operation, { retired: true, state: row.state, change: row.change, parts: row.parts }); changed = true;
      }
    }
    const state = next.background[key];
    if (state) {
      const retained = state.published.filter(row => row.message.at >= cutoff && !expiredDelivery.has(row.message.id.replace(/^published:/, '')));
      if (retained.length !== state.published.length) { state.published = retained; changed = true; }
    }
    if (changed) {
      const ledgers = [
        { path: this.messagePath(key), rows: inbound },
        { path: this.deliveryPath(key), rows: deliveries },
      ];
      this.writeMigration(next, ledgers);
      this.catalog = next;
    }
    const recent = this.recent.get(key);
    if (recent) this.recent.set(key, recent.filter(row => row.message.at >= cutoff && !expiredInbound.has(row.message.id)));
    this.lastPrune.set(key, now);
  }

  /** Journal first, then atomically replace both ledgers and the catalog. Recovery only writes data. */
  private writeMigration(next: Catalog, ledgers: Array<{ path: string; rows: unknown[] }>): void {
    this.assertWritable();
    const journal = join(this.dataDir, `recording-migration-${hash(this.appId)}.json`);
    const value = { catalog: next, ledgers };
    try {
      atomicWrite(journal, [JSON.stringify(value)]);
      for (const ledger of ledgers) atomicWrite(ledger.path, ledger.rows.map(row => `${JSON.stringify(row)}\n`));
      atomicWrite(this.path, [JSON.stringify(next)]);
      rmSync(journal);
      this.storageErrors.delete('catalog');
    } catch (error) {
      // Restart replays this journal before loading the catalog; later writes would be overwritten.
      this.migrationFailed = true;
      this.storageErrors.set('catalog', `QQ 记录迁移不完整，需重启恢复：${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  private resumeRecordingMigration(): void {
    const journal = join(this.dataDir, `recording-migration-${hash(this.appId)}.json`);
    if (!existsSync(journal)) return;
    const data = object(JSON.parse(readFileSync(journal, 'utf8')));
    const catalog = object(data.catalog);
    if (catalog.appId !== this.appId || catalog.format !== 2 || !Array.isArray(catalog.entries) || !Array.isArray(data.ledgers)) throw new Error('Invalid QQ recording migration journal');
    const paths = new Set(catalog.entries.flatMap(value => { const row = parseEntry(value); return [this.messagePath(row.key), this.deliveryPath(row.key)]; }));
    for (const input of data.ledgers) {
      const ledger = object(input);
      if (typeof ledger.path !== 'string' || !paths.has(ledger.path) || !Array.isArray(ledger.rows)) throw new Error('Invalid QQ recording migration ledger');
      for (const row of ledger.rows) ledger.path.endsWith('messages.jsonl') ? parseStoredMessage(row) : parseDelivery(row);
    }
    for (const input of data.ledgers) {
      const ledger = object(input);
      if (typeof ledger.path !== 'string' || !Array.isArray(ledger.rows)) throw new Error('Invalid QQ recording migration ledger');
      atomicWrite(ledger.path, ledger.rows.map(row => `${JSON.stringify(row)}\n`));
    }
    atomicWrite(this.path, [JSON.stringify(catalog)]);
    rmSync(journal);
  }

  private migrateRecording(): void {
    const next = clone(this.catalog);
    const ledgers: Array<{ path: string; rows: unknown[] }> = [];
    let changed = this.catalogNeedsMigration;
    for (const entry of next.entries) {
      if (entry.lastMessage && entry.lastMessageAt === undefined) { entry.lastMessage = ''; changed = true; }
      if (!entry.recording) {
        entry.recording = { version: 1, enabled: true, since: this.now(), retentionDays: entry.policy.context.mode === 'archive' ? entry.policy.context.retentionDays : 7 };
        changed = true;
      }
      const messages = [...forwardLines(this.messagePath(entry.key))].map(line => parseStoredMessage(JSON.parse(line)));
      const deliveries = [...forwardLines(this.deliveryPath(entry.key))].map(line => parseDelivery(JSON.parse(line)));
      const identities = new Map<string, { at: number; order?: number }>();
      for (const row of messages) identities.set(`inbound:${row.message.id}`, { at: row.message.at, order: row.order });
      for (const row of deliveries) if (!identities.has(`outbound:${row.id}`)) identities.set(`outbound:${row.id}`, { at: row.at, order: row.order });
      let nextOrder = next.timeline[entry.key]?.nextOrder ?? 1;
      for (const row of identities.values()) nextOrder = Math.max(nextOrder, (row.order ?? 0) + 1);
      // Only legacy rows lack order. Timestamp plus ledger identity gives a repeatable migration order.
      for (const [id, row] of [...identities].sort((a, b) => a[1].at - b[1].at || a[0].localeCompare(b[0]))) if (row.order === undefined) { identities.set(id, { ...row, order: nextOrder++ }); changed = true; }
      let nextChange = next.timeline[entry.key]?.nextChange ?? 1;
      for (const row of messages) nextChange = Math.max(nextChange, (row.change ?? 0) + 1);
      for (const row of deliveries) nextChange = Math.max(nextChange, (row.change ?? 0) + 1);
      for (const row of messages) {
        if (row.order === undefined) row.order = identities.get(`inbound:${row.message.id}`)?.order;
        if (row.change === undefined) { row.change = nextChange++; changed = true; }
      }
      for (const row of deliveries) {
        if (row.order === undefined) row.order = identities.get(`outbound:${row.id}`)?.order;
        if (row.change === undefined) { row.change = nextChange++; changed = true; }
        const operation = next.operations[row.id];
        if (operation) Object.assign(operation, { at: row.at, order: row.order, change: row.change, state: row.state, parts: row.parts });
        else { next.operations[row.id] = { key: entry.key, hash: row.bodyHash ?? hash(row.text), publish: true, published: row.state === 'accepted', at: row.at, order: row.order, change: row.change, state: row.state, parts: row.parts, retired: row.bodyState === 'expired' }; changed = true; }
      }
      const previous = next.timeline[entry.key];
      if (!previous || previous.nextOrder !== nextOrder || previous.nextChange !== nextChange) { next.timeline[entry.key] = { nextOrder, nextChange }; changed = true; }
      ledgers.push({ path: this.messagePath(entry.key), rows: messages }, { path: this.deliveryPath(entry.key), rows: deliveries });
    }
    if (changed) { this.writeMigration(next, ledgers); this.catalog = next; }
    this.reconcileNeeded = false;
  }
  private load(): Catalog {
    if (!existsSync(this.path)) return { format: 2, appId: this.appId, owners: [], entries: [], defaults: { version: 1, settings: validateQQAgentSettings(this.options.defaultSettings?.() ?? defaultQQAgentSettings()) }, background: {}, operations: {}, timeline: {} };
    const data = object(JSON.parse(readFileSync(this.path, 'utf8')));
    if ((data.format !== 1 && data.format !== 2) || data.appId !== this.appId || !Array.isArray(data.entries)) throw new Error('Unsupported QQ conversation catalog');
    this.catalogNeedsMigration = data.format === 1;
    const entries = data.entries.map(parseEntry);
    const keys = new Set<string>();
    for (const entry of entries) {
      if (entry.appId !== this.appId || entry.key !== this.key(entry.scope, entry.peerId) || keys.has(entry.key)) throw new Error('QQ conversation catalog target mismatch');
      keys.add(entry.key);
    }
    const background: Record<string, BackgroundState> = {};
    for (const [key, input] of Object.entries(object(data.background))) {
      if (!keys.has(key)) throw new Error('QQ background has no conversation');
      const state = object(input);
      if (!Array.isArray(state.published)) throw new Error('Invalid QQ published messages');
      background[key] = { next: natural(state.next), consumed: natural(state.consumed), published: state.published.map(parseStoredMessage), seen: state.seen === undefined ? [] : strings(state.seen).slice(-10_000) };
      if (background[key].next <= background[key].consumed) throw new Error('Invalid QQ background cursor order');
    }
    const operations: Catalog['operations'] = {};
    for (const [id, value] of Object.entries(object(data.operations))) {
      const operation = object(value);
      if (!validOperationId(id) || typeof operation.key !== 'string' || !keys.has(operation.key) || typeof operation.hash !== 'string') throw new Error('Invalid QQ delivery reservation');
      operations[id] = { key: operation.key, hash: operation.hash, publish: operation.publish !== false, published: operation.published === true,
        ...(operation.at === undefined ? {} : { at: natural(operation.at) }),
        ...(operation.order === undefined ? {} : { order: natural(operation.order) }),
        ...(operation.change === undefined ? {} : { change: natural(operation.change) }),
        ...(typeof operation.state === 'string' && ['pending', 'sending', 'accepted', 'failed', 'unknown'].includes(operation.state) ? { state: operation.state as DeliveryRecord['state'] } : {}),
        ...(operation.parts === undefined ? {} : { parts: parseDelivery({ id, key: operation.key, text: '', at: 0, updatedAt: 0, state: 'unknown', parts: operation.parts }).parts }), retired: operation.retired === true };
    }
    const timeline: Catalog['timeline'] = {};
    if (data.timeline !== undefined) for (const [key, input] of Object.entries(object(data.timeline))) {
      if (!keys.has(key)) throw new Error('QQ timeline has no conversation');
      const row = object(input);
      timeline[key] = { nextOrder: natural(row.nextOrder), nextChange: natural(row.nextChange) };
      if (timeline[key].nextOrder < 1 || timeline[key].nextChange < 1) throw new Error('Invalid QQ timeline cursor');
    }
    const defaults = data.defaults === undefined ? { version: 1, settings: validateQQAgentSettings(this.options.defaultSettings?.() ?? defaultQQAgentSettings()) } : validateQQDefaults(data.defaults);
    return { format: 2, appId: this.appId, owners: strings(data.owners), entries, defaults, background, operations, timeline, ...(data.memberProfiles !== undefined && typeof data.memberProfiles === 'object' && data.memberProfiles !== null ? { memberProfiles: data.memberProfiles as Record<string, MemberProfile> } : {}) };
  }
}

export class ConversationConflictError extends Error {
  public readonly code = 'CONVERSATION_CONFLICT';
  public constructor(message = '配置已更新，请刷新后重试') { super(message); this.name = 'ConversationConflictError'; }
}
