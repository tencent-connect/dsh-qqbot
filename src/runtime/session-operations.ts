import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite } from '../conversations/files.ts';
import { payloadHash } from './qq-operations.ts';

type SessionOperation = { id: string; hash: string } & (
  | { state: 'pending' }
  | { state: 'complete'; sessionId: string }
  | { state: 'failed'; error: string }
);

/** A pending recovered create is never replayed: its external outcome is unknown. */
export class SessionOperations {
  private readonly path: string;
  private readonly entries = new Map<string, SessionOperation>();
  constructor(dataDir: string) {
    this.path = join(dataDir, 'session-operations.json');
    if (!existsSync(this.path)) return;
    const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('会话操作账本无效');
    for (const value of parsed) {
      if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string'
        || !('hash' in value) || typeof value.hash !== 'string' || !('state' in value)) throw new Error('会话操作账本无效');
      if (value.state === 'pending') this.entries.set(value.id, { id: value.id, hash: value.hash, state: 'pending' });
      else if (value.state === 'complete' && 'sessionId' in value && typeof value.sessionId === 'string') this.entries.set(value.id, { id: value.id, hash: value.hash, state: 'complete', sessionId: value.sessionId });
      else if (value.state === 'failed' && 'error' in value && typeof value.error === 'string') this.entries.set(value.id, { id: value.id, hash: value.hash, state: 'failed', error: value.error });
      else throw new Error('会话操作账本无效');
    }
  }
  begin(id: string, input: unknown): string | undefined {
    if (!id.trim() || id.length > 256 || id.includes('\0')) throw new Error('操作标识无效');
    const hash = payloadHash(input);
    const prior = this.entries.get(id);
    if (prior) {
      if (prior.hash !== hash) throw new Error('操作标识已用于其他会话配置');
      if (prior.state === 'complete') return prior.sessionId;
      throw new Error(prior.state === 'failed' ? prior.error : '此前创建结果未知，请刷新核对当前会话；未自动重建');
    }
    this.write({ id, hash, state: 'pending' });
    return undefined;
  }
  complete(id: string, sessionId: string): void { this.finish(id, { state: 'complete', sessionId }); }
  fail(id: string, error: string): void { this.finish(id, { state: 'failed', error }); }
  private finish(id: string, result: { state: 'complete'; sessionId: string } | { state: 'failed'; error: string }): void {
    const prior = this.entries.get(id); if (!prior) throw new Error('会话操作账本缺失');
    this.write({ id, hash: prior.hash, ...result });
  }
  private write(entry: SessionOperation): void {
    const next = new Map(this.entries); next.set(entry.id, entry);
    atomicWrite(this.path, [JSON.stringify([...next.values()])]);
    this.entries.set(entry.id, entry);
  }
}
