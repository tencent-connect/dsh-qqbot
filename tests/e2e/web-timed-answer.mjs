import assert from 'node:assert/strict';
import { readSessionEvents } from './host.mjs';

export async function verifyWebAnswers({ client, sessions, setModelReply, until, outboundSince, qq, expectPush }) {
  const report = {};
  for (const [scope, sessionId] of Object.entries(sessions)) {
    const tag = 'QQ_TIMED_' + scope + (expectPush ? '_ON' : '_OFF');
    const afterTimeout = tag + '_PENDING';
    const final = tag + '_ANSWERED';
    const selected = tag + '_OPTION_A';
    const questions = [{ id: tag, header: 'Fixture', question: '请选择 A 或 B',
      options: [{ label: selected, description: 'A' }, { label: 'B', description: 'B' }] }];
    const call = { index: 0, id: tag + '_call', type: 'function',
      function: { name: 'ask_user_question', arguments: JSON.stringify({ questions, timeout: 1 }) } };
    let advertised = false;
    let answered = false;
    setModelReply(body => {
      const log = JSON.stringify(body.messages);
      if (!log.includes(tag + '_WEB_PROMPT')) return undefined;
      if (log.includes('answer_to_pending_question') && log.includes(selected) && answered) {
        return { content: final };
      }
      if (body.messages.some(message => message.role === 'tool' && message.tool_call_id === call.id
        && JSON.stringify(message.content).includes('pending'))) {
        return { content: afterTimeout };
      }
      advertised = body.tools?.some(tool => tool.function.name === 'ask_user_question'
        && Object.hasOwn(tool.function.parameters.properties, 'timeout'));
      return { tool_calls: [call] };
    });

    const before = (await readSessionEvents(client, sessionId)).at(-1)?.seq ?? 0;
    const sequence = qq.state.observedOutboundRequests;
    const receipt = await client.rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(),
      mode: 'queue', content: [{ type: 'text', text: tag + '_WEB_PROMPT' }] } });
    assert.equal(receipt.accepted, true);

    const readNew = async () => (await readSessionEvents(client, sessionId)).filter(event => event.seq > before);
    const completed = (text, after) => until(async () => {
      const rows = await readNew();
      const reply = rows.find(event => event.seq > after && event.type === 'assistant/message'
        && event.data.message.content.some(block => block.type === 'text' && block.text === text));
      return reply && rows.find(event => event.seq > reply.seq && event.type === 'turn/end'
        && event.data.turn === reply.data.turn && event.data.reason.kind === 'completed');
    }, 'native timed question turn ' + text);
    const expired = await completed(afterTimeout, before);
    assert(advertised, 'The Host offered the timed ask_user_question tool.');
    const rows = await readNew();
    const question = rows.find(event => event.type === 'tool/call' && event.data.name === 'ask_user_question');
    assert(question && rows.some(event => event.type === 'tool/result'
      && event.data.message.toolCallId === question.data.callId && JSON.stringify(event.data).includes('pending')));

    answered = true;
    assert.equal(await client.rpc('userQuestions/answer', {
      agentId: sessionId, callId: question.data.callId, answer: { answers: [{ id: tag, selected: [selected] }] },
    }), true);
    const settled = await completed(final, expired.seq);
    assert(settled.data.turn > expired.data.turn, 'The answer opens a later turn.');
    assert((await readNew()).some(event => event.seq > expired.seq && event.type === 'user/message'
      && event.data.source?.kind === 'user-question-reply' && event.data.source.callId === question.data.callId));
    if (expectPush) {
      await until(async () => (await outboundSince(sequence)).some(row => row.content === final), 'QQ delivery of the late Web answer');
    }
    report[scope] = { pending: true, answeredInLaterTurn: true, pushed: expectPush };
  }
  setModelReply(undefined);
  return report;
}
