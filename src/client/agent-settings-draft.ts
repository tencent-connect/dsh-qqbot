import type { WorkbenchAgentSettings } from '../shared/workbench-agent-settings.ts';

export function agentSettingsPatch(
  baseline: WorkbenchAgentSettings,
  draft: WorkbenchAgentSettings,
): Partial<WorkbenchAgentSettings> {
  const patch: Partial<WorkbenchAgentSettings> = {};
  // A missing tools field and an explicit empty list have different permission semantics.
  const keys = Object.keys({ ...baseline, ...draft }) as Array<keyof WorkbenchAgentSettings>;
  const copyChange = <K extends keyof WorkbenchAgentSettings>(key: K): void => {
    if (JSON.stringify(baseline[key]) !== JSON.stringify(draft[key])) patch[key] = draft[key];
  };
  for (const key of keys) copyChange(key);
  return patch;
}
