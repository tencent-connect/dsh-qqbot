/**
 * 端内 RPC 协议 —— 宿主 Connection 通道上的共享契约。
 *
 * 浏览器可写面不再注册裸 webServer 路由，而是挂宿主 `/api` 共享通道
 * （ctx.connection.fetch）：来源围栏（Host/Origin trust）与浏览器认证由
 * 宿主在 handler 之前施加，插件只做授权后的业务校验。
 *
 * 通道模型：一个端点 = 一条 connection fetch 路由（POST + 信封协议），
 * 端点内以 method 字段分发。本模块必须保持纯常量（零 node 依赖）：
 * 客户端 bundle 会内联。
 */

/** 共享 Fetch 通道（宿主 connection 固定值） */
export const RPC_CHANNEL = '/api';

/** 绑定/配置端点（fetch 路由 path = `/api/dsh-qqbot/bind`） */
export const BIND_RPC_ENDPOINT = 'dsh-qqbot/bind';

/** 命令清单与配对端点（fetch 路由 path = `/api/dsh-qqbot/account`） */
export const ACCOUNT_RPC_ENDPOINT = 'dsh-qqbot/account';

/** 绑定端点的方法名 */
export const BIND_METHODS = {
  state: 'bind.state',
  refresh: 'bind.refresh',
  manual: 'bind.manual',
  unbind: 'bind.unbind',
  configGet: 'config.get',
  configSet: 'config.set',
} as const;

/** 账号端点的方法名 */
export const ACCOUNT_METHODS = {
  commands: 'commands.list',
  pairStatus: 'pair.status',
  pairIssue: 'pair.issue',
  pairEnd: 'pair.end',
  pairManual: 'pair.manual',
  pairRename: 'pair.rename',
  pairRevoke: 'pair.revoke',
} as const;

/** 错误码（客户端按 code 区分冲突/重载/传输失败等语义） */
export const RPC_ERROR_CODES = {
  /** 配置保存与他人写入冲突（旧 HTTP 409） */
  configConflict: 'config/conflict',
  /** 配置草稿所属账号已变化，禁止跨账号写入。 */
  accountChanged: 'config/account-changed',
  /** 插件正在重载，动作未生效（旧 HTTP 503） */
  pluginReloading: 'plugin/reloading',
  /** 传输层 404：端点未注册（插件未启用/已卸载） */
  routeMissing: 'transport/404',
  /** 未知方法名（客户端 bug，非用户可见状态） */
  unknownMethod: 'qqbot/unknown-method',
} as const;
