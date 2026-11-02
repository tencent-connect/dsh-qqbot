import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MessageId, ToolCallId, type ContentBlock, type UserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { ReplyTarget } from '../types.ts';
import { atomicWrite } from '../conversations/files.ts';
import type { QQTurnContext } from '../prompt/index.ts';

export interface QQOperation {
  readonly preparedAt?: number;
  readonly terminalAt?: number;
  readonly operationId: string;
  readonly conversationKey: string;
  readonly sessionId: SessionId;
  readonly generation: number;
  readonly policyVersion: string;
  readonly message: UserMessage;
  readonly payloadHash: string;
  readonly target: Readonly<ReplyTarget>;
  readonly cutoff: number;
  readonly backgroundRefs: readonly string[];
  readonly originalReceived: unknown;
  /** Queue-only facts; the native inbox carries references, never these bodies. */
  readonly promptContext?: QQTurnContext;
  /** Retained after terminal cleanup to preserve immutable snapshot identity. */
  readonly promptContextHash?: string;
}

export type PrepareQQOperation = Omit<QQOperation, 'payloadHash' | 'promptContextHash'>;

export interface HumanReceipt {
  readonly sessionId: SessionId;
  readonly turn: number;
  readonly callId: ToolCallId;
  readonly nonce: string;
  readonly actor: string;
  readonly answerHash: string;
}

export type HumanReply = Omit<HumanReceipt, 'answerHash'> & { readonly answer: unknown };

interface OperationFile {
  format: 1;
  operations: QQOperation[];
  receipts: HumanReceipt[];
  retired: Array<{ operationId: string; messageId: string; payloadHash: string; conversationKey: string; sessionId: string }>;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid QQ operation record');
  return Object.fromEntries(Object.entries(value));
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new TypeError('Invalid QQ operation identity');
  return value;
}

function natural(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid QQ operation counter');
  return value;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid QQ background references');
  return value.map(text);
}

function isUserBlock(value: unknown): value is ContentBlock {
  if (!value || typeof value !== 'object' || !('type' in value)) return false;
  if (value.type === 'text') return 'text' in value && typeof value.text === 'string';
  if (value.type !== 'file' && value.type !== 'image') return false;
  if (!('attachment' in value) || !value.attachment || typeof value.attachment !== 'object') return false;
  const attachment = value.attachment;
  if (!('attachmentId' in attachment) || typeof attachment.attachmentId !== 'string' || !attachment.attachmentId
    || !('bytes' in attachment) || typeof attachment.bytes !== 'number'
    || !Number.isSafeInteger(attachment.bytes) || attachment.bytes < 0) return false;
  if (value.type === 'file') return 'name' in attachment && typeof attachment.name === 'string';
  if (!('mediaType' in attachment) || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(String(attachment.mediaType))
    || !('width' in attachment) || typeof attachment.width !== 'number' || !Number.isSafeInteger(attachment.width) || attachment.width < 1
    || !('height' in attachment) || typeof attachment.height !== 'number' || !Number.isSafeInteger(attachment.height) || attachment.height < 1
    || ('name' in attachment && typeof attachment.name !== 'string')
    || ('offloaded' in value && value.offloaded !== true)) return false;
  if ('originalDimensions' in attachment) {
    const dimensions = attachment.originalDimensions;
    if (!dimensions || typeof dimensions !== 'object'
      || !('width' in dimensions) || typeof dimensions.width !== 'number' || !Number.isSafeInteger(dimensions.width) || dimensions.width < 1
      || !('height' in dimensions) || typeof dimensions.height !== 'number' || !Number.isSafeInteger(dimensions.height) || dimensions.height < 1) return false;
  }
  return true;
}

function userMessage(value: unknown): UserMessage {
  const data = record(value);
  const source = record(data.source);
  if (data.role !== 'user' || source.kind !== 'user' || !Array.isArray(data.content) || !data.content.every(isUserBlock)) {
    throw new TypeError('Invalid QQ native user message');
  }
  return { ...data, id: MessageId(text(data.id)), role: 'user', source: { ...source, kind: 'user' }, content: data.content };
}

