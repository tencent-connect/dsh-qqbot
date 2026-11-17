/**
 * im-qqbot 浏览器半边 —— QQ Bot 端内扫码绑定入口
 *
 * 宿主插件在凭据缺失时注册 /qqbot/im-qqbot/bind 状态路由；本插件在
 * Web / Desktop 提供三个展示位：
 *
 * 1. 设置页「QQ Bot」栏目（settings.section 席位）——注册即展示，
 *    无 Session surface 时序依赖，待绑定/已绑定状态常驻可见；
 * 2. 右侧栏「QQ Bot 绑定」页（sidebarRightTabs）——Start 页入口，
 *    不自动打开：待绑定状态由用户从 Start 页（或设置页）主动进入；
 * 3. 主面板页 + 插件详情「设置」操作 + 左侧栏入口（layout 席位，
 *    经 ctx.inject 子 fiber，服务就绪才注册）。
 *
 * 分层（见各文件头）：host.ts 服务类型与增强 → seats.ts 席位装配 →
 * views.ts 组合视图 → store.ts 单一状态轮询 → http.ts 同源传输。运行时依赖仅 react（客户端平台种子表提供）；
 * 宿主服务经 cordis inject 声明访问（声明缺失时插件保持 inactive，
 * 不阻塞浏览器启动）。
 */
import type { Context } from '@deepseek-ai/cordis';
import { chain } from './host.ts';
import { installBindPanelStyles } from './styles.ts';
import { wireSeats } from './seats.ts';
import { setClientConnection } from './rpc.ts';

export const name = 'im-qqbot-client';
export const inject = ['slots', 'sidebarRightTabs', 'connection'];

export function apply(ctx: Context): void {
  // 端内 RPC 通道：宿主浏览器 Connection 服务（/api 共享通道，来源围栏
  // 与认证由宿主施加）。HMR 重载时以新 handle 重设。
  setClientConnection(ctx.connection);
  const dispose = chain();
  ctx.effect(() => {
    // 面板样式全局安装：插件详情按钮等面板外渲染的元素也需要可见
    // （引用计数，插件卸载时随本 effect 清理）
    const retainStyles = installBindPanelStyles();
    wireSeats(ctx, dispose);
    return () => {
      retainStyles();
      dispose.run();
    };
  }, 'im-qqbot-client.seats');
}
