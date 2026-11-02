import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as fileOps from './files.ts';
import { ConversationConflictError, ConversationStore } from './index.ts';
import type { GroupMessageRecord } from '../shared/conversation-protocol.ts';

let root = '';
let now = 1_800_000_000_000;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'qq-conversation-')); now = 1_800_000_000_000; });
afterEach(() => { rmSync(root, { force: true, recursive: true }); });
function store(): ConversationStore { return new ConversationStore(root, 'app', { now: () => now }); }
function msg(id: string, text = id, extra: Partial<GroupMessageRecord> = {}): GroupMessageRecord {
  return { id, text, senderId: 'member', senderName: '小明', at: now, mentioned: false, attachments: [], ...extra };
}
function archive(target: ConversationStore, key: string): void {
  const entry = target.get(key);
  if (!entry) throw new Error('Test conversation missing');
  entry.policy.context.mode = 'archive';
  target.updatePolicy(key, entry.policy.version, entry.policy);
}
function logPath(key: string, kind: 'messages' | 'deliveries'): string {
  return join(root, 'conversations', createHash('sha256').update(key).digest('hex'), `${kind}.jsonl`);
}

describe('QQ conversation directory', () => {
  it('persists isolated group and DM identities, members, owners, and session history', () => {
    const target = store();
    const group = target.ensure('group', 'same', { senderId: 'a', senderName: '甲', name: '学习群', allMessages: true });
    const dm = target.ensure('c2c', 'same', { senderId: 'same', senderName: '私聊人' });
    target.bindSession(group.key, 'session-old');
    now += 100;
    target.bindSession(group.key, 'session-new');
    target.setOwnerIds(['owner', 'owner']);
    const reloaded = store();
    expect(reloaded.list()).toHaveLength(2);
    expect(reloaded.getBySessionId('session-old')?.currentSessionId).toBe('session-new');
    expect(reloaded.get(group.key)?.sessions.map((item) => item.sessionId)).toEqual(['session-old', 'session-new']);
    expect(reloaded.get(group.key)?.observedAllMessages).toBe(true);
    expect(reloaded.get(dm.key)?.name).toBe('私聊人');
    expect(reloaded.ownerIds()).toEqual(['owner']);
    expect(() => reloaded.bindSession(dm.key, 'session-old')).toThrow('another conversation');
  });

  it('returns detached records and snapshots each group policy independently', () => {
    const target = store();
    const a = target.ensure('group', 'a');
    const b = target.ensure('group', 'b');
    a.policy.controllers.push('member');
    expect(target.get(a.key)?.policy.controllers).toEqual([]);
    target.updatePolicy(a.key, a.policy.version, a.policy, '群 A');
    expect(target.get(a.key)?.alias).toBe('群 A');
    expect(target.get(b.key)?.policy.controllers).toEqual([]);
    const listing = target.list();
    const first = listing[0];
    if (first) first.members.push({ id: 'fake', name: '', lastSeen: now });
    expect(target.list().every((entry) => entry.members.length === 0)).toBe(true);
  });

  it('pins role settings to each Session while allowing the next Session role to change', () => {
    const target = store(); const entry = target.ensure('group', 'g');
    target.bindSession(entry.key, 'old');
    entry.policy.role.description = '新角色';
    target.updatePolicy(entry.key, entry.policy.version, entry.policy);
    target.bindSession(entry.key, 'new');
    const history = store().get(entry.key)?.sessions;
    expect(history?.find((item) => item.sessionId === 'old')?.role?.description).toBe('');
    expect(history?.find((item) => item.sessionId === 'new')?.role?.description).toBe('新角色');
  });

  it('rejects stale updates and keeps memory unchanged when atomic persistence fails', () => {
    const target = store();
    const entry = target.ensure('group', 'a');
    const updated = target.updatePolicy(entry.key, entry.policy.version, entry.policy);
    expect(() => target.updatePolicy(entry.key, entry.policy.version, entry.policy)).toThrow(ConversationConflictError);
    const file = readdirSync(root).find((name) => name.endsWith('.json'));
    if (!file) throw new Error('Catalog missing');
    const path = join(root, file);
    renameSync(path, `${path}.backup`); mkdirSync(path);
    expect(() => target.updatePolicy(entry.key, updated.policy.version, { ...updated.policy, name: '未提交' })).toThrow();
    expect(target.get(entry.key)?.policy.name).toBe(updated.policy.name);
    expect(target.get(entry.key)?.policy.version).toBe(updated.policy.version);
  });

  it('imports only exact account session mappings and does not infer owners', () => {
    const target = store();
    writeFileSync(join(root, 'model-prefs.json'), JSON.stringify({ sessionIds: {
      'qqbot:app:group:g': 'sg', 'qqbot:app:c2c:u': 'su', 'qqbot:other:group:x': 'sx',
      'qqbot:application:group:x': 'bad', 'qqbot:app:group:': 'empty', unrelated: 'unknown',
    } }));
    expect(target.migratePrefs()).toBe(2);
    expect(target.migratePrefs()).toBe(0);
    expect(target.list()).toHaveLength(2);
    expect(target.ownerIds()).toEqual([]);
  });

  it('restores a legacy catalog without synthesizing new recording or role settings', () => {
    const target = store(); const entry = target.ensure('group', 'legacy');
    target.bindSession(entry.key, 'legacy-session');
    const file = join(root, readdirSync(root).find(name => name.endsWith('.json'))!);
    const catalog = JSON.parse(readFileSync(file, 'utf8'));
    for (const row of catalog.entries) {
      delete row.lifecycle; delete row.nativeLog;
      for (const session of row.sessions) { delete session.role; delete session.receivedMessages; delete session.prompt; }
    }
    writeFileSync(file, JSON.stringify(catalog));
    const restored = store().get(entry.key)!;
    expect(restored.lifecycle).toEqual({ rotateDays: 7, maxMessages: 1000, retentionDays: null });
    expect(restored.nativeLog).toEqual({ enabled: false, since: null });
    expect(restored.sessions).toEqual([{ sessionId: 'legacy-session', startedAt: now }]);
    expect(restored.policy.tools).toEqual(entry.policy.tools);
  });

  it('loads legacy retired grants without restoring retired tool access', () => {
    const target = store(); const entry = target.ensure('group', 'legacy-tools');
    const name = readdirSync(root).find(name => name.endsWith('.json'));
    if (!name) throw new Error('Catalog missing');
    const file = join(root, name);
    const catalog = JSON.parse(readFileSync(file, 'utf8'));
    catalog.entries[0].policy.memoryGrants = { project: 'readwrite' };
    catalog.entries[0].policy.tools = { ask_user_question: 'ask', memory_search: 'allow', memory_get: 'ask', memory_write: 'allow' };
    const bytes = JSON.stringify(catalog); writeFileSync(file, bytes);
    const reloaded = store();
    const restored = reloaded.get(entry.key);
    if (!restored) throw new Error('Conversation missing');
    expect(restored.policy).toEqual({ ...entry.policy, tools: { ask_user_question: 'ask' } });
    expect(restored.policy).not.toHaveProperty('memoryGrants');
    expect(readFileSync(file, 'utf8')).toBe(bytes);
    reloaded.updatePolicy(entry.key, restored.policy.version, restored.policy);
    expect(readFileSync(file, 'utf8')).not.toContain('memoryGrants');
    expect(store().get(entry.key)?.policy.tools).toEqual({ ask_user_question: 'ask' });
  });

  it.each(['lifecycle', 'nativeLog', 'role'])('rejects malformed explicitly stored %s settings', field => {
    const target = store(); const entry = target.ensure('group', 'legacy');
    target.bindSession(entry.key, 'legacy-session');
    const file = join(root, readdirSync(root).find(name => name.endsWith('.json'))!);
    const catalog = JSON.parse(readFileSync(file, 'utf8'));
    if (field === 'role') catalog.entries[0].sessions[0].role = {};
    else catalog.entries[0][field] = {};
    const bytes = JSON.stringify(catalog); writeFileSync(file, bytes);
    expect(store).toThrow();
    expect(readFileSync(file, 'utf8')).toBe(bytes);
  });

  it('fails loudly on an invalid catalog without replacing its evidence', () => {
    store().ensure('group', 'g');
    const file = readdirSync(root).find((name) => name.endsWith('.json'));
    if (!file) throw new Error('Catalog missing');
    writeFileSync(join(root, file), '{broken');
    expect(store).toThrow();
    expect(readFileSync(join(root, file), 'utf8')).toBe('{broken');
  });
});

