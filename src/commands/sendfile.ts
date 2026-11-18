/**
 * 文件发送命令：/sendfile — 把本机文件发回当前私聊
 *
 * 安全口径与 qqbot_send_file 工具完全一致：命令侧只做「解析 → 白名单 → 交给
 * sendMediaFile」，绝不自行 readFile、绝不自己拼 SDK 上传：
 *
 *   resolve(path)（相对进程 cwd，与工具同款）→ isPathAllowed(sendFile, agent cwd)
 *   → existsSync → sendMediaFile（内部 stat、拒绝非普通文件、按扩展名分发）
 *
 * 因此 sendFile.restrictPaths 的白名单在这条命令路径上没有绕过口：白名单不
 * 通过时连 stat 都不会发生，更不会触达发送器（防住「任意能给 bot 发消息的人
 * 让 bot 回传本机任意文件」这一越权原语）。
 */
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { CommandDeps, CategorizedCommand } from './types.ts';
import { commandAllowlistAuth } from './auth.ts';
import { getScopePeer } from '../shared/index.ts';
import type { SendFileConfig } from '../config.ts';
import { isPathAllowed, resolveAgentCwd, sendMediaFile } from '../media/send-media.ts';
import type { ReplyTarget } from '../types.ts';

const USAGE = [
  '用法: /sendfile <文件路径>',
  '示例: /sendfile /data/report.pdf',
  '相对路径按进程工作目录解析；可发送范围受 sendFile.restrictPaths 白名单约束。',
].join('\n');

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function sendFileCommand({ config, logger, getMediaSender }: CommandDeps): CategorizedCommand {
  // sendFile 在 schema 里带默认值，但老配置/直接构造的配置对象可能缺省
  const sendFileConfig: SendFileConfig | undefined = config.sendFile;

  return {
    name: 'sendfile',
    category: 'qqbot',
    // 文件只发私聊：群里任何人都能 @bot 触发，等于把本机文件广播给全群
    scope: 'c2c',
    authorized: commandAllowlistAuth(config, logger),
    description: '发送本机文件到当前私聊（路径受 sendFile.restrictPaths 白名单约束）',
    handler: async (cmdCtx) => {
      const raw = (cmdCtx.command?.raw ?? '').trim();
      if (!raw) return USAGE;
      if (sendFileConfig === undefined) {
        return '⚠️ 附件发送未配置（缺少 sendFile 配置），/sendfile 暂不可用';
      }

      const mediaSender = getMediaSender?.();
      if (mediaSender === undefined) return '⚠️ 附件发送器尚未就绪，/sendfile 暂不可用';

      // 1. 路径解析口径与 qqbot_send_file 工具一致：resolve() 规范化（相对进程 cwd）
      const absPath = resolve(raw);
      const cwd = resolveAgentCwd(config.cwd);

      // 2. 白名单先行：越权路径绝不进入 sendMediaFile（不 stat、不读、不发送）
      if (!isPathAllowed(absPath, sendFileConfig, cwd)) {
        logger?.warn(`im-qqbot: /sendfile 拒绝越权路径: ${absPath}`);
        const extra = sendFileConfig.extraRoots.length > 0
          ? `、sendFile.extraRoots（${sendFileConfig.extraRoots.join('、')}）`
          : '';
        return `⚠️ 拒绝发送：路径不在允许范围内\n${absPath}\n允许范围：媒体目录、agent 工作目录（${cwd}）${extra}`;
      }

      // 3. 区分「不存在」与「存在但不是普通文件」，两者都不触达发送器
      if (!existsSync(absPath)) return `⚠️ 文件不存在: ${absPath}`;

      // 4. 发送目标 = 当前私聊（保留 msgId，走 mediaSender 的被动回复窗口兜底）
      const { peerId } = getScopePeer(cmdCtx);
      const msgId = cmdCtx.replyTarget?.msgId;
      const target: ReplyTarget = {
        scope: 'c2c',
        targetId: peerId,
        ...(msgId !== undefined ? { msgId } : {}),
      };

      // 5. 分类发送统一走 send-media（目录/设备等非普通文件在此被拒，不调用 sender）
      const result = await sendMediaFile(mediaSender, target, absPath);
      const display = basename(absPath);

      if (result.outcome === 'sent') {
        logger?.info(`im-qqbot: /sendfile 发送 ${display} (${result.size} bytes) → c2c:${peerId}`);
        return `✅ 已发送 ${display}（${formatSize(result.size)}）`;
      }
      if (result.outcome === 'failed') {
        logger?.warn(`im-qqbot: /sendfile 发送失败 ${display}: ${result.error}`);
        return `⚠️ 发送失败: ${result.error}`;
      }
      return `⚠️ 无法发送：不是普通文件（目录、设备等）或不可读\n${absPath}`;
    },
  };
}