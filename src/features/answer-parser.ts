/**
 * QQ 文本回复 → 结构化答案（纯函数，便于单测）。
 *
 * 逐题解析：一次解析一个问题的答案。
 */
import type { UserQuestion, UserQuestionAnswer } from './question-channel.ts';

/** 把用户对单个问题的文本回复解析为答案 */
export function parseAnswer(question: UserQuestion, text: string): UserQuestionAnswer {
  const opts = question.options ?? [];
  if (opts.length > 0) {
    // 纯数字/分隔符 → 按编号选择
    if (/^[\d\s,，、;；./]+$/.test(text)) {
      const nums = [...text.matchAll(/\d+/g)]
        .map((m) => parseInt(m[0], 10))
        .filter((n) => n >= 1 && n <= opts.length);
      if (nums.length > 0) {
        const picked = question.multiSelect ? nums : nums.slice(0, 1);
        const selected = [...new Set(picked.map((n) => opts[n - 1]?.label).filter((l): l is string => typeof l === 'string'))];
        return { id: question.id, selected };
      }
    }
    // 文本与某个选项 label 完全一致（忽略大小写）
    const exact = opts.find((o) => o.label.toLowerCase() === text.toLowerCase());
    if (exact) return { id: question.id, selected: [exact.label] };
  }
  return { id: question.id, selected: [], custom: text };
}
