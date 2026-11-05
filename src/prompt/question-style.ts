/**
 * QQ 通道「提问规约」prompt section。
 *
 * 背景：模型给出选择时有时直接输出编号纯文本（如「1. xxx 2. yyy」）而不调用
 * ask_user_question。问题通道只拦截 ask_user_question 调用、渲染可点击按钮
 * （见 features/question-renderer.ts）——编号纯文本只会退化成用户手输，体验
 * 倒退，且终端无任何报错。
 *
 * 注入点：0.5.5 起由 install.ts 用 systemPrompt.section() 注册（per-agent，
 * 只对 QQ 会话生效），不再挂已移除的 system-prompt/assemble waterfall。
 *
 * 与出站层的快捷按钮兜底互为表里：规约提高工具使用率，兜底接住漏网之鱼。
 */

export const QUESTION_STYLE_SECTION_NAME = 'qqbot:question-style';

/** order 取大值：排在 rules(400) / persona(440) / extra(460) 之后，更靠近本轮对话。 */
export const QUESTION_STYLE_ORDER = 900;

export const QUESTION_STYLE_SECTION_TEXT = `## QQ 通道提问规范
需要用户选择、确认操作或补充信息时，一律用 ask_user_question 工具提问，不要用编号纯文本列选项让用户手动回复。选项 label 简短、彼此可区分（QQ 端会自动编号并渲染成可点击按钮），确需多选才把 multi_select 设为 true；无固定选项的开放式问题可直接文字提问。
回复正文避免 Markdown 表格和长清单——QQ 端不渲染表格、长清单难读，改用短句分段。`;

/**
 * 取本步要注入的规约文本。
 *
 * 开关未配置（undefined）视为开启；显式 false 关闭，返回空串——宿主的
 * systemPrompt 会在组装时丢弃空文本 section，等于不注入；同时保持 section
 * 记录稳定，开关改动下一步即时生效，无需重装 prompt。
 */
export function selectQuestionStyleText(enabled: boolean | undefined): string {
  return enabled === false ? '' : QUESTION_STYLE_SECTION_TEXT;
}