/** QQ 工作台、设置和原生会话操作的客户端入口。 */
import type { Context } from '@deepseek-ai/cordis';
import { createElement, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, IconChevronLeftOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { QQ_BOT_LOGO_PATH, installPanelStyles } from './bind-page.ts';
import { hasQqSessionOrigin, QQWorkbench, restoreQqSessionOrigin } from './workbench.ts';
import { WorkbenchExtensions } from './workbench-extensions.ts';
import { QqAnswerAction } from './workbench-answer.ts';
import type { AgentFormSource, SessionModelSource } from './workbench-agent-form.ts';

export const name = 'im-qqbot-client';
export const inject = ['slots'];

/** 本插件包名（插件详情页按其匹配来源包，只在对应详情页渲染操作按钮） */
const PACKAGE_NAME = '@tencent-connect/dsh-qqbot';
/** 主面板 id（layout.selectPanel 导航目标；keyed main 席位按其分发） */
const IM_MAIN_PANEL_ID = 'im-qqbot';
const emptyArchived: readonly string[] = [];
const noop = (): void => {};

/** ui-slots 的席位系统服务（局部投影） */
interface SlotsLike {
  inject(slotName: string, register: () => (() => void)): () => void;
  register(spec: Record<string, unknown>, component: unknown): () => void;
}

interface SavedSidebarTabs {
  openTabs: {
    getSnapshot(): readonly { sessionId: string; tabId: string; kind: string }[];
    subscribe(listener: () => void): () => void;
  };
  closeIn(sessionId: string, tabId: string): void;
}

interface ProfileSettingsRemote {
  describe(): Promise<{ ok: boolean; value?: { hasDocument: boolean } }>;
  openSettingsDocument(): Promise<{ ok: boolean }>;
}

function OpenProfileConfig({ remote }: { remote?: ProfileSettingsRemote }): ReactNode {
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState(false);
  const [opening, setOpening] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    setAvailable(false);
    setError(false);
    void remote?.describe().then(result => {
      if (active) setAvailable(result.ok && result.value?.hasDocument === true);
    }).catch(() => {});
    return () => { active = false; };
  }, [remote]);
  if (!available || !remote) return null;
  const open = async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setOpening(true);
    setError(false);
    try {
      const result = await remote.openSettingsDocument();
      setError(!result.ok);
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setOpening(false);
    }
  };
  return createElement('div', { className: 'imqw-actions' },
    error ? createElement('span', { className: 'imqb-error', role: 'alert' }, '无法打开配置文件。') : null,
    createElement(Button, { type: 'button', size: 'sm', variant: 'outline', disabled: opening,
      title: '打开当前 DSH 配置的 cordis.patch.yml', onClick: () => { void open(); },
    }, '打开配置文件'),
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
  return createElement('button', {
    type: 'button', className: 'imqb-pluginOpen', onClick: onOpen,
  }, '设置');
}

