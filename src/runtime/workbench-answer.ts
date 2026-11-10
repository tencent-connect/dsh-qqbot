import type { Context } from '@deepseek-ai/cordis';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { WORKBENCH_ANSWER_PATH, type AnswerPreview } from '../shared/workbench-answer-protocol.ts';
import { QQ_MANUAL_MESSAGE_LIMIT } from '../shared/workbench-timeline-protocol.ts';
import { deliveryKey } from '../transport/delivery-ledger.ts';
import type { RobotRuntimes } from './robot-runtimes.ts';
import { robotObject } from './robot-config.ts';
import { registerWorkbenchFetch, workbenchJson, WorkbenchRequestError } from './workbench-routes.ts';

interface SessionReader {
  open(id: string, access: 'read', options: { signal: AbortSignal }): Promise<{
    read(): Promise<{ events: readonly SessionEvent[] }>;
    close(): Promise<void>;
  }>;
}

function answerText(event: SessionEvent<'assistant/message'>): string {
  return event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('');
}

function finalizedAnswer(events: readonly SessionEvent[], messageId: string): string | undefined {
  const index = events.findIndex(event => event.type === 'assistant/message' && event.surfaceOp === 'append'
    && event.data.message.id === messageId);
  const selected = events[index];
  if (selected?.type !== 'assistant/message' || selected.data.interrupted) return undefined;
  const { turn } = selected.data;
  for (let i = index + 1; i < events.length; i++) {
    const event = events[i]!;
    if (event.type === 'turn/start') break;
    if (event.type === 'assistant/message' && event.surfaceOp === 'append' && event.data.turn === turn && answerText(event).trim()) break;
    if (event.type === 'turn/end' && event.data.turn === turn && event.data.reason.kind === 'completed') {
      const text = answerText(selected);
      return text.trim() ? text : undefined;
    }
  }
  return undefined;
}

function readId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value)) throw new WorkbenchRequestError(400, '回答标识无效。');
  return value;
}

export function registerWorkbenchAnswer(ctx: Context, robots: Pick<RobotRuntimes, 'answerDestination' | 'manualStatus' | 'manualSend'>): void {
  registerWorkbenchFetch(ctx, WORKBENCH_ANSWER_PATH, ['GET', 'POST'], async (request, assertWritable) => {
    let sessionId: string;
    let messageId: string | undefined;
    let confirmation: string | undefined;
    if (request.method === 'GET') {
      const query = new URL(request.url).searchParams;
      if (query.getAll('sessionId').length !== 1 || query.getAll('messageId').length > 1) throw new WorkbenchRequestError(400, '回答标识无效。');
      sessionId = readId(query.get('sessionId'));
      if (query.has('messageId')) messageId = readId(query.get('messageId'));
    } else {
      const raw = await request.text();
      try {
        if (raw.length > 2048) throw new Error();
        const row = robotObject(JSON.parse(raw), ['sessionId', 'messageId', 'confirmation']);
        sessionId = readId(row.sessionId);
        messageId = readId(row.messageId);
        if (typeof row.confirmation !== 'string' || !/^[a-f0-9]{64}$/.test(row.confirmation)) throw new Error();
        confirmation = row.confirmation;
      } catch {
        throw new WorkbenchRequestError(400, '发送前请重新预览这条回答。');
      }
    }

    const persistence = ctx.get('sessionPersistence') as SessionReader | undefined;
    const destination = robots.answerDestination(sessionId);
    if (messageId === undefined) return workbenchJson({ available: !!destination && typeof persistence?.open === 'function' });
    if (!destination) throw new WorkbenchRequestError(404, '这个 Session 已不是 QQ 对话的当前会话。');
    if (typeof persistence?.open !== 'function') throw new WorkbenchRequestError(503, '当前宿主无法读取原生回答。');
    const handle = await persistence.open(sessionId, 'read', { signal: request.signal });
    let text: string | undefined;
    try {
      text = finalizedAnswer((await handle.read()).events, messageId);
    } finally {
      await handle.close();
    }
    if (text === undefined) throw new WorkbenchRequestError(404, '没有找到这条已完成的文字回答。');
    const { appId, scope, openId } = destination;
    const target = { scope, targetId: openId };
    const operation = deliveryKey('native-answer', sessionId, messageId);
    const expected = deliveryKey(appId, scope, openId, operation, text);
    const blockedReason = destination.blockedReason ?? (text.length > QQ_MANUAL_MESSAGE_LIMIT || text.includes('\0')
      ? `此回答无法直接发送。QQ 文本限 ${QQ_MANUAL_MESSAGE_LIMIT} 字符，可复制所需片段到工作台发送。` : undefined);
    if (request.method === 'GET') {
      const preview: AnswerPreview = { ...destination, text, confirmation: expected, blockedReason,
        receipt: robots.manualStatus(appId, target, operation) };
      return workbenchJson(preview);
    }
    if (expected !== confirmation) throw new WorkbenchRequestError(409, '回答或发送目标已变化，请重新预览。');
    if (blockedReason) throw new WorkbenchRequestError(409, blockedReason);
    const assertCurrent = () => {
      assertWritable();
      const current = robots.answerDestination(sessionId);
      if (current?.appId !== appId || current.scope !== scope || current.openId !== openId || current.blockedReason) {
        throw new WorkbenchRequestError(409, 'QQ 会话或接入权限已变化，请重新预览。');
      }
    };
    assertCurrent();
    return workbenchJson(await robots.manualSend(appId, target, operation, text, assertCurrent, sessionId));
  });
}
