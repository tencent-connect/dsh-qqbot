import type { QqLocaleKey } from './qq-locale.ts';

export interface ToolCombination {
  id: string;
  label: string;
  tools: readonly string[];
}

const fileAndSearchTools = ['skill', 'read', 'read_image', 'grep', 'glob', 'qqbot_group_history'];

export const BUILT_IN_TOOL_COMBINATIONS = [
  { id: 'read-files', label: '只读：文件与搜索', tools: fileAndSearchTools },
  { id: 'read-web', label: '只读 + 网页', tools: [...fileAndSearchTools, 'web_search', 'web_fetch'] },
] as const satisfies readonly (ToolCombination & { label: QqLocaleKey })[];

const storageKey = 'im-qqbot/tool-presets/v1';

export function readToolCombinations(storage: Pick<Storage, 'getItem'>): ToolCombination[] {
  try {
    const raw: unknown = JSON.parse(storage.getItem(storageKey) ?? 'null');
    if (!Array.isArray(raw)) return [];
    const combinations = new Map<string, ToolCombination>();
    for (const item of raw as unknown[]) {
      if (!item || typeof item !== 'object' || !('id' in item) || !('label' in item) || !('tools' in item)) continue;
      const { id, label, tools } = item;
      if (typeof id !== 'string' || typeof label !== 'string' || !Array.isArray(tools) || combinations.has(id)) continue;
      combinations.set(id, { id, label, tools: tools.filter((tool): tool is string => typeof tool === 'string') });
    }
    return [...combinations.values()];
  } catch {
    return [];
  }
}

export function writeToolCombinations(storage: Pick<Storage, 'setItem'>, combinations: readonly ToolCombination[]): void {
  storage.setItem(storageKey, JSON.stringify(combinations));
}

interface CombinationChanges {
  tools: string[];
  added: string[];
  removed: string[];
  skipped: string[];
}

export function applyToolCombination(names: readonly string[], available: ReadonlySet<string>, current: ReadonlySet<string>): CombinationChanges {
  const unique = [...new Set(names)].sort();
  const tools = unique.filter(name => available.has(name));
  const next = new Set(tools);
  return {
    tools,
    added: tools.filter(name => !current.has(name)),
    removed: [...current].filter(name => !next.has(name)).sort(),
    skipped: unique.filter(name => !available.has(name)),
  };
}
