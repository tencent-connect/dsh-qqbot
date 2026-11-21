/**
 * 工具调用结果 → Markdown 格式化
 *
 * 适配 QQ 消息通道：优先用工具自定义的 presentResult 视图，
 * fallback 到结果文本。错误始终展示，成功结果按 config 开关。
 *
 * 数据形态对齐 dsh 的 tool/result 事件（SessionEventMap['tool/result']）：
 * message 是 ToolResultMessage，content 直接是 ContentBlock[]（如 { type: 'text', text }），
 * 失败标记在 message.isError，工具私有呈现元数据在 data.meta。
 */
/** 结果预览上限，避免单条消息刷屏 */
const RESULT_PREVIEW_LIMIT = 1500;
/**
 * 将工具调用结果格式化为 Markdown 文本
 *
 * 返回 null 表示无需发送（无内容）。
 */
export function formatToolResult(name, rawArgs, data, toolsRegistry, agent) {
    const content = contentBlocks(data);
    const isError = data.message?.isError === true || data.error !== undefined;
    // 1. 错误优先：始终展示
    if (isError) {
        const detail = data.error === undefined
            ? truncate(textOf(content)).trim()
            : errorLine(data.error);
        return detail
            ? `❌ 工具 \`${name}\` 执行失败\n${detail}`
            : `❌ 工具 \`${name}\` 执行失败`;
    }
    // 2. 尝试工具自定义视图（presentResult）
    const view = presentResultView(name, rawArgs, content, data.meta, toolsRegistry, agent);
    if (view !== undefined) {
        const rendered = renderView(name, view);
        if (rendered !== null)
            return rendered;
    }
    // 3. fallback 结果文本
    const result = textOf(content);
    if (!result.trim())
        return null;
    return `🔧 \`${name}\` 完成\n${truncate(result)}`;
}
/** 读取结果内容块（缺字段时按空处理，不让展示影响主流程） */
function contentBlocks(data) {
    const content = data.message?.content;
    return Array.isArray(content) ? content : [];
}
/** 错误标识行：`name: code` + 面向用户的原因 */
function errorLine(error) {
    const head = `\`${error.name}: ${error.code}\``;
    return error.reason ? `${head}\n${error.reason}` : head;
}
/** 调用工具自定义 presentResult，失败/不可用时返回 undefined */
function presentResultView(name, rawArgs, content, meta, toolsRegistry, agent) {
    if (!toolsRegistry)
        return undefined;
    try {
        const tool = toolsRegistry.get(name, agent);
        if (tool?.presentResult === undefined)
            return undefined;
        return tool.presentResult(JSON.parse(rawArgs), {
            content,
            isError: false,
            ...(meta !== undefined ? { meta } : {}),
        });
    }
    catch {
        return undefined;
    }
}
/** 将结构化视图渲染为 Markdown */
function renderView(name, view) {
    const header = `🔧 \`${name}\` 完成`;
    switch (view.card) {
        case 'terminal': {
            const output = (view.output ?? '').trimEnd();
            if (!output)
                return null;
            const exit = view.exitCode !== undefined && view.exitCode !== 0 ? `\n退出码 ${view.exitCode}` : '';
            return `${header}\n\`\`\`\n${truncate(output)}\n\`\`\`${exit}`;
        }
        case 'diff': {
            return `${header}\n\`\`\`diff\n${truncate(renderDiffs(view.diffs))}\n\`\`\``;
        }
        case 'read': {
            const body = view.lines !== undefined && view.lines.length > 0
                ? renderLines(view.lines)
                : textOf(view.content ?? []);
            if (!body.trim())
                return null;
            const path = view.path ? ` (${view.path})` : '';
            return `${header}${path}\n\`\`\`\n${truncate(body)}\n\`\`\``;
        }
        case 'generic':
        default: {
            const content = textOf(view.content ?? []);
            if (!content.trim())
                return null;
            return `${header}\n${truncate(content)}`;
        }
    }
}
/** 提取 content blocks 中的纯文本 */
function textOf(content) {
    return content
        .filter((b) => b !== null && typeof b === 'object' && b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
}
/** 渲染 read 视图的行号正文 */
function renderLines(lines) {
    return lines.map((line) => `${line.number}\t${line.text}`).join('\n');
}
/** 渲染 diff hunks 为纯文本 */
function renderDiffs(diffs) {
    return diffs
        .map((d) => {
        if (typeof d === 'object' && d !== null) {
            const { path, hunks } = d;
            const body = (hunks ?? []).map((h) => h.text ?? '').join('\n');
            return path ? `--- ${path} ---\n${body}` : body;
        }
        return '';
    })
        .filter(Boolean)
        .join('\n');
}
/** 截断长文本，避免刷屏 */
function truncate(text) {
    if (text.length <= RESULT_PREVIEW_LIMIT)
        return text;
    return `${text.slice(0, RESULT_PREVIEW_LIMIT)}\n…（已截断）`;
}
//# sourceMappingURL=tool-presenter.js.map