/**
 * 工具调用结果 → Markdown 格式化
 *
 * 适配 QQ 消息通道：优先用工具自定义的 presentResult 视图，
 * fallback 到 raw text。错误始终展示，成功结果按 config 开关。
 */

/** dsh-tools 主机平面注册表（presentResult 能力） */
export interface ToolsRegistryLike {
  get(name: string, scope?: unknown): {
    presentResult?(args: unknown, result: unknown): unknown;
  } | undefined;
}

/** 工具结果事件数据（tool/result） */
export interface ToolResultData {
  message: {
    content: Array<{ type: string; content?: unknown; isError?: boolean }>;
    source: { callId: string };
  };
  error?: { name: string; code: string };
  meta?: unknown;
}

/** 工具结果结构化视图（dsh-tools ToolResultView 的结构化子集） */
type ToolResultView =
  | { card: 'generic'; title?: string; content?: ReadonlyArray<{ type: string; text?: string }> }
  | { card: 'terminal'; title?: string; output?: string; exitCode?: number }
  | { card: 'diff'; title?: string; diffs: ReadonlyArray<unknown> }
  | { card: 'read'; title?: string; path?: string; content?: ReadonlyArray<{ type: string; text?: string }> };

const RESULT_PREVIEW_LIMIT = 1500;

/**
 * 将工具调用结果格式化为 Markdown 文本
 *
 * 返回 null 表示无需发送（无内容）。
 */
export function formatToolResult(
  name: string,
  rawArgs: string,
  data: ToolResultData,
  toolsRegistry: ToolsRegistryLike | undefined,
  agent: unknown,
): string | null {
  // 1. 错误优先：始终展示
  if (data.error) {
    return `❌ 工具 \`${name}\` 执行失败\n\`${data.error.name}: ${data.error.code}\``;
  }

  // 2. 尝试工具自定义视图（presentResult）
  const view = presentResultView(name, rawArgs, data, toolsRegistry, agent);
  if (view) {
    const rendered = renderView(name, view);
    if (rendered) return rendered;
  }

  // 3. fallback raw text
  const block = data.message.content[0];
  const result = block !== undefined && block.type === 'tool-result' ? textOf(block.content) : '';
  if (!result) return null;

  return `🔧 \`${name}\` 完成\n${truncate(result)}`;
}

/** 调用工具自定义 presentResult，失败/不可用时返回 undefined */
function presentResultView(
  name: string,
  rawArgs: string,
  data: ToolResultData,
  toolsRegistry: ToolsRegistryLike | undefined,
  agent: unknown,
): ToolResultView | undefined {
  if (!toolsRegistry) return undefined;

  try {
    const tool = toolsRegistry.get(name, agent);
    if (tool?.presentResult === undefined) return undefined;

    const block = data.message.content[0];
    const content = block !== undefined && block.type === 'tool-result' ? block.content : [];
    return tool.presentResult(JSON.parse(rawArgs), {
      content,
      isError: block?.isError === true,
      ...(data.meta !== undefined ? { meta: data.meta } : {}),
    }) as ToolResultView | undefined;
  } catch {
    return undefined;
  }
}

/** 将结构化视图渲染为 Markdown */
function renderView(name: string, view: ToolResultView): string | null {
  const header = `🔧 \`${name}\` 完成`;

  switch (view.card) {
    case 'terminal': {
      const output = (view.output ?? '').trimEnd();
      if (!output) return null;
      const exit = view.exitCode !== undefined && view.exitCode !== 0 ? `\n退出码 ${view.exitCode}` : '';
      return `${header}\n\`\`\`\n${output}\n\`\`\`${exit}`;
    }
    case 'diff': {
      return `${header}\n\`\`\`diff\n${truncate(renderDiffs(view.diffs))}\n\`\`\``;
    }
    case 'read': {
      const content = view.content ? textOf(view.content) : '';
      if (!content) return null;
      const path = view.path ? ` (${view.path})` : '';
      return `${header}${path}\n\`\`\`\n${truncate(content)}\n\`\`\``;
    }
    case 'generic':
    default: {
      const content = view.content ? textOf(view.content) : '';
      if (!content) return null;
      return `${header}\n${truncate(content)}`;
    }
  }
}

/** 提取 content blocks 中的纯文本 */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => {
      if (typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text') {
        return (b as { text?: string }).text ?? '';
      }
      return '';
    })
    .filter(Boolean)
    .join('');
}

/** 渲染 diff hunks 为纯文本 */
function renderDiffs(diffs: ReadonlyArray<unknown>): string {
  return diffs
    .map((d) => {
      if (typeof d === 'object' && d !== null) {
        const { path, hunks } = d as { path?: string; hunks?: ReadonlyArray<{ text?: string }> };
        const body = (hunks ?? []).map((h) => h.text ?? '').join('\n');
        return path ? `--- ${path} ---\n${body}` : body;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/** 截断长文本，避免刷屏 */
function truncate(text: string): string {
  if (text.length <= RESULT_PREVIEW_LIMIT) return text;
  return `${text.slice(0, RESULT_PREVIEW_LIMIT)}\n…（已截断）`;
}
