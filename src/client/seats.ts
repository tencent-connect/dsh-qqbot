/**
 * 席位装配 —— 每个函数体回答「挂在哪、用哪个视图」，返回清理。
 *
 * 生命周期模型（勿混用）：
 * - slots / sidebarRightTabs 已由 inject 声明：直接注册，disposer 交给
 *   chain，由 apply 的 ctx.effect 统一清理。
 * - layout 依赖席位（主面板 / 详情操作 / 左侧栏入口）：ctx.inject(['layout'])
 *   子 fiber 注册，回调返回清理，由 cordis 在依赖变更/卸载时调用。
 */
import type { Context } from '@deepseek-ai/cordis';
import { hostLayout, trySeat, type Disposer } from './host.ts';
import { BindGuideIcon, OpenQqBotAction, QQBotPage, QQBotView, QqBotSidebarIcon } from './views.ts';
import { BindPanelBody } from './bind-page.ts';

/** 侧栏 Tab 类型（ui-sidebar-right 契约的局部投影） */
const TAB_KIND = 'qqbot-bind';
/** 席位注册 key（Tab 类型 id，席位按其分发；只需全局唯一，与包名解耦） */
const TAB_ID = 'im-qqbot/bind';
/** 本插件包名（插件详情页按其匹配来源包，只在对应详情页渲染操作按钮） */
const PACKAGE_NAME = '@tencent-connect/dsh-qqbot';
/** 主面板 id（layout.selectPanel 导航目标；keyed main 席位按其分发） */
const IM_MAIN_PANEL_ID = 'im-qqbot';

/**
 * 装配全部席位。幂等性由调用方保证（apply 每次调用恰好一次）。
 *
 * @param ctx - 插件上下文（slots / sidebarRightTabs 已由 inject 声明在场）
 * @param dispose - 席位清理链（layout 子 fiber 自清理，不入链）
 */
export function wireSeats(ctx: Context, dispose: Disposer): void {
  const { slots } = ctx;
  const { sidebarRightTabs: tabs } = ctx;

  // 1. 设置页「QQ Bot」栏目（主展示位：注册即展示，无时序依赖）
  dispose.add(slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'qqbot', order: 7, label: 'QQ 机器人' },
    QQBotView,
  )));
  // 1.5 设置页导航图标（0.2.2 新席位；旧宿主缺失仅失去图标，栏目不受影响）
  dispose.add(trySeat(() => slots.inject('settings.section.icon', () => slots.register(
    { name: 'settings.section.icon', id: 'qqbot' },
    QqBotSidebarIcon,
  ))));

  // 2. 侧栏绑定页（快捷展示位：Start 页入口；不自动打开）
  dispose.add(tabs.register({
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
  dispose.add(slots.inject('sidebar.right.pane.tab', () => slots.register(
    { name: 'sidebar.right.pane.tab', key: TAB_ID },
    BindPanelBody,
  )));

  // 3. layout 依赖席位：ctx.inject 子 fiber（服务就绪才注册，卸载自清理）。
  //    子 fiber 内：slots 经父 fiber 声明继承可读，layout 经 hostLayout 读取。
  //    ctx.inject 返回 Fiber，随父插件卸载自动清理，无需入链。
  void ctx.inject(['layout'], (pageCtx: Context) => {
    const pageSlots = pageCtx.slots;
    const layout = hostLayout(pageCtx);
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
