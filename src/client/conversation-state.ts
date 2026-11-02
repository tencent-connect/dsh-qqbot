import { permissionSandbox } from '../shared/policy-settings.ts';
import type { ConversationPolicy, ConversationView, PolicyTemplate, ToolCatalogEntry } from '../shared/conversation-protocol.ts';

const RETIRED_TOOLS = new Set(['memory_search', 'memory_get', 'memory_write']);

export function conversationToolCatalog(catalog: readonly ToolCatalogEntry[]): ToolCatalogEntry[] {
  return catalog.filter((tool) => !RETIRED_TOOLS.has(tool.id));
}

export function conversationToolRules(tools: ConversationPolicy['tools']): ConversationPolicy['tools'] {
  return Object.fromEntries(Object.entries(tools).filter(([id]) => !RETIRED_TOOLS.has(id)));
}

export const TEMPLATE_LABELS: Record<PolicyTemplate, string> = {
  chat: '普通聊天', roleplay: '角色扮演', readonly: '资料只读', project: '项目协作', custom: '自定义',
};

export function conversationName(entry: Pick<ConversationView, 'alias' | 'name' | 'scope' | 'peerId'>): string {
  return entry.alias || entry.name || `${entry.scope === 'group' ? '群聊' : '私聊'} · ${entry.peerId.slice(-8)}`;
}

export function filterConversations(entries: readonly ConversationView[], scope: 'all' | 'group' | 'c2c', query: string): ConversationView[] {
  const term = query.trim().toLocaleLowerCase();
  return entries.filter((entry) => (scope === 'all' || entry.scope === scope)
    && (!term || `${entry.name} ${entry.alias} ${entry.peerId}`.toLocaleLowerCase().includes(term)))
    .sort((a, b) => b.lastActivity - a.lastActivity || a.key.localeCompare(b.key));
}

export function permissionSummary(policy: ConversationPolicy): string {
  if (policy.toolMode === 'native') return `${policy.name || TEMPLATE_LABELS[policy.template]} · 沿用 Agent 工作能力`;
  const values = Object.values(conversationToolRules(policy.tools));
  const enabled = values.filter((value) => value !== 'deny').length;
  const asks = values.filter((value) => value === 'ask').length;
  return `${policy.name || TEMPLATE_LABELS[policy.template]} · ${enabled === 0 ? '无工具' : `${enabled} 项工具`}${asks ? ` · ${asks} 项需审批` : ''}`;
}

/** Templates initialize an editable per-conversation snapshot; persona never grants tools. */
function templatePolicy(current: ConversationPolicy, template: PolicyTemplate, catalog: readonly ToolCatalogEntry[], permissionIds: readonly string[]): ConversationPolicy {
  const permission = template === 'project' ? 'workspace-write' : 'read-only';
  const next = structuredClone(current);
  next.template = template;
  next.toolMode = 'restricted';
  next.name = TEMPLATE_LABELS[template];
  next.resources.executionEnabled = false;
  next.resources.sandbox = template === 'project' ? 'workspace-write' : 'read-only';
  next.permission = permission;
  if (template !== 'project') next.resources.writeRoots = [];
  next.allowedPermissions = (template === 'project' ? ['read-only', 'workspace-write'] : ['read-only']).filter(id => permissionIds.includes(id));
  next.tools = Object.fromEntries(conversationToolCatalog(catalog).map((tool) => [tool.id,
    tool.available && current.resources.readRoots.length > 0 && (template === 'readonly' || template === 'project') && tool.constraint === 'read-path' ? 'allow'
      : tool.available && current.resources.writeRoots.length > 0 && template === 'project' && tool.constraint === 'write-path' ? 'ask' : 'deny']));
  return next;
}

/** Matches the Host's constraint admission; unsupported combinations cannot be granted in the menu. */
export function toolConstraintReason(tool: ToolCatalogEntry, policy: ConversationPolicy): string | null {
  if (!tool.available) return tool.reason ?? '当前宿主无法提供该能力';
  if (tool.constraint === 'send-path' || tool.id === 'qqbot_send_file') return '此版本未启用 QQ 文件发送工具';
  if (policy.toolMode === 'native') return null;
  if (policy.resources.networkDomains.length > 0 && (tool.category === 'network' || tool.category === 'mcp' || tool.constraint === 'execution')) return '该工具不支持可靠域名约束，请清除域名限制或保持禁止';
  if (policy.template === 'readonly' && tool.constraint !== 'read-path' && tool.constraint !== 'none') return '资料只读模板仅允许已适配的读取工具；其他能力请使用自定义配置';
  if (tool.constraint === 'read-path' && policy.resources.readRoots.length === 0) return '请先配置允许读取的目录';
  if (tool.constraint === 'write-path' && policy.permission !== 'workspace-write') return '写入需要此对话权限模式为工作区可写';
  if (tool.constraint === 'write-path' && policy.resources.writeRoots.length === 0) return '请先配置允许写入的目录';
  if (tool.constraint === 'execution' && !policy.resources.executionEnabled) return '请先单独开启命令／代码执行';
  return null;
}

