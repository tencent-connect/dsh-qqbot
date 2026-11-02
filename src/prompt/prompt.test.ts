import { describe, expect, it } from 'vitest';
import { RULES_TEXT } from './rules.ts';
import { scopeText, GROUP_SCOPE_TEXT, C2C_SCOPE_TEXT } from './scope.ts';
import { parsePersonaSections, selectPersonaText, roleSectionReport } from './persona.ts';
import { selectExtraPrompt, EXTRA_MAX_CHARS } from './extra.ts';
import { relTime, clockOf, turnMetaText } from './turn-meta.ts';
import { assembleUserBlocks } from './user-blocks.ts';

describe('prompt rules', () => {
  it('encourages tool use and forbids fabricated calls (no file/task-only restriction)', () => {
    expect(RULES_TEXT).toContain('主动调用');
    expect(RULES_TEXT).toContain('编造');
    expect(RULES_TEXT).not.toContain('只有用户明确要求处理文件或执行任务');
  });
});

describe('scope text', () => {
  it('differs between group and c2c', () => {
    expect(scopeText('group')).toBe(GROUP_SCOPE_TEXT);
    expect(scopeText('c2c')).toBe(C2C_SCOPE_TEXT);
    expect(GROUP_SCOPE_TEXT).not.toBe(C2C_SCOPE_TEXT);
  });
});

describe('persona role-card', () => {
  const card = ['# 你是谁', '你是鲸鱼。', '', '## 群聊补充 〔群聊〕', '群里别刷屏。', '', '## 私聊补充 〔私聊〕', '私聊可以更直接。'].join('\n');
  it('parses sections with mode tags', () => {
    const sections = parsePersonaSections(card);
    expect(sections.map(s => s.mode)).toEqual(['all', 'group', 'c2c']);
    expect(sections[1].heading).toBe('群聊补充'); // tag stripped
  });
  it('selects only applicable sections and strips tags', () => {
    const group = selectPersonaText(card, 'group');
    expect(group).toContain('你是鲸鱼');
    expect(group).toContain('群里别刷屏');
    expect(group).not.toContain('私聊可以更直接');
    expect(group).not.toContain('〔群聊〕');
    const c2c = selectPersonaText(card, 'c2c');
    expect(c2c).toContain('私聊可以更直接');
    expect(c2c).not.toContain('群里别刷屏');
  });
  it('reports per-section injection', () => {
    const report = roleSectionReport(card, 'group');
    expect(report.find(r => r.heading === '群聊补充')?.injected).toBe(true);
    expect(report.find(r => r.heading === '私聊补充')?.injected).toBe(false);
  });
});

describe('extra prompt', () => {
  it('selects by scope and trims', () => {
    expect(selectExtraPrompt({ group: '  g  ', direct: 'd' }, 'group')).toBe('g');
    expect(selectExtraPrompt({ group: 'g', direct: 'd' }, 'c2c')).toBe('d');
    expect(selectExtraPrompt({ group: '', direct: undefined }, 'group')).toBe('');
  });
  it('truncates to max', () => {
    const long = 'x'.repeat(EXTRA_MAX_CHARS + 10);
    expect(selectExtraPrompt({ group: long }, 'group').length).toBe(EXTRA_MAX_CHARS);
  });
});

describe('turn meta', () => {
  it('relative time buckets', () => {
    expect(relTime(undefined, undefined)).toBe('');
    expect(relTime(1000, 1000 + 30_000)).toBe('刚刚');
    expect(relTime(1000, 1000 + 5 * 60_000)).toBe('5 分钟前');
    expect(relTime(1000, 1000 + 3 * 3600_000)).toBe('3 小时前');
    expect(relTime(1000, 1000 + 2 * 86400_000)).toBe('2 天前');
  });
  it('clock', () => {
    const t = new Date(2026, 0, 1, 9, 5).getTime();
    expect(clockOf(t)).toBe('09:05');
  });
  it('builds meta text for group with mention + rel', () => {
    const at = new Date(2026, 0, 1, 9, 5).getTime();
    const txt = turnMetaText({ scope: 'group', mentioned: true, senderName: '张三', at, now: at + 120_000, unread: 3 });
    expect(txt).toContain('QQ 群聊');
    expect(txt).toContain('@ 了你');
    expect(txt).toContain('发送者：张三');
    expect(txt).toContain('09:05（2 分钟前）');
    expect(txt).toContain('待处理消息：3 条');
  });
  it('c2c has no mention/unread lines', () => {
    const txt = turnMetaText({ scope: 'c2c', senderName: '李四' });
    expect(txt).toContain('QQ 私聊');
    expect(txt).not.toContain('@ 了你');
    expect(txt).not.toContain('待处理消息');
  });
});

describe('user blocks', () => {
  it('emits the user body only and omits empty bodies', () => {
    expect(assembleUserBlocks({ body: 'hi' })).toEqual(['hi']);
    expect(assembleUserBlocks({ body: '' })).toEqual([]);
  });
});
