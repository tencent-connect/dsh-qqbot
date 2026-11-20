import assert from 'node:assert/strict';
import { createFixtureCommands, DUMMY_APP_ID } from './command-protocol.mjs';
import { readSessionEvents } from './host.mjs';

const text = value => [{ type: 'text', text: value }];
const fixtureCommands = createFixtureCommands();

export async function verifyGroupQueue({ client, sessionId, groupId, until, inject, newModelRound, outboundSince, qq }) {
  const events = () => readSessionEvents(client, sessionId);
  const groupMessage = (command = 'smoke', identity = 'allowed', mention = true) =>
    inject({ scope: 'group', identity, command, mention });
  const holdWeb = async name => {
    const round = newModelRound(name);
    const before = (await events()).at(-1)?.seq ?? 0;
    const receipt = await client.rpc('session/prompt', { request: {
      sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: text(round.holder),
    } });
    assert.equal(receipt.accepted, true);
    await until(() => round.waiting, 'Web model request held: ' + name);
    return { round, before };
  };
  const queueQQ = async () => {
    const before = (await events()).at(-1)?.seq ?? 0;
    await groupMessage();
    return until(async () => {
      const event = (await events()).find(row => row.seq > before && row.type === 'agent/inbox/spliced'
        && row.data.target === 'next-turn' && row.data.inserted.length === 1);
      return event && { item: event.data.inserted[0], seq: event.seq };
    }, 'QQ input waiting in the next-turn queue');
  };
  const update = async (item, action) => {
    const result = await client.rpc('session/updateQueue', { request: { sessionId, itemId: item.id, action } });
    assert.equal(result.accepted, true);
  };
  const completed = (answer, after) => until(async () => {
    const rows = (await events()).filter(event => event.seq > after);
    const message = rows.find(event => event.type === 'assistant/message'
      && event.data.message.content.some(block => block.type === 'text' && block.text === answer));
    const end = message && rows.find(event => event.seq > message.seq && event.type === 'turn/end'
      && event.data.turn === message.data.turn && event.data.reason.kind === 'completed');
    return end && { end, rows };
  }, 'completed native turn with ' + answer);
  const expectDelivered = (sequence, answer) => until(async () =>
    (await outboundSince(sequence)).some(row => row.content === answer), 'QQ delivery ' + answer);
  const start = qq.state.observedOutboundRequests;
  const expected = [];

  for (const edit of [true, false]) {
    const { round, before } = await holdWeb(edit ? 'RESTORED' : 'UNCHANGED');
    const { item, seq } = await queueQQ();
    if (edit) {
      const replacement = text('QQ_QUEUE_CHANGED_BODY');
      await update(item, { kind: 'edit', content: replacement });
      await until(async () => (await events()).some(event => event.seq > seq && event.type === 'agent/inbox/spliced'
        && event.data.inserted.some(value => value.id === item.id && value.content[0]?.text === replacement[0].text)),
      'changed text in the original queue item');
      await update(item, { kind: 'edit', content: item.content });
    }
    round.release();
    const { rows } = await completed(round.answer, before);
    const message = rows.find(event => event.type === 'user/message' && event.data.id === item.id);
    assert.deepEqual(message?.data.content, item.content, 'The native turn consumes the original ID and text.');
    expected.push(round.holder);
    if (!edit) expected.push(round.answer);
  }
  await expectDelivered(start, expected.at(-1));

  const timeline = '/api/qqbot/workbench/timeline?' + new URLSearchParams({ appId: DUMMY_APP_ID, scope: 'group', openId: groupId });
  const note = async (name, identity) => {
    await groupMessage(name, identity, false);
    const marker = fixtureCommands[name];
    await until(async () => (await client.get(timeline)).entries.some(entry =>
      entry.text === marker && entry.inboundOutcome === 'mention-required'), 'unmentioned group message ' + name);
    return marker;
  };
  const cases = { sessionId, editedAndRestored: true, unchangedQueuedReply: true };
  for (const kind of ['remove', 'steer']) {
    const { round, before } = await holdWeb(kind.toUpperCase());
    const first = await note('background-' + kind + '-first', 'allowed');
    const second = await note('background-' + kind + '-second', 'denied');
    const { item, seq } = await queueQQ();
    assert(item.content[0].text.includes(first) && item.content[0].text.includes(second), 'The queued draft includes both speakers.');
    const late = await note('background-' + kind + '-late', 'allowed');
    await update(item, { kind });
    const queueChanges = (await events()).filter(event => event.seq > seq && event.type === 'agent/inbox/spliced');
    assert(queueChanges.some(event => event.data.target === 'next-turn' && event.data.outcome === 'canceled'));
    if (kind === 'steer') assert(queueChanges.some(event => event.data.target === 'next-step'
      && event.data.inserted.some(value => value.id === item.id)));
    const consumed = kind === 'steer';
    const freshAnswer = round.answer + '_FRESH';
    const nextAnswer = round.answer + '_NEXT';
    round.replies = consumed ? [round.answer, freshAnswer, nextAnswer] : [freshAnswer, nextAnswer];
    const freshMessage = await groupMessage();
    // This QQ input reaches the SDK before the native turn releases the existing peer queue.
    await until(async () => (await client.get(timeline)).entries.some(entry => entry.platformId === freshMessage),
      'fresh QQ input received while the Web request is still held');
    round.release();

    const { end, rows } = await completed(consumed ? round.answer : round.holder, before);
    const admitted = rows.find(event => event.type === 'user/message' && event.data.id === item.id);
    if (consumed) {
      assert.deepEqual(admitted?.data.content, item.content);
      assert.equal(rows.filter(event => event.seq < end.seq && event.type === 'turn/start').length, 1,
        'The steered input joins the current turn.');
      checkBackground(round.inputs[0], [first, second], [], [late]);
    } else {
      assert.equal(admitted, undefined, 'A deleted item never becomes a native user message.');
      expected.push(round.holder);
    }

    const freshIndex = consumed ? 1 : 0;
    await expectDelivered(start, freshAnswer);
    assert.equal(round.inputs.length, freshIndex + 1);
    checkBackground(round.inputs[freshIndex], consumed ? [late] : [first, second, late], consumed ? [first, second] : []);
    await groupMessage();
    await expectDelivered(start, nextAnswer);
    assert.equal(round.inputs.length, freshIndex + 2);
    checkBackground(round.inputs[freshIndex + 1], [], [first, second, late]);
    expected.push(freshAnswer, nextAnswer);
    cases[kind] = { admittedInOriginalTurn: consumed, backgroundOnce: true, retiredReplyCount: 0 };
  }
  return { cases, async verifyOutbound() {
    const outbound = await outboundSince(start);
    assert.deepEqual(outbound.map(row => row.content).sort(), expected.toSorted(),
      'Only the Web controls and valid QQ replies may send. Edited, deleted or steered input cannot revive a QQ receipt.');
    assert.ok(outbound.every(row => row.path === '/v2/groups/' + groupId + '/messages'));
  } };
}

function checkBackground(request, latest, earlier, pending = []) {
  for (const marker of [...latest, ...earlier, ...pending]) {
    const occurrences = value => value.split(marker).length - 1;
    assert.equal(occurrences(request.latest), latest.includes(marker) ? 1 : 0, marker + ' in the current input');
    assert.equal(occurrences(request.history), pending.includes(marker) ? 0 : 1, marker + ' across all model inputs');
  }
}
