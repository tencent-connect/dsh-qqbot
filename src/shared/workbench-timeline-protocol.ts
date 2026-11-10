export const WORKBENCH_TIMELINE_PATH = '/api/qqbot/workbench/timeline';
export const WORKBENCH_SEND_PATH = '/api/qqbot/workbench/send';
export const QQ_MANUAL_MESSAGE_LIMIT = 2000;
export const TIMELINE_PAGE_SIZE = 40;
export const MAX_TIMELINE_IMAGES = 8;

export type TimelineStatus = 'received' | 'sending' | 'partial' | 'accepted' | 'rejected' | 'unknown';

export type TimelineInboundOutcome = 'mention-required' | 'rate-limited' | 'queue-full' | 'empty' | 'submitted' | 'submit-failed' | 'session-archived';

export interface TimelineEntry {
  id: string;
  at: number;
  direction: 'inbound' | 'outbound';
  text: string;
  status: TimelineStatus;
  senderName?: string;
  senderId?: string;
  attachments?: number;
  imageCount?: number;
  sessionId?: string;
  platformId?: string;
  httpStatus?: number;
  platformCode?: number;
  source?: 'manual' | 'answer' | 'automatic' | 'agent';
  inboundOutcome?: TimelineInboundOutcome;
  quote?: { text: string; attachments?: number };
}

export interface TimelinePage {
  entries: TimelineEntry[];
  before?: string;
  incomplete: boolean;
}


export interface WorkbenchSendResult {
  id: string;
  status: 'sending' | 'accepted' | 'rejected' | 'unknown';
  httpStatus?: number;
  platformCode?: number;
}
