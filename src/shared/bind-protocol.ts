/**
 * 端内绑定协议 —— 宿主路由与客户端面板的共享契约
 *
 * 类型与路径常量的唯一事实源：宿主（setup/bind-routes.ts）与浏览器
 * （client/bind-page.ts）各自 import，杜绝两端协议漂移。
 * 本模块必须保持纯类型 + 纯常量 + 纯函数（零 node 依赖、零副作用）：
 * 客户端 tsdown 构建会将其内联进 bundle。
 */

/** 状态查询（绑定页轮询） */
export const BIND_STATE_PATH = '/qqbot/im-qqbot/bind';

/** 刷新二维码（绑定页按钮） */
export const BIND_REFRESH_PATH = '/qqbot/im-qqbot/bind/refresh';

/** 手动填写/编辑凭据（绑定页表单） */
export const BIND_MANUAL_PATH = '/qqbot/im-qqbot/bind/manual';

/** 解绑：移除已保存凭据，回到绑定流程 */
export const BIND_UNBIND_PATH = '/qqbot/im-qqbot/bind/unbind';

/** 配置读写（设置面板表单） */
export const BIND_CONFIG_PATH = '/qqbot/im-qqbot/config';

/**
 * 客户端请求 URL —— 剥离开头的 `/`，交给浏览器（或 Desktop 壳的 IPC 桥）
 * 按当前页面地址做相对解析。
 *
 * 服务端路由仍以本模块的绝对路径常量注册（宿主根路径）；但浏览器端若直接
 * `fetch('/qqbot/...')`，会绕过反向代理挂载的子路径前缀。典型场景：
 * `dsh web --public-url https://host/dsh/` 下浏览器实际请求
 * `https://host/qqbot/...`（404），而应为 `https://host/dsh/qqbot/...`（200）。
 * DSH 主工程的客户端请求（如 `api/upload`）同样使用无前导斜杠的相对路径，
 * 此处保持一致。
 *
 * @param path - 服务端注册用绝对路径（如 `/qqbot/im-qqbot/bind`）
 * @returns 客户端可用相对路径（如 `qqbot/im-qqbot/bind`）
 */
export function toClientUrl(path: string): string {
  return path.replace(/^\/+/, '');
}

/** 线上协议（HTTP 路由序列化形态） */
export type BindStateWire =
  | { phase: 'starting' }
  | { phase: 'waiting'; url: string; qrSvg?: string; issuedAt: number }
  | { phase: 'saving' }
  | { phase: 'failed'; reason: string }
  | { phase: 'bound'; appId: string };

/** manual / unbind 操作的统一响应 */
export interface BindActionResponse {
  ok: boolean;
  message?: string;
  error?: string;
}
