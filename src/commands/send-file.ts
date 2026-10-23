/**
 * /sendfile <绝对路径> — 发送本地文件到当前私聊（v1 仅 c2c）
 *
 * 调用链：QQBot.sendFile → uploadMedia(base64 单发 <5MB / chunked ≥5MB)
 * → sendMediaMessage(msg_type=7)。被动上下文（replyTarget 带 msgId），
 * 不受主动 push 频控限制。
 *
 * 上限 v1 保守取 20MB（SDK base64 单传硬上限对齐值）；localPath 源
 * 5–100MB 分片链路 SDK 已具备，放宽与否留给配置项（D5）后续决定。
 *
 * 与 qqbot_send_file 工具的分工：工具 = 模型主动发文件（按扩展名分发
 * 图片/视频/语音/文件 + 路径白名单 + 被动三级兜底）；本命令 = 用户主动
 * 快速通道，直接把服务器上的文件推给自己，无需模型参与。
 *
 * ⚠ 安全边界：本命令等价于「按路径读本地文件」原语。斜杠命令对可达
 * 用户默认开放（access.c2cMode=open 时任何能私聊机器人的人可用），
 * 部署方应通过 slashCommand.allowFrom 收紧白名单；上游合并前需在
 * README 显著提示。
 */
import { existsSync, statSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import type { CategorizedCommand } from './types.ts';

/** 与 SDK file-utils MAX_UPLOAD_SIZE 对齐的 v1 上限（20MB） */
const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024;

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** 去掉参数外层引号（支持含空格路径） */
function unwrapQuotes(raw: string): string {
  const m = /^"([^"]*)"$|^'([^']*)'$/.exec(raw);
  return m ? (m[1] ?? m[2] ?? '') : raw;
}

export function sendFileCommand(): CategorizedCommand {
  return {
    name: 'sendfile',
    category: 'qqbot',
    description: '发送本地文件到当前私聊（≤20MB）',
    usage: '/sendfile <文件绝对路径>',
    handler: async (cmdCtx) => {
      const path = unwrapQuotes(cmdCtx.command.raw.trim());

      if (cmdCtx.message.kind === 'group') {
        return '群聊暂不开放文件发送（v1 仅私聊）';
      }
      if (!path) {
        return '用法: /sendfile <文件绝对路径>（含空格请加引号）';
      }
      if (!isAbsolute(path)) {
        return '请提供文件的绝对路径';
      }
      if (!existsSync(path)) {
        return `文件不存在: ${path}`;
      }

      let size: number;
      try {
        const st = statSync(path);
        if (!st.isFile()) {
          return '路径不是文件（目录/设备不支持发送）';
        }
        if (st.size === 0) {
          return '空文件不发送';
        }
        size = st.size;
      } catch (error) {
        return `无法读取文件: ${error instanceof Error ? error.message : String(error)}`;
      }

      if (size > MAX_UPLOAD_SIZE_BYTES) {
        return `文件超过 ${formatSize(MAX_UPLOAD_SIZE_BYTES)} 上限（当前 ${formatSize(size)}）`;
      }

      const fileName = basename(path);
      try {
        await cmdCtx.bot.sendFile(cmdCtx.replyTarget, { localPath: path }, { fileName });
      } catch (error) {
        return `发送失败: ${error instanceof Error ? error.message : String(error)}`;
      }
      return `已发送 📎 ${fileName}（${formatSize(size)}）`;
    },
  };
}
