import { chmodSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, join, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';
import { MAX_TIMELINE_IMAGES, TIMELINE_PAGE_SIZE, type TimelineEntry, type TimelineInboundOutcome, type TimelinePage } from '../shared/workbench-timeline-protocol.ts';
import { deliveryKey } from '../transport/delivery-ledger.ts';

interface Peer { scope: ChatScope; openId: string }
type StoredEntry = TimelineEntry & { imageFiles?: string[] };

function partition(appId: string, target: ReplyTarget): [string, ChatScope, string] {
  return [appId, target.scope, target.targetId];
}

function recordKey(appId: string, target: ReplyTarget): string {
  return join(deliveryKey(appId), deliveryKey(target.scope, target.targetId));
}

export function timelineText(text: string): string {
  return text.length > 16_000 ? text.slice(0, 16_000) + '…（记录已截断）' : text;
}

export function receivedEntryId(platformId: string): string {
  return deliveryKey('inbound', platformId);
}

/** The display store and the delivery ledger have separate retention and failure semantics. */
export class QqTimeline {
  private database?: DatabaseSync;
  private closed = false;
  private readonly incomplete = new Set<string>();
  private readonly pending = new Set<string>();
  private readonly generations = new Map<string, number>();

  constructor(private readonly root: string, private readonly logger: Logger,
    private readonly retainAfter?: (appId: string, target: ReplyTarget) => number | undefined) {}

  close(): void {
    this.closed = true;
    this.database?.close();
    this.database = undefined;
  }

  clearAccount(appId: string): void {
    this.connection().prepare('DELETE FROM peers WHERE app_id = ?').run(appId);
    const account = deliveryKey(appId);
    this.advanceGeneration(account);
    for (const key of this.generations.keys()) if (key.startsWith(account + sep)) this.generations.delete(key);
    for (const set of [this.incomplete, this.pending]) {
      for (const key of set) if (key.startsWith(account + sep)) set.delete(key);
    }
  }

  clearPeer(appId: string, target: ReplyTarget): void {
    const key = recordKey(appId, target);
    this.removeRows(appId, target);
    this.advanceGeneration(key);
    for (const pending of this.pending) if (pending.startsWith(key + sep)) this.pending.delete(pending);
    this.incomplete.delete(key);
  }

  expire(appId: string, target: ReplyTarget): void {
    try {
      const cutoff = this.retainAfter?.(appId, target);
      if (cutoff !== undefined) this.removeRows(appId, target, cutoff);
    } catch {
      this.noteFailure(recordKey(appId, target));
    }
  }

  peers(appId: string): Peer[] {
    const rows = this.connection().prepare('SELECT scope, target_id FROM peers WHERE app_id = ?').all(appId);
    return rows.flatMap(row => (row.scope === 'group' || row.scope === 'c2c') && typeof row.target_id === 'string'
      ? [{ scope: row.scope, openId: row.target_id }] : []);
  }

  record(appId: string, target: ReplyTarget, entry: TimelineEntry, once = false): void {
    this.update(appId, target, entry.id, previous => once && previous ? undefined : entry);
  }

  recordImages(appId: string, target: ReplyTarget, localPaths: readonly string[]): boolean {
    if (!target.msgId || localPaths.length === 0) return false;
    const id = receivedEntryId(target.msgId);
    return this.update(appId, target, id, previous => {
      if (previous?.direction !== 'inbound' || previous.imageFiles?.length) return undefined;
      return { ...previous, imageFiles: localPaths.slice(0, MAX_TIMELINE_IMAGES).map(path => basename(path)) };
    });
  }

  imageFile(appId: string, target: ReplyTarget, id: string, index: number): string | undefined {
    return this.read(appId, target, id)?.imageFiles?.[index];
  }

  reportInbound(appId: string, target: ReplyTarget, inboundOutcome: TimelineInboundOutcome, sessionId?: string): void {
    if (!target.msgId) return;
    this.update(appId, target, receivedEntryId(target.msgId), previous => {
      if (!previous || previous.direction !== 'inbound' || previous.inboundOutcome === 'submitted') return undefined;
      if (previous.inboundOutcome && inboundOutcome !== 'submitted' && inboundOutcome !== 'submit-failed') return undefined;
      if (previous.inboundOutcome === inboundOutcome) return undefined;
      return { ...previous, inboundOutcome, sessionId: previous.sessionId ?? sessionId };
    });
  }

  entry(appId: string, target: ReplyTarget, id: string): TimelineEntry | undefined {
    const row = this.read(appId, target, id);
    return row && this.observedStatus(recordKey(appId, target), row);
  }

  async observe<T>(appId: string, target: ReplyTarget, entry: TimelineEntry,
    send: () => Promise<T>, finish: (result?: T, error?: unknown) => Partial<TimelineEntry>,
    stillOwned?: () => boolean): Promise<T> {
    const account = deliveryKey(appId);
    const peer = recordKey(appId, target);
    const key = join(peer, entry.id);
    const accountGeneration = this.generations.get(account);
    const peerGeneration = this.generations.get(peer);
    const current = () => !this.closed && this.generations.get(account) === accountGeneration && this.generations.get(peer) === peerGeneration;
    this.pending.add(key);
    this.update(appId, target, entry.id, previous => ({ ...entry, at: previous?.at ?? entry.at }));
    try {
      const result = await send();
      if (current() && stillOwned?.() !== false) {
        this.update(appId, target, entry.id, previous => previous && ({ ...previous, ...finish(result) }));
      }
      return result;
    } catch (error) {
      if (current() && stillOwned?.() !== false) {
        this.update(appId, target, entry.id, previous => previous && ({ ...previous, ...finish(undefined, error) }));
      }
      throw error;
    } finally {
      if (current()) this.pending.delete(key);
    }
  }

  page(appId: string, target: ReplyTarget, before?: string): TimelinePage | undefined {
    this.expire(appId, target);
    const db = this.connection();
    const key = partition(appId, target);
    const position = before === undefined ? undefined : db.prepare(
      'SELECT seq FROM messages WHERE app_id = ? AND scope = ? AND target_id = ? AND message_id = ?',
    ).get(...key, before)?.seq;
    if (before !== undefined && typeof position !== 'number') return undefined;
    const cutoff = this.retainAfter?.(appId, target) ?? -Number.MAX_SAFE_INTEGER;
    const rows = typeof position === 'number'
      ? db.prepare(`SELECT body FROM messages INDEXED BY messages_page WHERE app_id = ? AND scope = ? AND target_id = ?
          AND seq < ? AND at >= ? ORDER BY seq DESC LIMIT ?`).all(...key, position, cutoff, TIMELINE_PAGE_SIZE + 1)
      : db.prepare(`SELECT body FROM messages INDEXED BY messages_page WHERE app_id = ? AND scope = ? AND target_id = ?
          AND at >= ? ORDER BY seq DESC LIMIT ?`).all(...key, cutoff, TIMELINE_PAGE_SIZE + 1);
    const directory = recordKey(appId, target);
    const entries = rows.slice(0, TIMELINE_PAGE_SIZE).reverse().map(row => this.observedStatus(directory, parseEntry(row.body)));
    const generation = db.prepare('SELECT generation FROM peers WHERE app_id = ? AND scope = ? AND target_id = ?').get(...key)?.generation;
    return {
      entries,
      before: rows.length > TIMELINE_PAGE_SIZE ? entries[0]?.id : undefined,
      incomplete: this.incomplete.has(directory),
      generation: typeof generation === 'string' ? generation : undefined,
    };
  }

  private observedStatus(directory: string, { imageFiles, ...row }: StoredEntry): TimelineEntry {
    if (imageFiles?.length) row.imageCount = imageFiles.length;
    return row.status === 'sending' && !this.pending.has(join(directory, row.id))
      ? { ...row, status: 'unknown' } : row;
  }

  private advanceGeneration(key: string): void {
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
  }

  private removeRows(appId: string, target: ReplyTarget, cutoff?: number): void {
    const db = this.connection();
    const key = partition(appId, target);
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = cutoff === undefined
        ? db.prepare('DELETE FROM messages WHERE app_id = ? AND scope = ? AND target_id = ?').run(...key)
        : db.prepare('DELETE FROM messages WHERE app_id = ? AND scope = ? AND target_id = ? AND at < ?').run(...key, cutoff);
      if (result.changes) {
        db.prepare('UPDATE peers SET generation = ? WHERE app_id = ? AND scope = ? AND target_id = ?').run(randomUUID(), ...key);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  private read(appId: string, target: ReplyTarget, id: string): StoredEntry | undefined {
    const entry = this.connection().prepare(
      'SELECT body, at FROM messages WHERE app_id = ? AND scope = ? AND target_id = ? AND message_id = ?',
    ).get(...partition(appId, target), id);
    const cutoff = this.retainAfter?.(appId, target);
    if (!entry || (cutoff !== undefined && typeof entry.at === 'number' && entry.at < cutoff)) return undefined;
    return parseEntry(entry.body);
  }

  private update(appId: string, target: ReplyTarget, id: string, change: (previous?: StoredEntry) => StoredEntry | undefined): boolean {
    if (this.closed) return false;
    try {
      const db = this.connection();
      const entry = change(this.read(appId, target, id));
      if (!entry || entry.at < (this.retainAfter?.(appId, target) ?? -Infinity)) return false;
      const key = partition(appId, target);
      db.prepare('INSERT OR IGNORE INTO peers VALUES (?, ?, ?, ?)').run(...key, randomUUID());
      db.prepare(`INSERT INTO messages (app_id, scope, target_id, message_id, at, body) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (app_id, scope, target_id, message_id) DO UPDATE SET at = excluded.at, body = excluded.body`)
        .run(...key, id, entry.at, JSON.stringify(entry));
      return true;
    } catch {
      this.noteFailure(recordKey(appId, target));
      return false;
    }
  }

  private connection(): DatabaseSync {
    if (this.closed) throw new Error('The QQ timeline is closed.');
    if (this.database) return this.database;
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const path = join(this.root, 'messages.sqlite');
    const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    try {
      chmodSync(path, 0o600);
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA secure_delete = ON;
        CREATE TABLE IF NOT EXISTS peers (
          app_id TEXT NOT NULL, scope TEXT NOT NULL, target_id TEXT NOT NULL, generation TEXT NOT NULL,
          PRIMARY KEY (app_id, scope, target_id)
        ) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS messages (
          seq INTEGER PRIMARY KEY, app_id TEXT NOT NULL, scope TEXT NOT NULL, target_id TEXT NOT NULL,
          message_id TEXT NOT NULL, at INTEGER NOT NULL, body TEXT NOT NULL,
          UNIQUE (app_id, scope, target_id, message_id),
          FOREIGN KEY (app_id, scope, target_id) REFERENCES peers ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS messages_page ON messages (app_id, scope, target_id, seq);
        CREATE INDEX IF NOT EXISTS messages_expiration ON messages (app_id, scope, target_id, at);
      `);
      this.database = db;
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  private noteFailure(key: string): void {
    if (!this.incomplete.has(key)) this.logger.warn('QQ 消息流水写入或读取失败，记录可能不完整。');
    this.incomplete.add(key);
  }
}

function parseEntry(body: unknown): StoredEntry {
  if (typeof body !== 'string') throw new Error('Invalid QQ timeline record');
  return JSON.parse(body) as StoredEntry;
}
