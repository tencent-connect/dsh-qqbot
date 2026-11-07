/**
 * /sessions — 按工作区分组的会话导航
 *
 * 无参数：列出宿主工作区（当前组置顶）及其会话账目，可点击直达。
 * /sessions <序号|id前缀>：切到该会话——工作区随会话 cwd 隐式切换，
 *   下一条消息 resume 目标会话（上下文与文件现场一并切换）。
 * /sessions new <工作区路径|标题>：在该工作区开新会话（当前会话归档，
 *   下一条消息在新 cwd create）。
 *
 * 宿主未挂载 workspaceRegistry（headless 组合）时列表为空，命令提示降级。
 * 与 dsh 桌面/Web 侧边栏"工作区 → 会话"心智模型一致。
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import { commandAllowlistAuth } from './auth.ts';
import { getScopePeer, sendMarkdownChunked, formatRelativeTime } from '../shared/index.ts';
import { renderCmdInput } from './cmd-input.ts';

/** 会话 id 展示短码（session-xxxxxxxx 截断到 16 字符） */
function shortId(id: string): string {
  return id.length > 16 ? id.slice(0, 16) : id;
}

export function sessionsCommand({ manager, config, logger }: CommandDeps): CategorizedCommand {
  return {
    name: 'sessions',
    category: 'agent',
    // 管理类指令：私聊/群聊均可用，但仅限白名单用户（与 /model /preset 同构）
    scope: 'all',
    authorized: commandAllowlistAuth(config, logger),
    description: '查看/切换会话（按工作区分组；/sessions [序号|id]；/sessions new <组序号|工作区>）',
    handler: async (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      const args = (cmdCtx.command?.raw ?? '').trim();

      // ── /sessions new [工作区] ──
      if (args === 'new' || args.startsWith('new ')) {
        const ref = args.slice(3).trim();
        if (!ref) return '用法: /sessions new <组序号|工作区路径|标题>（先发 /sessions 查看列表）';

        const outcome = await manager.startNewInWorkspace(scope, peerId, ref);
        if (!outcome.ok) {
          const known = manager.listWorkspaceRefs().map((w) => w.title === w.path ? w.path : `${w.title} (${w.path})`).join('、');
          return `未知工作区: ${ref}${known ? `\n可用工作区: ${known}` : ''}`;
        }
        return [
          `✅ 已切换工作区并开启新会话`,
          `📁 ${outcome.path}`,
          '发送消息即在此工作区开始（当前会话已归档，可随时 /sessions 切回）。',
        ].join('\n');
      }

      // ── /sessions <序号|id> ──
      if (args) {
        const target = await manager.resolveSessionTarget(scope, peerId, args);
        if (!target) {
          return '未找到会话。支持列表序号或会话 id 前缀；发 /sessions 查看列表。';
        }
        const outcome = await manager.switchSession(scope, peerId, target);
        if (!outcome.ok) {
          if (outcome.reason === 'occupied') return '切换失败：该会话已绑定其他 QQ 用户或群，不能切入';
          if (outcome.reason === 'not-on-disk') return '切换失败：目标会话的磁盘记录已不存在';
          return '切换失败：目标会话不在宿主工作区账目内';
        }
        if (outcome.alreadyCurrent) return `当前就在会话 ${shortId(target)}`;
        return [
          `✅ 已切换到会话 ${shortId(target)}`,
          '发送消息继续该会话（上下文与文件现场一并切换）。',
        ].join('\n');
      }

      // ── 无参数：分组列表 ──
      const groups = await manager.listSessionGroups(scope, peerId);
      if (groups.length === 0) {
        return [
          '当前部署无工作区服务（workspaceRegistry 未挂载），无法列出会话。',
          '会话仍可通过 /new 开启，仅不支持分组导航。',
        ].join('\n');
      }

      const lines: string[] = ['### 📂 会话列表', ''];
      let displayIndex = 0;
      for (const [groupIndex, group] of groups.entries()) {
        lines.push(`**${groupIndex + 1}. ${group.title}**${group.isCurrentWorkspace ? '（当前工作区）' : ''}`);
        if (group.sessions.length === 0) {
          lines.push('（暂无会话）');
        }
        for (const session of group.sessions) {
          displayIndex += 1;
          const meta = [
            formatRelativeTime(session.createdAt),
            session.agentPreset ?? '',
          ].filter(Boolean).join(' · ');
          const suffix = meta ? ` · ${meta}` : '';
          if (session.isCurrent) {
            lines.push(`● ${displayIndex}. ${shortId(session.sessionId)}（当前）${suffix}`);
          } else if (session.occupiedByOther) {
            lines.push(`🔒 ${displayIndex}. ${shortId(session.sessionId)}（其他 QQ 用户/群）${suffix}`);
          } else {
            const show = `○ ${displayIndex}. ${shortId(session.sessionId)}${suffix}`;
            lines.push(renderCmdInput(`/sessions ${displayIndex}`, show));
          }
        }
        if (group.truncated > 0) {
          lines.push(`…另有 ${group.truncated} 个会话未展示（/sessions <id前缀> 直达）`);
        }
        lines.push(renderCmdInput(`/sessions new ${groupIndex + 1}`, `＋ 组${groupIndex + 1} 开新会话`), '');
      }

      await sendMarkdownChunked(cmdCtx, lines.join('\n'), config.textChunkLimit);
      return { kind: 'noop' as const };
    },
  };
}
