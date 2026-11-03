export const TOOL_AVAILABILITY_SECTION_NAME = 'qqbot:tool-availability';
export const TOOL_AVAILABILITY_ORDER = 410;

/** Render only names admitted for this step, with stable order across assemblies. */
export function toolAvailabilityText(names: readonly string[]): string {
  const tools = [...names].sort().join('、') || '无';
  return `当前可用工具（完整清单）：${tools}。\n工具权限会动态更新，请以本次请求的工具清单为准。历史回答中“没有工具”的判断不代表当前能力。`;
}
