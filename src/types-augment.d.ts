/**
 * SDK MiddlewareState 类型扩展
 *
 * 为 @tencent-connect/qqbot-nodejs 的 MiddlewareState 添加
 * 项目自定义中间件填充的 well-known keys 类型声明。
 *
 * - downloadedFiles: attachmentProcessor 中间件 → 下载到本地的当前消息附件
 * - downloadedQuoteFiles: attachmentProcessor 中间件 → 下载到本地的引用消息附件
 * - preDownloadedFiles: 群图片在 @ 门控前预下载的结果
 */
import '@tencent-connect/qqbot-nodejs';
import type { DownloadedFile } from './transport/attachment.ts';

declare module '@tencent-connect/qqbot-nodejs' {
  interface MiddlewareState {
    /** attachmentProcessor 下载到本地的当前消息附件结果 */
    downloadedFiles?: DownloadedFile[];
    /** attachmentProcessor 下载到本地的引用消息附件结果 */
    downloadedQuoteFiles?: DownloadedFile[];
    /** 门控前群图片预下载结果 */
    preDownloadedFiles?: DownloadedFile[];
  }
}

