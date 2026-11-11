import type { Context } from '@deepseek-ai/cordis';
import { QqTimelineView } from './workbench-timeline.ts';
import type {} from '../shared/workbench-extension.ts';

export const name = 'im-qqbot-workbench-history-client';
export const inject = ['qqbotWorkbench'];

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.qqbotWorkbench.registerView({
    id: 'qq-history', title: 'QQ 记录', component: QqTimelineView,
  }));
}
