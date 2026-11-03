import type {} from '@deepseek-ai/dsh-agent/types';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-time-context';
import type {} from '@deepseek-ai/dsh-tool-skill';
import type {} from '@deepseek-ai/dsh-user-questions';
import type {} from '../../node_modules/@deepseek-ai/dsh-agent-loop/lib/types/runtime-context.d.ts';
import { createAssistantMessage, createMessage, createUserMessage, ToolCallId, type FileBlock, type UserMessage } from '@deepseek-ai/dsh-llm';
import { Session, SessionId, SessionSeq, type TurnEndReason } from '@deepseek-ai/dsh-session';
import { describe, expect, it } from 'vitest';
import { payloadHash, type HumanReceipt, type QQOperation } from './qq-operations.ts';
import { classifyTurn, classifyTurnInputs } from './qq-turn.ts';

function user(text: string): UserMessage { return createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }); }
function operation(message = user('QQ input'), id = 'qq-1'): QQOperation {
  return {
    operationId: id, conversationKey: 'qq:app:group:peer', sessionId: SessionId('native'), generation: 1,
    policyVersion: '2', message, payloadHash: payloadHash(message), target: { scope: 'group', targetId: 'peer', msgId: 'incoming-1' },
    cutoff: 10, backgroundRefs: [], originalReceived: { id: 'incoming-1' },
  };
}
function enqueue(session: Session, message: UserMessage, target: 'next-turn' | 'next-step' = 'next-turn', start = 0): void {
  session.append('agent/inbox/spliced', { target, start, inserted: [message] });
}
function claim(session: Session, target: 'next-turn' | 'next-step' = 'next-turn', removedCount = 1): void {
  session.append('agent/inbox/spliced', { target, start: 0, removedCount, inserted: [] });
}
function enter(session: Session, messages: readonly UserMessage[], step = 1): void {
  session.append('step/start', { turn: 1, step });
  for (const message of messages) session.append('user/message', message, { surfaceOp: 'append' });
}
function assistant(session: Session, text = 'final', step = 1): ReturnType<typeof createAssistantMessage> {
  const message = createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [{ type: 'reasoning', text: 'private reasoning' }, { type: 'text', text }] });
  session.append('assistant/message', { turn: 1, step, message, stream: [] }, { surfaceOp: 'append' });
  return message;
}
function toolCall(session: Session, callId: ReturnType<typeof ToolCallId>, name = 'ask_user_question', text = 'Question', args = '{"questions":[{"id":"q","question":"Continue?"}]}'): void {
  const message = createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [{ type: 'text', text }, { type: 'tool-call', id: callId, name, arguments: args }] });
  session.append('assistant/message', { turn: 1, step: 1, message, stream: [] }, { surfaceOp: 'append' });
  session.append('tool/call', { turn: 1, step: 1, callId, name, arguments: args });
}
function attachmentId(value: string): FileBlock['attachment']['attachmentId'] {
  function isAttachmentId(input: string): input is FileBlock['attachment']['attachmentId'] { return /^[a-f0-9]{64}$/.test(input); }
  if (!isAttachmentId(value)) throw new TypeError('invalid attachment fixture');
  return value;
}
function finish(session: Session, reason: TurnEndReason = { kind: 'completed' }, step = 1): void {
  session.append('step/end', { turn: 1, step });
  session.append('turn/end', { turn: 1, reason });
}
function start(op: QQOperation): Session {
  const session = Session.create(op.sessionId);
  enqueue(session, op.message);
  session.append('turn/start', { turn: 1 });
  claim(session);
  return session;
}
function verdict(session: Session, operations: readonly QQOperation[], receipts: readonly HumanReceipt[] = []) {
  return classifyTurn(session.snapshotEvents(), 1, operations, receipts);
}
function nativeContext(source: Extract<UserMessage['source'], { kind: 'runtime-context' | 'time-context' | 'skill-catalog' | 'model-selection' }>): UserMessage {
  const message = user('native context');
  const event = Session.create(SessionId('context'));
  event.append('user/message', { ...message, source }, { surfaceOp: 'append' });
  const stored = event.snapshotEvents()[0];
  if (stored?.type !== 'user/message') throw new Error('missing native context');
  return stored.data;
}

