/** QQ 按钮 label 有长度限制，超长截断（正文保留完整文本；多列布局下阈值更短） */
export const BUTTON_LABEL_MAX = 10;
/** 单选按钮每行个数（多列布局，减少选项多时的刷屏） */
export const BUTTONS_PER_ROW = 2;
/** 截断按钮 label，超长补省略号 */
export function buttonLabel(text) {
    const s = String(text ?? '').trim();
    return s.length > BUTTON_LABEL_MAX ? s.slice(0, BUTTON_LABEL_MAX - 1) + '…' : s;
}
/** 编码 button_data（JSON 字符串） */
export function encodeButtonData(data) {
    return JSON.stringify(data);
}
/** 解码 button_data；非法 JSON 或缺少合法 `t` 时返回 undefined */
export function decodeButtonData(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (parsed !== null && typeof parsed === 'object' && (parsed.t === 'question' || parsed.t === 'approval' || parsed.t === 'claim')) {
            return parsed;
        }
    }
    catch {
        // fall through
    }
    return undefined;
}
//# sourceMappingURL=button-utils.js.map