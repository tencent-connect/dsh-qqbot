import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeliveryLedger, deliveryKey } from './delivery-ledger.ts';
import { bindDelivery, guardMedia, guardSender } from './delivery-context.ts';
import { QqInputRegistry } from './qq-input-origin.ts';
import { createOutboundHandler, createTurnTracker } from './outbound.ts';
import { OutboundBuffer, type QQBotSender } from './outbound-buffer.ts';
import { DeliverablesDeliverer } from './deliverables.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { SessionManager, SessionRecord } from '../session/index.ts';
import type { Logger, ReplyTarget } from '../types.ts';
import { handleInbound } from './inbound.ts';
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { Context } from '@deepseek-ai/cordis';
import { registerSendFileTool } from '../media/send-file-tool.ts';

const dirs: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function directory() { const dir = mkdtempSync(join(tmpdir(), 'qq-delivery-')); dirs.push(dir); return dir; }
const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const target: ReplyTarget = { scope: 'c2c', targetId: 'synthetic-user', msgId: 'platform-1' };
const content = [{ type: 'text', text: 'synthetic request' }];

function setup(options: { file?: string; group?: boolean; streaming?: boolean; showToolResults?: boolean } = {}) {
  const ledger = new DeliveryLedger(options.file);
  const inputs = new QqInputRegistry({ ledger });
  const stream = { update: vi.fn().mockResolvedValue(undefined), complete: vi.fn().mockResolvedValue(undefined) };
  const bot: QQBotSender = { sendMarkdown: vi.fn().mockResolvedValue(undefined), openStream: vi.fn(() => stream) };
  const initial = options.group ? { ...target, scope: 'group' as const, targetId: 'synthetic-group' } : target;
  const record = { sessionId: 'session-1', replyTarget: { ...initial }, agent: {} } as SessionRecord;
  const manager = { findBySessionId: (id: string) => id === record.sessionId ? record : undefined } as SessionManager;
  const config = { streaming: options.streaming ?? true, showToolResults: options.showToolResults ?? true,
    textChunkLimit: 4500, proactiveDelivery: { externalTurns: 'c2c' },
    sendFile: { maxFiles: 4, restrictPaths: false, extraRoots: [], sendPresentedFiles: true } } as ImQQBotConfig;
  let authorized = true;
  const tracker = createTurnTracker(manager, config, logger, inputs, () => authorized);
  const sender = guardSender(bot, ledger);
  const media = { sendImage: vi.fn().mockResolvedValue({ upload: { file_uuid: 'file' } }),
    sendVideo: vi.fn(), sendVoice: vi.fn(), sendFile: vi.fn().mockResolvedValue({ upload: { file_uuid: 'file' } }) };
  const deliverer = new DeliverablesDeliverer(sender, guardMedia(media, ledger), config, logger);
  let markDelivered!: () => void;
  const deliveryFinished = new Promise<void>(resolve => { markDelivered = resolve; });
  const deliver = deliverer.deliver.bind(deliverer);
  vi.spyOn(deliverer, 'deliver').mockImplementation(async (...args) => { try { await deliver(...args); } finally { markDelivered(); } });
  const outbound = createOutboundHandler(manager, sender, config, logger, undefined, deliverer, tracker);
  const emit = (type: string, data: Record<string, unknown> = {}) => outbound.routeSessionEvent({ header: { id: record.sessionId } }, { type, data });
  const input = (id = 'input-1', turn = 1, platformId = 'platform-1') => {
    ledger.registerInput({ key: deliveryKey('input', initial.scope, initial.targetId, platformId), messageId: id,
      sessionId: record.sessionId, senderId: 'synthetic-member', target: { ...initial, msgId: platformId }, contentHash: deliveryKey(content) });
    inputs.register(id);
    emit('turn/start', { turn });
    emit('user/message', { id, source: { kind: 'user' }, content });
  };
  const answer = (text = 'answer', step = 1, turn = 1) => emit('assistant/message', { turn, step, message: { id: `answer-${step}`, content: [{ type: 'text', text }] } });
  const start = (attempt = 1, turn = 1, step = 1) => outbound.routeStreamFrame(record.sessionId, { kind: 'attempt-start', attemptId: `attempt-${attempt}`, revision: attempt * 100, turn, step });
  const chunk = (text: string, index = 0, attempt = 1) => outbound.routeStreamFrame(record.sessionId, { kind: 'text-delta', attemptId: `attempt-${attempt}`, revision: attempt * 100 + index + 1, index, text });
  return { ledger, inputs, bot, stream, media, record, tracker, emit, input, answer, start, chunk, deliveryFinished, revoke: () => { authorized = false; } };
}

