/**
 * 群聊工具收敛（groupToolAllow）
 *
 * 群会话是整群共享的一条会话记录（sessionKey 只含 group_openid），群里任何人都能
 * 驱动同一个 agent。沿用默认工具集等于把 bash / 文件读写 / MCP 这些能力交给群里
 * 每一位成员，而工具调用发生在服务端，群成员看不到也不需要理解审批卡片。
 *
 * `access.groupMode` 控制的是「哪个群能对话」，管不到「这个群能用什么」。这里补上
 * 后者：`groupToolAllow` 非空时，群会话的工具可见范围收窄到名单内（fail-closed，
 * 名单外的工具对该会话不可见）。
 *
 * 用 `ctx.tools.restrict()` 而不是在 system-prompt/assemble 里裁剪 tool schema：
 * restrict 作用在该 agent scope 上，一次设置对后续每一轮都生效，不依赖 assemble
 * 的调用时机或插件注册顺序。
 */
import type { ChatScope } from '../types.ts';
import type { ToolScopeLike } from './types.ts';

/**
 * 计算本次要应用的白名单。
 *
 * - 非群聊：返回 undefined（私聊不受影响）
 * - 名单为空或全是空白：返回 undefined（保持原行为，向后兼容）
 * - 否则返回去重、去空白后的名单
 */
export function resolveGroupToolAllow(
  scope: ChatScope,
  allow: readonly string[] | undefined,
): readonly string[] | undefined {
  if (scope !== 'group') return undefined;
  const cleaned = [...new Set((allow ?? []).map((name) => name.trim()).filter((name) => name.length > 0))];
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * 把名单应用到某个 agent scope，返回是否真的应用成功。
 *
 * `ctx.tools` 是宿主可选提供的服务（未挂载时按不启用处理，只告警不中断会话）：
 * 工具收敛是加固手段，不该因为宿主版本差异把机器人打死。
 */
export function applyGroupToolAllow(
  scopedCtx: { readonly tools?: ToolScopeLike } | undefined,
  allow: readonly string[],
  onWarn: (message: string) => void,
): boolean {
  const tools = scopedCtx?.tools;
  if (!tools) {
    onWarn('群聊工具白名单未生效：宿主未提供 ctx.tools');
    return false;
  }
  try {
    tools.restrict({ allow });
    return true;
  } catch (err) {
    onWarn(`群聊工具白名单应用失败: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
