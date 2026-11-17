import type { ChatScope } from '../types.ts';
import type { WorkbenchAgentSettings } from './workbench-agent-settings.ts';

export const WORKBENCH_CONVERSATIONS_PATH = '/api/qqbot/workbench/conversations';
export const WORKBENCH_NEW_SESSION_PATH = '/api/qqbot/workbench/conversations/new-session';

export type MessageRetention = 'forever' | 'paused' | `${number}d`;

export const RETENTION_DAY_MS = 86_400_000;

export function retentionDays(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^[1-9]\d*d$/.test(value)) return undefined;
  const days = Number(value.slice(0, -1));
  return days <= Math.floor(Number.MAX_SAFE_INTEGER / RETENTION_DAY_MS) ? days : undefined;
}

export function isMessageRetention(value: unknown): value is MessageRetention {
  return value === 'forever' || value === 'paused' || retentionDays(value) !== undefined;
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
