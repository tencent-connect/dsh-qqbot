import type { ChatScope } from '../types.ts';
import type { WorkbenchAgentSettings } from './workbench-agent-settings.ts';

export const WORKBENCH_CONVERSATIONS_PATH = '/api/qqbot/workbench/conversations';
export const WORKBENCH_NEW_SESSION_PATH = '/api/qqbot/workbench/conversations/new-session';

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
  admitted: boolean;
  revision: number;
  agent?: WorkbenchAgentSettings;
  currentSessionId?: string;
  sessions: WorkbenchSession[];
}

export interface WorkbenchConversationPatch {
  appId: string;
  scope: ChatScope;
  openId: string;
  revision: number;
  alias?: string;
  receiving?: boolean;
  recording?: boolean;
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