describe('durable delivery identities', () => {
  it('reserves before sending, suppresses concurrent and restart retries including changed text', async () => {
    const file = join(directory(), 'ledger.json');
    let finish!: () => void;
    const sent = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const first = new DeliveryLedger(file);
    const task = first.run('stable-operation', sent);
    expect(await new DeliveryLedger(file).run('stable-operation', sent)).toBe(false);
    finish(); await task;
    expect(await new DeliveryLedger(file).run('stable-operation', sent)).toBe(false);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(new DeliveryLedger(file).state('stable-operation')).toBe('accepted');
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('timeout and a crash after reservation remain non-replayable', async () => {
    const file = join(directory(), 'ledger.json');
    const ledger = new DeliveryLedger(file);
    const send = vi.fn().mockRejectedValue(new Error('timeout'));
    await expect(ledger.run('timeout', send)).rejects.toThrow('timeout');
    expect(ledger.begin('crashed')).toBe(true);
    const restored = new DeliveryLedger(file);
    expect(restored.state('timeout')).toBe('unknown');
    expect(restored.state('crashed')).toBe('sending');
    expect(await restored.run('timeout', send)).toBe(false);
    expect(await restored.run('crashed', send)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('bad storage blocks startup without overwriting the original file', () => {
    const file = join(directory(), 'ledger.json');
    writeFileSync(file, '{broken');
    expect(() => new DeliveryLedger(file)).toThrow();
    expect(readFileSync(file, 'utf8')).toBe('{broken');
  });

  it('a truncated journal or removed live journal cannot silently restore sending', () => {
    const file = join(directory(), 'ledger.jsonl');
    const ledger = new DeliveryLedger(file); ledger.begin('old-operation');
    writeFileSync(file, '{"kind":"delivery"}');
    expect(() => ledger.begin('new-operation')).toThrow('incomplete');
    rmSync(file);
    expect(() => ledger.begin('new-operation')).toThrow('disappeared');
  });

  it('stale instances refresh before writing and cannot remove newer reservations', () => {
    const file = join(directory(), 'ledger.json');
    const old = new DeliveryLedger(file), fresh = new DeliveryLedger(file);
    fresh.begin('new'); old.begin('old');
    expect(new DeliveryLedger(file).begin('new')).toBe(false);
  });

  it('storage failure prevents the platform action from starting', async () => {
    const root = directory(); writeFileSync(join(root, 'not-a-directory'), 'fixture');
    const ledger = new DeliveryLedger(join(root, 'not-a-directory', 'ledger.jsonl'));
    const send = vi.fn();
    await expect(ledger.run('never-submitted', send)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('input identity is scoped to the Session, exact content and one turn', () => {
    const ledger = new DeliveryLedger();
    const receipt = { key: 'input', messageId: 'm', sessionId: 's', senderId: 'u', target, contentHash: deliveryKey(content) };
    expect(ledger.registerInput(receipt)).toBe(true);
    expect(ledger.registerInput({ ...receipt, messageId: 'another-id' })).toBe(false);
    expect(ledger.claimInput('m', 'other-session', content, 1)).toBeUndefined();
    expect(ledger.claimInput('m', 's', [], 1)).toBeUndefined();
    expect(ledger.claimInput('m', 's', content, 1)?.target).toEqual(target);
    expect(ledger.claimInput('m', 's', content, 2)).toBeUndefined();
  });
});

describe('explicit file tool source and replay checks', () => {
  function tool() {
    const cwd = directory(), file = join(cwd, 'test.txt'); writeFileSync(file, 'synthetic delivery');
    const registry = { register: vi.fn() };
    const ctx = { get: () => registry } as unknown as Context;
    const manager = { findBySessionId: (id: string) => id === 'qq-session' ? {} : undefined, deliveryAddress: () => undefined } as unknown as SessionManager;
    const raw = { sendImage: vi.fn(), sendVideo: vi.fn(), sendVoice: vi.fn(), sendFile: vi.fn().mockResolvedValue({ upload: { file_uuid: 'fixture' } }) };
    let eligible = true;
    registerSendFileTool(ctx, guardMedia(raw, new DeliveryLedger()), manager,
      { cwd, sendFile: { restrictPaths: true, extraRoots: [] } } as ImQQBotConfig, logger,
      { targetFor: () => eligible ? target : undefined }, () => true);
    const definition = registry.register.mock.calls[0]?.[0] as { execute(args: unknown, exec: { agent: { id: string }; callId?: string; signal: AbortSignal }): Promise<unknown> };
    const execute = (callId: string | undefined, agentId = 'qq-session') => definition.execute({ file_path: file, target: 'group:explicit-target' }, { agent: { id: agentId }, callId, signal: new AbortController().signal });
    return { execute, raw, block: () => { eligible = false; } };
  }

  it('retains explicit targets but sends a repeated native call only once', async () => {
    const f = tool();
    await expect(f.execute('native-call')).resolves.toMatchObject({ target: 'group:explicit-target' });
    await expect(f.execute('native-call')).rejects.toThrow('already submitted');
    expect(f.raw.sendFile).toHaveBeenCalledTimes(1);
  });

  it('an explicit target cannot override an ineligible QQ source or missing call identity', async () => {
    const f = tool();
    await expect(f.execute(undefined)).rejects.toThrow('调用身份');
    f.block(); await expect(f.execute('blocked')).rejects.toThrow('当前来源');
    expect(f.raw.sendFile).not.toHaveBeenCalled();
  });

  it('preserves separately authorized explicit file calls outside a QQ Session', async () => {
    const f = tool(); f.block();
    await expect(f.execute('external-explicit-call', 'native-web-session')).resolves.toMatchObject({ target: 'group:explicit-target' });
    expect(f.raw.sendFile).toHaveBeenCalledTimes(1);
  });
});

describe('verified native output, retaining upstream delivery features', () => {
  it.each([false, true])('static reply keeps its original target and suppresses duplicate events (group=%s)', async group => {
    vi.useFakeTimers();
    const f = setup({ group, streaming: false }); f.input();
    f.record.replyTarget = { scope: 'group', targetId: 'wrong-peer', msgId: 'later-message' };
    f.answer(); f.answer('changed replay');
    await vi.runAllTimersAsync();
    expect(f.bot.sendMarkdown).toHaveBeenCalledTimes(1);
    expect(f.bot.sendMarkdown).toHaveBeenCalledWith(expect.objectContaining({ targetId: group ? 'synthetic-group' : 'synthetic-user', msgId: 'platform-1' }), 'answer');
  });

  it('reloading the plugin and replaying native events does not resend a reply', async () => {
    vi.useFakeTimers();
    const file = join(directory(), 'ledger.json');
    const first = setup({ file, streaming: false }); first.input(); first.answer(); await vi.runAllTimersAsync();
    const restored = setup({ file, streaming: false }); restored.input(); restored.answer('edited replay'); await vi.runAllTimersAsync();
    expect(first.bot.sendMarkdown).toHaveBeenCalledTimes(1);
    expect(restored.bot.sendMarkdown).not.toHaveBeenCalled();
  });

  it('a replay with extra static segments cannot append to an already submitted answer', async () => {
    vi.useFakeTimers();
    const f = setup({ streaming: false }); f.input(); f.answer('original'); await vi.runAllTimersAsync();
    f.answer('changed\n\n' + 'extra text '.repeat(2000)); await vi.runAllTimersAsync();
    expect(f.bot.sendMarkdown).toHaveBeenCalledTimes(1);
  });

  it('late live frames cannot reopen a reply already submitted as static text', async () => {
    vi.useFakeTimers();
    const f = setup(); f.input(); f.answer(); await vi.runAllTimersAsync();
    f.start(); f.chunk('late live text'); f.answer(); await vi.runAllTimersAsync();
    expect(f.bot.sendMarkdown).toHaveBeenCalledTimes(1); expect(f.bot.openStream).not.toHaveBeenCalled();
  });

  it('private streaming remains enabled, duplicate and late chunks are ignored and final text is not sent twice', async () => {
    vi.useFakeTimers();
    const f = setup(); f.input(); f.start(); f.chunk('streaming'); f.chunk('duplicate');
    await vi.advanceTimersByTimeAsync(200);
    f.start(2); f.chunk('late', 1); f.chunk('replacement', 0, 2);
    f.answer('replacement'); await vi.runAllTimersAsync();
    f.answer('replacement'); await vi.runAllTimersAsync();
    expect(f.bot.openStream).toHaveBeenCalledTimes(1);
    expect(f.stream.update).toHaveBeenNthCalledWith(1, 'streaming');
    expect(f.stream.update).toHaveBeenLastCalledWith('replacement');
    expect(f.stream.complete).toHaveBeenCalledTimes(1);
    expect(f.bot.sendMarkdown).not.toHaveBeenCalled();
  });

  it('an update timeout never falls back to a duplicate static reply', async () => {
    vi.useFakeTimers();
    const f = setup(); vi.mocked(f.stream.update).mockRejectedValue(new Error('timeout'));
    f.input(); f.start(); f.chunk('possibly sent'); f.answer(); await vi.runAllTimersAsync();
    expect(f.stream.update).toHaveBeenCalledTimes(1);
    expect(f.bot.sendMarkdown).not.toHaveBeenCalled();
  });

  it('a synchronous openStream failure retains the existing static fallback', async () => {
    vi.useFakeTimers();
    const f = setup(); vi.mocked(f.bot.openStream).mockImplementation(() => { throw new Error('not supported'); });
    f.input(); f.start(); f.chunk('fallback'); f.answer(); await vi.runAllTimersAsync();
    expect(f.bot.sendMarkdown).toHaveBeenCalledTimes(1);
  });

  it('Web steering suppresses subsequent chunks, tool output, final replies and presented files', async () => {
    vi.useFakeTimers();
    const f = setup(); f.input(); f.start(); f.chunk('not flushed');
    f.emit('user/message', { id: 'web', source: { kind: 'user' }, content: [{ type: 'text', text: 'private analysis' }] });
    f.chunk('web continuation', 1); f.answer();
    f.emit('deliverables/presented', { turn: 1, callId: 'present', files: [{ path: '/private-file.txt' }] });
    f.emit('turn/end', { turn: 1, reason: { kind: 'completed' } });
    await vi.runAllTimersAsync();
    expect(f.bot.openStream).not.toHaveBeenCalled(); expect(f.bot.sendMarkdown).not.toHaveBeenCalled(); expect(f.media.sendFile).not.toHaveBeenCalled();
  });

  it('already-published QQ text cannot be recalled, but no Web continuation is published', async () => {
    vi.useFakeTimers();
    const f = setup(); f.input(); f.start(); f.chunk('QQ-only step'); await vi.advanceTimersByTimeAsync(200);
    f.emit('user/message', { id: 'web', source: { kind: 'user' }, content });
    f.chunk('private', 1); f.answer(); await vi.runAllTimersAsync();
    expect(f.stream.update).toHaveBeenCalledTimes(1);
    expect(f.stream.update).toHaveBeenCalledWith('QQ-only step');
    expect(f.bot.sendMarkdown).not.toHaveBeenCalled();
  });

  it('permission withdrawal before the timer fires prevents streaming', async () => {
    vi.useFakeTimers();
    const f = setup(); f.input(); f.start(); f.chunk('pending'); f.revoke(); f.answer(); await vi.runAllTimersAsync();
    expect(f.bot.openStream).not.toHaveBeenCalled(); expect(f.bot.sendMarkdown).not.toHaveBeenCalled();
  });

  it('unowned, cross-session, modified and requeued QQ messages cannot claim a passive target', () => {
    const f = setup(); f.input();
    f.emit('user/message', { id: 'input-1', source: { kind: 'user' }, content: [] });
    expect(f.tracker.targetFor('session-1')).toBeUndefined();
    f.emit('turn/end', { turn: 1 });
    f.emit('turn/start', { turn: 2 });
    f.emit('user/message', { id: 'input-1', source: { kind: 'user' }, content });
    expect(f.tracker.targetFor('session-1')).toBeUndefined();
  });

  it('orphan stream frames and old turn events cannot create an output', async () => {
    vi.useFakeTimers();
    const f = setup(); f.start(); f.chunk('orphan'); f.answer(); await vi.runAllTimersAsync();
    expect(f.bot.sendMarkdown).not.toHaveBeenCalled(); expect(f.bot.openStream).not.toHaveBeenCalled();
    f.input(); f.start(1, 0); f.chunk('old turn'); await vi.runAllTimersAsync();
    expect(f.bot.openStream).not.toHaveBeenCalled();
  });

  it.each([true, false])('tool results retain their setting and native call identity (enabled=%s)', async showToolResults => {
    vi.useFakeTimers();
    const f = setup({ showToolResults }); f.input();
    f.emit('tool/call', { turn: 1, callId: 'call', name: 'read', arguments: '{}' });
    const result = { turn: 1, message: { source: { callId: 'call' }, content: [{ type: 'tool-result', content: [{ type: 'text', text: 'tool output' }] }] } };
    f.emit('tool/result', result); f.emit('tool/result', result); await vi.runAllTimersAsync();
    expect(f.bot.sendMarkdown).toHaveBeenCalledTimes(showToolResults ? 1 : 0);
  });

  it.each([false, true])('direct native tool text remains visible, including errors with previews disabled (error=%s)', async error => {
    vi.useFakeTimers();
    const f = setup({ showToolResults: !error }); f.input();
    f.emit('tool/call', { turn: 1, callId: 'native', name: 'read', arguments: '{}' });
    f.emit('tool/result', { turn: 1, message: { source: { callId: 'native' }, isError: error, content: [{ type: 'text', text: 'native tool details' }] } });
    await vi.runAllTimersAsync();
    expect(f.bot.sendMarkdown).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('native tool details'));
  });

  it('presented files are still delivered once, including a failed outer turn', async () => {
    vi.useFakeTimers();
    const dir = directory(), file = join(dir, 'report.txt'); writeFileSync(file, 'synthetic artifact');
    const f = setup(); f.input();
    const claim = { turn: 1, callId: 'present', files: [{ path: file }] };
    f.emit('deliverables/presented', claim); f.emit('deliverables/presented', claim);
    f.emit('turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'TEST', message: 'failure after present' } } });
    await f.deliveryFinished;
    expect(f.media.sendFile).toHaveBeenCalledTimes(1);
    expect(f.media.sendFile).toHaveBeenCalledWith(expect.objectContaining(target), { localPath: file }, { fileName: 'report.txt' });
  });

  it('file calls use stable identities without removing explicit cross-conversation targeting', async () => {
    const ledger = new DeliveryLedger();
    const sender = { sendImage: vi.fn(), sendVideo: vi.fn(), sendVoice: vi.fn(), sendFile: vi.fn().mockResolvedValue({ upload: { file_uuid: 'id' } }) };
    const media = guardMedia(sender, ledger);
    let allowed = true;
    const explicit = bindDelivery({ scope: 'group', targetId: 'explicit-target' }, { key: 'native-call-id', fixed: true, allowed: () => allowed });
    await media.sendFile(explicit, { localPath: '/synthetic.txt' });
    await expect(media.sendFile(explicit, { localPath: '/different.txt' })).rejects.toThrow('already submitted');
    allowed = false;
    await expect(media.sendFile(explicit, { localPath: '/synthetic.txt' })).rejects.toThrow('no longer authorized');
    expect(sender.sendFile).toHaveBeenCalledTimes(1);
  });

  it('rechecks access for each static segment instead of checking once for the whole reply', async () => {
    const ledger = new DeliveryLedger();
    let allowed = true;
    const bot: QQBotSender = { sendMarkdown: vi.fn(async () => { allowed = false; }), openStream: vi.fn() };
    const destination = bindDelivery(target, { key: 'chunked', allowed: () => allowed });
    const buffer = new OutboundBuffer(destination, guardSender(bot, ledger), 12, logger, false);
    buffer.append('first paragraph\n\nsecond paragraph\n\nthird paragraph');
    await buffer.flush();
    expect(bot.sendMarkdown).toHaveBeenCalledTimes(1);
  });
});

describe('native Inbox submission', () => {
  it.each([false, true])('platform replays do not create another Agent or submit another followup, even after reload (group=%s)', async group => {
    const file = join(directory(), 'ledger.json');
    const followup = vi.fn();
    const manager = { getOrCreate: vi.fn(async () => ({ sessionId: 'native-session', agent: { followup, whenIdle: async () => {} } })) } as unknown as SessionManager;
    const config = { appId: 'synthetic-app' } as ImQQBotConfig;
    const ctx = { message: { kind: group ? 'group' : 'c2c', senderId: 'synthetic-member', content: 'request', messageId: 'platform-message', groupOpenid: group ? 'synthetic-group' : undefined }, state: {}, signal: new AbortController().signal, bot: { sendMarkdown: vi.fn() } } as unknown as MiddlewareContext;
    await handleInbound(ctx, manager, config, logger, new QqInputRegistry({ ledger: new DeliveryLedger(file) }), () => true);
    await handleInbound(ctx, manager, config, logger, new QqInputRegistry({ ledger: new DeliveryLedger(file) }), () => true);
    expect(manager.getOrCreate).toHaveBeenCalledTimes(1); expect(followup).toHaveBeenCalledTimes(1);
    const message = followup.mock.calls[0]?.[0];
    const receipt = new DeliveryLedger(file).claimInput(String(message.id), 'native-session', message.content, 1);
    expect(receipt?.target).toEqual({ scope: group ? 'group' : 'c2c', targetId: group ? 'synthetic-group' : 'synthetic-member', msgId: 'platform-message' });
    expect(receipt?.senderId).toBe('synthetic-member');
  });

  it('missing platform identities are not admitted', async () => {
    const manager = { getOrCreate: vi.fn() } as unknown as SessionManager;
    const ctx = { message: { kind: 'group', senderId: 'user', messageId: '', content: 'bad input' } } as unknown as MiddlewareContext;
    await handleInbound(ctx, manager, {} as ImQQBotConfig, logger, new QqInputRegistry({ ledger: new DeliveryLedger() }), () => true);
    expect(manager.getOrCreate).not.toHaveBeenCalled();
  });
});

it.each([false, true])('does not re-send a file or report a new failure on replay (unknown=%s)', async unknown => {
  const root = directory();
  const file = join(root, 'report.txt');
  writeFileSync(file, 'synthetic artifact');
  const journal = join(root, 'journal.jsonl');
  const claim = { turn: 1, callId: 'present', files: [{ path: file }] };
  const end = { turn: 1, reason: { kind: 'completed' } };
  const first = setup({ file: journal });
  if (unknown) first.media.sendFile.mockRejectedValueOnce(new Error('QQ response lost'));
  first.input();
  first.emit('deliverables/presented', claim);
  first.emit('turn/end', end);
  await first.deliveryFinished;
  expect(first.media.sendFile).toHaveBeenCalledOnce();
  if (unknown) {
    expect(first.bot.sendMarkdown).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.stringContaining('未能直接发送'), undefined);
  } else {
    expect(first.bot.sendMarkdown).not.toHaveBeenCalled();
  }

  const restarted = setup({ file: journal });
  restarted.input();
  restarted.emit('deliverables/presented', claim);
  restarted.emit('turn/end', end);
  await restarted.deliveryFinished;
  expect(restarted.media.sendFile).not.toHaveBeenCalled();
  expect(restarted.bot.sendMarkdown).not.toHaveBeenCalled();
});
