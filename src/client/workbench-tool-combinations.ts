export interface ToolCombination {
  id: string;
  label: string;
  tools: readonly string[];
}

const fileAndSearchTools = ['skill', 'read', 'read_image', 'grep', 'glob', 'qqbot_group_history'];

export const BUILT_IN_TOOL_COMBINATIONS: readonly ToolCombination[] = [
  { id: 'read-files', label: '只读：文件与搜索', tools: fileAndSearchTools },
  { id: 'read-web', label: '只读 + 网页', tools: [...fileAndSearchTools, 'web_search', 'web_fetch'] },
];

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

export function applyToolCombination(names: readonly string[], available: ReadonlySet<string>): { tools: string[]; skipped: number } {
  const unique = [...new Set(names)];
  const tools = unique.filter(name => available.has(name)).sort();
  return { tools, skipped: unique.length - tools.length };
}
