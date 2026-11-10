import { Context } from '@deepseek-ai/cordis';
import { expect, it, vi } from 'vitest';
import { WORKBENCH_ANSWER_PATH } from '../shared/workbench-answer-protocol.ts';
import type { AnswerDestination, AnswerPreview } from '../shared/workbench-answer-protocol.ts';
import { DeliveryLedger } from '../transport/delivery-ledger.ts';
import { ManualQqSender } from '../transport/manual-send.ts';
import { registerWorkbenchAnswer } from './workbench-answer.ts';

function assistant(id: string, text: string, interrupted = false) {
  return {
    type: 'assistant/message', surfaceOp: 'append',
    data: { turn: 1, interrupted, message: { id, content: [
      { type: 'reasoning', text: 'private reasoning' }, { type: 'text', text }, { type: 'text', text: '\n**literal**' },
      { type: 'tool-call', name: 'private tool' },
    ] } },
  };
}
const end = { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } };

async function fixture() {
  const ctx = new Context();
  const close = vi.fn(async () => {});
  let events: unknown[] = [assistant('early', 'interim'), assistant('final', 'answer'), end];
  let destination: AnswerDestination | undefined = {
    appId: 'A', scope: 'group', openId: 'same', robotName: 'Robot A', peerName: 'My group', recording: true,
  };
  let handler!: (request: Request) => Promise<Response>;
  const open = vi.fn(async () => ({ read: async () => ({ events }), close }));
  const host = ctx.plugin(scope => {
    scope.provide('sessionPersistence', { open });
    scope.provide('connection', { fetch: { register: (route: { fetch: typeof handler }) => {
      handler = route.fetch;
      return async () => {};
    } } });
  });
  await host.await();
  const postToQQ = vi.fn();
  let beforeQQ = () => {};
  const send = new ManualQqSender('A', new DeliveryLedger(), async (target, text, assertCurrent) => {
    beforeQQ();
    assertCurrent();
    postToQQ(target, text);
    return { id: 'receipt' };
  });
  const plugin = ctx.plugin(scope => registerWorkbenchAnswer(scope, {
    answerDestination: sessionId => sessionId === 'bound' ? destination : undefined,
    manualStatus: (_appId, target, operation) => send.status(target, operation),
    manualSend: (_appId, target, operation, text, assertCurrent) => send.submit(target, operation, text, () => {
      assertCurrent();
      return true;
    }, () => false),
  }));
  await plugin.await();
  const url = 'http://example.test' + WORKBENCH_ANSWER_PATH;
  const get = (query = 'sessionId=bound&messageId=final') => handler(new Request(url + '?' + query));
  return {
    open, close, postToQQ, get,
    preview: async () => await (await get()).json() as AnswerPreview,
    confirm: (confirmation: string, extra = {}) => handler(new Request(url, {
      method: 'POST', body: JSON.stringify({ sessionId: 'bound', messageId: 'final', confirmation, ...extra }),
    })),
    setDestination: (value: AnswerDestination | undefined) => { destination = value; },
    setEvents: (value: unknown[]) => { events = value; },
    beforeQQ: (callback: () => void) => { beforeQQ = callback; },
    dispose: async () => { await plugin.dispose(); await host.dispose(); },
  };
}

it('previews the stored final text and exact QQ target without sending, then submits once across repeated confirmations', async () => {
  const f = await fixture();
  try {
    expect(await (await f.get('sessionId=normal')).json()).toEqual({ available: false });
    expect((await f.get('sessionId=normal&messageId=final')).status).toBe(404);
    expect(f.open).not.toHaveBeenCalled();
    const preview = await f.preview();
    expect(preview).toMatchObject({ appId: 'A', scope: 'group', robotName: 'Robot A', peerName: 'My group', text: 'answer\n**literal**' });
    expect(f.close).toHaveBeenCalledTimes(1);
    expect(f.postToQQ).not.toHaveBeenCalled();
    expect((await f.confirm(preview.confirmation, { text: 'changed', appId: 'B' })).status).toBe(400);
    await Promise.all([f.confirm(preview.confirmation), f.confirm(preview.confirmation)]);
    expect((await f.preview()).receipt?.status).toBe('accepted');
    expect(f.postToQQ).toHaveBeenCalledExactlyOnceWith({ scope: 'group', targetId: 'same' }, preview.text);
  } finally { await f.dispose(); }
});

it('rejects unfinished and superseded output, and refuses stale destinations or revocation before the QQ request', async () => {
  const f = await fixture();
  try {
    expect((await f.get('sessionId=bound&messageId=early')).status).toBe(404);
    f.setEvents([assistant('final', 'partial', true), end]);
    expect((await f.get()).status).toBe(404);
    f.setEvents([assistant('final', 'still running')]);
    expect((await f.get()).status).toBe(404);
    f.setEvents([assistant('final', 'original'), end]);
    const preview = await f.preview();
    f.setEvents([assistant('final', 'changed'), end]);
    expect((await f.confirm(preview.confirmation)).status).toBe(409);
    f.setEvents([assistant('final', 'original'), end]);
    f.setDestination({ ...preview, scope: 'c2c' });
    expect((await f.confirm(preview.confirmation)).status).toBe(409);
    f.setDestination(preview);
    f.beforeQQ(() => f.setDestination(undefined));
    expect((await (await f.confirm(preview.confirmation)).json()).status).toBe('rejected');
    expect(f.postToQQ).not.toHaveBeenCalled();
  } finally { await f.dispose(); }
});
