import type { ToolCatalogEntry } from '../shared/conversation-protocol.ts';

export interface ToolDefinitionLike { readonly name: string; readonly description?: string }
export interface ToolCatalogSource { definitions(scope?: unknown): readonly ToolDefinitionLike[] }
export interface McpToolIdentity { server: string; tool: string }

/** An exact registered name is opaque; MCP identity is never recovered by parsing it. */
export function stableToolId(name: string, identities?: ReadonlyMap<string, McpToolIdentity>): string {
  const identity = identities?.get(name);
  return identity ? `mcp:${JSON.stringify([identity.server, identity.tool])}` : name;
}

export function toolCatalogEntry(definition: ToolDefinitionLike, identity?: McpToolIdentity): ToolCatalogEntry {
  const name = definition.name;
  const base = { id: identity ? `mcp:${JSON.stringify([identity.server, identity.tool])}` : name, name, description: definition.description ?? '', available: true };
  if (name.startsWith('memory_')) return { ...base, available: false, category: 'other', constraint: 'unsupported', reason: '此工具已移除' };
  if (['subagent', 'subagent_fork', 'spawn_agent', 'delegate', 'create_agent'].includes(name)) return { ...base, available: false, category: 'other', constraint: 'unsupported', reason: '尚无法确认所有委派后端完整继承此对话权限，暂不开放' };
  if (identity || name.startsWith('mcp__')) return { ...base, category: 'mcp', constraint: 'unsupported', reason: '仅支持整个工具授权；不推断其参数或只读语义' };
  if (['read', 'read_image'].includes(name)) return { ...base, category: 'file', constraint: 'read-path' };
  if (['grep', 'glob'].includes(name)) return { ...base, category: 'search', constraint: 'read-path' };
  if (['write', 'edit'].includes(name)) return { ...base, category: 'file', constraint: 'write-path' };
  if (['bash', 'run_code', 'python', 'exec_command'].includes(name)) return { ...base, category: 'execution', constraint: 'execution' };
  if (['qqbot_send_file', 'present'].includes(name)) return { ...base, category: 'attachment', constraint: 'send-path' };
  if (name === 'qqbot_group_history') return { ...base, category: 'search', constraint: 'none' };
  if (['web_search', 'web_fetch', 'fetch', 'search'].includes(name)) return { ...base, category: 'network', constraint: 'unsupported', reason: '仅支持整个工具授权；尚无可靠的域名限制适配' };
  if (['ask_user_question', 'update_plan'].includes(name)) return { ...base, category: 'other', constraint: 'none' };
  return { ...base, category: 'other', constraint: 'unsupported', reason: '此工具没有资源范围适配，不能宣称受文件或网络范围限制' };
}

export function catalogTools(source: ToolCatalogSource, scope?: unknown, identities?: ReadonlyMap<string, McpToolIdentity>): ToolCatalogEntry[] {
  return source.definitions(scope).map(definition => toolCatalogEntry(definition, identities?.get(definition.name)));
}
