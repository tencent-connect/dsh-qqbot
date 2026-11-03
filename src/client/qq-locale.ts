/**
 * QQ 插件界面文案命名空间（唯一来源）。
 *
 * 历史遗留：本插件早期大量中文直接写在组件里。此模块把新增/改动的可见文案集中到
 * 一个 locale 命名空间 `qqbot`，通过 ctx.locale.register 注册、ctx.locale.bind 消费，
 * 避免再出现"同一句话两处不一致"。仅收录本模块声明过的键；未迁移的旧文案维持原样。
 *
 * 消费方式：在 apply 闭包里 `const t = bindQQ(ctx)`，把 `t` 作为 prop 传给组件。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots';

export const QQ_LOCALE_NS = 'qqbot';

/** 命名空间全部键（zh 作为类型基准；en 必须提供同键）。导出仅供测试构造 t。 */
export const ZH = {
  // 原生会话视图 / 设置区标题（点1）
  'view.settings.title': 'QQ 会话设置',
  // 会话设置面板（点5）
  'peer.settings.aria': '会话设置',
  'peer.deferred.hint': '补充提示词立即生效；Agent 预设与工作目录在下次新会话生效；模型与权限可在原生输入区调整。',
  // 侧栏（点6 / 点7）
  'sidebar.newSession': '新建会话',
  'sidebar.newSession.aria': '为{name}新建会话',
  'sidebar.current': '当前',
  'sidebar.current.title': '当前生效会话',
  'sidebar.receiving': '正在接收 QQ 消息',
  // 新对话默认值卡（点8）
  'defaults.title': '新对话默认值',
  'defaults.hint': '之后首次接入的群聊和私聊复制这些设置。保存立即生效，不改动已接入的对话，也不会重载插件。',
  'defaults.save': '保存默认设置（即时生效）',
  // 账号与访问卡 + 斜杠命令超管（点 A）
  'account.title': '账号与访问',
  'account.hint': '这一栏决定外部 QQ 用户能否触发本机 DSH、以及谁算管理员，只能在 DSH Web 配置。DSH 本身没有白名单——能打开本页面的人就是本机操作者。',
  'owners.title': '斜杠命令超管',
  'owners.hint': '所有 QQ 斜杠命令仅限此名单中的全局超管使用，名单对所有已启用且获准接入的 QQ 对话生效。不开放额外工具，不绕过执行权限。审批和提问按钮仍按原权限处理；DSH 网页斜杠命令不受此名单限制。',
  'owners.count': '{count} 个 OpenID。斜杠命令超管见下方说明。',
} as const;

export type QQBotKey = keyof typeof ZH;
type QQBotDict = Record<QQBotKey, string>;

const EN: QQBotDict = {
  'view.settings.title': 'QQ chat settings',
  'peer.settings.aria': 'Chat settings',
  'peer.deferred.hint': 'Extra prompt applies immediately; agent preset and working directory apply to the next new session; model and permission can be changed in the native composer.',
  'sidebar.newSession': 'New session',
  'sidebar.newSession.aria': 'Start a new session for {name}',
  'sidebar.current': 'Current',
  'sidebar.current.title': 'Current session',
  'sidebar.receiving': 'Receiving QQ messages',
  'defaults.title': 'New-conversation defaults',
  'defaults.hint': 'Newly admitted group and private chats copy these settings. Saving takes effect immediately, leaves admitted chats unchanged, and does not reload the plugin.',
  'defaults.save': 'Save defaults (instant)',
  'account.title': 'Account & access',
  'account.hint': 'This section decides whether external QQ users can drive this local DSH, and who counts as an admin. It is configured only in DSH Web. DSH itself has no allowlist — anyone who can open this page is the local operator.',
  'owners.title': 'Slash-command superadmin',
  'owners.hint': 'Only global superadmins on this list can use QQ slash commands in any enabled, admitted QQ chat. This grants no additional tools and does not bypass execution permissions. Approval and question buttons retain their existing permissions; DSH web slash commands are not restricted by this list.',
  'owners.count': '{count} OpenID(s). See the note below for what slash-command superadmin can do.',
};

/** 注册 qqbot 命名空间（在 apply 的 effect 内调用；返回 disposer）。 */
export function registerQQLocale(ctx: Context): () => void {
  return ctx.locale.register(QQ_LOCALE_NS, 'zh', ZH as unknown as Record<string, string>) && ctx.locale.register(QQ_LOCALE_NS, 'en', EN);
}

/** 绑定 qqbot 命名空间的翻译函数（类型退化为通用 key，仅本模块保证键存在）。 */
export function bindQQ(ctx: Context): Translate<QQBotKey> {
  return ctx.locale.bind(QQ_LOCALE_NS) as unknown as Translate<QQBotKey>;
}

/** 便捷：绑定并以 zh 基准键取文案；带 {name} 占位替换由 Translate 负责。 */
export type QQTranslate = Translate<QQBotKey>;

/** 测试用 t：直接读取 zh 字典并替换 {name} 占位，不依赖 locale 运行时。 */
export function testT(key: QQBotKey, params?: Record<string, unknown>): string {
  const template = (ZH as Record<string, string>)[key] ?? key;
  return params === undefined ? template : template.replace(/\{(\w+)\}/g, (_m, name: string) => String(params[name] ?? `{${name}}`));
}
