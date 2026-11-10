import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, fchmodSync, fsyncSync, mkdirSync, openSync, readFileSync, statSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ReplyTarget } from '../types.ts';

export function deliveryKey(...parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export interface InputReceipt {
  kind: 'input';
  key: string;
  messageId: string;
  sessionId: string;
  senderId: string;
  target: ReplyTarget;
  contentHash: string;
  turn?: number;
}

export type DeliveryState = 'sending' | 'accepted' | 'unknown' | 'not-sent';
interface DeliveryReceipt {
  kind: 'delivery';
  key: string;
  state: DeliveryState;
  fingerprint?: string;
  httpStatus?: number;
  platformCode?: number;
}
type Receipt = InputReceipt | DeliveryReceipt;

/** Only identities and submission states are retained here; this is not a chat log.
 * Synchronous refresh/write fences stale instances within one Host. Sharing the
 * directory between independent processes remains unsupported.
 */
export class DeliveryLedger {
  private receipts = new Map<string, Receipt>();
  private signature: string | undefined;
  private initialized = false;

  constructor(private readonly file?: string) { this.refresh(); }

  hasInput(key: string): boolean { this.refresh(); return this.receipts.get(key)?.kind === 'input'; }

  knowsInput(messageId: string): boolean {
    this.refresh();
    return [...this.receipts.values()].some(r => r.kind === 'input' && r.messageId === messageId);
  }

  registerInput(input: Omit<InputReceipt, 'kind'>): boolean {
    this.refresh();
    if (this.receipts.has(input.key)) return false;
    this.put({ ...input, target: { ...input.target }, kind: 'input' });
    return true;
  }

  claimInput(messageId: string, sessionId: string, content: unknown, turn: number): InputReceipt | undefined {
    this.refresh();
    const input = [...this.receipts.values()].find((r): r is InputReceipt => r.kind === 'input' && r.messageId === messageId);
    if (!input || input.sessionId !== sessionId || input.contentHash !== deliveryKey(content)) return undefined;
    if (input.turn !== undefined && input.turn !== turn) return undefined;
    if (input.turn === undefined) this.put({ ...input, turn });
    return input;
  }

  begin(key: string, fingerprint?: string): boolean {
    this.refresh();
    if (this.receipts.has(key)) return false;
    this.put({ kind: 'delivery', key, state: 'sending', fingerprint });
    return true;
  }

  state(key: string): DeliveryState | undefined {
    return this.delivery(key)?.state;
  }

  delivery(key: string): Readonly<DeliveryReceipt> | undefined {
    this.refresh();
    const receipt = this.receipts.get(key);
    return receipt?.kind === 'delivery' ? receipt : undefined;
  }

  settle(key: string, state: Exclude<DeliveryState, 'sending'>, detail?: Pick<DeliveryReceipt, 'httpStatus' | 'platformCode'>): void {
    const previous = this.delivery(key);
    this.put({ ...previous, kind: 'delivery', key, state, ...detail });
  }

  async run(key: string, action: () => Promise<unknown>): Promise<boolean> {
    if (!this.begin(key)) return false;
    try {
      await action();
      this.settle(key, 'accepted');
      return true;
    } catch (error) {
      this.settle(key, 'unknown');
      throw error;
    }
  }

  private refresh(): void {
    if (!this.file) return;
    const knownLedger = this.initialized || existsSync(`${this.file}.initialized`);
    if (!existsSync(this.file)) {
      if (this.signature || knownLedger) throw new Error('QQ delivery ledger disappeared; refusing to recreate submission identities');
      return;
    }
    const signature = this.fileSignature();
    if (signature === this.signature) return;
    const text = readFileSync(this.file, 'utf8');
    if (text && !text.endsWith('\n')) throw new Error('QQ delivery ledger is incomplete; refusing to replay it');
    const records = new Map<string, Receipt>();
    for (const line of text.trim().split('\n').filter(Boolean)) {
      const raw: unknown = JSON.parse(line);
      if (!isReceipt(raw)) throw new Error('QQ delivery ledger is invalid; refusing to replay or overwrite it');
      records.set(raw.key, raw);
    }
    if (records.size > 0) this.markInitialized(this.file);
    else if (knownLedger) throw new Error('QQ delivery ledger was emptied; refusing to recreate submission identities');
    this.receipts = records;
    this.signature = signature;
  }

  private put(receipt: Receipt): void {
    if (this.file) {
      const firstCreatedDir = mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      // Existing files must never be recreated by an append after refresh.
      const flags = this.signature ? constants.O_WRONLY | constants.O_APPEND : 'ax';
      const fd = openSync(this.file, flags, 0o600);
      try {
        fchmodSync(fd, 0o600);
        const line = Buffer.from(JSON.stringify(receipt) + '\n');
        let offset = 0;
        while (offset < line.length) offset += writeSync(fd, line, offset);
        fsyncSync(fd);
      } finally { closeSync(fd); }
      this.markInitialized(this.file, firstCreatedDir);
      this.signature = this.fileSignature();
    }
    this.receipts.set(receipt.key, receipt);
  }

  private markInitialized(file: string, firstCreatedDir?: string): void {
    if (this.initialized) return;
    // The marker survives loss of the journal. Sync both directory entries
    // before allowing the first external effect on a newly opened ledger.
    const marker = openSync(`${file}.initialized`, 'a', 0o600);
    try { fsyncSync(marker); } finally { closeSync(marker); }
    if (process.platform !== 'win32') {
      const top = firstCreatedDir ? dirname(firstCreatedDir) : dirname(file);
      for (let parent = dirname(file); ; parent = dirname(parent)) {
        const fd = openSync(parent, 'r');
        try { fsyncSync(fd); } finally { closeSync(fd); }
        if (parent === top) break;
      }
    }
    this.initialized = true;
  }

  private fileSignature(): string {
    const stat = statSync(this.file!);
    return `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  }
}

function isReceipt(raw: unknown): raw is Receipt {
  if (!raw || typeof raw !== 'object' || !('key' in raw) || typeof raw.key !== 'string') return false;
  if ('kind' in raw && raw.kind === 'delivery') {
    return 'state' in raw && (raw.state === 'sending' || raw.state === 'accepted' || raw.state === 'unknown' || raw.state === 'not-sent');
  }
  if (!('kind' in raw) || raw.kind !== 'input') return false;
  if (!('messageId' in raw) || typeof raw.messageId !== 'string' || !('sessionId' in raw) || typeof raw.sessionId !== 'string'
    || !('senderId' in raw) || typeof raw.senderId !== 'string' || !('contentHash' in raw) || typeof raw.contentHash !== 'string') return false;
  if ('turn' in raw && (typeof raw.turn !== 'number' || !Number.isSafeInteger(raw.turn))) return false;
  if (!('target' in raw) || !raw.target || typeof raw.target !== 'object') return false;
  return 'scope' in raw.target && (raw.target.scope === 'c2c' || raw.target.scope === 'group')
    && 'targetId' in raw.target && typeof raw.target.targetId === 'string'
    && (!('msgId' in raw.target) || typeof raw.target.msgId === 'string');
}