export function apply(ctx: Context): void {
  const extensions = new WorkbenchExtensions();
  ctx.provide('qqbotWorkbench', extensions);
  // 面板样式全局安装：插件详情按钮等面板外渲染的元素也需要可见
  installPanelStyles();
  const slots = (ctx as unknown as { slots?: SlotsLike }).slots;

  const disposers: Array<() => void> = [];

  if (slots) {
    const slot = 'conversation.chat.assistant-actions';
    disposers.push(slots.inject(slot, () => slots.register(
      { name: slot, id: 'im-qqbot-send-answer', order: 30 },
      QqAnswerAction,
    )));
  }

  const ctxInject = (ctx as unknown as {
    inject?: (deps: readonly string[], callback: (pageCtx: Context) => (() => void) | undefined) => unknown;
  }).inject;
  if (typeof ctxInject === 'function') {
    // Close the removed page when the host adopts a layout that still contains it.
    void ctxInject.call(ctx, ['sidebarRight'], scope => {
      const sidebar = scope.get('sidebarRight') as Partial<SavedSidebarTabs> | undefined;
      if (!sidebar?.openTabs || !sidebar.closeIn) return undefined;
      const { openTabs } = sidebar;
      const close = sidebar.closeIn.bind(sidebar);
      let stopped = false;
      let scheduled = false;
      const removeOldTabs = () => {
        if (scheduled || stopped) return;
        scheduled = true;
        queueMicrotask(() => {
          if (!stopped) {
            for (const tab of openTabs.getSnapshot()) {
              if (tab.kind === 'qqbot-bind') close(tab.sessionId, tab.tabId);
            }
          }
          scheduled = false;
        });
      };
      const unsubscribe = openTabs.subscribe(removeOldTabs);
      removeOldTabs();
      return () => { stopped = true; unsubscribe(); };
    });
    // ctx.inject 返回 Fiber（非 disposer）：子插件随父插件卸载自动清理，
    // 回调返回的清理函数由 cordis 在依赖变更/卸载时调用。
    void ctxInject.call(ctx, ['layout'], (pageCtx: Context) => {
      const pageSlots = (pageCtx as unknown as { slots?: SlotsLike }).slots;
      const layout = (pageCtx as unknown as { layout?: {
        selectPanel(panelId: string | null): void;
      } }).layout;
      if (pageSlots === undefined || layout === undefined) return undefined;
      const settingsListeners = new Set<() => void>();
      let settingsPending = false;
      let profileSettings: ProfileSettingsRemote | undefined;
      const emitSettings = (): void => {
        for (const listener of settingsListeners) listener();
      };
      const subscribeSettings = (listener: () => void): (() => void) => {
        settingsListeners.add(listener);
        return () => { settingsListeners.delete(listener); };
      };
      const dismissSettingsRequest = (): void => {
        settingsPending = false;
        emitSettings();
      };
      const openRobotSettings = (): void => {
        layout.selectPanel(IM_MAIN_PANEL_ID);
        settingsPending = true;
        emitSettings();
      };
      void ctxInject.call(pageCtx, ['remote', 'remote.settings'], scope => {
        const { remote } = scope as unknown as { remote: {
          $host?: { isLoopback: boolean }; settings: ProfileSettingsRemote;
        } };
        if (!remote.$host?.isLoopback) return undefined;
        profileSettings = remote.settings;
        emitSettings();
        return () => { profileSettings = undefined; emitSettings(); };
      });
      type AgentRemotes = {
        session: {
          modelCatalog(): Promise<unknown>;
          openWorkspacePath?(request: { path: string }): Promise<{ ok: boolean }>;
        };
        agentPresets: { list(): Promise<unknown> };
        permissionPresets: { catalog(): Promise<unknown> };
      };
      let remote: AgentRemotes | undefined;
      void ctxInject.call(pageCtx, ['remote', 'remote.session', 'remote.agentPresets', 'remote.permissionPresets'], scope => {
        remote = (scope as unknown as { remote: AgentRemotes }).remote;
        return () => { remote = undefined; };
      });
      let addWorkspace: AgentFormSource['addWorkspace'];
      void ctxInject.call(pageCtx, ['workspaces', 'uiWorkspace'], scope => {
        const { workspaces, uiWorkspace } = scope as unknown as {
          uiWorkspace: { pickDirectory?(): Promise<string | null> };
          workspaces: { create?(input: { path: string }): Promise<{ path: string }> };
        };
        if (!uiWorkspace.pickDirectory || !workspaces.create) return undefined;
        const pickDirectory = uiWorkspace.pickDirectory.bind(uiWorkspace);
        const createWorkspace = workspaces.create.bind(workspaces);
        addWorkspace = async () => {
          const path = await pickDirectory();
          if (!path) return null;
          return (await createWorkspace({ path })).path;
        };
        return () => { addWorkspace = undefined; };
      });
      let hostLocale: { bind(namespace: string): (key: string) => string } | undefined;
      void ctxInject.call(pageCtx, ['locale'], scope => {
        hostLocale = (scope as unknown as { locale: typeof hostLocale }).locale;
        return () => { hostLocale = undefined; };
      });
      const hostLabel = (namespace: string, key: string): string | undefined => {
        const label = hostLocale?.bind(namespace)(key);
        return label && label !== key && label !== `${namespace}.${key}` ? label : undefined;
      };
      const sessionService = () => pageCtx.get('sessions') as {
        list?: {
          subscribe(listener: () => void): () => void;
          getSnapshot(): {
            byId: Record<string, { title?: string }>;
            projectionsBySession?: Record<string, { values: { modelSelection?: unknown } }>;
          };
        };
        refresh?(): Promise<void>;
        refreshProjections?(id: string): Promise<void>;
      } | undefined;
      const sessionModels: SessionModelSource = {
        subscribe: listener => sessionService()?.list?.subscribe(listener) ?? noop,
        read: id => sessionService()?.list?.getSnapshot().projectionsBySession?.[id]?.values.modelSelection,
        refresh: id => sessionService()?.refreshProjections?.(id),
      };
      const presetNameKeys = new Map([
        ['standard', 'presetStandardName'], ['ptc', 'presetPtcName'],
        ['minimal', 'presetMinimalName'], ['cordis', 'presetCordisName'],
      ]);
      const permissionLabels = new Map([
        ['read-only', { key: 'preset.readOnly', nativeName: 'Read Only' }],
        ['workspace-write', { key: 'preset.workspaceWrite', nativeName: 'Workspace Write' }],
        ['danger-full-access', { key: 'preset.fullAccess', nativeName: 'Full access' }],
        ['auto', { key: 'auto.label', nativeName: 'Auto review' }],
      ]);
      const getRemote = (): AgentRemotes => {
        if (!remote) throw new Error('DSH 目录服务尚未就绪。');
        return remote;
      };
      const agentSource: AgentFormSource = {
        sessionModels,
        modelCatalog: () => getRemote().session.modelCatalog(),
        listAgentPresets: () => getRemote().agentPresets.list(),
        permissionCatalog: () => getRemote().permissionPresets.catalog(),
        localizePreset: id => {
          const key = presetNameKeys.get(id);
          return key && hostLabel('settings.agentPreset', key);
        },
        localizePermission: (id, name) => {
          const builtin = permissionLabels.get(id);
          return builtin && (id === name || name === builtin.nativeName)
            ? hostLabel('permission.access', builtin.key) : undefined;
        },
        get addWorkspace() { return addWorkspace; },
        openPromptFile: async path => {
          const session = getRemote().session;
          if (!(await session.openWorkspacePath?.({ path }))?.ok) {
            throw new Error('无法打开原文件，请在 DSH 宿主上编辑此文件。');
          }
        },
        workspaces: () => (pageCtx.get('workspaces') as {
          list?: { getSnapshot(): { items: readonly { path: string; title: string }[] } };
        } | undefined)?.list?.getSnapshot().items ?? [],
      };
      const QQBotPage = (): ReactNode => {
        const openSettings = useSyncExternalStore(subscribeSettings, () => settingsPending);
        const documentRemote = useSyncExternalStore(subscribeSettings, () => profileSettings);
        const workspace = pageCtx.get('uiWorkspace') as {
          openSession?(id: string): void;
          unarchiveSession?(id: string): Promise<void>;
        } | undefined;
        const sessions = sessionService();
        const workspaces = pageCtx.get('workspaces') as {
          list?: {
            subscribe?(listener: () => void): () => void;
            getSnapshot(): {
              archivedSessionIds: readonly string[];
              items: readonly { path: string; title: string; sessionIds: readonly string[] }[];
            };
          };
        } | undefined;
        const open = workspace?.openSession?.bind(workspace);
        const list = workspaces?.list;
        const archivedSessionIds = useSyncExternalStore(
          useCallback(listener => list?.subscribe?.(listener) ?? noop, [list]),
          () => list?.getSnapshot().archivedSessionIds ?? emptyArchived,
        );
        return createElement(QQWorkbench, {
          extensions,
          settingsRequest: openSettings ? dismissSettingsRequest : undefined,
          configFileAction: createElement(OpenProfileConfig, { remote: documentRemote }),
          agentSource, archivedSessionIds,
          restoreSession: workspace?.unarchiveSession?.bind(workspace),
          prepareSession: id => {
            const service = sessionService();
            return service?.list?.getSnapshot().byId[id] ? undefined : service?.refresh?.();
          },
          openSession: open ? id => {
            if (workspaces?.list?.getSnapshot().archivedSessionIds?.includes(id)) {
              throw new Error('这个 Session 已归档，请先在 DSH 工作区取消归档。');
            }
            open(id);
          } : undefined,
          sessionTitle: id => sessions?.list?.getSnapshot().byId[id]?.title,
          workspaceTitle: (id, cwd) => {
            const items = workspaces?.list?.getSnapshot().items;
            return items?.find(item => item.sessionIds.includes(id))?.title
              ?? items?.find(item => item.path === cwd)?.title;
          },
        });
      };
      const stopMain = pageSlots.inject('main', () => pageSlots.register(
        { name: 'main', key: IM_MAIN_PANEL_ID },
        QQBotPage,
      ));
      const stopActions = pageSlots.inject('plugins.detail.actions', () => pageSlots.register(
        {
          name: 'plugins.detail.actions', id: 'im-qqbot-open', order: 20,
          inject: () => ({
            packageName: PACKAGE_NAME,
            onOpen: openRobotSettings,
          }),
        },
        OpenQqBotAction,
      ));
      const ReturnToQq = ({ sessionId }: { sessionId: string }): ReactNode => hasQqSessionOrigin(sessionId) ? createElement(
        Button, { type: 'button', variant: 'toolbar', size: 'sm', onClick: () => {
          if (restoreQqSessionOrigin(sessionId)) layout.selectPanel(IM_MAIN_PANEL_ID);
        } }, createElement(IconChevronLeftOutlineRegular, { size: 14 }), '返回 QQ 对话',
      ) : null;
      const stopReturn = ['conversation.session.header.utilities', 'conversation.hero.options'].map(slot =>
        pageSlots.inject(slot, () => pageSlots.register({ name: slot, id: 'im-qqbot-return', order: 10 }, ReturnToQq)),
      );
      // 左侧栏入口：id 与 main 席位 key 一致，宿主点击即 selectPanel
      const stopSidebar = pageSlots.inject('sidebar.panellist', () => pageSlots.register(
        {
          name: 'sidebar.panellist', id: IM_MAIN_PANEL_ID,
          order: 10, label: 'QQ 机器人',
        },
        QqBotSidebarIcon,
      ));
      return () => {
        for (const stop of stopReturn) stop();
        stopActions();
        stopSidebar();
        stopMain();
      };
    });
  }

  (ctx as unknown as { effect(fn: () => () => void, name?: string): void }).effect(() => () => {
    for (const dispose of disposers.reverse()) dispose();
  }, 'im-qqbot-client.slots');
}
