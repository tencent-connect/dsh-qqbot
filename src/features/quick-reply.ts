/**
 * 快捷回复检测 — 识别助手消息尾部的"编号选项块"
 *
 * 背景：提问规约（system prompt section）不能 100% 约束模型——被中断后
 * 继续推进、或模型自行决定时，仍会把选项打成「1. xxx 2. yyy」纯文本。
 * 出站层对这类消息自动补挂可点击按钮（见 QuestionChannel.prepareQuickReply），
 * 点击等同用户回复对应编号，形成确定性兜底。
 *
 * 检测是启发式的，宁可漏报不可误报：
 *   - 只认消息**尾部**的连续编号块（2–6 项、编号 1..n 连续、单项 ≤ 80 字）；
 *   - 编号块后最多允许 2 行短收尾（如「回 1 / 2 / 3 即可。」）；
 *   - 全部条目以 ✅/✔/完成 结尾 → 判定为总结清单，不是提问；
 *   - 需要"提问信号"：块前 3 行内出现 ？/?/哪个/哪一/选/确认/告诉我/回复，
 *     或收尾行出现 回/选/回复/输入。
 */

/** 快捷按钮数量上限（QQ 键盘行数限制 + 体验考虑） */
export const MAX_QUICK_OPTIONS = 6;
/** 低于 2 项没有"选择"语义 */
export const MIN_QUICK_OPTIONS = 2;
/** 单项长度上限（超长多为正文段落，不是选项） */
export const ITEM_MAX_LEN = 80;
/** 编号块后允许的短收尾行数（如「回 1 / 2 / 3 即可。」） */
const MAX_CLOSER_LINES = 2;
/** 收尾行长度上限 */
const CLOSER_MAX_LEN = 30;

/** 去掉行内 markdown（加粗/斜体/行内代码/链接），用于按钮与注入文本 */
export function stripInlineMarkdown(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '');
}

const NUMBERED_LINE = /^(\d+)[.、)）]\s*(.+)$/;
const SUMMARY_ITEM = /[✅☑✔]\s*$|完成\s*$/;
const ASK_BEFORE = /[?？]|哪[个一]|选|确认|告诉我|回复/;
const ASK_AFTER = /回|选|回复|输入/;

/**
 * 检测文本尾部的编号选项块。
 * @returns 选项标签数组（已去行内 markdown），不构成选项时返回 undefined
 */
export function detectTrailingOptions(text: string): string[] | undefined {
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  // 1) 从末尾跳过空行与至多 2 行短收尾（非编号行）
  let end = lines.length;
  let closers = 0;
  while (end > 0 && closers <= MAX_CLOSER_LINES) {
    const t = (lines[end - 1] ?? '').trim();
    if (t === '') {
      end -= 1;
      continue;
    }
    if (t.length <= CLOSER_MAX_LEN && !NUMBERED_LINE.test(t)) {
      end -= 1;
      closers += 1;
      continue;
    }
    break;
  }
  if (closers > MAX_CLOSER_LINES) return undefined;

  // 2) 向上收集连续的编号行，随后校验编号为 1..k 顺序（从尾部扫描先见到最大编号）
  const items: { num: number; label: string }[] = [];
  let i = end;
  while (i > 0 && items.length < MAX_QUICK_OPTIONS) {
    const t = (lines[i - 1] ?? '').trim();
    const m = t.match(NUMBERED_LINE);
    if (!m) break;
    const label = stripInlineMarkdown(m[2] ?? '').trim();
    if (label.length === 0 || label.length > ITEM_MAX_LEN) break;
    items.unshift({ num: parseInt(m[1] ?? '', 10), label });
    i -= 1;
  }
  if (items.length < MIN_QUICK_OPTIONS) return undefined;
  for (let k = 0; k < items.length; k += 1) {
    if (items[k]?.num !== k + 1) return undefined; // 编号必须 1..k 连续
  }
  const labels = items.map((it) => it.label);

  // 3) 全部条目带完成标记 → 总结清单，不是提问
  if (labels.every((s) => SUMMARY_ITEM.test(s))) return undefined;

  // 4) 提问信号：块前 3 行或收尾行
  const before = lines.slice(Math.max(0, i - 3), i).map((l) => l.trim()).join(' ');
  const after = lines.slice(end).map((l) => l.trim()).join(' ');
  if (!ASK_BEFORE.test(before) && !ASK_AFTER.test(after)) return undefined;

  return labels;
}
