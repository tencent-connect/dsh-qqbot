import { describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import type { AssembleContext, PromptContext, PromptPresentation, PromptSection, SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { installQQPrompt, turnMetaText, type QQPromptEntry, type QQTurnContext } from '../prompt/index.ts';
import { EXTRA_MAX_CHARS as QQ_EXTRA_PROMPT_MAX_CHARS } from './extra.ts';
import { RULES_TEXT } from './rules.ts';

type AssembleListener = (assembly: PromptPresentation, context: AssembleContext, next: () => Promise<PromptPresentation>) => Promise<PromptPresentation>;

function fakeSystemPrompt() {
  const sections = new Map<string, PromptSection>();
  const contexts = new Map<string, PromptContext>();
  const service = {
    section(s: PromptSection) { sections.set(s.name, s); return () => sections.delete(s.name); },
    context(c: PromptContext) { contexts.set(c.name, c); return () => contexts.delete(c.name); },
  } satisfies Pick<SystemPrompt, 'section' | 'context'>;
  // 模拟宿主 waterfall：注册的监听器先跑，next() 返回内建组装结果（inner 原样）；
  // dispose 拆除监听器后，组装直接返回 inner。
  let assembleListener: AssembleListener | undefined;
  const ctx = {
    get: (n: string) => n === 'systemPrompt' ? service : undefined,
    on: (name: string, listener: AssembleListener) => {
      if (name !== 'system-prompt/assemble') throw new Error(`unexpected event: ${name}`);
      assembleListener = listener;
      return () => { assembleListener = undefined; return true; };
    },
  } as unknown as Context;
  const render = (map: ReadonlyMap<string, PromptSection | PromptContext>, c: AssembleContext) => [...map.values()].sort((a, b) => a.order - b.order)
    .map((s) => typeof s.text === 'function' ? s.text(c) : s.text).filter((t) => t.length > 0).join('NL');
  const dispatchAssemble = (inner: PromptPresentation) =>
    assembleListener === undefined
      ? Promise.resolve(inner)
      : assembleListener(inner, {}, () => Promise.resolve(inner));
  return { ctx, sections, contexts, renderSections: (c: AssembleContext = {}) => render(sections, c).split('NL').join('NL'), renderContexts: (c: AssembleContext = {}) => render(contexts, c), dispatchAssemble };
}

const NL = String.fromCharCode(10);
function card(p: string) { return ['# 你是谁', '你是鲸鱼。', '', '## 群聊规则 〔群聊〕', p + '别刷屏。', '', '## 私聊规则 〔私聊〕', p + '直接点。'].join(NL); }
function entry(o: Partial<QQPromptEntry> = {}): QQPromptEntry {
  return {
    scope: 'group',
    personaCard: () => card(''),
    extraPrompts: () => ({ group: 'GROUP_EXTRA', direct: 'DIRECT_EXTRA' }),
    ...o,
  };
}

describe('installQQPrompt (DSH section/context 注册)', () => {
  it('registers 3 sections + 2 contexts; dispose clears', () => {
    const sp = fakeSystemPrompt();
    const h = installQQPrompt(sp.ctx, entry());
    expect([...sp.sections.keys()].sort()).toEqual(['qqbot:extra', 'qqbot:persona', 'qqbot:rules']);
    expect([...sp.contexts.keys()]).toEqual(['qqbot:turn-meta', 'qqbot:background']);
    h.dispose();
    expect(sp.sections.size).toBe(0); expect(sp.contexts.size).toBe(0);
  });
  it('group vs c2c persona/extra differ', () => {
    const g = fakeSystemPrompt(); const gh = installQQPrompt(g.ctx, entry({ scope: 'group' }));
    const gt = g.renderSections();
    expect(gt).toContain('QQ'); expect(gt).toContain('别刷屏'); expect(gt).not.toContain('直接点');
    expect(gt).toContain('GROUP_EXTRA'); expect(gt).not.toContain('DIRECT_EXTRA'); expect(gt).not.toContain('〔群聊〕');
    const c = fakeSystemPrompt(); installQQPrompt(c.ctx, entry({ scope: 'c2c' }));
    const ct = c.renderSections();
    expect(ct).toContain('QQ'); expect(ct).toContain('DIRECT_EXTRA');
    expect(ct).not.toContain('别刷屏'); expect(ct).not.toContain('GROUP_EXTRA');
    gh.dispose();
  });
  it('built-in rules always render; persona/extra empty by default', () => {
    const sp = fakeSystemPrompt();
    installQQPrompt(sp.ctx, entry({ personaCard: () => '', extraPrompts: () => ({}) }));
    expect(sp.renderSections()).toContain('QQ');
    expect([...sp.sections.keys()].sort()).toEqual(['qqbot:extra', 'qqbot:persona', 'qqbot:rules']);
  });
  it('lazily reads persona/extra so edits apply without reinstall', () => {
    const sp = fakeSystemPrompt(); let extra = 'OLDEX'; let persona = '# X' + NL + 'OLDPER';
    installQQPrompt(sp.ctx, entry({ extraPrompts: () => ({ group: extra }), personaCard: () => persona }));
    expect(sp.renderSections()).toContain('OLDEX'); expect(sp.renderSections()).toContain('OLDPER');
    extra = 'NEWEX'; persona = '# X' + NL + 'NEWPER';
    const t = sp.renderSections();
    expect(t).toContain('NEWEX'); expect(t).toContain('NEWPER'); expect(t).not.toContain('OLDEX'); expect(t).not.toContain('OLDPER');
  });
  it.each(['group', 'c2c'] as const)('injects the complete current %s prompt after a live edit and keeps the other scope out', scope => {
    const sp = fakeSystemPrompt();
    let prompts = { group: 'OLD_GROUP', direct: 'OLD_DIRECT' };
    installQQPrompt(sp.ctx, entry({ scope, extraPrompts: () => prompts }));
    expect(sp.renderSections()).toContain(scope === 'group' ? 'OLD_GROUP' : 'OLD_DIRECT');
    const tail = scope === 'group' ? 'GROUP_FINAL_INSTRUCTION' : 'DIRECT_FINAL_INSTRUCTION';
    const prompt = 'x'.repeat(QQ_EXTRA_PROMPT_MAX_CHARS - tail.length) + tail;
    prompts = scope === 'group' ? { group: prompt, direct: 'OTHER_SCOPE_ONLY' } : { group: 'OTHER_SCOPE_ONLY', direct: prompt };
    const rendered = sp.renderSections();
    expect(rendered).toContain(prompt);
    expect(rendered).not.toContain('OTHER_SCOPE_ONLY');
    expect(rendered).not.toContain(scope === 'group' ? 'OLD_GROUP' : 'OLD_DIRECT');
  });
  it('reads verified turn facts lazily and clears them when the current turn has none', () => {
    const sp = fakeSystemPrompt();
    let current: QQTurnContext | undefined;
    const h = installQQPrompt(sp.ctx, entry({ turnContext: () => current }));
    expect(sp.renderContexts()).toBe('');
    current = { turnMetaText: turnMetaText({ scope: 'group', senderName: '张三', senderId: 'openid-123', mentioned: true, at: 1000, now: 1000 + 120000 }), backgroundText: 'Earlier group message {{literal}}' };
    const m = sp.renderContexts();
    expect(m).toContain('QQ 群聊'); expect(m).toContain('@ 了你'); expect(m).toContain('发送者：张三（QQ openid-123）'); expect(m).toContain('「张三」'); expect(m).toContain('2 分钟前');
    expect(m).toContain('Earlier group message {{literal}}');
    expect(m).toContain('仅作为背景');
    expect(sp.renderContexts()).toBe(m);
    current = undefined;
    expect(sp.renderContexts()).toBe('');
    h.dispose();
  });
});

describe('installQQPrompt (system-prompt/assemble 合并)', () => {
  const hostPersona = (name: string) => ({ name, text: 'HOST_PERSONA' });
  const qqSections = [
    { name: 'qqbot:rules', text: RULES_TEXT },
    { name: 'qqbot:persona', text: 'QQ_PERSONA' },
    { name: 'qqbot:extra', text: 'QQ_EXTRA' },
  ];
  const mergedPersonaText = ['HOST_PERSONA', RULES_TEXT, 'QQ_PERSONA', 'QQ_EXTRA'].join('\n\n---\n\n');

  it.each(['deployment:persona-prefix', 'deployment:persona', 'persona'] as const)(
    '含宿主 persona 段（%s）且 qqbot 有文本 → 按 rules→persona→extra 追加，独立 qqbot 段消失',
    async (hostName) => {
      const sp = fakeSystemPrompt();
      const h = installQQPrompt(sp.ctx, entry());
      const inner: PromptPresentation = {
        sections: [hostPersona(hostName), ...qqSections, { name: 'plan:policy', text: 'POLICY' }],
        contexts: [],
        variables: {},
      };
      const out = await sp.dispatchAssemble(inner);
      expect(out.sections.map((s) => s.name)).toEqual([hostName, 'plan:policy']);
      expect(out.sections[0].text).toBe(mergedPersonaText);
      // 幂等：只改当次副本，入参不受影响
      expect(inner.sections).toHaveLength(5);
      expect(inner.sections[0].text).toBe('HOST_PERSONA');
      h.dispose();
    },
  );

  it('无宿主 persona 段 → sections 原样保留 qqbot 独立段', async () => {
    const sp = fakeSystemPrompt();
    const h = installQQPrompt(sp.ctx, entry());
    const inner: PromptPresentation = { sections: [...qqSections, { name: 'plan:policy', text: 'POLICY' }], contexts: [], variables: {} };
    const out = await sp.dispatchAssemble(inner);
    expect(out).toBe(inner);
    h.dispose();
  });

  it('全部 qqbot 段为空文本 → 不追加、不改数组', async () => {
    const sp = fakeSystemPrompt();
    const h = installQQPrompt(sp.ctx, entry());
    const inner: PromptPresentation = {
      sections: [
        hostPersona('deployment:persona'),
        { name: 'qqbot:rules', text: '' },
        { name: 'qqbot:persona', text: '   ' },
        { name: 'qqbot:extra', text: '' },
      ],
      contexts: [],
      variables: {},
    };
    const out = await sp.dispatchAssemble(inner);
    expect(out).toBe(inner);
    h.dispose();
  });

  it('handle.dispose() 后监听器不再生效（再触发 assemble 无合并）', async () => {
    const sp = fakeSystemPrompt();
    const h = installQQPrompt(sp.ctx, entry());
    const inner: PromptPresentation = { sections: [hostPersona('deployment:persona'), ...qqSections], contexts: [], variables: {} };
    const before = await sp.dispatchAssemble(inner);
    expect(before.sections[0].text).toBe(mergedPersonaText);
    h.dispose();
    const after = await sp.dispatchAssemble(inner);
    expect(after).toBe(inner);
    expect(after.sections.map((s) => s.name)).toContain('qqbot:rules');
    expect(after.sections[0].text).toBe('HOST_PERSONA');
  });
});
