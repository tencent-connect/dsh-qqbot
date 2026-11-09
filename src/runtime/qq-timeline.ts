import { closeSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';
import { atomicWrite } from '../shared/atomic-file.ts';
import { TIMELINE_PAGE_SIZE, type TimelineEntry, type TimelinePage } from '../shared/workbench-timeline-protocol.ts';
import { deliveryKey } from '../transport/delivery-ledger.ts';

interface Peer { scope: ChatScope; openId: string }
interface Journal {
  signature: string;
  rows: Map<string, TimelineEntry>;
}

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function signature(stats: { ino: number; size: number; mtimeMs: number }): string {
  return `${stats.ino}:${stats.size}:${stats.mtimeMs}`;
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

  constructor(private readonly root: string, private readonly logger: Logger) {}

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

  link(appId: string, target: ReplyTarget, sessionId: string): void {
    if (!target.msgId) return;
    this.update(appId, target, receivedEntryId(target.msgId), previous =>
      previous && !previous.sessionId ? { ...previous, sessionId } : undefined);
  }

  async observe<T>(appId: string, target: ReplyTarget, entry: TimelineEntry,
    send: () => Promise<T>, finish: (result?: T, error?: unknown) => Partial<TimelineEntry>): Promise<T> {
    const key = join(this.peerDir(appId, target), entry.id);
    this.pending.add(key);
    this.update(appId, target, entry.id, previous => ({ ...entry, at: previous?.at ?? entry.at }));
    try {
      const result = await send();
      this.update(appId, target, entry.id, previous => previous && ({ ...previous, ...finish(result) }));
      return result;
    } catch (error) {
      this.update(appId, target, entry.id, previous => previous && ({ ...previous, ...finish(undefined, error) }));
      throw error;
    } finally {
      this.pending.delete(key);
    }
  }

  page(appId: string, target: ReplyTarget, before?: string): TimelinePage | undefined {
    const directory = this.peerDir(appId, target);
    const rows = [...this.load(join(directory, 'rows.jsonl')).rows.values()];
    const end = before === undefined ? rows.length : rows.findIndex(row => row.id === before);
    if (end < 0) return undefined;
    const start = Math.max(0, end - TIMELINE_PAGE_SIZE);
    return {
      entries: rows.slice(start, end).map(row => row.status === 'sending' && !this.pending.has(join(directory, row.id))
        ? { ...row, status: 'unknown' } : row),
      before: start > 0 ? rows[start]?.id : undefined,
      incomplete: this.incomplete.has(directory),
    };
  }

  private accountDir(appId: string): string {
    return join(this.root, deliveryKey(appId));
  }

  private peerDir(appId: string, target: ReplyTarget): string {
    return join(this.accountDir(appId), deliveryKey(target.scope, target.targetId));
  }

  private update(appId: string, target: ReplyTarget, id: string, change: (previous?: TimelineEntry) => TimelineEntry | undefined): void {
    const directory = this.peerDir(appId, target);
    const file = join(directory, 'rows.jsonl');
    try {
      const journal = this.load(file);
      const entry = change(journal.rows.get(id));
      if (!entry) return;
      if (journal.rows.size === 0) {
        atomicWrite(join(directory, 'peer.json'), [JSON.stringify({ scope: target.scope, openId: target.targetId })]);
      }
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const fd = openSync(file, 'a', 0o600);
      try {
        const buffer = Buffer.from(JSON.stringify(entry) + '\n');
        let offset = 0;
        while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset);
        fsyncSync(fd);
        journal.signature = signature(fstatSync(fd));
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
      if (missing(error) && !this.journals.has(file)) return { signature: '', rows: new Map() };
      throw error;
    }
    const stamp = signature(stats);
    const cached = this.journals.get(file);
    if (cached?.signature === stamp) {
      this.remember(file, cached);
      return cached;
    }
    const rows = new Map<string, TimelineEntry>();
    const text = readFileSync(file, 'utf8');
    if (text && !text.endsWith('\n')) throw new Error('Incomplete QQ timeline');
    for (const line of text.split('\n')) {
      if (!line) continue;
      const row = JSON.parse(line) as TimelineEntry;
      if (!row || typeof row.id !== 'string' || typeof row.text !== 'string' || !Number.isFinite(row.at)
        || (row.direction !== 'inbound' && row.direction !== 'outbound')
        || !['received', 'sending', 'partial', 'accepted', 'rejected', 'unknown'].includes(row.status)) throw new Error('Invalid QQ timeline');
      rows.set(row.id, row);
    }
    const journal = { signature: stamp, rows };
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