function replyTarget(value: unknown): Readonly<ReplyTarget> {
  const data = record(value);
  if (data.scope !== 'c2c' && data.scope !== 'group') throw new TypeError('Invalid QQ reply target');
  if (data.msgId !== undefined && data.eventId !== undefined) throw new TypeError('Ambiguous QQ reply target');
  return {
    scope: data.scope, targetId: text(data.targetId),
    ...(data.msgId === undefined ? {} : { msgId: text(data.msgId) }),
    ...(data.eventId === undefined ? {} : { eventId: text(data.eventId) }),
  };
}

function parseOperation(value: unknown): QQOperation {
  const data = record(value);
  const message = userMessage(data.message);
  if (data.payloadHash !== payloadHash(message) || data.originalReceived === undefined) throw new TypeError('Corrupt QQ operation payload');
  const terminalAt = data.terminalAt === undefined ? undefined : natural(data.terminalAt);
  const promptContext = contextSnapshot(data.promptContext, data.promptContextHash, terminalAt !== undefined);
  return {
    ...(data.preparedAt === undefined ? {} : { preparedAt: natural(data.preparedAt) }),
    ...(terminalAt === undefined ? {} : { terminalAt }),
    operationId: text(data.operationId), conversationKey: text(data.conversationKey),
    sessionId: SessionId(text(data.sessionId)), generation: natural(data.generation),
    policyVersion: text(data.policyVersion), message, payloadHash: data.payloadHash,
    target: replyTarget(data.target), cutoff: natural(data.cutoff),
    backgroundRefs: strings(data.backgroundRefs), originalReceived: data.originalReceived,
    ...promptContext,
  };
}

function contextSnapshot(value: unknown, digest: unknown, terminal: boolean): Pick<QQOperation, 'promptContext' | 'promptContextHash'> {
  if (value === undefined && digest === undefined) return {}; // Older operations have no snapshot.
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw new TypeError('Corrupt QQ prompt context hash');
  if (value === undefined && terminal) return { promptContextHash: digest };
  const data = record(value);
  if (typeof data.turnMetaText !== 'string' || typeof data.backgroundText !== 'string') throw new TypeError('Invalid QQ prompt context');
  const promptContext = { turnMetaText: data.turnMetaText, backgroundText: data.backgroundText };
  if (digest !== payloadHash(promptContext)) throw new TypeError('Corrupt QQ prompt context snapshot');
  return { promptContext, promptContextHash: digest };
}

