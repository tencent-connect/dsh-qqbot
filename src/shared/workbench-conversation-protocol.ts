import type { ChatScope } from '../types.ts';

export const WORKBENCH_CONVERSATIONS_PATH = '/api/qqbot/workbench/conversations';

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
  admitted: boolean;
  revision: number;
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
}
