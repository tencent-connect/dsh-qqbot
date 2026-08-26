/**
 * 分块发送 markdown 工具
 *
 * 长内容自动按 QQ 消息限制切分后逐条发送。
 */
import type { SlashCommandHandlerContext } from '@tencent-connect/qqbot-nodejs';
import { chunkMarkdownText } from '../transport/chunker.ts';

/**
 * 分块发送 markdown（长内容自动切分）
 */
export async function sendMarkdownChunked(
  cmdCtx: SlashCommandHandlerContext,
  content: string,
  chunkLimit: number,
): Promise<void> {
  const bot = (cmdCtx as unknown as Record<string, unknown>).bot as { sendMarkdown(target: unknown, content: string): Promise<unknown> };
  const replyTarget = (cmdCtx as unknown as Record<string, unknown>).replyTarget;
  const chunks = chunkMarkdownText(content, chunkLimit);
  for (const chunk of chunks) {
    await bot.sendMarkdown(replyTarget, chunk);
  }
}
