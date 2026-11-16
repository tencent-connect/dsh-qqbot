import type { ChatScope } from '../types.ts';
import type { WorkbenchAgentSettings } from './workbench-agent-settings.ts';

export const WORKBENCH_CONVERSATIONS_PATH = '/api/qqbot/workbench/conversations';
export const WORKBENCH_NEW_SESSION_PATH = '/api/qqbot/workbench/conversations/new-session';

export type MessageRetention = '7d' | '30d' | 'forever' | 'paused';

export function retentionDays(value: MessageRetention): number | undefined {
  return value === '7d' ? 7 : value === '30d' ? 30 : undefined;
}

export function shortensRetention(before: MessageRetention, after: MessageRetention): boolean {
  return (retentionDays(after) ?? Infinity) < (retentionDays(before) ?? Infinity);
}

export interface WorkbenchSession {
  id: string;
  createdAt: number;
  cwd?: string;
  preset?: string;
}

export interface WorkbenchConversation {
  scope: ChatScope;
  openId: string;
  name: string;
  alias: string;
  receiving: boolean;
  recording: boolean;
  retention: MessageRetention;
  admitted: boolean;
  executionBlocked?: string;
  revision: number;
  /** Present while this conversation uses the robot's template as its settings baseline. */
  defaultsRevision?: number;
  agent?: WorkbenchAgentSettings;
  currentSessionId?: string;
  sessionCount?: number;
  sessions: WorkbenchSession[];
}

export interface WorkbenchConversationPatch {
  appId: string;
  scope: ChatScope;
  openId: string;
  revision: number;
  defaultsRevision?: number;
  alias?: string;
  receiving?: boolean;
  recording?: boolean;
  retention?: MessageRetention;
  confirmRetention?: true;
  agent?: WorkbenchAgentSettings;
}


export interface WorkbenchNewSession {
  appId: string;
  scope: ChatScope;
  openId: string;
  revision: number;
  currentSessionId: string | null;
  cwd: string;
  preset: string;
}
