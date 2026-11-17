/**
 * 视图层 —— 全部展示位共用的组合视图与图标。
 *
 * 组合根（QQBotView / QQBotPage / BindPanelBody）经 store 订阅状态；
 * 其余组件保持纯 props + 回调（可脱离宿主/网络测试）。席位 adapter
 * （seats.ts）只回答「挂在哪、用哪个视图」，内容演进只改本文件。
 */
import { createElement, type ReactNode } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { BindPanelBody, QQ_BOT_LOGO_PATH, useBindState } from './bind-page.ts';
import { ConfigPanel } from './config-panel.ts';

/**
 * 设置栏目与主面板的完整视图：绑定面板 + 配置面板，共享同一 store 轮询。
 * 配置面板按绑定相位刷新（bound 态才拉取命令清单等 bound-only 数据）。
 */
export function QQBotView(): ReactNode {
  const { state } = useBindState();
  const appId = state?.phase === 'bound' ? state.appId : null;
  return createElement('div', null,
    createElement(BindPanelBody),
    createElement<NonNullable<Parameters<typeof ConfigPanel>[0]>>(ConfigPanel, {
      key: appId === null ? 'unbound' : `bound:${appId}`,
      appId,
      bindPhase: state?.phase,
    }),
  );
}

/** 主面板页面：完整视图包一层滚动留白容器（plugins.detail.actions 的跳转目标） */
export function QQBotPage(): ReactNode {
  return createElement('div', { className: 'imqb-pluginPage' },
    createElement('div', { className: 'imqb-pluginPageContent' },
      createElement(QQBotView)),
  );
}

/** 左侧栏入口图标（宿主传入 size：展开 18 / 收起 16；currentColor 跟随侧栏配色与选中态） */
export function QqBotSidebarIcon({ size = 16 }: { size?: number; active?: boolean }): ReactNode {
  return createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true,
  },
    createElement('path', { d: QQ_BOT_LOGO_PATH, fill: 'currentColor' }));
}

/** 侧栏 Start 页引导图标（currentColor 跟随宿主容器配色，明暗主题自适应） */
export function BindGuideIcon(): ReactNode {
  return createElement('svg', {
    width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true,
  },
    createElement('path', {
      d: 'M9.50039 11.1504C9.96983 11.1504 10.3504 11.5309 10.3504 12.0004V14.0004C10.3504 14.4698 9.96983 14.8504 9.50039 14.8504C9.03095 14.8504 8.65039 14.4698 8.65039 14.0004V12.0004C8.65039 11.5309 9.03095 11.1504 9.50039 11.1504Z',
      fill: 'currentColor',
    }),
    createElement('path', {
      d: 'M14.5004 11.1504C14.9698 11.1504 15.3504 11.5309 15.3504 12.0004V14.0004C15.3504 14.4698 14.9698 14.8504 14.5004 14.8504C14.0309 14.8504 13.6504 14.4698 13.6504 14.0004V12.0004C13.6504 11.5309 14.0309 11.1504 14.5004 11.1504Z',
      fill: 'currentColor',
    }),
    createElement('path', {
      fillRule: 'evenodd',
      clipRule: 'evenodd',
      d: 'M12.8504 5.3109C13.5299 4.99138 14.0004 4.30063 14.0004 3.5C14.0004 2.39543 13.1049 1.5 12.0004 1.5C10.8958 1.5 10.0004 2.39543 10.0004 3.5C10.0004 4.30065 10.4708 4.99141 11.1504 5.31092V6.18851C6.38487 6.61795 2.65039 10.6231 2.65039 15.5004V17.0004C2.65039 19.679 4.82181 21.8504 7.50039 21.8504H16.5004C19.179 21.8504 21.3504 19.679 21.3504 17.0004V15.5004C21.3504 10.6231 17.6159 6.61795 12.8504 6.18851V5.3109ZM12.0004 7.85039C7.77541 7.85039 4.35039 11.2754 4.35039 15.5004V17.0004C4.35039 18.7401 5.76069 20.1504 7.50039 20.1504H16.5004C18.2401 20.1504 19.6504 18.7401 19.6504 17.0004V15.5004C19.6504 11.2754 16.2254 7.85039 12.0004 7.85039Z',
      fill: 'currentColor',
    }),
  );
}

/** 插件详情「设置」按钮：仅在本包的 bundle / 组件行详情页渲染，其他插件不显示。
 *  样式走宿主统一 Button 原语（与详情页自身的更新/卸载按钮同规格）。 */
export function OpenQqBotAction({ subject, packageName, onOpen }: {
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
