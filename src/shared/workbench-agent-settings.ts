import type { ModelRoute } from '../model/types.ts';

export const WORKBENCH_DEFAULTS_PATH = '/api/qqbot/workbench/defaults';

export interface WorkbenchAgentSettings {
  model: ModelRoute | null;
  reasoningEffort: string;
  preset: string;
  cwd: string;
  /** Empty preserves the Host's native permission default. */
  permission: string;
  groupPrompt: string;
  directPrompt: string;
  streaming: boolean;
  showToolResults: boolean;
}

export interface WorkbenchDefaults {
  revision: number;
  settings: WorkbenchAgentSettings;
}
