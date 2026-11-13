import type { ModelRoute } from '../model/types.ts';

export const WORKBENCH_DEFAULTS_PATH = '/api/qqbot/workbench/defaults';
export const WORKBENCH_TOOLS_PATH = '/api/qqbot/workbench/tools';

export interface WorkbenchToolChoice {
  name: string;
  description?: string;
}

export const WORKBENCH_BASE_PERMISSIONS = ['read-only', 'workspace-write', 'danger-full-access'] as const;

export interface WorkbenchAgentSettings {
  model: ModelRoute | null;
  reasoningEffort: string;
  preset: string;
  cwd: string;
  /** Empty preserves the Host's native permission default. */
  permission: string;
  /** Absent uses the original Agent tools. An empty list explicitly allows none. */
  tools?: string[];
  groupPrompt: string;
  directPrompt: string;
  streaming: boolean;
  showToolResults: boolean;
}

export interface WorkbenchDefaults {
  revision: number;
  settings: WorkbenchAgentSettings;
}
