import { commandAllowlistAuth } from "./auth.js";
import { getScopePeer, sendMarkdownChunked } from "../shared/index.js";
/** 内置 preset 表（对齐宿主默认：workspace-write+ask / danger-full-access+never） */
const PERMISSION_PRESETS = [
    {
        name: 'read-only',
        label: '只读',
        knobs: { sandbox: 'read-only', approval: 'ask' },
        description: '只能读取，写入/执行逐次审批',
    },
    {
        name: 'workspace-write',
        label: '工作区可写',
        knobs: { sandbox: 'workspace-write', approval: 'ask' },
        description: '工作区内可写，越界操作需审批',
    },
    {
        name: 'danger-full-access',
        label: '完全访问',
        knobs: { sandbox: 'danger-full-access', approval: 'never' },
        description: '任意读写执行，不再询问',
        danger: true,
    },
];
/** knob 组合的可读展示：优先匹配 preset 名，否则列出原始值 */
function displayKnobs(knobs) {
    const matched = PERMISSION_PRESETS.find((p) => p.knobs.sandbox === knobs.sandbox && p.knobs.approval === knobs.approval);
    if (matched)
        return `${matched.label}（${matched.name}）`;
    return [knobs.sandbox, knobs.approval].filter(Boolean).join(' + ') || '未知';
}
export function permissionCommand({ manager, config, logger }) {
    return {
        name: 'permission',
        category: 'agent',
        // 管理类指令：私聊/群聊均可用，但仅限白名单用户（与 /model /preset 同构）
        scope: 'all',
        authorized: commandAllowlistAuth(config, logger),
        description: '查看或切换会话权限（用法: /permission [read-only|workspace-write|danger-full-access|reset]）',
        handler: async (cmdCtx) => {
            const { scope, peerId } = getScopePeer(cmdCtx);
            const args = (cmdCtx.command?.raw ?? '').trim();
            // ── /permission reset：清除 per-peer 偏好 ──
            if (args === 'reset' || args === 'default') {
                const cleared = manager.clearPermission(scope, peerId);
                return cleared
                    ? '✅ 已重置为宿主默认权限（新会话生效；当前会话保持现状直到 /new）。'
                    : '当前没有自定义权限偏好，无需重置';
            }
            // ── /permission <preset>：切换 ──
            if (args) {
                const preset = PERMISSION_PRESETS.find((p) => p.name === args);
                if (!preset) {
                    return `未知权限: ${args}\n可用: ${PERMISSION_PRESETS.map((p) => p.name).join(' / ')} / reset`;
                }
                const outcome = await manager.setPermission(scope, peerId, preset.knobs);
                if (!outcome.ok) {
                    return [
                        `⚠️ 权限偏好已保存（${preset.label}），但当前会话切换失败：`,
                        '宿主策略模块不可用（当前部署未组合 sandbox/审批能力）。',
                        '新会话仍会按偏好创建。',
                    ].join('\n');
                }
                const lines = [`✅ 权限已切换: ${preset.label}（${preset.name}）`, preset.description];
                if (preset.danger) {
                    lines.push('', '⚠️ **高危**：完全访问且不再询问审批，误操作不可拦截。随时可用 /permission read-only 切回。');
                }
                lines.push('', outcome.appliedLive ? '当前会话立即生效；/new 后的新会话沿用。' : '当前无活跃会话，发送消息创建会话时生效。');
                return lines.join('\n');
            }
            // ── 无参数：当前值 + 可点击列表 ──
            const status = manager.getPermissionStatus(scope, peerId);
            const sourceText = status.source === 'session'
                ? '当前会话生效值'
                : status.source === 'pref'
                    ? '新会话默认（当前无活跃会话）'
                    : '宿主部署默认';
            const currentText = status.knobs ? displayKnobs(status.knobs) : '宿主部署默认';
            const lines = [
                '### 🔐 会话权限',
                '',
                `**当前:** ${currentText}`,
                `来源: ${sourceText}`,
                '',
                '**可切换（点击生效）:**',
            ];
            for (const preset of PERMISSION_PRESETS) {
                const dangerTag = preset.danger ? ' ⚠️高危' : '';
                lines.push(`<qqbot-cmd-input text="/permission ${preset.name}" show="${preset.label} · ${preset.description}${dangerTag}"/>`);
            }
            lines.push('', '重置默认: `/permission reset`');
            await sendMarkdownChunked(cmdCtx, lines.join('\n'), config.textChunkLimit);
            return { kind: 'noop' };
        },
    };
}
//# sourceMappingURL=permission.js.map