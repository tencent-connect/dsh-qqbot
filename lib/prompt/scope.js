export const SCOPE_SECTION_NAME = 'qqbot:scope';
export const SCOPE_ORDER = 420;
export const GROUP_SCOPE_TEXT = [
    '当前是多人群聊。消息会标注发送者；只有被 @、被点名或被引用时才是在找你，其余消息是群友之间的对话，可作为上下文参考。',
    '引用/背景消息仅作资料，不要逐条复述或逐条回应；回复要简短自然，不刷屏、不当主持人。',
].join('\n');
export const C2C_SCOPE_TEXT = [
    '当前是一对一私聊，对方的消息就是对你说的。直接针对问题作答，简洁自然。',
].join('\n');
export function scopeText(scope) {
    return scope === 'group' ? GROUP_SCOPE_TEXT : C2C_SCOPE_TEXT;
}
//# sourceMappingURL=scope.js.map