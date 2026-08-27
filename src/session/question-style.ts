/**
 * QQ 通道提问规约 prompt section
 *
 * 背景：模型在给出选择时，有时直接输出编号文本（如「1. xxx 2. yyy」）
 * 而不调用 ask_user_question。QQ 问题通道只拦截 ask_user_question 调用
 * 渲染可点击按钮——编号纯文本只会让用户手动输入，体验倒退，且终端无任何报错。
 *
 * 本规约通过 system-prompt/assemble waterfall 注入（见 SessionManager
 * 的 registerScopePromptInjection，与群聊/私聊附加 prompt 同一订阅），
 * 明确要求模型：让读者做选择/确认/补信息时必须走 ask_user_question 工具。
 *
 * 与出站层的快捷按钮兜底（features/quick-reply.ts）互为表里：
 * 规约提高工具使用率，快捷按钮兜住漏网之鱼。
 */

export const QUESTION_STYLE_SECTION_NAME = 'qqbot:question-style';

export const QUESTION_STYLE_SECTION_TEXT = `## QQ 通道提问规范
需要用户选择、确认操作或补充信息时，一律用 ask_user_question 工具提问（选项 label 简洁；确需多选才设 multi_select 为 true），不要用编号纯文本列选项让用户手动回复。无固定选项的开放式问题可直接文字提问。`;