/** Explicitly snapshot the currently available Agent tools; future tools remain ungranted. */
function nativePolicy(policy: ConversationPolicy, catalog: readonly ToolCatalogEntry[]): ConversationPolicy {
  const next = structuredClone(policy);
  next.toolMode = 'native';
  next.tools = conversationToolRules(next.tools);
  next.resources.executionEnabled = true;
  const separate = new Set(['qqbot_send_file', 'present']);
  for (const tool of conversationToolCatalog(catalog)) if (tool.available && !separate.has(tool.id) && next.tools[tool.id] === undefined) next.tools[tool.id] = 'allow';
  return next;
}

export type PolicyTransitionRequest =
  | { kind: 'template'; template: PolicyTemplate }
  | { kind: 'tool-mode'; mode: 'native' | 'restricted' }
  | { kind: 'permission'; permission: string };
export type PolicyTransitionResult = { kind: 'ready'; policy: ConversationPolicy } | { kind: 'blocked'; reason: string };

/** Every explicit authority transition produces a coherent draft or an actionable refusal. */
export function transitionPolicy({ current, change, catalog, permissionIds }: {
  current: ConversationPolicy; change: PolicyTransitionRequest; catalog: readonly ToolCatalogEntry[]; permissionIds: readonly string[];
}): PolicyTransitionResult {
  const permission = change.kind === 'template' ? (change.template === 'project' ? 'workspace-write' : 'read-only')
    : change.kind === 'permission' ? change.permission : current.permission;
  if (!permissionIds.includes(permission)) return { kind: 'blocked', reason: `宿主权限目录未提供 ${permission}；请重试读取目录或选择可用的默认权限。` };
  if (change.kind === 'permission') {
    if (!current.allowedPermissions.includes(permission)) return { kind: 'blocked', reason: '请先在允许列表中授权此权限模式。' };
    if (current.toolMode !== 'native' && current.template === 'readonly' && permission !== 'read-only') {
      return { kind: 'blocked', reason: '资料只读模板仅支持只读默认权限；请先显式选择自定义或项目协作模板。' };
    }
  }
  let next: ConversationPolicy;
  switch (change.kind) {
    case 'template': next = templatePolicy(current, change.template, catalog, permissionIds); break;
    case 'permission': next = structuredClone(current); next.permission = permission; break;
    case 'tool-mode':
      next = change.mode === 'native' ? nativePolicy(current, catalog) : structuredClone(current);
      if (change.mode === 'restricted') {
        next.toolMode = 'restricted'; next.resources.executionEnabled = false;
        next.tools = Object.fromEntries(Object.keys(conversationToolRules(next.tools)).map(id => [id, 'deny']));
      }
      break;
    default: { const exhaustive: never = change; return exhaustive; }
  }
  if (next.toolMode !== 'native') {
    if (next.template === 'readonly') {
      if (!permissionIds.includes('read-only')) return { kind: 'blocked', reason: '受限的资料只读模板需要宿主提供 read-only；请先选择自定义模板，或恢复宿主只读权限预设。' };
      next.permission = 'read-only'; next.allowedPermissions = ['read-only']; next.resources.executionEnabled = false;
    }
    // The restricted adapter admits writes only for the exact workspace-write contract.
    // Removing an inactive directory list is part of this explicit, previewed transition.
    if (next.permission !== 'workspace-write') next.resources.writeRoots = [];
  }
  const sandbox = permissionSandbox(next.permission);
  if (sandbox !== undefined) next.resources.sandbox = sandbox;
  const available = new Map(conversationToolCatalog(catalog).map(tool => [tool.id, tool]));
  for (const [id, decision] of Object.entries(next.tools)) {
    if (decision === 'deny') continue;
    const tool = available.get(id);
    if (tool === undefined || toolConstraintReason(tool, next) !== null) next.tools[id] = 'deny';
  }
  return { kind: 'ready', policy: next };
}

export function splitLines(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
}

/** Human-readable diff preview also covers removals; copying never writes immediately. */
export function policyChanges(previous: ConversationPolicy, next: ConversationPolicy, previousAlias: string, nextAlias: string): string[] {
  const rows: Array<[string, unknown, unknown]> = [
    ['备注', previousAlias, nextAlias], ['配置名称', previous.name, next.name], ['场景模板', previous.template, next.template],
    ['角色设定', previous.role, next.role], ['工具规则', conversationToolRules(previous.tools), conversationToolRules(next.tools)], ['资源范围', previous.resources, next.resources],
    ['Agent 工作能力', previous.toolMode ?? 'restricted', next.toolMode ?? 'restricted'],
    ['控制者', previous.controllers, next.controllers], ['审批者', previous.approvers, next.approvers],
    ['允许模型', previous.allowedModels, next.allowedModels], ['允许预设', previous.allowedPresets, next.allowedPresets],
    ['允许权限模式', previous.allowedPermissions, next.allowedPermissions], ['当前权限模式', previous.permission, next.permission],
    ['工作目录', previous.cwd, next.cwd], ['自动回复', previous.replyEnabled !== false, next.replyEnabled !== false], ['回复触发', previous.requireMention, next.requireMention], ['上下文规则', previous.context, next.context],
  ];
  return rows.filter(([, before, after]) => JSON.stringify(before) !== JSON.stringify(after)).map(([label]) => label);
}
