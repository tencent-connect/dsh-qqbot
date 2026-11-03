/**
 * 补充提示词（按场景分离）：promptGroup / promptDirect。由调用方每步现读 settings，即时生效。
 */
export const EXTRA_SECTION_NAME = 'qqbot:extra';
export const EXTRA_ORDER = 460;
export const EXTRA_MAX_CHARS = 80_000;
/** 取当次场景的补充提示词；长度已在设置写入时校验，注入时保留完整内容。 */
export function selectExtraPrompt(prompts, scope) {
    const raw = (scope === 'group' ? prompts.group : prompts.direct) ?? '';
    return raw.trim();
}
//# sourceMappingURL=extra.js.map