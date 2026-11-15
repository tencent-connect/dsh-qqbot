import { closeSync, existsSync, fstatSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeSync, type Stats } from 'node:fs';
import { basename, dirname, join, sep } from 'node:path';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';
import { atomicWrite } from '../shared/atomic-file.ts';
import { MAX_TIMELINE_IMAGES, TIMELINE_PAGE_SIZE, type TimelineEntry, type TimelineInboundOutcome, type TimelinePage } from '../shared/workbench-timeline-protocol.ts';
import { deliveryKey } from '../transport/delivery-ledger.ts';

interface Peer { scope: ChatScope; openId: string }
type StoredEntry = TimelineEntry & { imageFiles?: string[] };
interface Journal {
  signature: string;
  generation?: string;
  oldestAt: number;
  rows: Map<string, StoredEntry>;
  completeBytes?: number;
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function signature(stats: { ino: number; size: number; mtimeMs: number }): string {
  return `${stats.ino}:${stats.size}:${stats.mtimeMs}`;
}

function journalState(stats: Stats, rows: Map<string, StoredEntry>): Journal {
  let oldestAt = Infinity;
  for (const row of rows.values()) oldestAt = Math.min(oldestAt, row.at);
  return { signature: signature(stats), generation: deliveryKey(stats.ino, stats.birthtimeMs), oldestAt, rows };
}

export function timelineText(text: string): string {
  return text.length > 16_000 ? text.slice(0, 16_000) + '…（记录已截断）' : text;
}

export function receivedEntryId(platformId: string): string {
  return deliveryKey('inbound', platformId);
}

/** Display data has independent failure and retention semantics from the delivery ledger. */
export class QqTimeline {
  private readonly journals = new Map<string, Journal>();
  private readonly incomplete = new Set<string>();
  private readonly pending = new Set<string>();
  private readonly generations = new Map<string, number>();

  constructor(private readonly root: string, private readonly logger: Logger,
    private readonly retainAfter?: (appId: string, target: ReplyTarget) => number | undefined) {}

  clearAccount(appId: string): void {
    const path = this.accountDir(appId);
    this.advanceGeneration(path);
    for (const key of this.generations.keys()) if (key.startsWith(path + sep)) this.generations.delete(key);
    for (const key of this.journals.keys()) if (key.startsWith(path + sep)) this.journals.delete(key);
    for (const set of [this.incomplete, this.pending]) {
      for (const key of set) if (key.startsWith(path + sep)) set.delete(key);
    }
    rmSync(path, { force: true, recursive: true });
  }

  clearPeer(appId: string, target: ReplyTarget): void {
    const path = this.peerDir(appId, target);
    const file = join(path, 'rows.jsonl');
    if (existsSync(file)) atomicWrite(file, []);
    this.advanceGeneration(path);
    this.journals.delete(file);
    for (const key of this.pending) if (key.startsWith(path + sep)) this.pending.delete(key);
    rmSync(join(path, 'incomplete'), { force: true });
    this.incomplete.delete(path);
  }

  expire(appId: string, target: ReplyTarget): void {
    try {
      this.retainedJournal(appId, target);
    } catch {
      this.noteFailure(this.peerDir(appId, target));
    }
  }

  peers(appId: string): Peer[] {
    const root = this.accountDir(appId);
    let names: string[];
    try { names = readdirSync(root); }
    catch (error) { if (missing(error)) return []; throw error; }

    return names.filter(name => /^[a-f0-9]{64}$/.test(name)).flatMap(name => {
      const directory = join(root, name);
      try {
        const peer = JSON.parse(readFileSync(join(directory, 'peer.json'), 'utf8')) as Peer;
        if (typeof peer.openId !== 'string' || (peer.scope !== 'c2c' && peer.scope !== 'group')
          || deliveryKey(peer.scope, peer.openId) !== name) throw new Error('Invalid QQ timeline peer');
        return [peer];
      } catch {
        this.noteFailure(directory);
        return [];
      }
    });
  }

  record(appId: string, target: ReplyTarget, entry: TimelineEntry, once = false): void {
    this.update(appId, target, entry.id, previous => once && previous ? undefined : entry);
  }

  recordImages(appId: string, target: ReplyTarget, localPaths: readonly string[]): void {
    if (!target.msgId || localPaths.length === 0) return;
    const id = receivedEntryId(target.msgId);
    this.update(appId, target, id, previous => {
      if (previous?.direction !== 'inbound' || previous.imageFiles?.length) return undefined;
      return { ...previous, imageFiles: localPaths.slice(0, MAX_TIMELINE_IMAGES).map(path => basename(path)) };
    });
  }

  imageFile(appId: string, target: ReplyTarget, id: string, index: number): string | undefined {
    return this.retainedJournal(appId, target).rows.get(id)?.imageFiles?.[index];
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
    const directory = this.peerDir(appId, target);
    const row = this.retainedJournal(appId, target).rows.get(id);
    return row && this.observedStatus(directory, row);
  }

  async observe<T>(appId: string, target: ReplyTarget, entry: TimelineEntry,
    send: () => Promise<T>, finish: (result?: T, error?: unknown) => Partial<TimelineEntry>,
    stillOwned?: () => boolean): Promise<T> {
    const account = this.accountDir(appId);
    const peer = this.peerDir(appId, target);
    const key = join(peer, entry.id);
    const accountGeneration = this.generations.get(account);
    const peerGeneration = this.generations.get(peer);
    const current = () => this.generations.get(account) === accountGeneration && this.generations.get(peer) === peerGeneration;
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
    const directory = this.peerDir(appId, target);
    const journal = this.retainedJournal(appId, target);
    const rows = [...journal.rows.values()];
    const end = before === undefined ? rows.length : rows.findIndex(row => row.id === before);
    if (end < 0) return undefined;
    const start = Math.max(0, end - TIMELINE_PAGE_SIZE);
    return {
      entries: rows.slice(start, end).map(row => this.observedStatus(directory, row)),
      before: start > 0 ? rows[start]?.id : undefined,
      incomplete: this.incomplete.has(directory) || existsSync(join(directory, 'incomplete')),
      generation: journal.generation,
    };
  }

