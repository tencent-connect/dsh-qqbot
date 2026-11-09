import { commandAllowlistAuth } from "./auth.js";
import { getScopePeer, sendMarkdownChunked, formatRelativeTime } from "../shared/index.js";
import { clipTitle, DIGEST_MESSAGE_CLIP } from "../shared/session-title.js";
import { renderCmdInput, renderCmdEnter } from "./cmd-input.js";
/** 会话 id 展示短码（session-xxxxxxxx 截断到 16 字符） */
function shortId(id) {
    return id.length > 16 ? id.slice(0, 16) : id;
}
/** 行显示名：宿主标题（session/title 投影或首条消息摘要）> id 短码兜底 */
function displayName(session) {
    return session.title !== undefined && session.title !== ''
        ? clipTitle(session.title, 40)
        : shortId(session.sessionId);
}
/**
 * 最近对话预览的排版：对话式缩进 + 回合分组。
 *
 * 用户问句顶格，助手答句缩进 3 空格挂在问句下（读起来像聊天记录）；
 * 每个回合之间空行分隔，避免 5 行等长文本挤成一堵墙。
 */
export function renderDigestLines(messages) {
    const lines = [];
    let previousRole;
    for (const message of messages) {
        const icon = message.role === 'user' ? '🧑' : '🤖';
        const indent = message.role === 'assistant' && previousRole === 'user' ? '   ' : '';
        if (previousRole === 'assistant' && message.role === 'user')
            lines.push('');
        lines.push(`${indent}${icon} ${clipTitle(message.text, DIGEST_MESSAGE_CLIP)}`);
        previousRole = message.role;
    }
    return lines;
}
export function sessionsCommand({ manager, config, logger }) {
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
                if (!ref)
                    return '用法: /sessions new <组序号|工作区路径|标题>（先发 /sessions 查看列表）';
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
                    if (outcome.reason === 'occupied')
                        return '切换失败：该会话已绑定其他 QQ 用户或群，不能切入';
                    if (outcome.reason === 'not-on-disk')
                        return '切换失败：目标会话的磁盘记录已不存在';
                    return '切换失败：目标会话不在宿主工作区账目内';
                }
                if (outcome.alreadyCurrent)
                    return `当前就在会话 ${clipTitle(outcome.title ?? shortId(target), 40)}`;
                const lines = [`✅ 已切换到会话 ${clipTitle(outcome.title ?? shortId(target), 40)}`];
                if (outcome.recentMessages !== undefined && outcome.recentMessages.length > 0) {
                    lines.push('', '**最近对话**', '');
                    lines.push(...renderDigestLines(outcome.recentMessages));
                    if ((outcome.earlierMessages ?? 0) > 0) {
                        lines.push('', `（更早还有 ${outcome.earlierMessages} 条消息）`);
                    }
                }
                lines.push('', '发送消息继续该会话，上下文与文件现场一并切换。');
                return lines.join('\n');
            }
            // ── 无参数：分组列表 ──
            const groups = await manager.listSessionGroups(scope, peerId);
            if (groups.length === 0) {
                return [
                    '当前部署无工作区服务（workspaceRegistry 未挂载），无法列出会话。',
                    '会话仍可通过 /new 开启，仅不支持分组导航。',
                ].join('\n');
            }
            const lines = ['### 📂 会话列表', ''];
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
                    const name = displayName(session);
                    if (session.isCurrent) {
                        lines.push(`● ${displayIndex}. ${name}（当前）${suffix}`);
                    }
                    else if (session.occupiedByOther) {
                        lines.push(`🔒 ${displayIndex}. ${name}（其他 QQ 用户/群）${suffix}`);
                    }
                    else {
                        const show = `○ ${displayIndex}. ${name}${suffix}`;
                        // 私聊用回车指令（点击即切换）；群聊不支持 cmd-enter，保留插入式
                        lines.push(scope === 'c2c'
                            ? `${show} ${renderCmdEnter(`/sessions ${displayIndex}`)}`
                            : renderCmdInput(`/sessions ${displayIndex}`, show));
                    }
                }
                if (group.truncated > 0) {
                    lines.push(`…另有 ${group.truncated} 个会话未展示（/sessions <id前缀> 直达）`);
                }
                lines.push(scope === 'c2c'
                    ? `＋ 组${groupIndex + 1} 开新会话 ${renderCmdEnter(`/sessions new ${groupIndex + 1}`)}`
                    : renderCmdInput(`/sessions new ${groupIndex + 1}`, `＋ 组${groupIndex + 1} 开新会话`), '');
            }
            await sendMarkdownChunked(cmdCtx, lines.join('\n'), config.textChunkLimit);
            return { kind: 'noop' };
        },
    };
}
//# sourceMappingURL=sessions.js.map