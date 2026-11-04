import { createHash } from 'node:crypto';
import { closeSync, existsSync, fchmodSync, fsyncSync, mkdirSync, openSync, readFileSync, statSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
export function deliveryKey(...parts) {
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
/** Only identities and submission states are retained here; this is not a chat log.
 * Synchronous refresh/write fences stale instances within one Host. Sharing the
 * directory between independent processes remains unsupported.
 */
export class DeliveryLedger {
    file;
    receipts = new Map();
    signature;
    constructor(file) {
        this.file = file;
        this.refresh();
    }
    hasInput(key) { this.refresh(); return this.receipts.get(key)?.kind === 'input'; }
    knowsInput(messageId) {
        this.refresh();
        return [...this.receipts.values()].some(r => r.kind === 'input' && r.messageId === messageId);
    }
    registerInput(input) {
        this.refresh();
        if (this.receipts.has(input.key))
            return false;
        this.put({ ...input, target: { ...input.target }, kind: 'input' });
        return true;
    }
    claimInput(messageId, sessionId, content, turn) {
        this.refresh();
        const input = [...this.receipts.values()].find((r) => r.kind === 'input' && r.messageId === messageId);
        if (!input || input.sessionId !== sessionId || input.contentHash !== deliveryKey(content))
            return undefined;
        if (input.turn !== undefined && input.turn !== turn)
            return undefined;
        if (input.turn === undefined)
            this.put({ ...input, turn });
        return input;
    }
    begin(key) {
        this.refresh();
        if (this.receipts.has(key))
            return false;
        this.put({ kind: 'delivery', key, state: 'sending' });
        return true;
    }
    state(key) {
        this.refresh();
        const receipt = this.receipts.get(key);
        return receipt?.kind === 'delivery' ? receipt.state : undefined;
    }
    settle(key, state) {
        this.refresh();
        this.put({ kind: 'delivery', key, state });
    }
    async run(key, action) {
        if (!this.begin(key))
            return false;
        try {
            await action();
            this.settle(key, 'accepted');
            return true;
        }
        catch (error) {
            this.settle(key, 'unknown');
            throw error;
        }
    }
    refresh() {
        if (!this.file)
            return;
        if (!existsSync(this.file)) {
            if (this.signature)
                throw new Error('QQ delivery ledger disappeared; refusing to recreate submission identities');
            return;
        }
        const signature = this.fileSignature();
        if (signature === this.signature)
            return;
        const text = readFileSync(this.file, 'utf8');
        if (text && !text.endsWith('\n'))
            throw new Error('QQ delivery ledger is incomplete; refusing to replay it');
        const records = new Map();
        for (const line of text.trim().split('\n').filter(Boolean)) {
            const raw = JSON.parse(line);
            if (!isReceipt(raw))
                throw new Error('QQ delivery ledger is invalid; refusing to replay or overwrite it');
            records.set(raw.key, raw);
        }
        this.receipts = records;
        this.signature = signature;
    }
    put(receipt) {
        if (this.file) {
            mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
            const fd = openSync(this.file, 'a', 0o600);
            try {
                fchmodSync(fd, 0o600);
                const line = Buffer.from(JSON.stringify(receipt) + '\n');
                let offset = 0;
                while (offset < line.length)
                    offset += writeSync(fd, line, offset);
                fsyncSync(fd);
            }
            finally {
                closeSync(fd);
            }
            this.signature = this.fileSignature();
        }
        this.receipts.set(receipt.key, receipt);
    }
    fileSignature() {
        const stat = statSync(this.file);
        return `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
    }
}
function isReceipt(raw) {
    if (!raw || typeof raw !== 'object' || !('key' in raw) || typeof raw.key !== 'string')
        return false;
    if ('kind' in raw && raw.kind === 'delivery') {
        return 'state' in raw && (raw.state === 'sending' || raw.state === 'accepted' || raw.state === 'unknown' || raw.state === 'not-sent');
    }
    if (!('kind' in raw) || raw.kind !== 'input')
        return false;
    if (!('messageId' in raw) || typeof raw.messageId !== 'string' || !('sessionId' in raw) || typeof raw.sessionId !== 'string'
        || !('senderId' in raw) || typeof raw.senderId !== 'string' || !('contentHash' in raw) || typeof raw.contentHash !== 'string')
        return false;
    if ('turn' in raw && (typeof raw.turn !== 'number' || !Number.isSafeInteger(raw.turn)))
        return false;
    if (!('target' in raw) || !raw.target || typeof raw.target !== 'object')
        return false;
    return 'scope' in raw.target && (raw.target.scope === 'c2c' || raw.target.scope === 'group')
        && 'targetId' in raw.target && typeof raw.target.targetId === 'string'
        && (!('msgId' in raw.target) || typeof raw.target.msgId === 'string');
}
//# sourceMappingURL=delivery-ledger.js.map