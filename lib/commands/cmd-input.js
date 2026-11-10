/**
 * QQ markdown 参数指令标签渲染。
 *
 * 官方约束：text/show 均须 urlencode，且最多 100 字符。文档未明确长度
 * 按原始值还是编码后计算，因此这里按更严格的【编码后 <=100】处理。
 * SDK 原样透传 markdown，不负责标签编码，因此必须在插件侧收口。
 */
const QQ_CMD_VALUE_LIMIT = 100;
function escapeHtml(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}
/** 按编码后字节长度截断（Unicode 码点完整，始终保留省略号） */
function encodeWithinLimit(value) {
    const encoded = encodeURIComponent(value);
    if (encoded.length <= QQ_CMD_VALUE_LIMIT)
        return encoded;
    let prefix = '';
    for (const char of Array.from(value)) {
        if (encodeURIComponent(prefix + char + '…').length > QQ_CMD_VALUE_LIMIT)
            break;
        prefix += char;
    }
    return encodeURIComponent(prefix + '…');
}
/**
 * 渲染 <qqbot-cmd-input>。text 编码后超限时退化为转义纯文本；
 * show 编码后超限截断。编码同时完成属性所需的引号/&/空格转义。
 */
export function renderCmdInput(text, show) {
    if (encodeURIComponent(text).length > QQ_CMD_VALUE_LIMIT)
        return escapeHtml(show);
    return '<qqbot-cmd-input text="' + encodeURIComponent(text) + '" show="' + encodeWithinLimit(show) + '" reference="false"/>';
}
/**
 * 渲染 <qqbot-cmd-enter>：点击后直接发送 text（无需用户回车）。
 * 官方约束：仅 text 属性（无 show）、编码后 <=100 字符；**群聊与文字子频道不支持**，
 * 调用方须仅在该能力可用的场景（私聊）使用。超限时退化为转义纯文本。
 */
export function renderCmdEnter(text) {
    const encoded = encodeURIComponent(text);
    if (encoded.length > QQ_CMD_VALUE_LIMIT)
        return escapeHtml(text);
    return '<qqbot-cmd-enter text="' + encoded + '"/>';
}
//# sourceMappingURL=cmd-input.js.map