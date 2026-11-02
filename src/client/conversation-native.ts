import { createElement as h, type ReactNode } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-chat/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { installQQConversationViewRegistration } from './qq-conversation-registration.ts';
import { conversationName } from './conversation-state.ts';
import { installConversationStyles } from './conversation-styles.ts';
import { createQQAnswerAction } from './conversation-answer-action.ts';
import { QQConversationView, QQConversationOverlay } from './conversation-panel.ts';
import { QQSessionStore, useQQSessionStore } from './qq-session-store.ts';
import type { SelectorSource } from './host-selectors.ts';
import type { QQTranslate } from './qq-locale.ts';

export function installNativeQQConversation(ctx: Context, store: QQSessionStore, selectorSource: SelectorSource, t: QQTranslate): void {
  installConversationStyles();
  ctx.effect(() => store.start(), 'im-qqbot.conversation-directory');
  const Badge = ({ sessionId }: PropsRuntime<'sidebar.session.row.trailing'>): ReactNode => {
    useQQSessionStore(store);
    const entry = store.entry(sessionId);
    if (!entry) return null;
    const current = entry.currentSessionId === sessionId;
    return h('span', { className: 'imqc-sessionBadge', title: `${conversationName(entry)} · ${current ? '当前 QQ 会话' : '历史 QQ 会话'}` }, current ? 'QQ' : 'QQ·历史');
  };
  const Hover = ({ sessionId }: PropsRuntime<'sidebar.session.row.hover'>): ReactNode => {
    useQQSessionStore(store);
    const entry = store.entry(sessionId);
    return entry ? h('div', { className: 'imqc-sessionSource' }, `${entry.scope === 'group' ? 'QQ 群聊' : 'QQ 私聊'} · ${conversationName(entry)} · ${entry.currentSessionId === sessionId ? '当前会话' : '历史会话'}`) : null;
  };
  ctx.slots.inject('sidebar.session.row.trailing', () => ctx.slots.register({ name: 'sidebar.session.row.trailing', id: 'qqbot-source', order: 30 }, Badge));
  ctx.slots.inject('sidebar.session.row.hover', () => ctx.slots.register({ name: 'sidebar.session.row.hover', id: 'qqbot-source', order: 30 }, Hover));
  ctx.inject(['uiSession'], (viewCtx) => {
    const stopSeat = viewCtx.slots.inject('conversation.view', () => installQQConversationViewRegistration({
      current: viewCtx.uiSession.adapter.current, store,
      register: () => viewCtx.slots.register({ name: 'conversation.view', id: 'qqbot-settings', order: 20, label: t('view.settings.title') },
        (props: PropsRuntime<'conversation.view'>) => h(QQConversationView, { store, selectorSource, t, sessionId: props.sessionId, useProjection: props.useProjection, useSessions: props.useSessions, useWorkspaces: props.useWorkspaces, defaultWorkspaceName: ctx.locale.bind('common')('workspace.defaultName') })),
    }));
    return stopSeat;
  });
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({ name: 'conversation.chat.assistant-actions', id: 'qqbot-send-answer', order: 30 }, createQQAnswerAction(store)));
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'qqbot-conversation' }, (props: PropsRuntime<'shell.overlay'>) => h(QQConversationOverlay, { store, selectorSource, t, useWorkspaces: props.useWorkspaces, useSessions: props.useSessions, defaultWorkspaceName: ctx.locale.bind('common')('workspace.defaultName') })));
}
