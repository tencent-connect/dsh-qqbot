export const WORKBENCH_TIMELINE_PATH = '/api/qqbot/workbench/timeline';
export const TIMELINE_PAGE_SIZE = 40;

export type TimelineStatus = 'received' | 'sending' | 'partial' | 'accepted' | 'rejected' | 'unknown';

export interface TimelineEntry {
  id: string;
  at: number;
  direction: 'inbound' | 'outbound';
  text: string;
  status: TimelineStatus;
  senderName?: string;
  senderId?: string;
  attachments?: number;
  sessionId?: string;
  platformId?: string;
  httpStatus?: number;
  platformCode?: number;
}

export interface TimelinePage {
  entries: TimelineEntry[];
  before?: string;
  incomplete: boolean;
}
