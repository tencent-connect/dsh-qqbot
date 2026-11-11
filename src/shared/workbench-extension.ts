import type { ComponentType } from 'react';
import type { WorkbenchConversation } from './workbench-conversation-protocol.ts';
import type { TimelineEntry, TimelinePage } from './workbench-timeline-protocol.ts';

export interface QqConversationRef {
  appId: string;
  scope: WorkbenchConversation['scope'];
  openId: string;
}

export interface QqbotService {
  timelinePage(target: QqConversationRef, before?: string): TimelinePage | undefined;
  timelineEntry(target: QqConversationRef, entryId: string): TimelineEntry | undefined;
  timelineImage(target: QqConversationRef, entryId: string, index: number): Promise<Response | undefined>;
}

export interface QqWorkbenchViewProps {
  appId: string;
  peer: WorkbenchConversation;
  robotName: string;
  disabledReason?: string;
  openSession?: (id: string) => void;
}

export interface QqWorkbenchView {
  id: string;
  title: string;
  component: ComponentType<QqWorkbenchViewProps>;
}

export interface QqbotWorkbench {
  registerView(view: QqWorkbenchView): () => void;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    qqbot: QqbotService;
    qqbotWorkbench: QqbotWorkbench;
  }
}
