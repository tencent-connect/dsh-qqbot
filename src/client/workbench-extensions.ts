import {
  WORKBENCH_EXTENSION_SETTINGS_PATH,
  type QqbotWorkbench,
  type QqConversationRef,
  type QqWorkbenchSettingsProps,
  type QqWorkbenchSettingsSection,
  type QqWorkbenchView,
} from '../shared/workbench-extension.ts';
import { fetchJson } from './http.ts';

export class WorkbenchExtensions implements QqbotWorkbench {
  private views: readonly QqWorkbenchView[] = [];
  private sections: readonly QqWorkbenchSettingsSection[] = [];
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getViews = (): readonly QqWorkbenchView[] => this.views;

  registerView(view: QqWorkbenchView): () => void {
    if (this.views.some(item => item.id === view.id)) throw new Error(`Duplicate QQ workbench view: ${view.id}`);
    this.views = [...this.views, view];
    this.notify();
    return () => {
      if (!this.views.includes(view)) return;
      this.views = this.views.filter(item => item !== view);
      this.notify();
    };
  }

  getSettingsSections = (): readonly QqWorkbenchSettingsSection[] => this.sections;

  registerSettingsSection(section: QqWorkbenchSettingsSection): () => void {
    if (this.sections.some(item => item.id === section.id)) throw new Error(`Duplicate QQ workbench settings: ${section.id}`);
    this.sections = [...this.sections, section];
    this.notify();
    return () => {
      if (!this.sections.includes(section)) return;
      this.sections = this.sections.filter(item => item !== section);
      this.notify();
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export function extensionSettingsProps(id: string, target: QqConversationRef): QqWorkbenchSettingsProps {
  return {
    target,
    read: (scope, signal) => {
      const params = new URLSearchParams({ id, ...scope });
      return fetchJson(`${WORKBENCH_EXTENSION_SETTINGS_PATH}?${params}`, { signal });
    },
    save: (scope, revision, overrides, signal) => fetchJson(WORKBENCH_EXTENSION_SETTINGS_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, scope, revision, overrides }),
      signal,
    }),
  };
}
