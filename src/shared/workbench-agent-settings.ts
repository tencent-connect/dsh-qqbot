import type { ModelRoute } from '../model/types.ts';

export const WORKBENCH_DEFAULTS_PATH = '/api/qqbot/workbench/defaults';
export const WORKBENCH_TOOLS_PATH = '/api/qqbot/workbench/tools';
export const WORKBENCH_PROMPT_PREVIEW_PATH = '/api/qqbot/workbench/prompt-preview';
export const WORKBENCH_PROMPT_PATH_LIMIT = 4096;

export interface WorkbenchToolChoice {
  name: string;
  description?: string;
}

export const WORKBENCH_BASE_PERMISSIONS = ['read-only', 'workspace-write', 'danger-full-access'] as const;
export const WORKBENCH_TOOL_LIMIT = 512;

export interface WorkbenchPromptFile {
  kind: 'file';
  path: string;
}

export type WorkbenchPrompt = string | WorkbenchPromptFile;

export interface WorkbenchAgentSettings {
  model: ModelRoute | null;
  reasoningEffort: string;
  preset: string;
  cwd: string;
  /** Empty preserves the Host's native permission default. */
  permission: string;
  /** Absent uses the original Agent tools. An empty list explicitly allows none. */
  tools?: string[];
  groupPrompt: WorkbenchPrompt;
  directPrompt: WorkbenchPrompt;
  streaming: boolean;
  showToolResults: boolean;
}

export interface WorkbenchDefaults {
  revision: number;
  settings: WorkbenchAgentSettings;
}
