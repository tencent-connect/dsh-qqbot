/**
 * im-qqbot 浏览器半边 —— QQ Bot 端内扫码绑定入口
 *
 * 宿主插件在凭据缺失时注册 /qqbot/im-qqbot/bind 状态路由；本插件在
 * Web / Desktop 提供两个展示位：
 *
 * 1. 设置页「QQ Bot」栏目（settings.section 席位）——注册即展示，
 *    无 Session surface 时序依赖，待绑定/已绑定状态常驻可见；
 * 2. 右侧栏「QQ Bot 绑定」页（sidebarRightTabs）——Start 页入口。
 *    不自动打开：待绑定状态由用户从 Start 页（或设置页）主动进入。
 *
 * 运行时依赖仅 react（客户端平台种子表提供）；宿主服务经 cordis inject
 * 声明访问（声明缺失时插件保持 inactive，不阻塞浏览器启动）。
 */
import type { Context } from '@deepseek-ai/cordis';
import { createElement, type ReactNode } from 'react';
import { BindPanelBody, useBindState, QQ_BOT_LOGO_PATH, installPanelStyles } from './bind-page.ts';
import { ConfigPanel } from './config-panel.ts';

export const name = 'im-qqbot-client';
export const inject = ['slots', 'sidebarRightTabs'];

/** 侧栏 Tab 类型（ui-sidebar-right 契约的局部投影） */
const TAB_KIND = 'qqbot-bind';
/** 席位注册 key（Tab 类型 id，席位按其分发；只需全局唯一，与包名解耦） */
const TAB_ID = 'im-qqbot/bind';
/** 本插件包名（插件详情页按其匹配来源包，只在对应详情页渲染操作按钮） */
const PACKAGE_NAME = '@tencent-connect/dsh-qqbot';
/** 主面板 id（layout.selectPanel 导航目标；keyed main 席位按其分发） */
const IM_MAIN_PANEL_ID = 'im-qqbot';

/** ui-sidebar-right 的 Tab 注册表服务（局部投影） */
interface TabRegistryLike {
  register(definition: {
    id: string;
    kind: string;
    title: (address: string) => string;
    guide?: ReadonlyArray<{
      id: string;
      order: number;
      title: () => string;
      description: () => string;
      icon: unknown;
    }>;
  }): () => void;
}

/** ui-slots 的席位系统服务（局部投影） */
interface SlotsLike {
  inject(slotName: string, register: () => (() => void)): () => void;
  register(spec: Record<string, unknown>, component: unknown): () => void;
}

/** 绑定入口图标（QQ 机器人，跟随主题图标色变量） */
function BindGuideIcon(): ReactNode {
  return createElement('svg', {
    width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true,
  },
    createElement('path', {
      d: 'M9.50039 11.1504C9.96983 11.1504 10.3504 11.5309 10.3504 12.0004V14.0004C10.3504 14.4698 9.96983 14.8504 9.50039 14.8504C9.03095 14.8504 8.65039 14.4698 8.65039 14.0004V12.0004C8.65039 11.5309 9.03095 11.1504 9.50039 11.1504Z',
      fill: 'var(------icon_primary, #1A1A1A)',
    }),
    createElement('path', {
      d: 'M14.5004 11.1504C14.9698 11.1504 15.3504 11.5309 15.3504 12.0004V14.0004C15.3504 14.4698 14.9698 14.8504 14.5004 14.8504C14.0309 14.8504 13.6504 14.4698 13.6504 14.0004V12.0004C13.6504 11.5309 14.0309 11.1504 14.5004 11.1504Z',
      fill: 'var(------icon_primary, #1A1A1A)',
    }),
    createElement('path', {
      fillRule: 'evenodd',
      clipRule: 'evenodd',
      d: 'M12.8504 5.3109C13.5299 4.99138 14.0004 4.30063 14.0004 3.5C14.0004 2.39543 13.1049 1.5 12.0004 1.5C10.8958 1.5 10.0004 2.39543 10.0004 3.5C10.0004 4.30065 10.4708 4.99141 11.1504 5.31092V6.18851C6.38487 6.61795 2.65039 10.6231 2.65039 15.5004V17.0004C2.65039 19.679 4.82181 21.8504 7.50039 21.8504H16.5004C19.179 21.8504 21.3504 19.679 21.3504 17.0004V15.5004C21.3504 10.6231 17.6159 6.61795 12.8504 6.18851V5.3109ZM12.0004 7.85039C7.77541 7.85039 4.35039 11.2754 4.35039 15.5004V17.0004C4.35039 18.7401 5.76069 20.1504 7.50039 20.1504H16.5004C18.2401 20.1504 19.6504 18.7401 19.6504 17.0004V15.5004C19.6504 11.2754 16.2254 7.85039 12.0004 7.85039Z',
      fill: 'var(------icon_primary, #1A1A1A)',
    }),
  );
}

