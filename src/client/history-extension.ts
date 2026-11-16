import { t } from './qq-locale.ts';
import type { Context } from '@deepseek-ai/cordis';
import { createElement } from 'react';
import { QqTimelineView, TimelineState } from './workbench-timeline.ts';
import { QQ_HISTORY_VIEW_ID, type QqWorkbenchViewProps } from '../shared/workbench-extension.ts';

export const name = 'im-qqbot-workbench-history-client';
export const inject = ['qqbotWorkbench'];

export function apply(ctx: Context): void {
  const state = new TimelineState();
  const component = (props: QqWorkbenchViewProps) => createElement(QqTimelineView, { ...props, state });
  ctx.effect(() => ctx.qqbotWorkbench.registerView({
    id: QQ_HISTORY_VIEW_ID, title: t("QQ 记录"), component, refreshable: true,
  }));
}
