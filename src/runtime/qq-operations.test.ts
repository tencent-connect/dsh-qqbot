import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { afterEach, describe, expect, it } from 'vitest';
import { payloadHash, QQOperations, type PrepareQQOperation } from './qq-operations.ts';

const directories: string[] = [];
function directory(): string { const path = mkdtempSync(join(tmpdir(), 'qq-operations-')); directories.push(path); return path; }
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

function input(): PrepareQQOperation {
  return {
    operationId: 'qq:incoming-1', conversationKey: 'qq:app:group:peer', sessionId: SessionId('native-session'),
    generation: 2, policyVersion: '4', cutoff: 17, backgroundRefs: ['incoming-0'],
    message: createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }),
    target: { scope: 'group', targetId: 'peer', msgId: 'incoming-1' },
    originalReceived: { id: 'incoming-1', text: 'hello', attachments: [] },
  };
}

describe('QQOperations', () => {
  it('retires only expired terminal bodies and keeps permanent no-replay identities', () => {
    const path = directory(); const operations = new QQOperations(path);
    const request = { ...input(), preparedAt: 1 };
    operations.prepare(request);
    expect(operations.retireExpired(() => 2, () => false)).toBe(0);
    operations.markTerminal(request.operationId);
    expect(operations.retireExpired(() => 2, () => true)).toBe(0);
    expect(operations.retireExpired(() => 2, () => false)).toBe(1);
    const raw = readFileSync(join(path, 'qq-operations.json'), 'utf8');
    expect(raw).not.toContain('hello');
    expect(JSON.parse(raw).retired).toMatchObject([{ operationId: request.operationId, payloadHash: payloadHash(request.message) }]);
    const restored = new QQOperations(path);
    expect(restored.has(request.operationId)).toBe(true);
    expect(restored.lookup(request.operationId)).toBeUndefined();
    expect(() => restored.prepare(request)).toThrow('cannot be replayed');
  });

  it('persists the original incoming and prepared native input in the same immutable request', () => {
    const path = directory();
    const operations = new QQOperations(path);
    const request = input();
    const prepared = operations.prepare(request);
    expect(prepared.created).toBe(true);
    const persisted = JSON.parse(readFileSync(join(path, 'qq-operations.json'), 'utf8'));
    expect(persisted.operations).toHaveLength(1);
    expect(persisted.operations[0]).toMatchObject({ originalReceived: request.originalReceived, message: request.message, cutoff: 17 });
    expect(new QQOperations(path).prepare(request)).toEqual({ created: false, operation: prepared.operation });
    expect(new QQOperations(path).forSession(request.sessionId)).toEqual([prepared.operation]);
  });

  it('cannot change the destination, policy, background cutoff, or payload under an existing operation id', () => {
    const operations = new QQOperations(directory());
    const request = input();
    operations.prepare(request);
    for (const changed of [
      { ...request, target: { ...request.target, targetId: 'other' } },
      { ...request, policyVersion: '5' }, { ...request, cutoff: 18 },
      { ...request, message: { ...request.message, content: [{ type: 'text', text: 'edited' }] } satisfies PrepareQQOperation['message'] },
    ]) expect(() => operations.prepare(changed)).toThrow('different input');
  });

  it('preserves the complete native source metadata through prepare and restart', () => {
    const path = directory();
    const request = input();
    const source = { ...request.message.source, rpcId: 'incoming-rpc', qq: { senderId: 'sender', backgroundRefs: ['prior'], cutoff: 17 } };
    const message = { ...request.message, source };
    const prepared = new QQOperations(path).prepare({ ...request, message });
    expect(prepared.operation.message).toEqual(message);
    expect(prepared.operation.payloadHash).toBe(payloadHash(message));
    expect(new QQOperations(path).lookup(request.operationId)?.message.source).toEqual(source);
    expect(new QQOperations(path).prepare({ ...request, message }).created).toBe(false);
  });

  it('detaches the complete incoming snapshot and target from caller-owned mutable objects', () => {
    const operations = new QQOperations(directory());
    const request = input();
    const incoming = { text: 'before', attachments: [{ url: 'before' }] };
    const target = { scope: 'group', targetId: 'original' } satisfies PrepareQQOperation['target'];
    operations.prepare({ ...request, originalReceived: incoming, target });
    incoming.attachments[0]!.url = 'after';
    incoming.text = 'after';
    target.targetId = 'changed';
    expect(operations.lookup(request.operationId)).toMatchObject({ originalReceived: { text: 'before', attachments: [{ url: 'before' }] }, target: { targetId: 'original' } });
  });

  it('records an exact human-answer receipt before its caller returns and deduplicates the nonce', () => {
    const path = directory();
    const operations = new QQOperations(path);
    const reply = { sessionId: SessionId('native-session'), turn: 3, callId: ToolCallId('question-1'), nonce: 'interaction-1', actor: 'qq-user', answer: { answers: [{ id: 'q', selected: ['yes'] }] } };
    const receipt = operations.recordHumanReply(reply);
    expect(receipt.answerHash).toBe(payloadHash(reply.answer));
    expect(new QQOperations(path).receiptsForSession(reply.sessionId)).toEqual([receipt]);
    expect(operations.recordHumanReply(reply)).toEqual(receipt);
    expect(() => operations.recordHumanReply({ ...reply, answer: { answers: [] } })).toThrow('different answer');
  });

  it('fails closed on a stored payload modification and does not repair it', () => {
    const path = directory();
    new QQOperations(path).prepare(input());
    const filename = join(path, 'qq-operations.json');
    const data = JSON.parse(readFileSync(filename, 'utf8'));
    data.operations[0].message.content[0].text = 'edited';
    writeFileSync(filename, JSON.stringify(data));
    expect(() => new QQOperations(path)).toThrow('Corrupt QQ operation payload');
    expect(JSON.parse(readFileSync(filename, 'utf8')).operations[0].message.content[0].text).toBe('edited');
  });
});