  private observedStatus(directory: string, { imageFiles, ...row }: StoredEntry): TimelineEntry {
    if (imageFiles?.length) row.imageCount = imageFiles.length;
    return row.status === 'sending' && !this.pending.has(join(directory, row.id))
      ? { ...row, status: 'unknown' } : row;
  }

  private accountDir(appId: string): string {
    return join(this.root, deliveryKey(appId));
  }

  private peerDir(appId: string, target: ReplyTarget): string {
    return join(this.accountDir(appId), deliveryKey(target.scope, target.targetId));
  }

  private advanceGeneration(path: string): void {
    this.generations.set(path, (this.generations.get(path) ?? 0) + 1);
  }

  private retainedJournal(appId: string, target: ReplyTarget): Journal {
    const directory = this.peerDir(appId, target);
    const file = join(directory, 'rows.jsonl');
    const journal = this.load(file);
    const cutoff = this.retainAfter?.(appId, target);
    if (cutoff === undefined || journal.oldestAt >= cutoff) return journal;
    const rows = new Map([...journal.rows].filter(([, row]) => row.at >= cutoff));
    try {
      if (journal.completeBytes !== undefined && !existsSync(join(directory, 'incomplete'))) {
        atomicWrite(join(directory, 'incomplete'), ['Interrupted append\n']);
      }
      atomicWrite(file, journalLines(rows.values()));
      const retained = journalState(statSync(file), rows);
      this.remember(file, retained);
      return retained;
    } catch {
      this.noteFailure(directory);
      return { ...journal, rows, generation: deliveryKey(journal.generation, rows.size, rows.keys().next().value) };
    }
  }

  private update(appId: string, target: ReplyTarget, id: string, change: (previous?: StoredEntry) => StoredEntry | undefined): void {
    const directory = this.peerDir(appId, target);
    const file = join(directory, 'rows.jsonl');
    try {
      const journal = this.load(file);
      const entry = change(journal.rows.get(id));
      if (!entry || entry.at < (this.retainAfter?.(appId, target) ?? -Infinity)) return;
      if (journal.rows.size === 0) {
        atomicWrite(join(directory, 'peer.json'), [JSON.stringify({ scope: target.scope, openId: target.targetId })]);
      }
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (journal.completeBytes !== undefined && !existsSync(join(directory, 'incomplete'))) {
        atomicWrite(join(directory, 'incomplete'), ['Interrupted append\n']);
      }
      const fd = openSync(file, 'a', 0o600);
      try {
        if (journal.completeBytes !== undefined) ftruncateSync(fd, journal.completeBytes);
        const buffer = Buffer.from(JSON.stringify(entry) + '\n');
        let offset = 0;
        while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset);
        fsyncSync(fd);
        const stats = fstatSync(fd);
        journal.signature = signature(stats);
        journal.generation ??= deliveryKey(stats.ino, stats.birthtimeMs);
        journal.oldestAt = Math.min(journal.oldestAt, entry.at);
        journal.completeBytes = undefined;
      } finally { closeSync(fd); }
      journal.rows.set(id, entry);
      this.remember(file, journal);
    } catch {
      this.journals.delete(file);
      this.noteFailure(directory);
    }
  }

  private load(file: string): Journal {
    let stats: ReturnType<typeof statSync>;
    try { stats = statSync(file); }
    catch (error) {
      if (missing(error) && !this.journals.has(file)) return { signature: '', oldestAt: Infinity, rows: new Map() };
      throw error;
    }
    const stamp = signature(stats);
    const cached = this.journals.get(file);
    if (cached?.signature === stamp) {
      this.remember(file, cached);
      return cached;
    }
    const rows = new Map<string, StoredEntry>();
    const bytes = readFileSync(file);
    const end = bytes.lastIndexOf(0x0a) + 1;
    const completeBytes = end < bytes.length ? end : undefined;
    if (completeBytes !== undefined) this.noteFailure(dirname(file));
    const text = bytes.subarray(0, end).toString('utf8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      const row = JSON.parse(line) as StoredEntry;
      if (!row || typeof row.id !== 'string' || typeof row.text !== 'string' || !Number.isFinite(row.at)
        || (row.direction !== 'inbound' && row.direction !== 'outbound')
        || !['received', 'sending', 'partial', 'accepted', 'rejected', 'unknown'].includes(row.status)) throw new Error('Invalid QQ timeline');
      rows.set(row.id, row);
    }
    const journal = { ...journalState(stats, rows), completeBytes };
    this.remember(file, journal);
    return journal;
  }

  private remember(file: string, journal: Journal): void {
    this.journals.delete(file);
    this.journals.set(file, journal);
    if (this.journals.size > 8) this.journals.delete(this.journals.keys().next().value!);
  }

  private noteFailure(directory: string): void {
    if (!this.incomplete.has(directory)) this.logger.warn('QQ 消息流水写入或读取失败，记录可能不完整。');
    this.incomplete.add(directory);
  }
}

function* journalLines(rows: Iterable<StoredEntry>): Iterable<string> {
  for (const row of rows) yield JSON.stringify(row) + '\n';
}
