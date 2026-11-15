import type { Context } from '@deepseek-ai/cordis';
import { QqTimelineView } from './workbench-timeline.ts';
import { QQ_HISTORY_VIEW_ID } from '../shared/workbench-extension.ts';

export const name = 'im-qqbot-workbench-history-client';
export const inject = ['qqbotWorkbench'];

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.qqbotWorkbench.registerView({
    id: QQ_HISTORY_VIEW_ID, title: 'QQ 记录', component: QqTimelineView,
  }));
}