describe('bounded group context', () => {
  it('claims command identities durably without storing content or advancing context', () => {
    const target = store(); const a = target.ensure('group', 'a'); const b = target.ensure('group', 'b');
    archive(target, a.key);
    expect(target.claimMessage(a.key, 'command-id')).toBe(true);
    expect(target.claimMessage(a.key, 'command-id')).toBe(false);
    expect(target.snapshotBackground(a.key, 'not-present')).toEqual({ text: '', cursor: 0, messageIds: [] });
    expect(target.messages(a.key)).toEqual([]);
    const reloaded = store();
    expect(reloaded.claimMessage(a.key, 'command-id')).toBe(false);
    expect(reloaded.recordMessage(a.key, msg('command-id', '/new'))).toBe(false);
    expect(reloaded.claimMessage(b.key, 'command-id')).toBe(true);
    reloaded.recordMessage(a.key, msg('ordinary', '背景内容'));
    reloaded.recordMessage(a.key, msg('ask'));
    const snapshot = reloaded.snapshotBackground(a.key, 'ask');
    expect(snapshot.text).toContain('背景内容');
    expect(snapshot.text).not.toContain('/new');
    expect(snapshot.cursor).toBe(2);
  });

  it('deduplicates, excludes current input, and commits only the captured cursor', () => {
    const target = store();
    const entry = target.ensure('group', 'g');
    expect(target.recordMessage(entry.key, msg('one', '背景'))).toBe(true);
    expect(target.recordMessage(entry.key, msg('one', '重复'))).toBe(false);
    target.recordMessage(entry.key, msg('ask', '问题', { mentioned: true }));
    const first = target.snapshotBackground(entry.key, 'ask');
    expect(first.text).toContain('背景');
    expect(first.text).not.toContain('问题');
    target.recordMessage(entry.key, msg('later', '稍后到达'));
    target.commitBackground(entry.key, first.cursor);
    target.recordMessage(entry.key, msg('next', '下个问题', { mentioned: true }));
    const second = target.snapshotBackground(entry.key, 'next');
    expect(second.text).toContain('稍后到达');
    expect(second.text).not.toContain('背景');
    expect(second.text).not.toContain('问题');
  });

  it('limits count, time and characters together and does not mix another group', () => {
    const target = store();
    const a = target.ensure('group', 'a');
    const b = target.ensure('group', 'b');
    a.policy.context = { ...a.policy.context, maxMessages: 2, maxAgeMinutes: 1, maxChars: 25 };
    target.updatePolicy(a.key, a.policy.version, a.policy);
    target.recordMessage(a.key, msg('old', '过期', { at: now - 61_000 }));
    target.recordMessage(b.key, msg('b', '其他群秘密'));
    for (const id of ['1', '2', '3']) target.recordMessage(a.key, msg(id, `${id}很长的背景消息内容`));
    target.recordMessage(a.key, msg('ask'));
    const snapshot = target.snapshotBackground(a.key, 'ask');
    expect(snapshot.text.length).toBeLessThanOrEqual(25);
    expect(snapshot.text).not.toContain('过期');
    expect(snapshot.text).not.toContain('秘密');
    expect(snapshot.text).not.toContain('1很长');
  });

  it('does not inject ordinary messages in interaction mode', () => {
    const target = store(); const entry = target.ensure('group', 'g');
    entry.policy.context.mode = 'interaction'; target.updatePolicy(entry.key, entry.policy.version, entry.policy);
    target.recordMessage(entry.key, msg('background', '不该注入'));
    target.recordMessage(entry.key, msg('ask'));
    expect(target.snapshotBackground(entry.key, 'ask').text).toBe('');
    expect(target.messages(entry.key).map(row => row.id)).toEqual(['ask', 'background']);
  });

  it('persists only normalized archive fields and paginates equal-time messages by cursor', () => {
    const target = store(); const entry = target.ensure('group', 'g'); archive(target, entry.key);
    const input = { ...msg('one', '第一条'), auth_token: 'TOP_SECRET', raw: { access_token: 'TOP_SECRET' } };
    target.recordMessage(entry.key, input);
    target.recordMessage(entry.key, msg('two', '第二条'));
    target.recordMessage(entry.key, msg('three', '第三条'));
    const page = target.messages(entry.key, { limit: 2 });
    expect(page.map((item) => item.id)).toEqual(['three', 'two']);
    expect(target.messages(entry.key, { before: page[1]?.cursor, limit: 2 }).map((item) => item.id)).toEqual(['one']);
    expect(JSON.stringify(target.messages(entry.key))).not.toContain('TOP_SECRET');
    expect(target.messages(entry.key, { query: '第二' }).map((item) => item.id)).toEqual(['two']);
    expect(store().messages(entry.key)).toHaveLength(3);
    expect(store().recordMessage(entry.key, msg('three'))).toBe(false);
  });

  it('reset cuts automatic background but leaves archive explicitly queryable across restart', () => {
    const target = store(); const entry = target.ensure('group', 'g'); archive(target, entry.key);
    target.recordMessage(entry.key, msg('before', '重置之前'));
    target.resetBackground(entry.key);
    const reloaded = store();
    reloaded.recordMessage(entry.key, msg('ask'));
    expect(reloaded.snapshotBackground(entry.key, 'ask').text).toBe('');
    expect(reloaded.messages(entry.key).some((item) => item.text === '重置之前')).toBe(true);
  });

  it.each([false, true])('recovers a torn archive tail without consuming its identity, complete JSON %j', complete => {
    const target = store(); const entry = target.ensure('group', 'torn'); archive(target, entry.key);
    target.recordMessage(entry.key, msg('first'));
    const tail = JSON.stringify({ cursor: 2, message: msg('replayed', '恢复的消息') });
    appendFileSync(logPath(entry.key, 'messages'), complete ? tail : tail.slice(0, -7));
    const reloaded = store();
    expect(reloaded.hasMessage(entry.key, 'replayed')).toBe(false);
    expect(reloaded.recordMessage(entry.key, msg('replayed', '恢复的消息'))).toBe(true);
    expect(reloaded.recordMessage(entry.key, msg('ask'))).toBe(true);
    expect(reloaded.snapshotBackground(entry.key, 'ask')).toMatchObject({ cursor: 3, messageIds: ['first', 'replayed'] });
    expect(store().messages(entry.key).map(item => [item.id, item.cursor])).toEqual([['ask', 3], ['replayed', 2], ['first', 1]]);
    expect(store().recordMessage(entry.key, msg('replayed'))).toBe(false);
  });

  it('reconciles a durable archive record ahead of the catalog before assigning the next cursor', () => {
    const target = store(); const entry = target.ensure('group', 'ahead'); archive(target, entry.key);
    target.recordMessage(entry.key, msg('first'));
    appendFileSync(logPath(entry.key, 'messages'), `${JSON.stringify({ cursor: 2, message: msg('durable') })}\n{"cursor":3`);
    const reloaded = store();
    expect(reloaded.recordMessage(entry.key, msg('durable'))).toBe(false);
    expect(reloaded.recordMessage(entry.key, msg('next'))).toBe(true);
    expect(store().messages(entry.key).map(item => [item.id, item.cursor])).toEqual([['next', 3], ['durable', 2], ['first', 1]]);
  });

  it('keeps catalog cursors and committed dedupe identities when a retained archive is truncated', () => {
    const target = store(); const entry = target.ensure('group', 'catalog-ahead'); archive(target, entry.key);
    target.recordMessage(entry.key, msg('first'));
    target.recordMessage(entry.key, msg('lost-tail'));
    target.commitBackground(entry.key, 2);
    const path = logPath(entry.key, 'messages');
    const bytes = readFileSync(path, 'utf8');
    writeFileSync(path, bytes.slice(0, -7));
    const reloaded = store();
    expect(reloaded.consumedCursor(entry.key)).toBe(2);
    expect(reloaded.recordMessage(entry.key, msg('lost-tail'))).toBe(false);
    expect(reloaded.recordMessage(entry.key, msg('next'))).toBe(true);
    expect(store().messages(entry.key).map(item => [item.id, item.cursor])).toEqual([['next', 3], ['first', 1]]);
    expect(reloaded.snapshotBackground(entry.key, 'next')).toMatchObject({ cursor: 3, messageIds: [] });
  });

  it('rejects malformed committed records without treating them as torn tails or replacing their evidence', () => {
    const target = store(); const entry = target.ensure('group', 'corrupt'); archive(target, entry.key);
    target.recordMessage(entry.key, msg('first'));
    const path = logPath(entry.key, 'messages');
    appendFileSync(path, '{broken\n');
    const bytes = readFileSync(path, 'utf8');
    expect(store).toThrow(SyntaxError);
    expect(readFileSync(path, 'utf8')).toBe(bytes);
  });

  it('retains history independently of the automatic context mode', () => {
    const target = store(); const entry = target.ensure('group', 'g'); archive(target, entry.key);
    target.updateRecording(entry.key, entry.recording!.version, { enabled: true, retentionDays: 7 });
    target.recordMessage(entry.key, msg('first'));
    now += 8 * 86_400_000;
    expect(target.messages(entry.key)).toEqual([]);
    target.recordMessage(entry.key, msg('retained'));
    const latest = target.get(entry.key);
    if (!latest) throw new Error('Missing entry');
    latest.policy.context.mode = 'recent'; target.updatePolicy(entry.key, latest.policy.version, latest.policy);
    target.recordMessage(entry.key, msg('not-archived'));
    const again = target.get(entry.key);
    if (!again) throw new Error('Missing entry');
    again.policy.context.mode = 'archive'; target.updatePolicy(entry.key, again.policy.version, again.policy);
    expect(target.messages(entry.key).map((item) => item.id)).toEqual(['not-archived', 'retained']);
  });
});

