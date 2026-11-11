import type { ComponentType } from 'react';
import type { WorkbenchConversation } from './workbench-conversation-protocol.ts';
import type { TimelineEntry, TimelinePage } from './workbench-timeline-protocol.ts';

export interface QqConversationRef {
  appId: string;
  scope: WorkbenchConversation['scope'];
  openId: string;
}

export const WORKBENCH_EXTENSION_SETTINGS_PATH = '/api/qqbot/workbench/extension-settings';

export type QqExtensionScope =
  | { kind: 'global' }
  | { kind: 'robot'; appId: string }
  | ({ kind: 'conversation' } & QqConversationRef);

type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type QqExtensionValues = Readonly<Record<string, JsonValue>>;

export interface QqExtensionSettingsDefinition {
  id: string;
  defaults: QqExtensionValues;
  parseOverrides(value: unknown): QqExtensionValues;
}

export interface QqExtensionSettingsSnapshot {
  revision: number;
  overrides: QqExtensionValues;
  effective: QqExtensionValues;
  sources: Readonly<Record<string, 'default' | QqExtensionScope['kind']>>;
}

export interface QqbotTimelineService {
  timelinePage(target: QqConversationRef, before?: string): TimelinePage | undefined;
  timelineEntry(target: QqConversationRef, entryId: string): TimelineEntry | undefined;
  timelineImage(target: QqConversationRef, entryId: string, index: number): Promise<Response | undefined>;
}

export interface QqbotService extends QqbotTimelineService {
  registerSettings(definition: QqExtensionSettingsDefinition): () => void;
  getSettings(id: string, scope: QqExtensionScope): QqExtensionSettingsSnapshot;
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

export interface QqWorkbenchSettingsProps {
  target: QqConversationRef;
  read(scope: QqExtensionScope, signal?: AbortSignal): Promise<QqExtensionSettingsSnapshot>;
  save(scope: QqExtensionScope, revision: number, overrides: QqExtensionValues, signal?: AbortSignal): Promise<QqExtensionSettingsSnapshot>;
}

export interface QqWorkbenchSettingsSection {
  id: string;
  title: string;
  component: ComponentType<QqWorkbenchSettingsProps>;
}

export interface QqbotWorkbench {
  registerView(view: QqWorkbenchView): () => void;
  registerSettingsSection(section: QqWorkbenchSettingsSection): () => void;
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    qqbot: QqbotService;
    qqbotWorkbench: QqbotWorkbench;
  }
}
