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
 * 面向普通用户：只说"对话被归档、消息没处理"，以及两条下一步动作，
 * 不出现归档门禁、写句柄这类内部术语。归档门禁在 `agent/pre-step` 就拒绝
 * 该会话的回合，本轮消息被丢弃（不进会话、模型没跑），所以必须说明"没处理"。
 */
export const ARCHIVED_SESSION_NOTICE = [
  '📦 这条对话已经归档，刚才的消息没有处理。',
  '',
  '想继续原来的内容，点「恢复对话」；想重新开始，点「新对话」。',
  `<qqbot-cmd-input text="${UNARCHIVE_COMMAND}" show="恢复对话"/>`,
  `<qqbot-cmd-input text="${NEW_SESSION_COMMAND}" show="新对话"/>`,
].join('\n');

/**
 * 会话被另一个窗口占用时的提示。
 *
 * 面向普通用户：不解释进程与句柄，只说"被另一个窗口打开着、消息没处理"，
 * 并给出一条可执行的动作（关掉那边再发）。常见于电脑上的 DSH 开着同一条对话。
 */
export const SESSION_BUSY_NOTICE = [
  '⏳ 这条对话正被另一个窗口打开着（通常是电脑上的 DSH 还开着它），刚才的消息没有处理。',
  '',
  '在那边关掉这条对话后，再发一次就好；也可以先开一段新对话：',
  `<qqbot-cmd-input text="${NEW_SESSION_COMMAND}" show="新对话"/>`,
].join('\n');