describe('durable explicit delivery', () => {
  it('binds operation identity to target and content across restart', () => {
    const target = store(); const a = target.ensure('group', 'a'); const b = target.ensure('group', 'b');
    expect(target.beginDelivery(a.key, 'operation', '正文', 2).created).toBe(true);
    expect(target.beginDelivery(a.key, 'operation', '正文').created).toBe(false);
    expect(() => target.beginDelivery(a.key, 'operation', '其他内容')).toThrow(ConversationConflictError);
    expect(() => target.beginDelivery(b.key, 'operation', '正文')).toThrow(ConversationConflictError);
    expect(store().beginDelivery(a.key, 'operation', '正文').created).toBe(false);
    expect(() => target.beginDelivery(a.key, '__proto__', '正文')).toThrow(TypeError);
    expect(() => target.beginDelivery(a.key, 'constructor', '正文')).toThrow(TypeError);
  });

  it('recovers interrupted sends as unknown without retry and preserves segment receipts', () => {
    const target = store(); const entry = target.ensure('group', 'g');
    target.beginDelivery(entry.key, 'operation', '长正文', 2);
    target.updateDelivery(entry.key, 'operation', { state: 'sending', parts: [{ index: 0, state: 'accepted' }, { index: 1, state: 'pending' }] });
    const reloaded = store();
    const result = reloaded.beginDelivery(entry.key, 'operation', '长正文');
    expect(result.created).toBe(false); expect(result.record.state).toBe('unknown');
    expect(result.record.parts).toEqual([{ index: 0, state: 'accepted' }, { index: 1, state: 'unknown' }]);
  });

  it.each([false, true])('recovers an interrupted delivery before a torn acceptance tail, complete JSON %j', complete => {
    const target = store(); const entry = target.ensure('group', 'torn-delivery');
    target.beginDelivery(entry.key, 'operation', '结果未知的消息', 2);
    const sending = target.updateDelivery(entry.key, 'operation', {
      state: 'sending', parts: [{ index: 0, state: 'accepted' }, { index: 1, state: 'pending' }],
    });
    const tail = JSON.stringify({ ...sending, state: 'accepted' });
    appendFileSync(logPath(entry.key, 'deliveries'), complete ? tail : tail.slice(0, -4));
    const reloaded = store();
    const result = reloaded.beginDelivery(entry.key, 'operation', '结果未知的消息');
    expect(result.created).toBe(false);
    expect(result.record.state).toBe('unknown');
    expect(result.record.parts).toEqual([{ index: 0, state: 'accepted' }, { index: 1, state: 'unknown' }]);
    expect(store().deliveries(entry.key)).toEqual([result.record]);
    reloaded.recordMessage(entry.key, msg('ask'));
    expect(reloaded.snapshotBackground(entry.key, 'ask').text).not.toContain('结果未知的消息');
  });

  it('publishes only accepted text to next-turn background, retaining it over restart', () => {
    const target = store(); const entry = target.ensure('group', 'g');
    target.beginDelivery(entry.key, 'failed', '失败内容'); target.updateDelivery(entry.key, 'failed', { state: 'failed' });
    target.beginDelivery(entry.key, 'ok', '最终结论'); target.updateDelivery(entry.key, 'ok', { state: 'accepted', parts: [{ index: 0, state: 'accepted' }] });
    const reloaded = store(); reloaded.recordMessage(entry.key, msg('ask'));
    const snapshot = reloaded.snapshotBackground(entry.key, 'ask');
    expect(snapshot.text).toContain('最终结论'); expect(snapshot.text).not.toContain('失败内容');
    reloaded.commitBackground(entry.key, snapshot.cursor);
    reloaded.recordMessage(entry.key, msg('next'));
    expect(reloaded.snapshotBackground(entry.key, 'next').text).not.toContain('最终结论');
    expect(reloaded.deliveries(entry.key)[0]?.id).toBe('ok');
    const afterAnotherRestart = store(); afterAnotherRestart.recordMessage(entry.key, msg('third'));
    expect(afterAnotherRestart.snapshotBackground(entry.key, 'third').text).not.toContain('最终结论');
  });

  it('includes published replies in interaction mode without ordinary group messages', () => {
    const target = store(); const entry = target.ensure('group', 'g');
    entry.policy.context.mode = 'interaction'; target.updatePolicy(entry.key, entry.policy.version, entry.policy);
    target.recordMessage(entry.key, msg('ordinary', '闲聊背景'));
    target.beginDelivery(entry.key, 'published', '人工发布的结论');
    target.updateDelivery(entry.key, 'published', { state: 'accepted' });
    target.recordMessage(entry.key, msg('ask'));
    const context = target.snapshotBackground(entry.key, 'ask');
    expect(context.text).toContain('人工发布的结论');
    expect(context.text).not.toContain('闲聊背景');
  });

  it('keeps automatic QQ replies out of the next context across restart', () => {
    const target = store(); const entry = target.ensure('group', 'g');
    target.beginDelivery(entry.key, 'automatic', '已在 DSH 里的回复', 1, false);
    target.updateDelivery(entry.key, 'automatic', { state: 'accepted', parts: [{ index: 0, state: 'accepted' }] });
    target.recordMessage(entry.key, msg('ask'));
    expect(target.snapshotBackground(entry.key, 'ask').text).not.toContain('已在 DSH 里的回复');
    const reloaded = store();
    reloaded.recordMessage(entry.key, msg('next'));
    expect(reloaded.snapshotBackground(entry.key, 'next').text).not.toContain('已在 DSH 里的回复');
    expect(reloaded.beginDelivery(entry.key, 'automatic', '已在 DSH 里的回复', 1, false).created).toBe(false);
    expect(() => reloaded.beginDelivery(entry.key, 'automatic', '已在 DSH 里的回复')).toThrow(ConversationConflictError);
  });

  it('defaults legacy operation metadata to publishing manual replies', () => {
    const target = store(); const entry = target.ensure('group', 'g');
    target.beginDelivery(entry.key, 'legacy', '人工旧版本结论');
    target.updateDelivery(entry.key, 'legacy', { state: 'accepted' });
    const name = readdirSync(root).find((item) => item.endsWith('.json'));
    if (!name) throw new Error('Catalog missing');
    const path = join(root, name);
    const raw = readFileSync(path, 'utf8').replace(/,"publish":true/g, '');
    writeFileSync(path, raw);
    const reloaded = store(); reloaded.recordMessage(entry.key, msg('ask'));
    expect(reloaded.snapshotBackground(entry.key, 'ask').text).toContain('人工旧版本结论');
  });
});

