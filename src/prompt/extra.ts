import type { WorkbenchPrompt } from '../shared/workbench-agent-settings.ts';
import type { QQScope } from './scope.ts';

export const EXTRA_SECTION_NAME = 'qqbot:extra';
export const EXTRA_ORDER = 460;

export const EXTRA_MAX_CHARS = 80_000;

export interface ScopePrompts { group?: WorkbenchPrompt; direct?: WorkbenchPrompt }

export function selectExtraPrompt(prompts: ScopePrompts, scope: QQScope): WorkbenchPrompt {
  const raw = (scope === 'group' ? prompts.group : prompts.direct) ?? '';
  return typeof raw === 'string' ? raw.trim() : raw;
}
