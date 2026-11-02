export const UNEXECUTED_TOOL_REQUEST_NOTICE = '模型返回了未执行的工具请求，无法据此提供结果。请检查此会话的工具设置后重试。';
const markers = ['<｜｜DSML｜｜', '<｜DSML｜', '<||DSML||', '<|DSML|'];
const commands = ['calls', 'function_calls', 'tool_calls', 'invoke', 'parameter'];
const callSyntax = new RegExp(String.raw `<(?:｜｜DSML｜｜|｜DSML｜|\|\|DSML\|\||\|DSML\|)\s*(?:${commands.join('|')})(?=[\s>]|$)`, 'u');
/** Keep Markdown examples intact; only exposed control syntax is a failed model reply. */
function outsideCode(text, complete) {
    const masked = text.split('');
    const hide = (start, end) => { masked.fill(' ', start, end); };
    let fence;
    let position = 0;
    while (position < text.length) {
        if (position === 0 || text[position - 1] === '\n') {
            const newline = text.indexOf('\n', position);
            const end = newline < 0 ? text.length : newline + 1;
            const line = text.slice(position, end).trimEnd();
            const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
            if (fence) {
                if (delimiter && delimiter[1]?.[0] === fence.character && delimiter[1].length >= fence.size && !delimiter[2]?.trim())
                    fence = undefined;
                hide(position, end);
                position = end;
                continue;
            }
            if (delimiter?.[1]) {
                fence = { character: delimiter[1].startsWith('`') ? '`' : '~', size: delimiter[1].length };
                hide(position, end);
                position = end;
                continue;
            }
            if (/^(?: {4}|\t| {0,3}>)/.test(line)) {
                hide(position, end);
                position = end;
                continue;
            }
        }
        if (text[position] === '\\' && /[\\`<]/.test(text[position + 1] ?? '')) {
            hide(position, position + 2);
            position += 2;
            continue;
        }
        if (text[position] === '`') {
            const run = /^`+/.exec(text.slice(position))?.[0] ?? '`';
            let closing = text.indexOf('`', position + run.length);
            while (closing >= 0) {
                const size = /^`+/.exec(text.slice(closing))?.[0].length ?? 1;
                if (size === run.length)
                    break;
                closing = text.indexOf('`', closing + size);
            }
            if (closing >= 0) {
                const end = closing + run.length;
                hide(position, end);
                position = end;
                continue;
            }
            // An unfinished inline example is held until its closing delimiter arrives.
            if (!complete) {
                hide(position, text.length);
                return { exposed: masked.join(''), end: position };
            }
            position += run.length;
            continue;
        }
        position++;
    }
    return { exposed: masked.join(''), end: text.length };
}
/** Model text only: never interprets or executes protocol text as a tool call. */
export function modelReplyText(text, complete = true) {
    const { exposed, end } = outsideCode(text, complete);
    if (callSyntax.test(exposed))
        return UNEXECUTED_TOOL_REQUEST_NOTICE;
    const start = exposed.lastIndexOf('<');
    if (start >= 0) {
        const tail = exposed.slice(start);
        const pending = markers.some(marker => marker.startsWith(tail)
            || (tail.startsWith(marker) && commands.some(command => command.startsWith(tail.slice(marker.length).trimStart()))));
        if (pending) {
            if (!complete)
                return text.slice(0, Math.min(start, end));
            if (tail.includes('DSML'))
                return UNEXECUTED_TOOL_REQUEST_NOTICE;
        }
    }
    return text.slice(0, end);
}
//# sourceMappingURL=model-reply.js.map