function parseReceipt(value: unknown): HumanReceipt {
  const data = record(value);
  if (typeof data.answerHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.answerHash)) throw new TypeError('Invalid QQ human receipt');
  return {
    sessionId: SessionId(text(data.sessionId)), turn: natural(data.turn), callId: ToolCallId(text(data.callId)),
    nonce: text(data.nonce), actor: text(data.actor), answerHash: data.answerHash,
  };
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const data = record(value);
  return `{${Object.keys(data).sort().filter(key => data[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical(data[key])}`).join(',')}}`;
}

export function payloadHash(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }

function snapshot<T>(value: T): T {
  const copy = structuredClone(value);
  function freeze(item: unknown): void {
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) return;
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  }
  freeze(copy);
  return copy;
}

/** Immutable request and human-origin evidence. A recovered request is never a new enqueue. */
export class QQOperations {
  private readonly path: string;
  private state: OperationFile;

  public constructor(dataDir: string) {
    this.path = join(dataDir, 'qq-operations.json');
    if (!existsSync(this.path)) { this.state = { format: 1, operations: [], receipts: [], retired: [] }; return; }
    const data = record(JSON.parse(readFileSync(this.path, 'utf8')));
    if (data.format !== 1 || !Array.isArray(data.operations) || !Array.isArray(data.receipts)) throw new TypeError('Invalid QQ operation file');
    const legacyTime = Math.floor(statSync(this.path).mtimeMs);
    const retired = data.retired === undefined ? [] : data.retired;
    if (!Array.isArray(retired)) throw new TypeError('Invalid retired QQ operation file');
    this.state = { format: 1, operations: data.operations.map(item => { const operation = parseOperation(item); return snapshot({ ...operation, preparedAt: operation.preparedAt ?? legacyTime }); }), receipts: data.receipts.map(parseReceipt), retired: retired.map(item => { const value = record(item); return { operationId: text(value.operationId), messageId: text(value.messageId), payloadHash: text(value.payloadHash), conversationKey: text(value.conversationKey), sessionId: text(value.sessionId) }; }) };
    if (new Set(this.state.operations.map(item => item.operationId)).size !== this.state.operations.length
      || new Set(this.state.operations.map(item => item.message.id)).size !== this.state.operations.length) throw new TypeError('Duplicate QQ operation identity');
    if (new Set(this.state.receipts.map(item => `${item.sessionId}\0${item.nonce}`)).size !== this.state.receipts.length) throw new TypeError('Duplicate QQ human receipt');
  }

  public prepare(input: PrepareQQOperation): { created: boolean; operation: QQOperation } {
    if (this.state.retired.some(item => item.operationId === input.operationId || item.messageId === input.message.id)) throw new Error('QQ operation body has expired; it cannot be replayed');
    const prior = this.state.operations.find(item => item.operationId === input.operationId);
    const operation = snapshot(parseOperation({ ...input,
      ...(input.promptContext === undefined ? {} : { promptContextHash: payloadHash(input.promptContext) }),
      ...(prior?.terminalAt === undefined ? {} : { terminalAt: prior.terminalAt, promptContext: undefined }),
      preparedAt: prior?.preparedAt ?? input.preparedAt ?? Date.now(), payloadHash: payloadHash(input.message) }));
    canonical(operation);
    if (prior) {
      if (payloadHash(prior) !== payloadHash(operation)) throw new Error('QQ operation identity reused with different input');
      return { created: false, operation: snapshot(prior) };
    }
    if (this.state.operations.some(item => item.message.id === operation.message.id)) throw new Error('QQ message identity already prepared');
    this.commit({ ...this.state, operations: [...this.state.operations, operation] });
    return { created: true, operation: snapshot(operation) };
  }

  public has(operationId: string): boolean { return this.state.operations.some(item => item.operationId === operationId) || this.state.retired.some(item => item.operationId === operationId); }
  public all(): readonly QQOperation[] { return snapshot(this.state.operations); }
  public markTerminal(operationId: string): void {
    const operation = this.state.operations.find(item => item.operationId === operationId);
    if (!operation || operation.terminalAt !== undefined) return;
    this.commit({ ...this.state, operations: this.state.operations.map(item => {
      if (item !== operation) return item;
      const terminal = { ...item, terminalAt: Date.now() };
      delete terminal.promptContext;
      return snapshot(terminal);
    }) });
  }
  public retireExpired(cutoff: (key: string) => number, protectedOperation: (operation: QQOperation) => boolean, bodyExpired: (operation: QQOperation) => boolean = () => false): number {
    const retired = this.state.operations.filter(item => item.terminalAt !== undefined && ((item.preparedAt ?? Infinity) < cutoff(item.conversationKey) || bodyExpired(item)) && !protectedOperation(item));
    if (!retired.length) return 0;
    const ids = new Set(retired.map(item => item.operationId));
    this.commit({ ...this.state, operations: this.state.operations.filter(item => !ids.has(item.operationId)), retired: [...this.state.retired, ...retired.map(item => ({ operationId: item.operationId, messageId: item.message.id, payloadHash: item.payloadHash, conversationKey: item.conversationKey, sessionId: item.sessionId }))] });
    return retired.length;
  }

  public lookup(operationId: string): QQOperation | undefined {
    const operation = this.state.operations.find(item => item.operationId === operationId);
    return operation === undefined ? undefined : snapshot(operation);
  }

  public forSession(sessionId: string): readonly QQOperation[] {
    return snapshot(this.state.operations.filter(item => item.sessionId === sessionId));
  }

  public recordHumanReply(input: HumanReply): HumanReceipt {
    const receipt = parseReceipt({ ...input, answerHash: payloadHash(input.answer) });
    const prior = this.state.receipts.find(item => item.nonce === receipt.nonce && item.sessionId === receipt.sessionId);
    if (prior) {
      if (payloadHash(prior) !== payloadHash(receipt)) throw new Error('QQ human nonce reused with different answer');
      return snapshot(prior);
    }
    this.commit({ ...this.state, receipts: [...this.state.receipts, receipt] });
    return snapshot(receipt);
  }

  public receiptsForSession(sessionId: string): readonly HumanReceipt[] {
    return snapshot(this.state.receipts.filter(item => item.sessionId === sessionId));
  }

  private commit(next: OperationFile): void {
    atomicWrite(this.path, [JSON.stringify(next)]);
    this.state = next;
  }
}
