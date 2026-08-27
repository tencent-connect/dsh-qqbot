import { describe, it, expect } from 'vitest';
import { QUESTION_STYLE_SECTION_NAME, QUESTION_STYLE_SECTION_TEXT } from './question-style.ts';

describe('question-style section', () => {
  it('mandates ask_user_question for choices', () => {
    expect(QUESTION_STYLE_SECTION_TEXT).toContain('ask_user_question');
    // 明确反对编号纯文本列选项（快捷按钮只是兜底，不是目标形态）
    expect(QUESTION_STYLE_SECTION_TEXT).toContain('编号');
    // multi_select 克制使用（多选在 QQ 端无按钮，只能手输编号）
    expect(QUESTION_STYLE_SECTION_TEXT).toContain('multi_select');
  });

  it('has a stable section name for the assemble waterfall', () => {
    expect(QUESTION_STYLE_SECTION_NAME).toBe('qqbot:question-style');
  });
});
