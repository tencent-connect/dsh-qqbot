export const EXTRA_SECTION_NAME = 'qqbot:extra';
export const EXTRA_ORDER = 460;
export const EXTRA_MAX_CHARS = 80_000;
export function selectExtraPrompt(prompts, scope) {
    const raw = (scope === 'group' ? prompts.group : prompts.direct) ?? '';
    return typeof raw === 'string' ? raw.trim() : raw;
}
//# sourceMappingURL=extra.js.map