describe('independent durable QQ recording and timeline', () => {
  it('defaults both scopes to recording and changes only the recording version', () => {
    const target = store();
    for (const scope of ['group', 'c2c'] as const) {
      const entry = target.ensure(scope, scope);
      expect(entry.recording).toEqual({ version: 1, enabled: true, since: now, retentionDays: 0 });
      const changed = target.updateRecording(entry.key, 1, { enabled: false, retentionDays: 3 });
      expect(changed.recording).toEqual({ version: 2, enabled: false, since: now, retentionDays: 3 });
      expect(changed.policy).toEqual(entry.policy);
      expect(changed.nativeLog).toEqual(entry.nativeLog);
      expect(() => target.updateRecording(entry.key, 1, { enabled: true, retentionDays: 7 })).toThrow(ConversationConflictError);
      expect(() => target.updateRecording(entry.key, 2, { enabled: true, retentionDays: -1 })).toThrow(TypeError);
    }
  });

  it('records commands durably without injecting them into any automatic context mode', () => {
    const target = store(); const entry = target.ensure('c2c', 'commands');
    target.recordMessage(entry.key, msg('command', '/new', { contextEligible: false, provenance: 'command' }));
    target.recordMessage(entry.key, msg('ordinary', 'ordinary body'));
    target.recordMessage(entry.key, msg('ask'));
    expect(target.snapshotBackground(entry.key, 'ask').text).toContain('ordinary body');
    expect(target.snapshotBackground(entry.key, 'ask').text).not.toContain('/new');
    const rows = store().timeline(entry.key).items;
    expect(rows).toHaveLength(3);
    expect(rows.find(row => row.direction === 'inbound' && row.message.id === 'command')).toMatchObject({ direction: 'inbound', message: { text: '/new', contextEligible: false, provenance: 'command' } });
  });

  it('drains more than 100 equal-time rows across a stable snapshot while new rows arrive', () => {
    const target = store(); const entry = target.ensure('group', 'pages');
    for (let index = 0; index < 137; index++) target.recordMessage(entry.key, msg(`message-${index}`, `searchable ${index}`));
    const first = target.timeline(entry.key, { limit: 23 });
    const orders = first.items.map(row => row.order);
    target.recordMessage(entry.key, msg('later', 'new arrival'));
    let page = first;
    while (page.hasMore) {
      page = target.timeline(entry.key, { before: page.nextBefore, snapshot: first.snapshot, limit: 23 });
      orders.push(...page.items.map(row => row.order));
    }
    expect(orders).toHaveLength(137);
    expect(new Set(orders).size).toBe(137);
    expect(orders).toEqual([...orders].sort((a, b) => b - a));
    expect(target.timeline(entry.key, { query: 'searchable', limit: 1000 }).items).toHaveLength(137);
    expect(store().timeline(entry.key, { after: first.snapshot }).items).toMatchObject([{ direction: 'inbound', message: { id: 'later' } }]);
    expect(() => target.timeline(entry.key, { limit: NaN })).toThrow(TypeError);
  }, 30_000);

  it('updates the same outbound row and incrementally reports changes outside the first history page', () => {
    const target = store(); const entry = target.ensure('group', 'updates');
    const started = target.beginDelivery(entry.key, 'outbound', 'outgoing body', 1, false, { provenance: 'web', sourceSessionId: 'verified-session', sourceMessageId: 'verified-answer' });
    target.updateDelivery(entry.key, 'outbound', { state: 'sending' });
    for (let index = 0; index < 110; index++) target.recordMessage(entry.key, msg(`newer-${index}`));
    const snapshot = target.timeline(entry.key).snapshot;
    target.updateDelivery(entry.key, 'outbound', { state: 'accepted', parts: [{ index: 0, state: 'accepted', receiptId: 'platform-id' }] });
    const changed = target.timeline(entry.key, { after: snapshot, limit: 1 });
    expect(changed.items).toHaveLength(1);
    expect(changed.items[0]).toMatchObject({ direction: 'outbound', order: started.record.order, delivery: { state: 'accepted', provenance: 'web', sourceSessionId: 'verified-session', parts: [{ receiptId: 'platform-id' }] } });
    expect(target.timeline(entry.key, { snapshot, query: 'outgoing' }).items[0]).toMatchObject({ direction: 'outbound', delivery: { state: 'sending' } });
    expect(target.timeline(entry.key, { query: 'outgoing' }).items).toHaveLength(1);
    expect(store().timeline(entry.key, { query: 'outgoing' }).items[0]).toMatchObject({ direction: 'outbound', delivery: { state: 'accepted' } });
  }, 30_000);

  it('streams expired search matches and unrelated changes across stable incremental pages', () => {
    const target = store(); const entry = target.ensure('group', 'search-expiry');
    target.updateRecording(entry.key, entry.recording!.version, { enabled: true, retentionDays: 7 });
    target.recordMessage(entry.key, msg('secret', 'SECRET_SEARCH_BODY'));
    target.recordMessage(entry.key, msg('unrelated', 'other old body'));
    const first = target.timeline(entry.key, { query: 'SECRET_SEARCH_BODY', limit: 1 });
    expect(first.items).toMatchObject([{ direction: 'inbound', message: { id: 'secret', text: 'SECRET_SEARCH_BODY' } }]);
    now += 8 * 86_400_000;
    target.recordMessage(entry.key, msg('fresh', 'unrelated new body'));
    const changes = target.timeline(entry.key, { after: first.snapshot, query: 'SECRET_SEARCH_BODY', limit: 1 });
    expect(changes.items).toMatchObject([{ direction: 'inbound', message: { id: 'secret', text: '', senderName: '', attachments: [], bodyState: 'expired' } }]);
    expect(changes.hasMore).toBe(true);
    let page = changes;
    const rows = [...page.items];
    while (page.hasMore) {
      const previous = page.nextAfter;
      page = target.timeline(entry.key, { after: page.nextAfter, snapshot: changes.snapshot, query: 'SECRET_SEARCH_BODY', limit: 1 });
      expect(page.snapshot).toBe(changes.snapshot);
      expect(page.nextAfter).toBeGreaterThan(previous ?? 0);
      rows.push(...page.items);
    }
    expect(rows.map(row => row.direction === 'inbound' ? row.message.id : row.delivery.id)).toEqual(['secret', 'unrelated', 'fresh']);
    expect(new Set(rows.map(row => row.change)).size).toBe(3);
    expect(page.nextAfter).toBe(changes.snapshot);
    expect(target.timeline(entry.key, { after: page.nextAfter, query: 'SECRET_SEARCH_BODY' })).toMatchObject({ items: [], hasMore: false, nextAfter: changes.snapshot });
    expect(target.timeline(entry.key, { query: 'SECRET_SEARCH_BODY' }).items).toEqual([]);
    expect(JSON.stringify(rows)).not.toContain('SECRET_SEARCH_BODY');
  });

  it('removes expired bodies from both ledgers, delivery versions, catalog previews and context copies', () => {
    const target = store(); const entry = target.ensure('group', 'retention');
    target.updateRecording(entry.key, entry.recording!.version, { enabled: true, retentionDays: 7 });
    target.recordMessage(entry.key, msg('inbound-id', 'PRIVATE_INBOUND_BODY'));
    target.noteMessage(entry.key, 'PRIVATE_INBOUND_BODY', now);
    target.beginDelivery(entry.key, 'outbound-id', 'PRIVATE_OUTBOUND_BODY');
    target.updateDelivery(entry.key, 'outbound-id', { state: 'sending' });
    target.updateDelivery(entry.key, 'outbound-id', { state: 'accepted', parts: [{ index: 0, state: 'accepted', receiptId: 'receipt' }] });
    target.recordMessage(entry.key, msg('ask'));
    expect(target.snapshotBackground(entry.key, 'ask').text).toContain('PRIVATE_OUTBOUND_BODY');
    now += 8 * 86_400_000;
    target.ensure('group', 'retention'); // Fresh activity must not extend the old preview's lifetime.
    target.pruneExpired();
    expect(target.get(entry.key)?.lastMessage).toBe('');
    const files = [logPath(entry.key, 'messages'), logPath(entry.key, 'deliveries'), join(root, readdirSync(root).find(name => name.startsWith('conversations-') && name.endsWith('.json'))!)];
    for (const file of files) expect(readFileSync(file, 'utf8')).not.toMatch(/PRIVATE_(INBOUND|OUTBOUND)_BODY/);
    // 清空/过期后的正文不再出现在时间线（本轮改为无条件隐藏 expired），但投递身份仍保留（下面断言）。
    expect(target.timeline(entry.key).items).toHaveLength(0);
    expect(target.timeline(entry.key, { query: 'PRIVATE_' }).items).toEqual([]);
    expect(target.beginDelivery(entry.key, 'outbound-id', 'PRIVATE_OUTBOUND_BODY').created).toBe(false);
    expect(target.beginDelivery(entry.key, 'outbound-id', 'PRIVATE_OUTBOUND_BODY').record).toMatchObject({ text: '', bodyState: 'expired', state: 'accepted' });
    target.recordMessage(entry.key, msg('fresh'));
    expect(target.snapshotBackground(entry.key, 'fresh').text).not.toContain('PRIVATE_');
    expect(store().beginDelivery(entry.key, 'outbound-id', 'PRIVATE_OUTBOUND_BODY').created).toBe(false);
  });

  it('never recreates a reserved operation when the initial body append failed', () => {
    const target = store(); const entry = target.ensure('group', 'reserved');
    const append = vi.spyOn(fileOps, 'appendRecord').mockImplementationOnce(() => { throw new Error('injected disk-full append'); });
    expect(() => target.beginDelivery(entry.key, 'reserved-id', 'do not send twice')).toThrow('injected disk-full append');
    append.mockRestore();
    expect(target.errors().join(' ')).toContain('写入失败');
    expect(target.recordingError(entry.key)).toContain('写入失败');
    const repeated = target.beginDelivery(entry.key, 'reserved-id', 'do not send twice');
    expect(repeated.created).toBe(false);
    expect(repeated.record).toMatchObject({ state: 'unknown', text: '' });
    expect(target.timeline(entry.key).items).toMatchObject([{ direction: 'outbound', delivery: { id: 'reserved-id', state: 'unknown', text: '' } }]);
    expect(store().beginDelivery(entry.key, 'reserved-id', 'do not send twice').created).toBe(false);
  });

  it('keeps disabled recording separate from background selection and never persists disabled bodies', () => {
    const target = store(); const entry = target.ensure('group', 'disabled');
    target.updateRecording(entry.key, 1, { enabled: false, retentionDays: 7 });
    target.recordMessage(entry.key, msg('unrecorded', 'DISABLED_INBOUND_BODY'));
    target.noteMessage(entry.key, 'DISABLED_INBOUND_BODY', now);
    target.beginDelivery(entry.key, 'unrecorded-send', 'DISABLED_OUTBOUND_BODY', 1, false);
    target.updateDelivery(entry.key, 'unrecorded-send', { state: 'accepted' });
    target.recordMessage(entry.key, msg('ask'));
    expect(target.snapshotBackground(entry.key, 'ask').text).toContain('DISABLED_INBOUND_BODY');
    const catalog = readdirSync(root).find(name => name.startsWith('conversations-') && name.endsWith('.json'))!;
    expect(readFileSync(join(root, catalog), 'utf8')).not.toContain('DISABLED_');
    expect(readFileSync(logPath(entry.key, 'deliveries'), 'utf8')).not.toContain('DISABLED_');
    expect(store().timeline(entry.key).items).toMatchObject([{ direction: 'outbound', delivery: { text: '', bodyState: 'disabled' } }]);
  });

  it('migrates archive retention independently and never invents provenance for legacy rows', () => {
    const target = store(); const archiveEntry = target.ensure('group', 'archive-migration'); const recentEntry = target.ensure('c2c', 'recent-migration');
    const policy = archiveEntry.policy; policy.context.mode = 'archive'; policy.context.retentionDays = 3;
    target.updatePolicy(archiveEntry.key, policy.version, policy);
    target.recordMessage(archiveEntry.key, msg('legacy', 'legacy body'));
    const path = join(root, readdirSync(root).find(name => name.startsWith('conversations-') && name.endsWith('.json'))!);
    const catalog = JSON.parse(readFileSync(path, 'utf8'));
    for (const entry of catalog.entries) delete entry.recording;
    delete catalog.timeline;
    writeFileSync(path, JSON.stringify(catalog));
    const record = JSON.parse(readFileSync(logPath(archiveEntry.key, 'messages'), 'utf8').trim());
    delete record.order; delete record.change;
    writeFileSync(logPath(archiveEntry.key, 'messages'), `${JSON.stringify(record)}\n`);
    const reloaded = store();
    expect(reloaded.get(archiveEntry.key)?.recording?.retentionDays).toBe(3);
    expect(reloaded.get(recentEntry.key)?.recording?.retentionDays).toBe(7);
    expect(reloaded.get(archiveEntry.key)?.policy).toEqual(target.get(archiveEntry.key)?.policy);
    expect(reloaded.timeline(archiveEntry.key).items[0]).toMatchObject({ direction: 'inbound', message: { id: 'legacy' } });
    const row = reloaded.timeline(archiveEntry.key).items[0];
    if (row?.direction !== 'inbound') throw new Error('Missing incoming row');
    expect(row.message).not.toHaveProperty('sessionId');
    expect(row.message).not.toHaveProperty('provenance');
    expect(JSON.parse(readFileSync(path, 'utf8')).entries.every((entry: { recording?: unknown }) => entry.recording)).toBe(true);
  });

  it('recovers an interrupted multi-file migration from its durable journal without duplicating rows', () => {
    const target = store(); const entry = target.ensure('group', 'journal');
    target.recordMessage(entry.key, msg('legacy', 'legacy body'));
    target.beginDelivery(entry.key, 'pending-legacy', 'pending body', 1, false);
    const path = join(root, readdirSync(root).find(name => name.startsWith('conversations-') && name.endsWith('.json'))!);
    const catalog = JSON.parse(readFileSync(path, 'utf8'));
    delete catalog.entries[0].recording; delete catalog.timeline;
    writeFileSync(path, JSON.stringify(catalog));
    // A complete replacement journal simulates a crash after its first ledger was replaced.
    const restoredCatalog = { ...catalog, entries: catalog.entries.map((row: Record<string, unknown>) => ({ ...row, recording: { version: 1, enabled: true, since: now, retentionDays: 7 } })), timeline: { [entry.key]: { nextOrder: 3, nextChange: 3 } } };
    const messageRows = [JSON.parse(readFileSync(logPath(entry.key, 'messages'), 'utf8').trim())];
    const deliveryRows = [JSON.parse(readFileSync(logPath(entry.key, 'deliveries'), 'utf8').trim())];
    const journal = join(root, `recording-migration-${createHash('sha256').update('app').digest('hex')}.json`);
    writeFileSync(journal, JSON.stringify({ catalog: restoredCatalog, ledgers: [{ path: logPath(entry.key, 'messages'), rows: messageRows }, { path: logPath(entry.key, 'deliveries'), rows: deliveryRows }] }));
    const reloaded = store();
    expect(reloaded.timeline(entry.key).items).toHaveLength(2);
    expect(reloaded.beginDelivery(entry.key, 'pending-legacy', 'pending body', 1, false)).toMatchObject({ created: false, record: { state: 'unknown' } });
    expect(readdirSync(root).some(name => name.startsWith('recording-migration-'))).toBe(false);
    expect(store().timeline(entry.key).items).toHaveLength(2);
  });

  it('blocks every mutation after a real partial ledger replacement until restart recovers the journal', () => {
    const target = store(); const entry = target.ensure('group', 'partial-prune');
    target.updateRecording(entry.key, entry.recording!.version, { enabled: true, retentionDays: 7 });
    target.bindSession(entry.key, 'old-session'); target.bindSession(entry.key, 'current-session');
    target.recordMessage(entry.key, msg('old-inbound', 'OLD_INBOUND_BODY'));
    target.beginDelivery(entry.key, 'old-send', 'OLD_DELIVERY_BODY', 1, false);
    target.updateDelivery(entry.key, 'old-send', { state: 'accepted' });
    now += 8 * 86_400_000;
    const deliveryPath = logPath(entry.key, 'deliveries');
    const originalRename = fs.renameSync;
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
      if (destination === deliveryPath) throw new Error('injected delivery rename failure');
      return originalRename(source, destination);
    });
    syncBuiltinESMExports();
    try { expect(() => target.pruneExpired()).toThrow('injected delivery rename failure'); }
    finally { rename.mockRestore(); syncBuiltinESMExports(); }
    expect(readFileSync(logPath(entry.key, 'messages'), 'utf8')).not.toContain('OLD_INBOUND_BODY');
    expect(readFileSync(deliveryPath, 'utf8')).toContain('OLD_DELIVERY_BODY');
    const journal = join(root, `recording-migration-${createHash('sha256').update('app').digest('hex')}.json`);
    const catalog = join(root, `conversations-${createHash('sha256').update('app').digest('hex')}.json`);
    const paths = [journal, catalog, logPath(entry.key, 'messages'), deliveryPath];
    const bytes = paths.map(path => readFileSync(path, 'utf8'));
    const mutations = [
      () => target.setOwnerIds(['new-owner']),
      () => target.ensure('group', 'new-target'),
      () => target.bindSession(entry.key, 'new-session'),
      () => target.updatePolicy(entry.key, entry.policy.version, entry.policy),
      () => target.updateLifecycle(entry.key, entry.policy.version, entry.lifecycle),
      () => target.updateRecording(entry.key, 1, { enabled: false, retentionDays: 7 }),
      () => target.noteReceived(entry.key, 'current-session'),
      () => target.noteMessage(entry.key, 'new preview', now),
      () => target.forgetSession(entry.key, 'old-session'),
      () => target.migratePrefs({ sessionIds: { 'qqbot:app:c2c:new': 'migrated-session' } }),
      () => target.recordMessage(entry.key, msg('fresh-inbound')),
      () => target.claimMessage(entry.key, 'new-claim'),
      () => target.commitBackground(entry.key, 1),
      () => target.resetBackground(entry.key),
      () => target.beginDelivery(entry.key, 'fresh-send', 'FRESH_DELIVERY_BODY', 1, false),
      () => target.updateDelivery(entry.key, 'old-send', { state: 'accepted' }),
      () => target.pruneExpired(),
    ];
    for (const mutate of mutations) expect(mutate).toThrow('需重启恢复');
    expect(target.errors().join(' ')).toContain('不完整，需重启恢复');
    expect(target.recordingError(entry.key)).toContain('不完整，需重启恢复');
    expect(paths.map(path => readFileSync(path, 'utf8'))).toEqual(bytes);
    const recovered = store();
    expect(recovered.errors()).toEqual([]);
    expect(recovered.beginDelivery(entry.key, 'old-send', 'OLD_DELIVERY_BODY', 1, false)).toMatchObject({ created: false, record: { state: 'accepted', text: '', bodyState: 'expired' } });
    expect(recovered.beginDelivery(entry.key, 'fresh-send', 'FRESH_DELIVERY_BODY', 1, false).created).toBe(true);
    recovered.updateDelivery(entry.key, 'fresh-send', { state: 'accepted' });
    const restarted = store();
    expect(restarted.beginDelivery(entry.key, 'fresh-send', 'FRESH_DELIVERY_BODY', 1, false)).toMatchObject({ created: false, record: { state: 'accepted', text: 'FRESH_DELIVERY_BODY' } });
    expect(restarted.deliveries(entry.key).filter(row => row.id === 'fresh-send')).toHaveLength(1);
    expect(readdirSync(root).some(name => name.startsWith('recording-migration-'))).toBe(false);
  });
});