/** 设置页栏目：共享一份绑定状态轮询，驱动绑定面板与配置刷新 */
function QQBotSettingsSection(): ReactNode {
  const { state, gone, recheck } = useBindState();
  return createElement('div', null,
    createElement<NonNullable<Parameters<typeof BindPanelBody>[0]>>(BindPanelBody, { state, gone, recheck }),
    createElement<NonNullable<Parameters<typeof ConfigPanel>[0]>>(ConfigPanel, { bindPhase: state?.phase }),
  );
}

/** 主面板页面：与设置栏目同一内容，包一层滚动留白容器（plugins.detail.actions 的跳转目标） */
function QQBotPage(): ReactNode {
  return createElement('div', { className: 'imqb-pluginPage' },
    createElement('div', { className: 'imqb-pluginPageContent' },
      createElement(QQBotSettingsSection)),
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
  // 面板样式全局安装：插件详情按钮等面板外渲染的元素也需要可见
  installPanelStyles();
  const tabs = (ctx as unknown as { sidebarRightTabs?: TabRegistryLike }).sidebarRightTabs;
  const slots = (ctx as unknown as { slots?: SlotsLike }).slots;

  const disposers: Array<() => void> = [];

  // 1. 设置页「QQ Bot」栏目（主展示位：注册即展示，无时序依赖）
  if (slots !== undefined) {
    disposers.push(    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'qqbot', order: 7, label: 'QQ 机器人' },
      QQBotSettingsSection,
    )));
    // 1.5 设置页导航图标
    try {
      disposers.push(slots.inject('settings.section.icon', () => slots.register(
        { name: 'settings.section.icon', id: 'qqbot' },
        QqBotSidebarIcon,
      )));
    } catch {
      // 旧宿主注入失败：仅失去自定义图标，设置栏目本身不受影响
    }
  }

  // 2. 侧栏绑定页（快捷展示位：Start 页入口；不自动打开）
  if (tabs !== undefined && slots !== undefined) {
    disposers.push(tabs.register({
      id: TAB_ID,
      kind: TAB_KIND,
      title: () => 'QQ 机器人绑定',
      guide: [{
        id: 'bind',
        order: 90,
        title: () => 'QQ 机器人绑定',
        description: () => '扫码或手动填写，绑定 QQ 机器人',
        icon: BindGuideIcon,
      }],
    }));
    disposers.push(slots.inject('sidebar.right.pane.tab', () => slots.register(
      { name: 'sidebar.right.pane.tab', key: TAB_ID },
      BindPanelBody,
    )));
  }

  // 3. 主面板 + 插件详情「设置」操作（layout.selectPanel 导航，
  const ctxInject = (ctx as unknown as {
    inject?: (deps: readonly string[], callback: (pageCtx: Context) => (() => void) | undefined) => unknown;
  }).inject;
  if (typeof ctxInject === 'function') {
    // ctx.inject 返回 Fiber（非 disposer）：子插件随父插件卸载自动清理，
    // 回调返回的清理函数由 cordis 在依赖变更/卸载时调用。
    void ctxInject.call(ctx, ['layout'], (pageCtx: Context) => {
      const pageSlots = (pageCtx as unknown as { slots?: SlotsLike }).slots;
      const layout = (pageCtx as unknown as { layout?: { selectPanel(panelId: string | null): void } }).layout;
      if (pageSlots === undefined || layout === undefined) return undefined;
      const stopMain = pageSlots.inject('main', () => pageSlots.register(
        { name: 'main', key: IM_MAIN_PANEL_ID },
        QQBotPage,
      ));
      const stopActions = pageSlots.inject('plugins.detail.actions', () => pageSlots.register(
        {
          name: 'plugins.detail.actions', id: 'im-qqbot-open', order: 20,
          inject: () => ({
            packageName: PACKAGE_NAME,
            onOpen: () => layout.selectPanel(IM_MAIN_PANEL_ID),
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
        stopActions();
        stopSidebar();
        stopMain();
      };
    });
  }

  (ctx as unknown as { effect(fn: () => () => void, name?: string): void }).effect(() => () => {
    for (const dispose of disposers.reverse()) dispose();
  }, 'im-qqbot-client.binding');
}
