import { describe, expect, it } from 'vitest';
import { finalizedAnswer } from './conversation-answer-action.ts';
describe('explicit forwarding of native answers', () => {
  it('selects the requested durable assistant message and excludes reasoning/tool artifacts', () => {
    const snapshot = { nodes: { values: () => [
      { kind: 'assistant-step', data: { blocks: [{ kind: 'text', text: 'unfinished' }] } },
      { kind: 'turn-tail', data: { closing: { status: 'settled', finalNode: { messageId: 'different' }, blocks: [{ kind: 'text', text: 'other conversation reply' }] } } },
      { kind: 'turn-tail', data: { closing: { status: 'settled', finalNode: { messageId: 'answer' }, blocks: [{ kind: 'reasoning', text: 'private reasoning' }, { kind: 'text', text: '结论' }, { kind: 'tool-call', text: 'tool params' }, { kind: 'text', text: '补充' }] } } },
    ] } };
    expect(finalizedAnswer(snapshot, 'answer')).toBe('结论\n补充');
    expect(finalizedAnswer(snapshot, 'unknown')).toBe('');
  });
  it('does not offer interrupted or missing content for forwarding', () => {
    expect(finalizedAnswer({ nodes: { values: () => [{ kind: 'turn-tail', data: { closing: null } }, { kind: 'turn-tail', data: { closing: { status: 'interrupted', finalNode: { messageId: 'answer' }, blocks: [{ kind: 'text', text: 'partial output' }] } } }] } }, 'answer')).toBe('');
  });
});