describe('recording format upgrade boundary', () => {
  it('atomically upgrades format 1 to format 2 so a pre-recording binary fails closed', () => {
    const target = store(); const entry = target.ensure('group', 'old-format');
    target.recordMessage(entry.key, msg('stored', 'retained body'));
    const path = join(root, readdirSync(root).find(name => name.startsWith('conversations-') && name.endsWith('.json'))!);
    const catalog = JSON.parse(readFileSync(path, 'utf8'));
    catalog.format = 1; delete catalog.timeline; delete catalog.entries[0].recording;
    writeFileSync(path, JSON.stringify(catalog));
    expect(store().timeline(entry.key).items).toHaveLength(1);
    const upgraded = JSON.parse(readFileSync(path, 'utf8'));
    expect(upgraded.format).toBe(2);
    // The previous binary's catalog gate accepts only format 1.
    expect(upgraded.format === 1).toBe(false);
    expect(store().get(entry.key)?.recording?.enabled).toBe(true);
    upgraded.format = 3; const bytes = JSON.stringify(upgraded); writeFileSync(path, bytes);
    expect(store).toThrow('Unsupported QQ conversation catalog');
    expect(readFileSync(path, 'utf8')).toBe(bytes);
  });
});

describe('retention recovery ordering', () => {
  it('reopens a large retained tombstone ledger without exceeding the JavaScript argument limit', () => {
    const target = store(); const entry = target.ensure('group', 'large-ledger');
    target.recordMessage(entry.key, msg('initial'));
    const count = 130_000;
    const message = msg('expired', '', { at: now - 8 * 86_400_000, senderName: '', bodyState: 'expired' });
    writeFileSync(logPath(entry.key, 'messages'), Array.from({ length: count }, (_, index) => JSON.stringify({ cursor: index + 1, order: index + 1, change: index + 1, message: { ...message, id: `expired-${index}` } })).join('\n') + '\n');
    const reopened = store();
    expect(reopened.timeline(entry.key, { after: count - 1 })).toMatchObject({ snapshot: count, items: [{ direction: 'inbound', order: count, change: count, message: { id: `expired-${count - 1}`, text: '', bodyState: 'expired' } }] });
    reopened.recordMessage(entry.key, msg('fresh'));
    expect(reopened.timeline(entry.key, { after: count })).toMatchObject({ snapshot: count + 1, items: [{ direction: 'inbound', order: count + 1, change: count + 1, message: { id: 'fresh', cursor: count + 1 } }] });
  }, 30_000);

  it('expires old accepted bodies before startup publication recovery can copy them into fresh context', () => {
    const target = store(); const entry = target.ensure('group', 'old-accepted');
    target.updateRecording(entry.key, entry.recording!.version, { enabled: true, retentionDays: 7 });
    target.beginDelivery(entry.key, 'old-send', 'NEVER_REFRESH_THIS_BODY');
    target.updateDelivery(entry.key, 'old-send', { state: 'accepted' });
    const path = join(root, readdirSync(root).find(name => name.startsWith('conversations-') && name.endsWith('.json'))!);
    const catalog = JSON.parse(readFileSync(path, 'utf8'));
    catalog.operations['old-send'].published = false; catalog.background[entry.key].published = [];
    writeFileSync(path, JSON.stringify(catalog));
    now += 8 * 86_400_000;
    const reloaded = store();
    expect(readFileSync(path, 'utf8')).not.toContain('NEVER_REFRESH_THIS_BODY');
    expect(readFileSync(logPath(entry.key, 'deliveries'), 'utf8')).not.toContain('NEVER_REFRESH_THIS_BODY');
    reloaded.recordMessage(entry.key, msg('fresh'));
    expect(reloaded.snapshotBackground(entry.key, 'fresh').text).not.toContain('NEVER_REFRESH_THIS_BODY');
  });

  it('allocates new changes after a same-call expiry pass and clears the old recent cache', () => {
    const target = store(); const entry = target.ensure('group', 'write-after-expiry');
    target.updateRecording(entry.key, entry.recording!.version, { enabled: true, retentionDays: 7 });
    target.recordMessage(entry.key, msg('old', 'OLD_CACHE_BODY'));
    const before = target.timeline(entry.key).snapshot;
    now += 8 * 86_400_000;
    target.recordMessage(entry.key, msg('fresh'));
    const changes = target.timeline(entry.key, { after: before });
    expect(changes.items).toHaveLength(2);
    expect(new Set(changes.items.map(row => row.change)).size).toBe(2);
    expect(changes.items[0]).toMatchObject({ direction: 'inbound', message: { id: 'old', text: '', bodyState: 'expired' } });
    expect(changes.items[1]).toMatchObject({ direction: 'inbound', message: { id: 'fresh' } });
    expect(target.snapshotBackground(entry.key, 'fresh').text).not.toContain('OLD_CACHE_BODY');
  });
});
