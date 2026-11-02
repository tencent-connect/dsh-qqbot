import { createElement as h, type ReactNode } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-chat/client';
import { QQSessionStore, useQQSessionStore } from './qq-session-store.ts';

interface ChatProjection { nodes: { values(): readonly { kind: string; data: unknown }[] } }
type AnswerActionProps = PropsRuntime<'conversation.chat.assistant-actions'>;
/** Read only finalized text blocks from the public Chat projection; never forward reasoning/tool output. */
export function finalizedAnswer(snapshot: ChatProjection, messageId: string): string {
  for (const node of snapshot.nodes.values()) {
    if (node.kind !== 'turn-tail' || !node.data || typeof node.data !== 'object' || !('closing' in node.data)) continue;
    const closing = node.data.closing;
    if (!closing || typeof closing !== 'object' || !('status' in closing) || closing.status !== 'settled' || !('finalNode' in closing) || !('blocks' in closing)) continue;
    const finalNode = closing.finalNode;
    if (!finalNode || typeof finalNode !== 'object' || !('messageId' in finalNode) || finalNode.messageId !== messageId || !Array.isArray(closing.blocks)) continue;
    return closing.blocks.filter((block): block is { kind: 'text'; text: string } => Boolean(block) && typeof block === 'object' && block.kind === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n');
  }
  return '';
}
export function createQQAnswerAction(store: QQSessionStore): (props: AnswerActionProps) => ReactNode {
  return function QQAnswerAction({ sessionId, messageId, useChat }: AnswerActionProps): ReactNode {
    useQQSessionStore(store);
    const text = useChat((snapshot) => finalizedAnswer(snapshot, messageId));
    const entry = store.entry(sessionId);
    if (!entry?.admitted || entry.currentSessionId !== sessionId || !text.trim()) return null;
    return h(Button, { variant: 'toolbar', size: 'sm', className: 'imqc-answerAction', onClick: () => store.previewAnswer(sessionId, messageId, text) }, '发送到 QQ');
  };
}
