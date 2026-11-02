import { CONVERSATIONS_PATH, type ConversationAction, type ConversationActionResult } from '../shared/conversation-protocol.ts';
import { fetchJson } from './http.ts';

export async function conversationAction(action: ConversationAction): Promise<ConversationActionResult> {
  return fetchJson<ConversationActionResult>(CONVERSATIONS_PATH, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action),
  }, 15_000);
}

export async function sendConversationAnswer(action: Extract<ConversationAction, { action: 'send' }> & { sourceSessionId: string; sourceMessageId: string }): Promise<ConversationActionResult> {
  return fetchJson<ConversationActionResult>(CONVERSATIONS_PATH, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action),
  }, 15_000);
}
