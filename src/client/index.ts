/** QQ directory and account settings, with native Session navigation and QQ drawers. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-remotes/client';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { presetDisplayText } from '@deepseek-ai/dsh-agent-preset-registry/display';
import type { AgentPresetRow } from '@deepseek-ai/dsh-agent-preset-registry/types';
import { createElement, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { SessionId } from '@deepseek-ai/dsh-session/types';
import { BindPanelBody, useBindState, QQ_BOT_LOGO_PATH, installPanelStyles } from './bind-page.ts';
import { ConfigPanel } from './config-panel.ts';
import { QQDefaultsSettings } from './qq-defaults-settings.ts';
import { ConversationPanel, QQAccountOwners } from './conversation-panel.ts';
import { installNativeQQConversation } from './conversation-native.ts';
import { QQSessionStore } from './qq-session-store.ts';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type { SelectorSource } from './host-selectors.ts';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import { QQSidebar, type QQSidebarActions } from './qq-sidebar.ts';
import { bindQQ, registerQQLocale, type QQTranslate } from './qq-locale.ts';
import { installQQSidebarNavigation, QQ_MAIN_PANEL_ID } from './qq-sidebar-navigation.ts';

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { qqbotOperation: unknown }
}

export const name = 'im-qqbot-client';
export const inject = ['slots', 'remote', 'remote.session', 'remote.workspace', 'remote.agentPresets', 'remote.permissionPresets', 'locale', 'uiWorkspace'];

/** 本插件包名（插件详情页按其匹配来源包，只在对应详情页渲染操作按钮） */
const PACKAGE_NAME = '@tencent-connect/dsh-qqbot';
/** 主面板 id（layout.selectPanel 导航目标；keyed main 席位按其分发） */
const IM_MAIN_PANEL_ID = QQ_MAIN_PANEL_ID;

/** ui-slots 的席位系统服务（局部投影） */
interface SlotsLike {
  inject(slotName: string, register: () => (() => void)): () => void;
  register(spec: Record<string, unknown>, component: unknown): () => void;
}

type WorkspaceItem = { workspaceId: string; title: string; path: string };
const EMPTY_WORKSPACES: ReadonlyArray<WorkspaceItem> = [];

/** 设置页栏目：共享一份绑定状态轮询，驱动绑定面板与配置刷新 */
function QQBotSettingsSection({ selectorSource, store, t, workspaces, defaultWorkspaceName }: { selectorSource: SelectorSource; store: QQSessionStore; t: QQTranslate; workspaces: ReadonlyArray<WorkspaceItem>; defaultWorkspaceName: string }): ReactNode {
  const { state, gone, error, recheck } = useBindState();
  // 单页两卡：账号与访问（凭据 / 服务范围 / 所有者，均"保存即重载插件"）与新对话默认值（版本化即时生效）。
  return createElement('div', { className: 'imqb-cards' },
    createElement('section', { className: 'imqb-card', 'aria-label': t('account.title') },
      createElement('h2', { className: 'imqb-cardTitle' }, t('account.title')),
      createElement('p', { className: 'imqb-cardHint' }, t('account.hint')),
      createElement(BindPanelBody, { state, gone, error, recheck }),
      createElement(ConfigPanel, { bindPhase: state?.phase, selectorSource, t }),
      createElement(QQAccountOwners, { store, t, bound: state?.phase === 'bound' })),
    createElement('section', { className: 'imqb-card', 'aria-label': '新对话默认值' },
      createElement(QQDefaultsSettings, { store, selectorSource, t, workspaces, defaultWorkspaceName })),
  );
}

