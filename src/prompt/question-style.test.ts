import { describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import type { AssembleContext, PromptContext, PromptSection, SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { installQQPrompt, type QQPromptEntry } from './install.ts';
import {
  QUESTION_STYLE_ORDER,
  QUESTION_STYLE_SECTION_NAME,
  QUESTION_STYLE_SECTION_TEXT,
  selectQuestionStyleText,
} from './question-style.ts';

/** 按宿主语义渲染：section.text 可取函数，渲染后空文本被丢弃（同 @deepseek-ai/dsh-system-prompt）。 */
function fakeSystemPrompt() {
  const sections = new Map<string, PromptSection>();
  const service = {
    section(s: PromptSection) { sections.set(s.name, s); return () => sections.delete(s.name); },
    context(c: PromptContext) { return () => { void c; }; },
  } satisfies Pick<SystemPrompt, 'section' | 'context'>;
  const ctx = { get: (n: string) => n === 'systemPrompt' ? service : undefined } as unknown as Context;
  const renderSections = (c: AssembleContext = {}): string => [...sections.values()]
    .sort((a, b) => a.order - b.order)
    .map((s) => typeof s.text === 'function' ? s.text(c) : s.text)
    .filter((t) => t.length > 0)
    .join('\n\n');
  return { ctx, sections, renderSections };
}

function entry(o: Partial<QQPromptEntry> = {}): QQPromptEntry {
  return { scope: 'group', personaCard: () => '', extraPrompts: () => ({}), ...o };
}

describe('question-style section 文本', () => {
  it('要求需要选择时走 ask_user_question，而非编号纯文本', () => {
    expect(QUESTION_STYLE_SECTION_TEXT).toContain('ask_user_question');
    // 明确反对编号纯文本列选项（快捷按钮只是兜底，不是目标形态）
    expect(QUESTION_STYLE_SECTION_TEXT).toContain('编号');
    // multi_select 克制使用（多选在 QQ 端没有按钮，只能手输编号）
    expect(QUESTION_STYLE_SECTION_TEXT).toContain('multi_select');
    // QQ 不渲染 Markdown 表格
    expect(QUESTION_STYLE_SECTION_TEXT).toContain('表格');
  });

  it('保持稳定的 section 名与尾部 order（rules 400 / persona 440 / extra 460 之后）', () => {
    expect(QUESTION_STYLE_SECTION_NAME).toBe('qqbot:question-style');
    expect(QUESTION_STYLE_ORDER).toBe(900);
  });

  it('开关语义：未配置视为开启，显式 false 才关闭', () => {
    expect(selectQuestionStyleText(undefined)).toBe(QUESTION_STYLE_SECTION_TEXT);
    expect(selectQuestionStyleText(true)).toBe(QUESTION_STYLE_SECTION_TEXT);
    expect(selectQuestionStyleText(false)).toBe('');
  });
});

describe('question-style 注入点（installQQPrompt → systemPrompt.section）', () => {
  it('开启时 section 文本出现在组装结果里', () => {
    const sp = fakeSystemPrompt();
    installQQPrompt(sp.ctx, entry({ questionStyleEnabled: () => true }));
    expect(sp.sections.get(QUESTION_STYLE_SECTION_NAME)?.order).toBe(QUESTION_STYLE_ORDER);
    const rendered = sp.renderSections();
    expect(rendered).toContain('QQ 通道提问规范');
    expect(rendered).toContain('ask_user_question');
  });

  it('entry 未提供开关时默认注入', () => {
    const sp = fakeSystemPrompt();
    installQQPrompt(sp.ctx, entry());
    expect(sp.renderSections()).toContain('ask_user_question');
  });

  it('关闭时不注入（渲染结果里没有规约文本）', () => {
    const sp = fakeSystemPrompt();
    installQQPrompt(sp.ctx, entry({ questionStyleEnabled: () => false }));
    const rendered = sp.renderSections();
    expect(rendered).not.toContain('QQ 通道提问规范');
    expect(rendered).not.toContain('ask_user_question');
    // 同一 agent 上的其它 section 不受影响
    expect(rendered).toContain('QQ');
  });

  it('开关每步现读：改开关即时生效，无需重装', () => {
    const sp = fakeSystemPrompt();
    let on = true;
    installQQPrompt(sp.ctx, entry({ questionStyleEnabled: () => on }));
    expect(sp.renderSections()).toContain('ask_user_question');
    on = false;
    expect(sp.renderSections()).not.toContain('ask_user_question');
    on = true;
    expect(sp.renderSections()).toContain('ask_user_question');
  });

  it.each(['group', 'c2c'] as const)('群聊/私聊两种 QQ scope 都注入（非 QQ 通道不装本 prompt）', scope => {
    const sp = fakeSystemPrompt();
    installQQPrompt(sp.ctx, entry({ scope }));
    expect(sp.renderSections()).toContain('ask_user_question');
  });

  it('dispose 后不再注入', () => {
    const sp = fakeSystemPrompt();
    const handle = installQQPrompt(sp.ctx, entry());
    expect(sp.renderSections()).toContain('ask_user_question');
    handle.dispose();
    expect(sp.renderSections()).toBe('');
  });
});