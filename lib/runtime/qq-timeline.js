import { chmodSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, join, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MAX_TIMELINE_IMAGES, TIMELINE_PAGE_SIZE } from "../shared/workbench-timeline-protocol.js";
import { deliveryKey } from "../transport/delivery-ledger.js";
function partition(appId, target) {
    return [appId, target.scope, target.targetId];
}
function recordKey(appId, target) {
    return join(deliveryKey(appId), deliveryKey(target.scope, target.targetId));
}
export function timelineText(text) {
    return text.length > 16_000 ? text.slice(0, 16_000) + '…（记录已截断）' : text;
}
export function receivedEntryId(platformId) {
    return deliveryKey('inbound', platformId);
}
/** The display store and the delivery ledger have separate retention and failure semantics. */
export class QqTimeline {
    root;
    logger;
    retainAfter;
    database;
    closed = false;
    incomplete = new Set();
    pending = new Set();
    generations = new Map();
    constructor(root, logger, retainAfter) {
        this.root = root;
        this.logger = logger;
        this.retainAfter = retainAfter;
    }
    close() {
        this.closed = true;
        this.database?.close();
        this.database = undefined;
    }
    clearAccount(appId) {
        this.connection().prepare('DELETE FROM peers WHERE app_id = ?').run(appId);
        const account = deliveryKey(appId);
        this.advanceGeneration(account);
        for (const key of this.generations.keys())
            if (key.startsWith(account + sep))
                this.generations.delete(key);
        for (const set of [this.incomplete, this.pending]) {
            for (const key of set)
                if (key.startsWith(account + sep))
                    set.delete(key);
        }
    }
    clearPeer(appId, target) {
        const key = recordKey(appId, target);
        this.removeRows(appId, target);
        this.advanceGeneration(key);
        for (const pending of this.pending)
            if (pending.startsWith(key + sep))
                this.pending.delete(pending);
        this.incomplete.delete(key);
    }
    expire(appId, target) {
        try {
            const cutoff = this.retainAfter?.(appId, target);
            if (cutoff !== undefined)
                this.removeRows(appId, target, cutoff);
        }
        catch {
            this.noteFailure(recordKey(appId, target));
        }
    }
    peers(appId) {
        const rows = this.connection().prepare('SELECT scope, target_id FROM peers WHERE app_id = ?').all(appId);
        return rows.flatMap(row => (row.scope === 'group' || row.scope === 'c2c') && typeof row.target_id === 'string'
            ? [{ scope: row.scope, openId: row.target_id }] : []);
    }
    record(appId, target, entry, once = false) {
        this.update(appId, target, entry.id, previous => once && previous ? undefined : entry);
    }
    recordImages(appId, target, localPaths) {
        if (!target.msgId || localPaths.length === 0)
            return;
        const id = receivedEntryId(target.msgId);
        this.update(appId, target, id, previous => {
            if (previous?.direction !== 'inbound' || previous.imageFiles?.length)
                return undefined;
            return { ...previous, imageFiles: localPaths.slice(0, MAX_TIMELINE_IMAGES).map(path => basename(path)) };
        });
    }
    imageFile(appId, target, id, index) {
        return this.read(appId, target, id)?.imageFiles?.[index];
    }
    reportInbound(appId, target, inboundOutcome, sessionId) {
        if (!target.msgId)
            return;
        this.update(appId, target, receivedEntryId(target.msgId), previous => {
            if (!previous || previous.direction !== 'inbound' || previous.inboundOutcome === 'submitted')
                return undefined;
            if (previous.inboundOutcome && inboundOutcome !== 'submitted' && inboundOutcome !== 'submit-failed')
                return undefined;
            if (previous.inboundOutcome === inboundOutcome)
                return undefined;
            return { ...previous, inboundOutcome, sessionId: previous.sessionId ?? sessionId };
        });
    }
    entry(appId, target, id) {
        const row = this.read(appId, target, id);
        return row && this.observedStatus(recordKey(appId, target), row);
    }
    async observe(appId, target, entry, send, finish, stillOwned) {
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
        }
        catch (error) {
            if (current() && stillOwned?.() !== false) {
                this.update(appId, target, entry.id, previous => previous && ({ ...previous, ...finish(undefined, error) }));
            }
            throw error;
        }
        finally {
            if (current())
                this.pending.delete(key);
        }
    }
    page(appId, target, before) {
        this.expire(appId, target);
        const db = this.connection();
        const key = partition(appId, target);
        const position = before === undefined ? undefined : db.prepare('SELECT seq FROM messages WHERE app_id = ? AND scope = ? AND target_id = ? AND message_id = ?').get(...key, before)?.seq;
        if (before !== undefined && typeof position !== 'number')
            return undefined;
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
    observedStatus(directory, { imageFiles, ...row }) {
        if (imageFiles?.length)
            row.imageCount = imageFiles.length;
        return row.status === 'sending' && !this.pending.has(join(directory, row.id))
            ? { ...row, status: 'unknown' } : row;
    }
    advanceGeneration(key) {
        this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    }
    removeRows(appId, target, cutoff) {
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
        }
        catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    }
    read(appId, target, id) {
        const entry = this.connection().prepare('SELECT body, at FROM messages WHERE app_id = ? AND scope = ? AND target_id = ? AND message_id = ?').get(...partition(appId, target), id);
        const cutoff = this.retainAfter?.(appId, target);
        if (!entry || (cutoff !== undefined && typeof entry.at === 'number' && entry.at < cutoff))
            return undefined;
        return parseEntry(entry.body);
    }
    update(appId, target, id, change) {
        if (this.closed)
            return;
        try {
            const db = this.connection();
            const entry = change(this.read(appId, target, id));
            if (!entry || entry.at < (this.retainAfter?.(appId, target) ?? -Infinity))
                return;
            const key = partition(appId, target);
            db.prepare('INSERT OR IGNORE INTO peers VALUES (?, ?, ?, ?)').run(...key, randomUUID());
            db.prepare(`INSERT INTO messages (app_id, scope, target_id, message_id, at, body) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (app_id, scope, target_id, message_id) DO UPDATE SET at = excluded.at, body = excluded.body`)
                .run(...key, id, entry.at, JSON.stringify(entry));
        }
        catch {
            this.noteFailure(recordKey(appId, target));
        }
    }
    connection() {
        if (this.closed)
            throw new Error('The QQ timeline is closed.');
        if (this.database)
            return this.database;
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
        }
        catch (error) {
            db.close();
            throw error;
        }
    }
    noteFailure(key) {
        if (!this.incomplete.has(key))
            this.logger.warn('QQ 消息流水写入或读取失败，记录可能不完整。');
        this.incomplete.add(key);
    }
}
function parseEntry(body) {
    if (typeof body !== 'string')
        throw new Error('Invalid QQ timeline record');
    return JSON.parse(body);
}
//# sourceMappingURL=qq-timeline.js.map