/** 主面板页面：与设置栏目同一内容，包一层滚动留白容器（plugins.detail.actions 的跳转目标） */
function QQBotPage({ selectorSource, store, t, initialSettings, installSettingsHandler, workspaces, defaultWorkspaceName }: {
  selectorSource: SelectorSource; store: QQSessionStore; t: QQTranslate;
  initialSettings: () => boolean; installSettingsHandler: (handler: (() => void) | undefined) => void;
  workspaces: ReadonlyArray<WorkspaceItem>; defaultWorkspaceName: string;
}): ReactNode {
  const [settings, setSettings] = useState(initialSettings);
  useEffect(() => { installSettingsHandler(() => setSettings(true)); return () => installSettingsHandler(undefined); }, [installSettingsHandler]);
  return createElement('div', { style: { height: '100%', minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' } },
    !settings ? createElement(ConversationPanel, { store, onOpenSettings: () => setSettings(true) }) : null,
    settings ? createElement('div', { className: 'imqb-pluginPage' },
    createElement('div', { className: 'imqb-pluginPageContent' },
      createElement(Button, { variant: 'outline', size: 'sm', onClick: () => setSettings(false) }, '‹ 返回 QQ 会话'),
      createElement('h1', { className: 'imqb-pageTitle' }, 'QQ 机器人'),
      createElement('p', { className: 'imqb-pageDescription' }, '管理机器人账号、可对话范围与新对话默认值'),
      createElement(QQBotSettingsSection, { selectorSource, store, t, workspaces, defaultWorkspaceName }))) : null,
  );
}

/** 左侧栏入口图标（宿主传入 size：展开 18 / 收起 16；currentColor 跟随侧栏配色与选中态） */
function QqBotSidebarIcon({ size = 16 }: { size?: number; active?: boolean }): ReactNode {
  return createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true,
  },
    createElement('path', { d: QQ_BOT_LOGO_PATH, fill: 'currentColor' }));
}

/** 插件详情「设置」按钮：仅在本包的 bundle / 组件行详情页渲染，其他插件不显示 */
function OpenQqBotAction({ subject, packageName, onOpen }: {
  subject?: { kind?: string; pkg?: { name?: string }; row?: { moduleName?: string } };
  packageName: string;
  onOpen: () => void;
}): ReactNode {
  if (subject?.kind !== 'bundle' && subject?.kind !== 'row') return null;
  if (subject.pkg?.name !== packageName) return null;
  if (subject.kind === 'row' && subject.row?.moduleName !== packageName) return null;
  return createElement(Button, {
    variant: 'outline', size: 'sm', onClick: onOpen,
  }, '设置');
}

