import { describe, expect, it } from 'vitest';
import { CONVERSATION_SANDBOX_MODES } from '../shared/policy-settings.ts';
import { conversationName, conversationToolCatalog, filterConversations, permissionSummary, policyChanges, splitLines, toolConstraintReason, transitionPolicy, type PolicyTransitionRequest } from './conversation-state.ts';
import type { ConversationPolicy, ConversationView, ToolCatalogEntry } from '../shared/conversation-protocol.ts';

function policy(): ConversationPolicy {
  return { version: 4, template: 'custom', name: '原配置', role: { description: '角色', tone: '语气', world: '', prompt: '' }, tools: { shell: 'allow' },
    resources: { readRoots: ['/docs'], writeRoots: [], sendRoots: [], executionEnabled: true, sandbox: 'workspace-write', networkDomains: [], maxFiles: 3, maxFileMB: 10 },
    controllers: [], approvers: [], allowedModels: [], allowedPresets: [], allowedPermissions: ['read-only'], permission: 'read-only', cwd: '/project', requireMention: true,
    context: { mode: 'recent', maxMessages: 10, maxAgeMinutes: 10, maxChars: 4000, retentionDays: 7 } };
}
function entry(overrides: Partial<ConversationView> = {}): ConversationView {
  return { key: 'qqbot:1:group:g', appId: '1', scope: 'group', peerId: 'group-123456789', name: '', alias: '', currentSessionId: null, sessions: [], members: [],
    policy: policy(), lastActivity: 1, observedAllMessages: false, admitted: true, running: false, currentModel: null, currentPreset: null, nextPreset: null, deliveryState: null, ...overrides };
}
const catalog: ToolCatalogEntry[] = [
  { id: 'read', name: '读取', description: '', category: 'file', constraint: 'read-path', available: true },
  { id: 'write', name: '写入', description: '', category: 'file', constraint: 'write-path', available: true },
  { id: 'shell', name: '执行', description: '', category: 'execution', constraint: 'execution', available: true },
  { id: 'mcp', name: '未知', description: '', category: 'mcp', constraint: 'unsupported', available: false },
];
function readyTransition(current: ConversationPolicy, change: PolicyTransitionRequest, tools: readonly ToolCatalogEntry[] = catalog, permissionIds: readonly string[] = CONVERSATION_SANDBOX_MODES): ConversationPolicy {
  const result = transitionPolicy({ current, change, catalog: tools, permissionIds });
  if (result.kind === 'blocked') throw new Error(result.reason);
  return result.policy;
}
describe('QQ conversation UI state', () => {
  it('snapshots only currently available Agent tools and retains separate QQ grants', () => {
    const prior = policy(); prior.tools = { read: 'deny', shell: 'ask' }; prior.resources.executionEnabled = false;
    const tools = [...catalog, ...['memory_search', 'memory_get', 'memory_write', 'qqbot_send_file', 'present'].map(id => ({ id, name: id, description: '', category: 'other' as const, constraint: 'none' as const, available: true }))];
    const next = readyTransition(prior, { kind: 'tool-mode', mode: 'native' }, tools);
    expect(next.tools).toEqual({ read: 'deny', shell: 'ask', write: 'allow' });
    expect(next.resources.executionEnabled).toBe(true);
    expect(next.toolMode).toBe('native');
    expect(prior.toolMode).toBeUndefined();
    expect(toolConstraintReason(catalog[1]!, next)).toBeNull();
    expect(toolConstraintReason(catalog[3]!, next)).not.toBeNull();
    expect(policyChanges(prior, next, '', '')).toContain('Agent 工作能力');
  });

  it('clears native-dependent grants on an explicit transition to restricted mode', () => {
    const previous = policy(); previous.toolMode = 'native'; previous.tools = { read: 'allow', shell: 'ask', future: 'deny' };
    const next = readyTransition(previous, { kind: 'tool-mode', mode: 'restricted' });
    expect(next.toolMode).toBe('restricted'); expect(next.tools).toEqual({ read: 'deny', shell: 'deny', future: 'deny' });
    expect(next.resources.executionEnabled).toBe(false); expect(previous.tools.read).toBe('allow');
    expect(policyChanges(previous, next, '', '')).toContain('工具规则');
  });

  it('selects a known readonly default by revoking existing write roots and write grants', () => {
    const previous = policy(); previous.permission = 'workspace-write'; previous.allowedPermissions = ['read-only', 'workspace-write']; previous.resources.writeRoots = ['/project']; previous.tools.write = 'ask';
    const next = readyTransition(previous, { kind: 'permission', permission: 'read-only' });
    expect(next.resources.sandbox).toBe('read-only'); expect(next.resources.writeRoots).toEqual([]); expect(next.tools.write).toBe('deny');
    expect(previous.resources.writeRoots).toEqual(['/project']);
  });

  it('hides retired tools from a stale catalog and ignores their legacy grants in summaries and previews', () => {
    const retired = ['memory_search', 'memory_get', 'memory_write'].map(id => ({ id, name: id, description: '', category: 'other' as const, constraint: 'none' as const, available: true }));
    const stale = [...catalog, ...retired];
    expect(conversationToolCatalog(stale)).toEqual(catalog);
    const previous = policy(); previous.tools = { memory_search: 'allow', memory_get: 'ask', memory_write: 'allow' };
    const next = structuredClone(previous); next.tools = {};
    expect(permissionSummary(previous)).toBe('原配置 · 无工具');
    expect(policyChanges(previous, next, '', '')).toEqual([]);
    expect(readyTransition(previous, { kind: 'tool-mode', mode: 'native' }, stale).tools).toEqual({ read: 'allow', write: 'allow', shell: 'allow' });
    expect(readyTransition(previous, { kind: 'template', template: 'readonly' }, stale).tools).toEqual({ read: 'allow', write: 'deny', shell: 'deny', mcp: 'deny' });
  });

  it('uses explicit alias before platform name and never invents a missing name', () => {
    expect(conversationName(entry({ alias: '学习群', name: '平台群' }))).toBe('学习群');
    expect(conversationName(entry())).toBe('群聊 · 23456789');
  });
  it('filters by scope and case-insensitive name, sorting without mutating storage', () => {
    const entries = [entry({ key: 'old', alias: 'Study', lastActivity: 1 }), entry({ key: 'new', name: 'study group', lastActivity: 8 }), entry({ scope: 'c2c', key: 'dm', alias: 'study', lastActivity: 10 })];
    expect(filterConversations(entries, 'group', 'STUDY').map((item) => item.key)).toEqual(['new', 'old']);
    expect(entries[0]?.key).toBe('old');
  });
  it('roleplay template removes tools but preserves independent persona and resource lists', () => {
    const previous = policy();
    const next = readyTransition(previous, { kind: 'template', template: 'roleplay' }, catalog);
    expect(Object.values(next.tools).every((value) => value === 'deny')).toBe(true);
    expect(next.resources.executionEnabled).toBe(false);
    expect(next.role.description).toBe('角色');
    next.resources.readRoots.push('/new');
    expect(previous.resources.readRoots).toEqual(['/docs']);
    expect(previous.tools.shell).toBe('allow');
  });
  it('does not manufacture unavailable Host permission ids when initializing templates', () => {
    const previous = policy();
    expect(transitionPolicy({ current: previous, change: { kind: 'template', template: 'readonly' }, catalog, permissionIds: ['custom-host-id'] }).kind).toBe('blocked');
    expect(readyTransition(previous, { kind: 'template', template: 'project' }, catalog, ['workspace-write']).allowedPermissions).toEqual(['workspace-write']);
  });
  it('readonly template admits only supported read operations', () => {
    expect(readyTransition(policy(), { kind: 'template', template: 'readonly' }, catalog).tools).toEqual({ read: 'allow', write: 'deny', shell: 'deny', mcp: 'deny' });
  });
  it('project template asks for writes and keeps execution disabled until separately configured', () => {
    const previous = policy(); previous.resources.writeRoots = ['/project'];
    const next = readyTransition(previous, { kind: 'template', template: 'project' }, catalog);
    expect(next.tools.write).toBe('ask'); expect(next.tools.shell).toBe('deny'); expect(next.resources.executionEnabled).toBe(false);
    expect(next.permission).toBe('workspace-write');
  });
  it('does not grant path-based tools until a resource root is configured', () => {
    const previous = policy(); previous.resources.readRoots = [];
    expect(readyTransition(previous, { kind: 'template', template: 'readonly' }, catalog).tools.read).toBe('deny');
    expect(toolConstraintReason(catalog[0]!, previous)).toContain('读取的目录');
  });
  it('clears prior project write roots when switching to a readonly template', () => {
    const previous = policy(); previous.resources.writeRoots = ['/project'];
    for (const template of ['readonly', 'chat', 'roleplay'] as const) {
      const next = readyTransition(previous, { kind: 'template', template });
      expect(next.resources.writeRoots).toEqual([]);
      expect(next.permission).toBe('read-only');
      expect(previous.resources.writeRoots).toEqual(['/project']);
    }
  });
  it('blocks write grants under readonly policy and execution grants before explicit opt-in', () => {
    const previous = policy(); previous.resources.executionEnabled = false;
    expect(toolConstraintReason(catalog[1]!, previous)).toContain('工作区可写');
    expect(toolConstraintReason(catalog[2]!, previous)).toContain('单独开启');
  });
  it('does not imply generic MCP or execution tools can enforce a domain allowlist', () => {
    const previous = policy(); previous.resources.networkDomains = ['example.com'];
    const mcp = { ...catalog[3]!, available: true };
    expect(toolConstraintReason(mcp, previous)).toContain('域名约束');
  });
  it('shows a complete summary of allowed and approval tools', () => {
    const value = policy(); value.tools = { read: 'allow', write: 'ask', shell: 'deny' };
    expect(permissionSummary(value)).toBe('原配置 · 2 项工具 · 1 项需审批');
  });
  it('previews removals and role changes while ignoring host revision-only updates', () => {
    const old = policy(); const next = structuredClone(old); next.version += 1;
    expect(policyChanges(old, next, '', '')).toEqual([]);
    next.role.prompt = 'new'; delete next.tools.shell;
    expect(policyChanges(old, next, '', '备注')).toEqual(['备注', '角色设定', '工具规则']);
  });
  it('splits and deduplicates explicit identity lists', () => {
    expect(splitLines(' a\nb, a\n \nc ')).toEqual(['a', 'b', 'c']);
  });
});
