/**
 * 客户端插件版本号 —— 由 tsdown.client.config.ts 的 `define` 在构建期注入
 * （bundle 与包同版本发布，无需运行时向服务端请求）。
 *
 * 未注入的环境（vitest 等）返回 'unknown'：`typeof` 对未声明标识符安全，
 * 不会抛错；构建后该表达式被常量折叠为字面量。
 */
declare const __DSH_QQBOT_VERSION__: string;

export const PLUGIN_VERSION: string = typeof __DSH_QQBOT_VERSION__ === 'string' && __DSH_QQBOT_VERSION__ !== ''
  ? __DSH_QQBOT_VERSION__
  : 'unknown';
