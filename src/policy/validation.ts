import { isAbsolute, resolve } from 'node:path';
import { CONTEXT_LIMITS, CONVERSATION_SANDBOX_MODES, permissionSandbox } from '../shared/policy-settings.ts';
import type { ConversationPolicy, PolicyTemplate, ToolCatalogEntry, ToolDecision } from '../shared/conversation-protocol.ts';

const TEMPLATES = ['chat', 'roleplay', 'readonly', 'project', 'custom'] as const;
const DECISIONS = ['deny', 'ask', 'allow'] as const;
const NAMES: Record<PolicyTemplate, string> = { chat: '普通聊天', roleplay: '角色扮演', readonly: '资料只读', project: '项目协作', custom: '自定义' };

/** Templates are initial policy data, never implicit grants to newly installed tools. */
export function defaultPolicy(template: PolicyTemplate = 'chat', cwd = ''): ConversationPolicy {
  return {
    version: 1, template, name: NAMES[template], receiveEnabled: true,
    role: { description: '', tone: '', world: '', prompt: '' }, tools: {},
    resources: { readRoots: [], writeRoots: [], sendRoots: [], executionEnabled: false, sandbox: 'read-only', networkDomains: [], maxFiles: 3, maxFileMB: 20 },
    controllers: [], approvers: [], allowedModels: [], allowedPresets: [],
    toolMode: template === 'chat' ? 'native' : 'restricted', nativeTools: template === 'chat', allowedPermissions: ['read-only'], permission: 'read-only', cwd, requireMention: true, replyEnabled: true,
    context: { mode: 'recent', maxMessages: 10, maxAgeMinutes: 10, maxChars: 4000, retentionDays: 7 },
  };
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${field} 必须是对象`);
  return Object.fromEntries(Object.entries(value));
}
function string(value: unknown, field: string, max = 20000): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new TypeError(`${field} 必须是有效字符串（最多 ${max} 字符）`);
  return value;
}
function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${field} 必须是布尔值`);
  return value;
}
function integer(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${field} 必须在 ${min} 到 ${max} 之间`);
  return value;
}
function choice<T extends string>(value: unknown, values: readonly T[], field: string): T {
  const found = values.find(item => item === value);
  if (found === undefined) throw new TypeError(`${field} 值无效`);
  return found;
}
function strings(value: unknown, field: string, max = 1000): string[] {
  if (!Array.isArray(value) || value.length > max) throw new TypeError(`${field} 必须是列表`);
  return [...new Set(value.map(item => string(item, field, 2048).trim()).filter(Boolean))];
}
function roots(value: unknown, field: string): string[] {
  return strings(value, field, 100).map(path => {
    if (!isAbsolute(path)) throw new TypeError(`${field} 必须使用绝对路径`);
    return resolve(path);
  });
}

/** Construct a validated detached policy at the persistence/HTTP boundary. */
export function validatePolicy(input: unknown): ConversationPolicy {
  const p = record(input, 'policy');
  const role = record(p.role, 'role');
  const resources = record(p.resources, 'resources');
  const context = record(p.context, 'context');
  const toolInput = record(p.tools, 'tools');
  if (Object.keys(toolInput).length > 2000) throw new TypeError('工具规则过多');
  // Retired built-in rules must not reactivate tools from a legacy catalog.
  const toolEntries: Array<[string, ToolDecision]> = Object.entries(toolInput).filter(([id]) => !id.startsWith('memory_')).map(([id, value]) => {
    string(id, 'tool id', 512);
    if (!id.trim() || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new TypeError('工具标识无效');
    return [id, choice(value, DECISIONS, 'tool decision')];
  });
  const cwd = string(p.cwd, 'cwd', 4096).trim();
  if (cwd && !isAbsolute(cwd)) throw new TypeError('工作目录必须使用绝对路径');
  const permission = string(p.permission, 'permission', 256).trim();
  if (!permission) throw new TypeError('权限预设标识不能为空');
  const allowedPermissions = strings(p.allowedPermissions, 'allowedPermissions', 100);
  if (!allowedPermissions.includes(permission)) throw new TypeError('当前权限模式必须在允许列表中');
  const domains = strings(resources.networkDomains, 'networkDomains', 100).map(domain => {
    const normalized = domain.toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(normalized)) throw new TypeError('联网域名必须是主机名，不含协议、端口或通配符');
    return normalized;
  });
  const result: ConversationPolicy = {
    version: integer(p.version, 'version', 1, Number.MAX_SAFE_INTEGER), receiveEnabled: p.receiveEnabled === undefined ? true : bool(p.receiveEnabled, 'receiveEnabled'),
    template: choice(p.template, TEMPLATES, 'template'), name: string(p.name, 'name', 120).trim(),
    role: { description: string(role.description, 'role.description'), tone: string(role.tone, 'role.tone'), world: string(role.world, 'role.world'), prompt: string(role.prompt, 'role.prompt') },
    tools: Object.fromEntries(toolEntries),
    resources: {
      readRoots: roots(resources.readRoots, 'readRoots'), writeRoots: roots(resources.writeRoots, 'writeRoots'), sendRoots: roots(resources.sendRoots, 'sendRoots'),
      executionEnabled: bool(resources.executionEnabled, 'executionEnabled'), sandbox: choice(resources.sandbox, CONVERSATION_SANDBOX_MODES, 'sandbox'),
      networkDomains: domains, maxFiles: integer(resources.maxFiles, 'maxFiles', 0, 20), maxFileMB: integer(resources.maxFileMB, 'maxFileMB', 1, 200),
    },
    controllers: strings(p.controllers, 'controllers'), approvers: strings(p.approvers, 'approvers'),
    allowedModels: strings(p.allowedModels, 'allowedModels'), allowedPresets: strings(p.allowedPresets, 'allowedPresets'),
    toolMode: p.toolMode === undefined ? 'restricted' : choice(p.toolMode, ['restricted', 'native'] as const, 'toolMode'),
    ...(p.nativeTools === undefined ? {} : { nativeTools: bool(p.nativeTools, 'nativeTools') }),
    allowedPermissions, permission, cwd, requireMention: bool(p.requireMention, 'requireMention'), replyEnabled: p.replyEnabled === undefined ? true : bool(p.replyEnabled, 'replyEnabled'),
    context: {
      mode: choice(context.mode, ['interaction', 'recent', 'archive'], 'context.mode'),
      maxMessages: integer(context.maxMessages, 'maxMessages', CONTEXT_LIMITS.maxMessages.min, CONTEXT_LIMITS.maxMessages.max), maxAgeMinutes: integer(context.maxAgeMinutes, 'maxAgeMinutes', CONTEXT_LIMITS.maxAgeMinutes.min, CONTEXT_LIMITS.maxAgeMinutes.max),
      maxChars: integer(context.maxChars, 'maxChars', CONTEXT_LIMITS.maxChars.min, CONTEXT_LIMITS.maxChars.max), retentionDays: integer(context.retentionDays, 'retentionDays', CONTEXT_LIMITS.retentionDays.min, CONTEXT_LIMITS.retentionDays.max),
    },
  };
  if (permissionSandbox(permission) !== undefined && result.resources.sandbox !== permission) throw new TypeError('沙箱模式与当前权限模式必须一致');
  if (result.toolMode !== 'native' && permission === 'read-only' && result.resources.writeRoots.length > 0) throw new TypeError('只读模式不能授权写入目录');
  if (result.toolMode !== 'native' && result.template === 'readonly' && (result.resources.executionEnabled || permission !== 'read-only')) throw new TypeError('资料只读模板不能启用通用执行或写入');
  return result;
}

/** Validate capability combinations against the actual registered tool catalog. */
export function validatePolicyTools(policy: ConversationPolicy, catalog: readonly ToolCatalogEntry[]): void {
  const entries = new Map(catalog.map(entry => [entry.id, entry]));
  for (const [id, decision] of Object.entries(policy.tools)) {
    if (decision === 'deny') continue;
    const entry = entries.get(id);
    if (!entry || !entry.available) throw new TypeError(`工具 ${id} 当前不可用`);
    if (policy.toolMode === 'native') {
      if (entry.constraint === 'send-path' && policy.resources.sendRoots.length === 0) throw new TypeError(`工具 ${entry.name} 需要发送来源目录`);
      continue;
    }
    if (entry.constraint === 'read-path' && policy.resources.readRoots.length === 0) throw new TypeError(`工具 ${entry.name} 需要读取目录`);
    if (entry.constraint === 'write-path' && (policy.permission !== 'workspace-write' || policy.resources.writeRoots.length === 0)) throw new TypeError(`工具 ${entry.name} 需要可写模式及写入目录`);
    if (entry.constraint === 'send-path' && policy.resources.sendRoots.length === 0) throw new TypeError(`工具 ${entry.name} 需要发送来源目录`);
    if (entry.constraint === 'execution' && !policy.resources.executionEnabled) throw new TypeError(`工具 ${entry.name} 需要单独启用执行`);
    if (policy.resources.networkDomains.length > 0 && (entry.category === 'network' || entry.category === 'mcp' || entry.constraint === 'execution')) throw new TypeError(`工具 ${entry.name} 尚不支持可靠的域名限制`);
    if (policy.template === 'readonly' && !['read-path', 'none'].includes(entry.constraint)) throw new TypeError(`工具 ${entry.name} 不具备只读范围适配`);
  }
}
