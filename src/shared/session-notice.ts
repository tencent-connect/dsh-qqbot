/**
 * 会话状态相关的用户可见文案（入站兜底与出站回合失败共用一份）。
 *
 * `<qqbot-cmd-input text="..." show="..."/>` 是 QQ 官方 markdown 的可点击指令标签：
 * 点一下等于把这条命令发进输入框，用户不必手打。只在 markdown 消息里生效，
 * 插件对外统一走 sendMarkdown，因此这里可以安全使用。
 */

/** 取消归档命令（定义在 commands/session.ts，文案与注册名必须一致） */
export const UNARCHIVE_COMMAND = '/unarchive';

/** 新会话命令（commands/session.ts 的 /new，另有 /reset、/clear 别名） */
export const NEW_SESSION_COMMAND = '/new';

/**
 * 归档会话的提示。
 *
 * 归档门禁在 `agent/pre-step` 就拒绝该会话的回合，本轮消息被丢弃（不进会话、
 * 模型没跑），所以必须说明"本条未处理"，并给出取消归档 / 换会话两条可点路径。
 */
export const ARCHIVED_SESSION_NOTICE = [
  '⚠️ 当前会话已归档，本条消息未被处理。',
  '',
  '可以点下面的指令继续：',
  `<qqbot-cmd-input text="${UNARCHIVE_COMMAND}" show="取消归档"/>`,
  `<qqbot-cmd-input text="${NEW_SESSION_COMMAND}" show="新会话"/>`,
].join('\n');
