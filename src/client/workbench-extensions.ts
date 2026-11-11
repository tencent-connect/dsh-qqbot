import type { QqbotWorkbench, QqWorkbenchView } from '../shared/workbench-extension.ts';

export class WorkbenchExtensions implements QqbotWorkbench {
  private views: readonly QqWorkbenchView[] = [];
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

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
