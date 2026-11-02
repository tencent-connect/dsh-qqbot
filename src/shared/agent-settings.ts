import type { ConversationSandboxMode } from './conversation-protocol.ts';
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm';

export type QQExecutionSettings =
  | { kind: 'native'; permission: ConversationSandboxMode }
  | { kind: 'custom'; permission: ConversationSandboxMode; tools: string[] };

export interface QQAgentSettings {
  preset: string;
  model: { provider: string; model: string; reasoningEffort?: import('@deepseek-ai/dsh-llm').ReasoningEffortId } | null;
  /** Reasoning effort applied to the inherited default model when `model` is null. Ignored when a concrete model carries its own effort. */
  reasoningEffort?: import('@deepseek-ai/dsh-llm').ReasoningEffortId;
  /** 群聊补充提示词（只对群聊生效）。 */
  promptGroup: string;
  /** 私聊补充提示词（只对私聊生效）。 */
  promptDirect: string;
  cwd: string;
  execution: QQExecutionSettings;
  slashCommands: boolean;
}

export interface QQDefaults {
  version: number;
  settings: QQAgentSettings;
}

export function defaultQQAgentSettings(): QQAgentSettings {
  return { preset: '', model: null, promptGroup: '', promptDirect: '', cwd: '', execution: { kind: 'native', permission: 'read-only' }, slashCommands: true };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('QQ Agent 设置无效');
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new TypeError(`${field} 无效`);
  return value;
}

export function validateQQAgentSettings(value: unknown): QQAgentSettings {
  const data = object(value);
  const execution = object(data.execution);
  const permission = execution.permission;
  if (permission !== 'read-only' && permission !== 'workspace-write' && permission !== 'danger-full-access') throw new TypeError('QQ 执行权限无效');
  let checkedExecution: QQExecutionSettings;
  if (execution.kind === 'native') checkedExecution = { kind: 'native', permission };
  else if (execution.kind === 'custom') {
    if (!Array.isArray(execution.tools) || execution.tools.length > 2000) throw new TypeError('QQ 工具选择无效');
    const tools = [...new Set(execution.tools.map(value => {
      const id = text(value, 'QQ 工具标识', 512).trim();
      if (!id || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new TypeError('QQ 工具标识无效');
      return id;
    }))];
    checkedExecution = { kind: 'custom', permission, tools };
  } else throw new TypeError('QQ 执行方式无效');
  let model: QQAgentSettings['model'] = null;
  if (data.model !== null) {
    const route = object(data.model);
    const provider = text(route.provider, '模型提供方', 256).trim();
    const id = text(route.model, '模型标识', 1024).trim();
    if (!provider || !id) throw new TypeError('模型选择无效');
    const reasoningEffort = route.reasoningEffort === undefined || route.reasoningEffort === null ? undefined : text(route.reasoningEffort, '推理强度', 64).trim();
    model = { provider, model: id, ...(reasoningEffort ? { reasoningEffort: reasoningEffort as ReasoningEffortId } : {}) };
  }
  const cwd = text(data.cwd, '工作目录', 4096).trim();
  if (cwd && !cwd.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(cwd)) throw new TypeError('工作目录必须使用绝对路径');
  if (typeof data.slashCommands !== 'boolean') throw new TypeError('QQ 斜杠命令开关无效');
  const defaultEffort = data.reasoningEffort === undefined || data.reasoningEffort === null ? undefined : text(data.reasoningEffort, '推理强度', 64).trim();
  // 迁移期：旧 prompt 归入当前 scope 由调用方处理；校验层把旧 prompt 同时落到两个字段可见处由上层决定。
  const legacyPrompt = data.prompt === undefined ? undefined : text(data.prompt, '提示词', 80000);
  const promptGroup = data.promptGroup === undefined ? (legacyPrompt ?? '') : text(data.promptGroup, '群聊补充提示词', 80000);
  const promptDirect = data.promptDirect === undefined ? (legacyPrompt ?? '') : text(data.promptDirect, '私聊补充提示词', 80000);
  return { preset: text(data.preset, 'Agent 预设', 256).trim(), model, ...(defaultEffort ? { reasoningEffort: defaultEffort as ReasoningEffortId } : {}), promptGroup, promptDirect, cwd, execution: checkedExecution, slashCommands: data.slashCommands };
}

export function validateQQDefaults(value: unknown): QQDefaults {
  const data = object(value);
  if (typeof data.version !== 'number' || !Number.isSafeInteger(data.version) || data.version < 1) throw new TypeError('QQ 默认设置版本无效');
  return { version: data.version, settings: validateQQAgentSettings(data.settings) };
}
