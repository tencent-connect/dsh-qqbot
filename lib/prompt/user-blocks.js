/** 生成 user 消息的分段文本块；空正文省略。 */
export function assembleUserBlocks(input) {
    return input.body ? [input.body] : [];
}
//# sourceMappingURL=user-blocks.js.map