describe('classifyTurn with stock Session events', () => {
  it('authorizes the single native QQ opening and selects only the last completed assistant body', () => {
    const op = operation();
    const session = start(op);
    expect(classifyTurnInputs(session.snapshotEvents(), 1, [op], [])).toMatchObject({ kind: 'qq', operationId: op.operationId });
    expect(verdict(session, [op]).kind).toBe('suppressed');
    enter(session, [op.message, nativeContext({ kind: 'runtime-context' }), nativeContext({ kind: 'time-context' }), nativeContext({ kind: 'skill-catalog', form: 'catalog', entries: [] })]);
    const final = assistant(session, 'QQ answer');
    finish(session);
    expect(verdict(session, [op])).toEqual({ kind: 'qq', operationId: op.operationId, finalMessageId: final.id, text: 'QQ answer', inputSeq: 4 });
  });

  it('authorizes a QQ turn with the native model-selection notice appended after its opening', () => {
    const op = operation(); const session = start(op);
    const notice = nativeContext({ kind: 'model-selection', form: 'notice', summary: 'old/model → new/model' });
    enter(session, [op.message, notice]);
    expect(classifyTurnInputs(session.snapshotEvents(), 1, [op], [])).toEqual({ kind: 'qq', operationId: op.operationId, inputSeq: 4 });
    const final = assistant(session, 'QQ answer after model change'); finish(session);
    expect(verdict(session, [op])).toEqual({ kind: 'qq', operationId: op.operationId, finalMessageId: final.id, text: 'QQ answer after model change', inputSeq: 4 });
  });

  it('suppresses a native model-selection notice mixed with a real web input', () => {
    const op = operation(); const session = Session.create(op.sessionId);
    const web = user('web steer');
    const notice = nativeContext({ kind: 'model-selection', form: 'notice', summary: 'old/model → new/model' });
    enqueue(session, op.message); enqueue(session, web, 'next-step');
    session.append('turn/start', { turn: 1 }); claim(session); claim(session, 'next-step');
    enter(session, [op.message, notice, web]); assistant(session); finish(session);
    expect(classifyTurnInputs(session.snapshotEvents(), 1, [op], [])).toEqual({ kind: 'suppressed', reason: 'mixed-input' });
    expect(verdict(session, [op])).toEqual({ kind: 'suppressed', reason: 'mixed-input' });
  });

  it('does not treat other model-selection context forms as the native notice', () => {
    const op = operation(); const session = start(op);
    enter(session, [op.message, nativeContext({ kind: 'model-selection', form: 'catalog' })]);
    assistant(session); finish(session);
    expect(verdict(session, [op])).toEqual({ kind: 'suppressed', reason: 'unclaimed-input' });
  });

  it('suppresses a model-selection notice that rewrites the admitted QQ input', () => {
    const op = operation(); const session = start(op); enter(session, [op.message]);
    const notice = nativeContext({ kind: 'model-selection', form: 'notice', summary: 'old/model → new/model' });
    const inputSeq = SessionSeq(4);
    session.append('user/message', notice, { surfaceOp: { op: 'replace', startSeq: inputSeq, endSeq: inputSeq }, sourceEventSeqs: [inputSeq] });
    assistant(session); finish(session);
    expect(verdict(session, [op])).toEqual({ kind: 'suppressed', reason: 'input-history-rewritten' });
  });

  it('does not authorize a web queue message or a web-only steer turn', () => {
    for (const target of ['next-turn', 'next-step'] satisfies Array<'next-turn' | 'next-step'>) {
      const op = operation();
      const session = Session.create(op.sessionId);
      const web = user('web input');
      enqueue(session, web, target);
      session.append('turn/start', { turn: 1 });
      claim(session, target);
      enter(session, [web]); assistant(session); finish(session);
      expect(verdict(session, [op]).kind).toBe('suppressed');
    }
  });

  it('suppresses QQ mixed with web Steer, another QQ operation, or a second direct user input', () => {
    for (const extra of [user('web steer'), operation(user('QQ 2'), 'qq-2').message]) {
      const op = operation();
      const second = operation(extra, 'qq-2');
      const session = Session.create(op.sessionId);
      enqueue(session, op.message); enqueue(session, extra, 'next-step');
      session.append('turn/start', { turn: 1 });
      claim(session, 'next-step'); claim(session);
      enter(session, [extra, op.message]); assistant(session); finish(session);
      expect(verdict(session, [op, second]).kind).toBe('suppressed');
    }
    const op = operation(); const session = start(op);
    enter(session, [op.message, user('injected follow-up')]); assistant(session); finish(session);
    expect(verdict(session, [op]).kind).toBe('suppressed');
  });

  it('permanently revokes an edited QQ id even when its original text is restored before claim', () => {
    const op = operation(); const session = Session.create(op.sessionId);
    enqueue(session, op.message);
    session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [{ ...op.message, content: [{ type: 'text', text: 'web edited' }] }], outcome: 'canceled' });
    session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [op.message], outcome: 'canceled' });
    session.append('turn/start', { turn: 1 }); claim(session);
    enter(session, [op.message]); assistant(session); finish(session);
    expect(verdict(session, [op])).toEqual({ kind: 'suppressed', reason: 'qq-input-modified' });
  });

  it.each([
    { kind: 'runtime-context' },
    { kind: 'skill-catalog', form: 'catalog', entries: [] },
    { kind: 'time-context' },
    { kind: 'model-selection', form: 'notice', summary: 'old/model → new/model' },
  ] satisfies Array<Parameters<typeof nativeContext>[0]>)('suppresses a web-edited queued $kind message even when its original source is retained', source => {
    const op = operation(); const session = Session.create(op.sessionId);
    const context = nativeContext(source);
    enqueue(session, context, 'next-step');
    const edited: UserMessage = { ...context, content: [{ type: 'text', text: 'Private web edit' }] };
    session.append('agent/inbox/spliced', { target: 'next-step', start: 0, removedCount: 1, inserted: [edited], outcome: 'canceled' });
    enqueue(session, op.message);
    session.append('turn/start', { turn: 1 }); claim(session, 'next-step'); claim(session);
    enter(session, [edited, op.message]); assistant(session); finish(session);
    expect(verdict(session, [op])).toEqual({ kind: 'suppressed', reason: 'context-input-modified' });
  });

  it('revokes a QQ message moved from next-turn to next-step', () => {
    const op = operation(); const session = Session.create(op.sessionId);
    enqueue(session, op.message);
    session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' });
    enqueue(session, op.message, 'next-step');
    session.append('turn/start', { turn: 1 }); claim(session, 'next-step');
    enter(session, [op.message]); assistant(session); finish(session);
    expect(verdict(session, [op])).toEqual({ kind: 'suppressed', reason: 'qq-input-modified' });
  });

  it('requires the complete original payload including attachment references', () => {
    const original = user('with attachment');
    const message: UserMessage = { ...original, content: [...original.content, { type: 'file', attachment: { attachmentId: attachmentId('a'.repeat(64)), bytes: 3, name: 'a.txt' } }] };
    const op = operation(message);
    const changed: UserMessage = { ...message, content: [...original.content, { type: 'file', attachment: { attachmentId: attachmentId('b'.repeat(64)), bytes: 3, name: 'a.txt' } }] };
    const session = Session.create(op.sessionId); enqueue(session, changed);
    session.append('turn/start', { turn: 1 }); claim(session); enter(session, [changed]); assistant(session); finish(session);
    expect(verdict(session, [op]).kind).toBe('suppressed');
  });

  it('requires a QQ receipt with the exact call and structured answer for a question tool result', () => {
    const op = operation(); const session = start(op); enter(session, [op.message]);
    const callId = ToolCallId('ask-1'); const answer = { answers: [{ id: 'q', selected: ['yes'] }] };
    toolCall(session, callId);
    const result = createMessage({ role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text: JSON.stringify(answer) }] });
    session.append('tool/result', { turn: 1, step: 1, message: result }, { surfaceOp: 'append' });
    session.append('step/end', { turn: 1, step: 1 });
    enter(session, [], 2); assistant(session, 'final', 2); finish(session, { kind: 'completed' }, 2);
    const receipt: HumanReceipt = { sessionId: op.sessionId, turn: 1, callId, nonce: 'nonce', actor: 'qq-user', answerHash: payloadHash(answer) };
    expect(verdict(session, [op]).kind).toBe('suppressed');
    expect(verdict(session, [op], [{ ...receipt, callId: ToolCallId('other-call') }]).kind).toBe('suppressed');
    expect(verdict(session, [op], [{ ...receipt, answerHash: payloadHash({ answers: [] }) }]).kind).toBe('suppressed');
    expect(verdict(session, [op], [receipt]).kind).toBe('qq');
  });

  it('requires a matching receipt for a late user-question-reply consumed in the QQ turn', () => {
    const op = operation(); const session = start(op); enter(session, [op.message]);
    const callId = ToolCallId('late-ask'); const answer = { answers: [{ id: 'q', selected: ['yes'] }] };
    toolCall(session, callId);
    const result = createMessage({ role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text: JSON.stringify({ pending: true, callId, message: 'pending' }) }] });
    session.append('tool/result', { turn: 1, step: 1, message: result }, { surfaceOp: 'append' });
    session.append('step/end', { turn: 1, step: 1 });
    const reply = { ...user(''), source: { kind: 'user-question-reply', callId, outcome: 'answered' }, content: [{ type: 'text', text: JSON.stringify({ kind: 'answer_to_pending_question', tool: 'ask_user_question', callId, questions: [], ...answer }) }] } satisfies UserMessage;
    enqueue(session, reply, 'next-step'); claim(session, 'next-step'); enter(session, [reply], 2); assistant(session, 'answered', 2); finish(session, { kind: 'completed' }, 2);
    const receipt: HumanReceipt = { sessionId: op.sessionId, turn: 1, callId, nonce: 'nonce', actor: 'qq-user', answerHash: payloadHash(answer) };
    expect(verdict(session, [op]).kind).toBe('suppressed');
    expect(verdict(session, [op], [receipt]).kind).toBe('qq');
  });

  it('fails closed on partial logs, unfinished turns, and cancellation/error endings', () => {
    for (const reason of [{ kind: 'completed' }, { kind: 'aborted', reason: { kind: 'user' } }, { kind: 'error', error: { code: 'UNKNOWN', message: 'failure' } }] satisfies TurnEndReason[]) {
      const op = operation(); const session = start(op); enter(session, [op.message]); assistant(session);
      expect(verdict(session, [op]).kind).toBe('suppressed');
      finish(session, reason);
      const events = session.snapshotEvents();
      expect(classifyTurn(events.slice(1), 1, [op], []).kind).toBe('suppressed');
      expect(classifyTurn(events.filter(event => event.type !== 'user/message'), 1, [op], []).kind).toBe('suppressed');
      if (reason.kind !== 'completed') expect(verdict(session, [op]).kind).toBe('suppressed');
    }
  });

  it('does not concatenate tool narration or reasoning into the final response', () => {
    const op = operation(); const session = start(op); enter(session, [op.message]);
    const callId = ToolCallId('read');
    toolCall(session, callId, 'read', 'tool narration', '{"path":"file.txt"}');
    const result = createMessage({ role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text: 'tool result' }] });
    session.append('tool/result', { turn: 1, step: 1, message: result }, { surfaceOp: 'append' });
    session.append('step/end', { turn: 1, step: 1 });
    enter(session, [], 2); const final = assistant(session, 'only final', 2); finish(session, { kind: 'completed' }, 2);
    expect(verdict(session, [op])).toMatchObject({ kind: 'qq', finalMessageId: final.id, text: 'only final' });
  });

  it('does not send tool-call text as a final answer', () => {
    const op = operation(); const session = start(op); enter(session, [op.message]);
    const message = createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: [{ type: 'text', text: 'calling tool' }, { type: 'tool-call', id: ToolCallId('tool'), name: 'test', arguments: '{}' }] });
    session.append('assistant/message', { turn: 1, step: 1, message, stream: [] }, { surfaceOp: 'append' }); finish(session);
    expect(verdict(session, [op]).kind).toBe('suppressed');
  });
});
