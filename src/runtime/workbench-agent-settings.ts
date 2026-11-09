import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { ImQQBotConfig } from '../config.ts';
import { ModelResolver } from '../model/model-resolver.ts';
import { resolveAgentCwd } from '../shared/dirs.ts';
import type { WorkbenchAgentSettings } from '../shared/workbench-agent-settings.ts';
import { robotObject } from './robot-config.ts';

export function legacyAgentSettings(config: ImQQBotConfig): WorkbenchAgentSettings {
  return {
    model: config.provider && config.model ? { provider: config.provider, model: config.model } : null,
    reasoningEffort: '',
    preset: config.preset ?? '',
    cwd: config.cwd ? resolveAgentCwd(config.cwd) : '',
    permission: '',
    groupPrompt: config.groupPrompt ?? '',
    directPrompt: config.directPrompt ?? '',
    streaming: config.streaming,
    showToolResults: config.showToolResults,
  };
}

export function parseAgentSettings(raw: unknown): WorkbenchAgentSettings {
  const row = robotObject(raw, ['model', 'reasoningEffort', 'preset', 'cwd', 'permission', 'groupPrompt', 'directPrompt', 'streaming', 'showToolResults']);
  const string = (value: unknown, field: string, max: number): string => {
    if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new Error(`${field}格式无效。`);
    return value;
  };
  const route = row.model === null ? null : robotObject(row.model, ['provider', 'model']);
  const model = route && { provider: string(route.provider, '模型提供方', 256).trim(), model: string(route.model, '模型', 1024).trim() };
  if (model && (!model.provider || !model.model)) throw new Error('请选择有效的模型。');
  const cwd = string(row.cwd, '工作区', 4096).trim();
  if (cwd && !isAbsolute(cwd)) throw new Error('工作区必须使用绝对路径。');
  if (typeof row.streaming !== 'boolean' || typeof row.showToolResults !== 'boolean') throw new Error('QQ 输出选项无效。');
  return {
    model, cwd, reasoningEffort: string(row.reasoningEffort, '推理强度', 64).trim(),
    preset: string(row.preset, 'Agent 预设', 256).trim(),
    permission: string(row.permission, '执行权限', 256).trim(),
    groupPrompt: string(row.groupPrompt, '群聊补充提示词', 80_000),
    directPrompt: string(row.directPrompt, '私聊补充提示词', 80_000),
    streaming: row.streaming, showToolResults: row.showToolResults,
  };
}

export interface PermissionCatalog {
  catalog(): { options: readonly { value: string }[] };
  set(session: unknown, permission: string): void;
}

export async function validateAgentSettings(ctx: Context, config: ImQQBotConfig, next: WorkbenchAgentSettings, current: WorkbenchAgentSettings): Promise<void> {
  if (next.cwd && next.cwd !== current.cwd) {
    try {
      if (!statSync(next.cwd).isDirectory()) throw new Error();
    } catch {
      throw new Error('所选工作区目录不可用。');
    }
  }
  if (next.permission && next.permission !== current.permission) {
    const permissions = ctx.get('permissionPresets') as PermissionCatalog | undefined;
    if (!permissions?.catalog().options.some(item => item.value === next.permission)) throw new Error('此 DSH 宿主不提供所选执行权限。');
  }
  if (next.preset && next.preset !== current.preset) {
    const presets = ctx.get('agentPresets') as { resolve(id: string): Promise<{ broken?: string }> } | undefined;
    const result = await presets?.resolve(next.preset);
    if (!result || result.broken !== undefined) throw new Error('所选 Agent 预设不可用。');
  }
  if (next.model?.provider !== current.model?.provider || next.model?.model !== current.model?.model || next.reasoningEffort !== current.reasoningEffort) {
    if (!next.model && !next.reasoningEffort) return;
    const route = next.model ?? new ModelResolver(ctx, config).resolveDefault(false);
    const llm = ctx.get('llm') as {
      listModels(provider: string): Promise<readonly { id: string }[]>;
      resolveModelInfo?(provider: string, model: string): Promise<{ reasoning?: { efforts: readonly { id: string }[] } }>;
    } | undefined;
    const models = await llm?.listModels(route.provider);
    if (!models?.some(item => item.id === route.model)) throw new Error('所选模型不可用。');
    if (!next.reasoningEffort) return;
    const model = await llm?.resolveModelInfo?.(route.provider, route.model);
    if (!model?.reasoning?.efforts.some(item => item.id === next.reasoningEffort)) {
      throw new Error('所选模型不支持这个推理强度。');
    }
  }
}