export function apply(ctx: Context): void {
  // 面板样式全局安装：插件详情按钮等面板外渲染的元素也需要可见
  installPanelStyles();
  // QQ 可见文案命名空间（唯一来源）；已注册的 slot 文案随 locale 变化刷新
  ctx.effect(() => registerQQLocale(ctx), 'qqbot-locale: dictionaries');
  const t: QQTranslate = bindQQ(ctx);
  const selectorSource: SelectorSource = {
    permissionCatalog: () => ctx.remote.permissionPresets.catalog(),
    modelCatalog: () => ctx.remote.session.modelCatalog(),
    pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
    createWorkspace: async (path: string) => {
      const result = await ctx.remote.workspace.create({ path });
      if (!result.ok) throw new Error(result.error.message);
      return { workspaceId: String(result.value.workspace.workspaceId), title: result.value.workspace.title, path: result.value.workspace.path };
    },
    listAgentPresets: async () => {
      const result = await ctx.remote.agentPresets.list();
      if (!result.ok) return result;
      const copy = ctx.locale.bind('settings.agentPreset');
      return {
        ...result,
        value: {
          ...result.value,
          presets: result.value.presets.map((preset: AgentPresetRow) => ({ ...preset, ...presetDisplayText(preset, copy) })),
        },
      };
    },
  };
  const store = new QQSessionStore(ctx.uiWorkspace);
  const defaultWorkspaceName = ctx.locale.bind('common')('workspace.defaultName');
  // settings.section slot 不提供 useWorkspaces；直接订阅 workspaces 服务的工作区列表。
  const workspacesSource = (ctx as unknown as { get?: (name: string) => unknown }).get?.('workspaces') as { list?: { getSnapshot(): { items: ReadonlyArray<WorkspaceItem> }; subscribe(listener: () => void): () => void } } | undefined;
  const useWorkspacesList = (): ReadonlyArray<WorkspaceItem> => {
    const list = workspacesSource?.list;
    return useSyncExternalStore(
      (listener) => list ? list.subscribe(listener) : () => {},
      () => list ? list.getSnapshot().items : EMPTY_WORKSPACES,
    );
  };
  const SettingsSection = (): ReactNode => createElement(QQBotSettingsSection, { selectorSource, store, t, workspaces: useWorkspacesList(), defaultWorkspaceName });
  let settingsRequested = false;
  let showSettings: (() => void) | undefined;
  const installSettingsHandler = (handler: (() => void) | undefined): void => { showSettings = handler; };
  const initialSettings = (): boolean => { const value = settingsRequested; settingsRequested = false; return value; };
  const MainPage = (): ReactNode => createElement(QQBotPage, { selectorSource, store, t, initialSettings, installSettingsHandler, workspaces: useWorkspacesList(), defaultWorkspaceName });
  const slots = (ctx as unknown as { slots?: SlotsLike }).slots;

  const disposers: Array<() => void> = [];
  installNativeQQConversation(ctx, store, selectorSource, t);

  // 1. 设置页「QQ Bot」栏目（主展示位：注册即展示，无时序依赖）
  if (slots !== undefined) {
    disposers.push(    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'qqbot', order: 7, label: 'QQ 机器人' },
      SettingsSection,
    )));
  }

  ctx.inject(['layout', 'uiSession', 'sessions'], (pageCtx) => {
      const pageSlots = pageCtx.slots;
      const layout = pageCtx.layout;
      const stopMain = pageSlots.inject('main', () => pageSlots.register(
        { name: 'main', key: IM_MAIN_PANEL_ID },
        MainPage,
      ));
      const showAccountSettings = (): void => { settingsRequested = !showSettings; showSettings?.(); navigation.openSettings(); };
      const actions: QQSidebarActions = {
        onExit: () => { navigation.exit(); layout.selectPanel(null); },
        onOpenSettings: showAccountSettings,
        nativeCatalog: { refresh: () => pageCtx.sessions.refresh(), summaries: () => pageCtx.sessions.list.getSnapshot().byId },
        renameSession: async (sessionId, title) => {
          await pageCtx.sessions.using(SessionId(sessionId), { source: 'qqbotOperation' }, async (reference) => {
            const result = await reference.binding.session.rename(title);
            if (!result.ok) throw new Error(result.error.message);
          });
        },
      };
      const navigation = installQQSidebarNavigation({ store, layout, currentSession: pageCtx.uiSession.adapter.current,
        navigation: pageCtx.uiWorkspace,
        mountSidebar: () => pageSlots.inject('sidebar.workspaces', () => pageSlots.register(
          { name: 'sidebar.workspaces', priority: -1 },
          (props) => createElement(QQSidebar, { ...props, store, actions, t, defaultWorkspaceName: ctx.locale.bind('common')('workspace.defaultName') }),
        )),
      });
      const detailSlots = pageSlots as unknown as SlotsLike;
      const stopActions = detailSlots.inject('plugins.detail.actions', () => detailSlots.register(
        {
          name: 'plugins.detail.actions', id: 'im-qqbot-open', order: 20,
          inject: () => ({
            packageName: PACKAGE_NAME,
            onOpen: showAccountSettings,
          }),
        },
        OpenQqBotAction,
      ));
      // 左侧栏入口：id 与 main 席位 key 一致，宿主点击即 selectPanel
      const stopSidebar = pageSlots.inject('sidebar.panellist', () => pageSlots.register(
        {
          name: 'sidebar.panellist', id: IM_MAIN_PANEL_ID,
          order: 10, label: 'QQ 机器人',
        },
        QqBotSidebarIcon,
      ));
      return () => {
        navigation.dispose();
        stopActions();
        stopSidebar();
        stopMain();
      };
    });

  (ctx as unknown as { effect(fn: () => () => void, name?: string): void }).effect(() => () => {
    for (const dispose of disposers.reverse()) dispose();
  }, 'im-qqbot-client.binding');
}
