/**
 * 端内绑定协议 —— 宿主路由与客户端面板的共享契约
 *
 * 类型唯一事实源：宿主（setup/bind-routes.ts 的 RPC 处理器）与浏览器
 * （client/bind-page.ts）各自 import，杜绝两端协议漂移。
 * 传输走宿主 Connection 通道（shared/rpc-protocol.ts 的端点与方法名）。
 * 本模块必须保持纯类型 + 纯常量（零 node 依赖、零副作用）：
 * 客户端 tsdown 构建会将其内联进 bundle。
 */

/** 线上协议（RPC 方法返回的序列化形态） */
export type BindStateWire =
  | { phase: 'starting' }
  | { phase: 'waiting'; url: string; qrSvg?: string; issuedAt: number }
  | { phase: 'saving' }
  | { phase: 'failed'; reason: string }
  | { phase: 'bound'; appId: string };

/** manual / unbind 操作的统一响应值 */
export interface BindActionResponse {
  ok: boolean;
  message?: string;
  error?: string;
}
