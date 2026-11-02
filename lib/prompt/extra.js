/**
 * 补充提示词（按场景分离）：promptGroup / promptDirect。由调用方每步现读 settings，即时生效。
 */
export const EXTRA_SECTION_NAME = 'qqbot:extra';
export const EXTRA_ORDER = 460;
export const EXTRA_MAX_CHARS = 20000;
/** 取当次场景的补充提示词；先按场景筛选再截断，避免另一场景内容占预算。 */
export function selectExtraPrompt(prompts, scope) {
    const raw = (scope === 'group' ? prompts.group : prompts.direct) ?? '';
    const text = raw.trim();
    return text.length > EXTRA_MAX_CHARS ? text.slice(0, EXTRA_MAX_CHARS) : text;
}
//# sourceMappingURL=extra.js.map