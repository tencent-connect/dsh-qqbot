import type { ChatScope } from '../types.ts';
import type { WorkbenchSendResult } from './workbench-timeline-protocol.ts';

export const WORKBENCH_ANSWER_PATH = '/api/qqbot/workbench/answer';

export interface AnswerDestination {
  appId: string;
  scope: ChatScope;
  openId: string;
  robotName: string;
  peerName: string;
  recording: boolean;
  automaticWebReplies?: boolean;
  blockedReason?: string;
}

export interface AnswerPreview extends AnswerDestination {
  text: string;
  confirmation: string;
  receipt?: WorkbenchSendResult;
}
