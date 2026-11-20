window.__ModuleLoader__.load({
	id: "@tencent-connect/dsh-qqbot-workbench-history",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __defProp = Object.defineProperty;
		var __exportAll = (all, no_symbols) => {
			let target = {};
			for (var name in all) __defProp(target, name, {
				get: all[name],
				enumerable: true
			});
			if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
			return target;
		};
		//#endregion
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region src/client/qq-locale.ts
		const english = {
			"主机器人 · 未绑定": "Primary bot · Unbound",
			"新机器人 · 未绑定": "New bot · Unbound",
			"机器人设置页面": "Bot settings tab",
			"账号与权限": "Account and access",
			"新会话默认设置": "New Session defaults",
			"机器人列表": "Bot list",
			"请更新 DSH 以打开 QQ 工作台。已绑定机器人仍可在 QQ 收发。": "Update DSH to open the QQ workbench. Previously bound bots can still send and receive messages in QQ.",
			"机器人列表暂不可用": "Bot list unavailable",
			"正在读取机器人…": "Loading bots…",
			"机器人设置": "Bot settings",
			"返回会话": "Back to conversations",
			"全部": "All",
			"群聊": "Groups",
			"私聊": "Direct",
			"收起设置栏": "Collapse settings",
			"收起": "Collapse",
			"无法读取 QQ 会话": "Could not load QQ conversations.",
			"无法读取历史 Session。": "Could not load Session history.",
			"无法恢复原会话。": "Could not restore the original Session.",
			"会话标识不一致，请刷新后重试。": "The conversation changed. Refresh and try again.",
			"无法保存会话设置。": "Could not save conversation settings.",
			"已清空此对话的本机 QQ 消息记录。": "This conversation’s local QQ message history was cleared.",
			"无法清空本机 QQ 消息记录。": "Could not clear local QQ message history.",
			"未能确认新 Session，请刷新会话列表。": "Could not confirm the new Session. Refresh the conversation list.",
			"会话状态已刷新。请核对设置后再创建。": "Conversation state refreshed. Review the settings before creating the Session.",
			"新 Session 已创建。下一条 QQ 消息会进入这个 Session。": "Session created. The next QQ message will use this Session.",
			"无法新建 QQ Session。": "Could not create a QQ Session.",
			"无法打开原生 Session，请稍后重试。": "Could not open the native Session. Try again.",
			"QQ 会话列表": "QQ conversation list",
			"QQ 会话": "QQ conversations",
			"刷新会话列表": "Refresh conversation list",
			"搜索会话": "Search conversations",
			"搜索 QQ 会话": "Search QQ conversations",
			"会话类型": "Conversation type",
			"此宿主暂不提供 QQ 会话列表。": "This Host does not provide the QQ conversation list.",
			"正在读取会话…": "Loading conversations…",
			"没有符合条件的会话。": "No matching conversations.",
			"暂无 QQ 会话。": "No QQ conversations yet.",
			"在获准接入的 QQ 对话中发送 /bot-ping，确认收到 pong。群聊请先 @ 机器人。": "Send /bot-ping in an authorized QQ conversation and check for pong. Mention the bot first in a group.",
			"再发一条普通消息，确认模型回复，并在这里打开创建的 Session。": "Send a regular message to check the model reply and open the new Session here.",
			"展开": "Expand",
			"已归档": "Archived",
			"历史": "History",
			"收起历史": "Collapse history",
			"当前 QQ 会话": "Current QQ conversation",
			"请从会话列表选择对话": "Select a conversation from the list",
			"查看": "View",
			"恢复中…": "Restoring…",
			"恢复当前 Session": "Restore current Session",
			"打开当前 Session": "Open current Session",
			"尚未创建 Session": "No Session yet",
			"当前 Session": "Current Session",
			"新建 Session": "New Session",
			"刷新消息": "Refresh messages",
			"会话设置": "Conversation settings",
			"恢复原会话可继续原有上下文。也可以新建 Session 接收后续消息。": "Restore the original Session to continue with its context, or create a Session for future messages.",
			"请在 DSH 工作区取消归档，或新建 Session 接收后续消息。": "Unarchive the Session in the DSH workspace or create a Session for future messages.",
			"QQ 消息记录组件未加载。请在插件详情中启用它，或重新安装 QQ 机器人。": "The QQ message history component is unavailable. Enable it in plugin details or reinstall QQ Bot.",
			"机器人未连接": "Bot disconnected",
			"此会话未获准接入": "This conversation is not authorized",
			"此会话已暂停": "This conversation is paused",
			"选择群聊或联系人后可以编辑。": "Select a group or contact to edit its settings.",
			"新建 QQ Session": "New QQ Session",
			"关闭": "Close",
			"取消": "Cancel",
			"正在创建…": "Creating…",
			"创建并切换": "Create and switch",
			"工作台页面": "Workbench page",
			"会话列表": "Conversation list",
			"会话": "Conversation",
			"保留最近 7 天": "Keep for 7 days",
			"保留最近 30 天": "Keep for 30 days",
			"自定义天数": "Custom number of days",
			"保留最近 {0} 天": "Keep for {0} days",
			"保留最近": "Keep for",
			"天": "days",
			"自定义保留天数": "Custom retention in days",
			"请输入有效的正整数天数。": "Enter a valid positive whole number of days.",
			"长期保留": "Keep indefinitely",
			"暂停记录": "Pause recording",
			"获取群内全部消息": "Receive all group messages",
			"在「机器人可获取的群聊消息范围」中选择此项，工作台才能接收普通群消息。是否记录消息和是否仅在 @ 时回复由 DSH 设置决定。": "Select this option in the bot’s group message access settings to receive ordinary group messages. DSH controls recording and replies that require a mention.",
			"机器人主动在群聊内发言": "Allow proactive group messages",
			"开启后，工作台可在没有可用回复凭据时主动发言。网页回答的自动推送仍由机器人的主动推送配置决定。": "This lets the workbench send messages without a reply token. The bot’s proactive delivery settings still control automatic Web push.",
			"QQ 群权限": "QQ group permissions",
			"在手机 QQ 设置": "Set in mobile QQ",
			"请群主在手机 QQ 的群聊中打开机器人的设置。": "Ask the group owner to open the bot’s settings in the group chat on mobile QQ.",
			"看图": "View image",
			"无法读取机器人默认设置。": "Could not load bot defaults.",
			"采用机器人当前默认值": "Use the bot’s current defaults",
			"更多会话设置": "More conversation settings",
			"概览与接收": "Overview and delivery",
			"会话备注": "Conversation note",
			"未设置备注": "No note",
			"暂停此 QQ 会话": "Pause this QQ conversation",
			"暂停会话会停止收发和新建 Session。消息保留期可在消息记录里调整。": "Pausing stops sending, receiving, and new Session creation. Adjust retention under Message history.",
			"此对话未获机器人接入许可。": "This conversation is not authorized for this bot.",
			"对话详情": "Conversation details",
			"接入规则": "Access rules",
			"Agent 设置": "Agent settings",
			"当前与新建": "Current and new Sessions",
			"QQ 回复": "QQ replies",
			"当前 Session 也适用": "Applies to the current Session",
			"消息记录": "Message history",
			"本机消息记录": "Local message history",
			"保存后暂停记录新消息，保留已有记录。": "Saving pauses recording new messages and keeps existing history.",
			"保留期限适用于此 QQ 对话的本机收发记录。": "Retention applies to local QQ messages in this conversation.",
			"清空本会话记录": "Clear this conversation’s history",
			"清空本会话记录？": "Clear this conversation’s history?",
			"缩短消息保留期？": "Shorten message retention?",
			"确认清空": "Confirm clear",
			"确认缩短并保存": "Shorten and save",
			"正在读取默认值…": "Loading defaults…",
			"会话设置已更新。点击「合并草稿」会把你改过的字段带到最新设置，核对后点击「保存」才会生效。": "Conversation settings changed. Merge Draft copies your edits onto the latest settings. Review the draft and click Save to apply.",
			"合并草稿": "Merge draft",
			"撤销修改": "Discard changes",
			"保存中…": "Saving…",
			"保存": "Save",
			"机器人已停用": "Bot disabled",
			"未获准接入": "Not authorized",
			"工具策略不可用": "Tool policy unavailable",
			"已暂停接收": "Paused",
			"当前 Session 已归档": "Current Session archived",
			"当前接收": "Receiving",
			"等待首个 Session": "Waiting for first Session",
			"所有人": "Everyone",
			"白名单": "Allowlist",
			"连接中": "Connecting",
			"已连接": "Connected",
			"重连中": "Reconnecting",
			"连接失败": "Connection failed",
			"已停用": "Disabled",
			"主机器人": "Primary bot",
			"无法读取机器人列表": "Could not load the bot list.",
			"机器人配置已更新，请确认当前机器人后再解绑。": "Bot configuration changed. Confirm the current bot before unbinding.",
			"无法读取绑定状态，请刷新二维码。": "Could not check binding status. Refresh the QR code.",
			"无法开始绑定，请重试。": "Could not start binding. Try again.",
			"请等待当前绑定完成。": "Wait for the current binding to finish.",
			"绑定已取消。": "Binding cancelled.",
			"绑定未完成，请重试。": "Binding is incomplete. Try again.",
			"绑定失败，请重试。": "Binding failed. Try again.",
			"请等待当前操作完成。": "Wait for the current operation to finish.",
			"操作已取消。": "Operation cancelled.",
			"机器人配置已更新，请读取最新配置后再保存。": "Bot configuration changed. Load the latest settings before saving.",
			"无法保存机器人配置": "Could not save bot settings.",
			"暂未确认解绑结果。若刷新后仍显示此机器人，可以重试。": "Unbinding could not be confirmed. Refresh and try again if the bot is still listed.",
			"机器人名称": "Bot name",
			"配置已变化，草稿仍保留。": "Configuration changed. Your draft is still available.",
			"合并到最新配置": "Merge into latest settings",
			"草稿已合并，请核对后保存。": "Draft merged. Review and save.",
			"账号信息": "Account info",
			"启用机器人": "Enable bot",
			"凭据与访问": "Credentials and access",
			"扫码账号 {0}": "Scanned by {0}",
			"机器人账号": "Bot accounts",
			"机器人": "Bot",
			"添加机器人": "Add bot",
			"展开机器人栏": "Expand bots",
			"收起机器人栏": "Collapse bots",
			"绑定主机器人": "Bind primary bot",
			"还没有机器人": "No bots yet",
			"当前机器人设置": "Current bot settings",
			"这台机器人已解绑。重试将继续清除本机 QQ 消息记录和 Session 关联。": "This bot is unbound. Retry to finish clearing local QQ messages and Session links.",
			"「仅解绑」会保留本机 QQ 消息记录和 Session 关联。「解绑并清除记录」还会删除这台机器人在本机的 QQ 消息记录，并解除它的 QQ 会话与 DSH Session 的关联。清除无法撤销，原 Session 可在 DSH 工作区打开。": "Unbind keeps local QQ messages and Session links. Unbind and clear deletes this bot’s local QQ messages and removes its QQ-to-DSH Session links. Clearing is irreversible. The original Sessions remain available in the DSH workspace.",
			"正在解绑…": "Unbinding…",
			"仅解绑": "Unbind",
			"正在清除…": "Clearing…",
			"重试清除记录": "Retry clearing records",
			"解绑并清除记录": "Unbind and clear records",
			"无法打开配置文件。": "Could not open the configuration file.",
			"打开当前 DSH 配置的 cordis.patch.yml": "Open cordis.patch.yml for the current DSH profile",
			"打开配置文件": "Open configuration file",
			"设置": "Settings",
			"DSH 目录服务尚未就绪。": "The DSH catalog is unavailable.",
			"无法打开原文件，请在 DSH 宿主上编辑此文件。": "Could not open the original file. Edit it on the DSH Host.",
			"这个 Session 已归档，请先在 DSH 工作区取消归档。": "This Session is archived. Unarchive it in the DSH workspace.",
			"返回 QQ 对话": "Back to QQ conversation",
			"QQ 机器人": "QQ Bot",
			"已收到": "Received",
			"发送中": "Sending",
			"QQ 已接受部分内容": "QQ accepted part of the message",
			"QQ 接口已接受": "Accepted by QQ",
			"QQ 拒绝": "Rejected by QQ",
			"结果未知": "Result unknown",
			"已收到，未 @ 机器人": "Received without a mention",
			"触发频率限制": "Rate limited",
			"处理队列已满": "Processing queue full",
			"没有可提交给 DSH 的内容": "No content to submit to DSH",
			"已提交到 DSH": "Submitted to DSH",
			"提交到 DSH 失败": "Submission to DSH failed",
			"当前 Session 已归档，消息未提交": "Current Session is archived. Message was not submitted.",
			"自动回复": "Automatic reply",
			"Agent 投递": "Agent delivery",
			"网页直发": "Sent from Web",
			"Session 回答": "Session answer",
			"无法读取 QQ 流水": "Could not load QQ message history.",
			"无法读取更早记录": "Could not load earlier messages.",
			"QQ 消息": "QQ messages",
			"已暂停记录新消息": "Recording new messages is paused",
			"消息记录可能不完整。": "Message history may be incomplete.",
			"重试": "Retry",
			"正在读取消息…": "Loading messages…",
			"还没有已保存的 QQ 消息。": "No saved QQ messages yet.",
			"正在读取…": "Loading…",
			"加载更早消息": "Load earlier messages",
			"查看最新消息 ↓": "Jump to latest ↓",
			"QQ 成员": "QQ member",
			"引用回复": "Reply with quote",
			"打开关联 Session": "Open linked Session",
			"收起响应详情": "Hide delivery details",
			"响应详情": "Delivery details",
			"记录仍未确认结果，请在 QQ 核对。": "Delivery is still unconfirmed. Check QQ.",
			"无法查询发送记录。": "Could not check the delivery receipt.",
			"消息操作": "Message actions",
			"查询中…": "Checking…",
			"查询回执": "Check receipt",
			"来源未记录": "Source unavailable",
			"图片已过期或无法预览": "Image expired or unavailable",
			"正在等待 QQ 回执…": "Waiting for QQ receipt…",
			"发送结果未知，请先在 QQ 核对。": "Delivery result unknown. Check QQ first.",
			"发送中…": "Sending…",
			"正在查询发送结果…": "Checking delivery result…",
			"暂未确认发送结果，请查询回执或先在 QQ 核对。": "Delivery has not been confirmed. Check the receipt or verify in QQ.",
			"请先移除附件，再引用回复。": "Remove the attachment before quoting a reply.",
			"发送到 QQ": "Send to QQ",
			"选择 QQ 附件": "Choose a QQ attachment",
			"请选择一个非空附件，最多 4 MiB。": "Choose a non-empty attachment up to 4 MiB.",
			"移除附件": "Remove attachment",
			"取消引用": "Remove quote",
			"发送到 QQ 的消息": "Message to QQ",
			"输入消息": "Enter a message",
			"取消引用后可添加附件": "Remove the quote to attach a file",
			"每次可发送一个附件，最多 4 MiB": "Attach one file up to 4 MiB",
			"附件": "Attachment",
			"Shift + Enter 换行": "Shift + Enter for a new line",
			"已结束查询。发送前请在 QQ 核对。": "Receipt check stopped. Verify in QQ before sending again.",
			"结束查询": "Stop checking",
			"服务范围": "Access",
			"私聊白名单": "Direct message allowlist",
			"生成配对码，让对方在私聊里直接给机器人发送这个码，即加入私聊白名单。": "Generate a code and ask the contact to send it to the bot in a direct chat.",
			"群白名单": "Group allowlist",
			"生成配对码，让群成员在群里 @ 机器人后直接发送这个码，即把该群加入白名单。": "Generate a code and ask a group member to mention the bot and send the code in the group.",
			"斜杠命令": "Slash commands",
			"仅在获准接入的对话中生效。所有人模式允许成员切换模型、开始新会话等，影响该群的共享会话。审批和提问按钮按各自权限处理。": "Applies in authorized conversations. Everyone mode lets group members change the shared model and start a new Session. Approvals and questions use their own access rules.",
			"命令白名单": "Command allowlist",
			"名单按发送者 OpenID 校验，适用于获准接入的群聊和私聊。保存模式与管理名单分别生效。": "The sender’s OpenID controls access in authorized groups and direct chats. Saving modes and managing the list take effect separately.",
			"主机器人绑定已更新，请重新打开设置。": "The primary bot binding changed. Reopen settings.",
			"已保留未保存的修改，其余配置已更新。": "Your draft was kept and the other configuration was refreshed.",
			"配置已保存，插件重载完成后生效。": "Settings saved. Changes take effect after the plugin reloads.",
			"已读取当前配置，内容与上次保存的值不同。": "Current settings differ from the last saved value.",
			"配置已保存。": "Settings saved.",
			"保存失败，请重试。": "Save failed. Try again.",
			"配置已保存，刷新配置核对生效结果。": "Settings saved. Refresh to verify the result.",
			"重试中…": "Retrying…",
			"正在加载配置…": "Loading settings…",
			"正在保存配置…": "Saving settings…",
			"有未保存修改。保存会重载插件，并中断正在运行的 QQ 任务。": "There are unsaved changes. Saving reloads the plugin and interrupts active QQ work.",
			"没有未保存的修改。": "No unsaved changes.",
			"基础设置": "General settings",
			"群聊仅回复 @机器人的消息": "Only reply when mentioned in a group",
			"刷新中…": "Refreshing…",
			"刷新配置": "Refresh settings",
			"QQ 记录": "QQ history",
			"{0} {1} 的 Session": "{0} Sessions for {1}",
			"另有 {0} 个 Session": "{0} more Sessions",
			"{0} · {1}。创建成功后，QQ 新消息会进入新 Session，原有记录可从历史打开。": "{0} · {1}. Future QQ messages will use the new Session. Earlier Sessions remain in history.",
			"看图：{0}": "View image for {0}",
			"手机 QQ 设置截图：{0}": "Mobile QQ settings screenshot for {0}",
			"将删除「{0}」的全部本机 QQ 消息记录。DSH Session 历史单独保留。": "Clear all local QQ messages for {0}. The DSH Session history is retained separately.",
			"保存后将删除「{0}」超过 {1} 天的本机 QQ 消息记录。": "Saving removes local QQ messages for {0} that are older than {1} days.",
			"机器人 {0}": "Bot {0}",
			"设置{0}": "Settings for {0}",
			"解绑{0}": "Unbind {0}",
			"启用{0}": "Enable {0}",
			"解绑「{0}」？": "Unbind {0}?",
			"私聊 {0}": "Direct chat {0}",
			"成员 {0}": "Member {0}",
			"引用附件 · {0} 项": "Quoted attachments · {0} items",
			"附件 · {0}": "Attachment · {0}",
			"附件 · {0} 项": "Attachments · {0} items",
			"{0}的消息操作": "Message actions for {0}",
			"来源 · {0}": "Source · {0}",
			"打开原图 {0}": "Open original image {0}",
			"QQ 图片 {0}": "QQ image {0}",
			"消息未发送{0}，请检查连接或权限后重试。": "Message was not sent{0}. Check your connection or access and try again.",
			"回复 {0} · {1}": "Reply to {0} · {1}",
			"附件 {0} 项": "{0} attachments",
			"命令清单加载失败：{0}": "Could not load slash commands: {0}",
			"{0}草稿已保留，请先刷新配置。": "{0}Your draft is available. Refresh settings first.",
			"保存结果未确认：{0}。草稿已保留，可重试或刷新配置核对。": "Could not confirm save: {0}. Your draft is available. Retry or refresh settings.",
			"机器人名称已保存。{0}": "Bot name saved. {0}",
			"配置加载失败：{0}": "Could not load settings: {0}",
			"DSH 目录加载超时。": "DSH catalogs did not load in time.",
			"此宿主的目录暂不可用。": "Catalogs are unavailable on this Host.",
			"模型目录不可用": "Model catalog unavailable",
			"Agent 预设目录不可用": "Agent presets unavailable",
			"权限目录不可用": "Permission presets unavailable",
			"无法添加工作区。": "Could not add the workspace.",
			"自定义工具": "Custom tools",
			"自定义工具 · 上限 {0} · 已选 {1} 项": "Custom tools · {0} ceiling · {1} selected",
			"当前 Session（已归档）": "Current Session (archived)",
			"模型与推理强度请在原生会话查看": "Open the DSH Session to view its model and reasoning effort.",
			"在原生会话中调整": "Adjust in the DSH Session",
			"新建 Session 默认值": "New Session defaults",
			"模型、推理强度、预设、工作区和原生权限在新建时应用。自定义工具限制保存后生效。": "Model, reasoning effort, preset, workspace, and native permissions apply to new Sessions. Custom tool limits apply when saved.",
			"正在读取 DSH 目录…": "Loading DSH catalogs…",
			"重试目录": "Reload catalogs",
			"模型": "Model",
			"推理强度": "Reasoning effort",
			"模型默认 · {0}": "Model default · {0}",
			"模型默认": "Model default",
			"Agent 预设": "Agent preset",
			"工作区": "Workspace",
			"机器人默认目录": "Bot default directory",
			"默认工作区": "Default workspace",
			"已配置的工作目录": "Configured working directory",
			"＋ 添加工作区（选择文件夹…）": "+ Add workspace…",
			"执行权限": "Execution permissions",
			"设置权限上限和允许的工具": "Set the permission ceiling and allowed tools",
			"DSH 默认 · {0}": "DSH default · {0}",
			"DSH 默认权限": "DSH default permissions",
			"群聊补充提示词": "Group prompt",
			"私聊补充提示词": "Private chat prompt",
			"补充提示词": "Supplemental prompt",
			"保存后，下次组装模型请求时读取。": "Applies to the next model request after saving.",
			"补充提示词场景": "Prompt scope",
			"群聊生成完成后发送整条回复。": "Group chats receive the final answer after the turn completes.",
			"私聊流式输出": "Stream private chat replies",
			"保存后下一轮生效，仅限被动回复。": "Applies on the next turn to replies initiated in QQ.",
			"显示工具成功结果": "Show successful tool results",
			"仅在整轮失败时向 QQ 发送简短提示。": "QQ receives a brief notice if the turn fails.",
			"文件": "Files",
			"搜索": "Search",
			"联网": "Web",
			"命令与代码": "Commands and code",
			"附件与交付": "Attachments and deliverables",
			"其他": "Other",
			"MCP": "MCP",
			"当前不可用": "Currently unavailable",
			"无法读取工具目录。": "Could not load tools.",
			"当前 Agent 预设未提供": "Unavailable in the current Agent preset",
			"{0} · {1} 项": "{0} · {1} tools",
			"本浏览器无法保存工具组合。": "This browser could not save the tool combination.",
			"已有同名组合。": "A combination with this name already exists.",
			"关闭工具选择": "Close tool picker",
			"确认选择": "Confirm selection",
			"权限上限": "Permission ceiling",
			"当前 Session 的原生权限高于上限时，所选工具会暂停使用。": "Selected tools pause while the current Session exceeds this permission ceiling.",
			"内置模板": "Built-in templates",
			"我的组合": "My combinations",
			"新建组合": "New combination",
			"删除组合 {0}": "Delete combination {0}",
			"输入组合名称": "Enter a name",
			"组合名称": "Combination name",
			"取消新建": "Cancel",
			"保存组合": "Save combination",
			"保存下方已选的 {0} 项工具。": "Save the {0} selected tools.",
			"在下方勾选要保存的工具。": "Select the tools to save with this combination.",
			"已选工具": "Selected tools",
			"已选工具（{0}）": "Selected tools ({0})",
			"清空选择": "Clear selection",
			"不可用": "Unavailable",
			"移除已选工具 {0}": "Remove selected tool {0}",
			"尚未选择工具。": "No tools selected.",
			"组合变更": "Combination changes",
			"已套用「{0}」": "Applied {0}",
			"新增": "Added",
			"移除": "Remove",
			"跳过（当前不可用）": "Skipped (unavailable)",
			"{0} {1} 项 ": "{0} {1} tools ",
			"搜索工具名称或描述": "Search tool names or descriptions",
			"搜索工具": "Search tools",
			"仅看已选": "Selected only",
			"工具分类": "Tool categories",
			"全选当前筛选": "Select all filtered tools",
			"取消当前筛选的勾选": "Deselect filtered tools",
			"正在读取工具…": "Loading tools…",
			"没有匹配的工具。": "No matching tools.",
			"工具列表": "Tool list",
			"全选本组": "Select this group",
			"取消本组勾选": "Deselect this group",
			"最多可选 {0} 项工具。": "Select up to {0} tools.",
			"回到设置页保存后生效。": "Save settings to apply your selection.",
			"保存空名单后，Session 无法调用工具。": "Saving an empty list blocks all tools in the Session.",
			"只读：文件与搜索": "Read only · Files and search",
			"只读 + 网页": "Read only + web",
			"无法更新默认设置。": "Could not update defaults.",
			"默认设置已更新，草稿已保留。": "Defaults refreshed. Your draft is still available.",
			"默认设置已保存。": "Defaults saved.",
			"首次建立 QQ 群聊或私聊的配置时采用。": "Applies when setting up a QQ chat for the first time.",
			"处理中…": "Working…",
			"重新读取": "Reload",
			"正在读取默认设置…": "Loading defaults…",
			"编辑": "Edit",
			"预览": "Preview",
			"无法预览补充提示词。": "Could not preview the prompt.",
			"请选择 MD、TXT 或 DOCX 文件。": "Choose an MD, TXT, or DOCX file.",
			"无法打开原文件。": "Could not open the original file.",
			"{0}来源": "{0} source",
			"直接输入": "Enter text",
			"文件路径": "File path",
			"{0}视图": "{0} view",
			"输入{0}": "Enter {0}",
			"{0}预览": "{0} preview",
			"暂无补充提示词。": "No supplemental prompt.",
			"{0}文件路径": "{0} file path",
			"输入 DSH 宿主上的绝对文件路径": "Enter an absolute path on the DSH Host",
			"选择文件": "Choose file",
			"预览{0}文件": "Preview file for {0}",
			"刷新预览": "Refresh preview",
			"预览文件": "Preview file",
			"编辑原文件": "Edit original",
			"此宿主暂不支持打开原文件。": "This Host cannot open the original file.",
			"正在打开…": "Opening…",
			"打开原文编辑": "Open original to edit",
			"正在读取提示词文件…": "Reading prompt file…",
			"文件内容为空。": "The file is empty.",
			"支持 MD、TXT、DOCX。保存路径后，每次组装请求都会读取文件。": "Supports MD, TXT, and DOCX. Requests read the saved path each time.",
			"含 {{…}}，DSH 会在组装提示词时解析变量。": "DSH resolves {{…}} variables when it builds the prompt.",
			"无法保存原文件。": "Could not save the original file.",
			"读取最新版本": "Load latest version",
			"最新文件内容": "Latest file contents",
			"已保留草稿。请核对最新文件后再保存。": "Draft preserved. Review the latest file contents before saving.",
			"编辑提示词原文件": "Edit the original prompt file",
			"正在保存…": "Saving…",
			"保存到原文件": "Save original file",
			"原文件视图": "Original file view",
			"原文件正文": "Original file content",
			"原文件编辑预览": "Preview original file edits",
			"无法读取宿主目录。": "Could not read the Host directory.",
			"选择提示词文件": "Choose a prompt file",
			"浏览 DSH 宿主上的 MD、TXT、DOCX 文件。": "Browse MD, TXT, and DOCX files on the DSH Host.",
			"使用此文件": "Use this file",
			"宿主目录路径": "Host directory path",
			"输入宿主目录路径": "Enter a Host directory path",
			"前往": "Go",
			"主目录": "Home",
			"上一级": "Parent folder",
			"正在读取目录…": "Reading directory…",
			"宿主目录内容": "Host directory contents",
			"文件夹 ›": "Folder ›",
			"此目录没有可选文件。": "No supported files in this directory.",
			"目录内容较多。也可以直接填写文件路径。": "You can enter a file path directly.",
			"读取认领状态失败": "Could not load pairing status",
			"OpenID 已复制。": "OpenID copied.",
			"剪贴板不可用，请选择 OpenID 手动复制。": "Clipboard unavailable. Select the OpenID and copy it manually.",
			"复制失败，请选择 OpenID 手动复制。": "Copy failed. Select the OpenID and copy it manually.",
			"配对码已过期，请重新生成": "The pairing code expired. Generate a new one.",
			"配对码已结束，请核对名单；未加入时请重新生成。": "Pairing ended. Check the list and generate another code if needed.",
			"先完成 QQ 机器人绑定，才能配置认领。": "Bind the QQ bot to configure pairing.",
			"生成配对码失败": "Could not generate a pairing code",
			"已从{0}移除。": "Removed from {0}.",
			"移除失败": "Could not remove the entry",
			"昵称已更新。": "Nickname updated.",
			"修改失败": "Could not update the entry",
			"添加失败": "Could not add the entry",
			"结束配对失败，请重试": "Could not end pairing. Try again.",
			"添加": "Add",
			"复制{0}全部 OpenID 和昵称": "Copy all OpenIDs and names in {0}",
			"每行一个 OpenID:昵称，可直接粘贴到批量添加": "One OpenID:nickname per line. Paste into the bulk add field.",
			"名单已复制（OpenID:昵称，每行一个）。": "List copied with one OpenID:nickname per line.",
			"复制全部": "Copy all",
			"导出失败": "Export failed",
			"导出 CSV": "Export CSV",
			"名单修改即时保存。": "List changes are saved immediately.",
			"尚未添加任何成员。": "No members added.",
			"（未命名）": "(Unnamed)",
			"群成员{0}": "Group member {0}",
			"私聊用户": "Private chat user",
			"复制 {0} 的 OpenID": "Copy the OpenID for {0}",
			"复制 OpenID": "Copy OpenID",
			"昵称": "Nickname",
			"修改昵称": "Change nickname",
			"改名": "Rename",
			"添加{0}": "Add to {0}",
			"关闭并停止配对": "Close and end pairing",
			"完成后配对码失效，已添加的成员保留。": "Finish to expire the pairing code and keep the members you added.",
			"完成": "Done",
			"在需要添加的群里 @机器人后发送此码，有效期内可连续添加多个群。": "Mention the bot and send this code in each group you want to add.",
			"让需要添加的用户在私聊里发送此码，有效期内可连续添加多人。": "Ask each person you want to add to send this code to the bot in a private chat.",
			"已结束，请重新生成": "Pairing ended. Generate a new code.",
			"剩余 {0}:{1}": "{0}:{1} left",
			"已复制": "Copied",
			"复制": "Copy",
			"查看原文": "View source",
			"查看排版": "View formatted message",
			"消息原文": "Message source",
			"QQ 表情": "QQ emoji",
			"表情包": "Sticker",
			"脚注": "Footnotes",
			"复制配对码": "Copy pairing code",
			"生成中…": "Generating…",
			"重新生成": "Regenerate",
			"生成配对码": "Generate pairing code",
			"启用机器人后可生成配对码。": "Enable the bot to generate a pairing code.",
			"通过 OpenID 批量添加（非{0}）": "Bulk add by OpenID",
			"群号": "group number",
			" QQ 号": "QQ number",
			"用户 OpenID 不是 QQ 号，群 OpenID 也不是群号，不能直接填写 QQ 号或群号。请使用当前机器人对应的 OpenID；没有 OpenID 时，请使用上方配对码添加。": "Use OpenIDs assigned to this bot. Use the pairing code if you only have QQ or group numbers.",
			"每行一个 OpenID 或 OpenID:昵称。简单条目也可用逗号分隔；昵称含逗号时用双引号包住。": "Enter one OpenID or OpenID:nickname per line. To separate entries with commas, put nicknames containing commas in double quotes.",
			"{0} openID 列表": "{0} OpenID list",
			"OpenID 或 OpenID:昵称，每行一个；不能填写 QQ 号或群号": "Enter one OpenID or OpenID:nickname per line.",
			"添加后可继续填写，配对码保持有效。": "You can keep adding entries while the code is valid.",
			"本次添加结果": "Pairing results",
			"本次添加结果（{0} 项新增）": "Pairing results ({0} added)",
			"等待认领，成功结果会显示在这里。": "New entries appear here as they pair.",
			"未命名群聊": "Unnamed group",
			"未命名用户": "Unnamed user",
			"已添加": "Added",
			"已在名单中": "Already on the list",
			"已移除": "Removed",
			"QQ 接口已接受。": "QQ accepted the request.",
			"正在等待 QQ 回执。": "Waiting for QQ.",
			"发送结果未知，请在 QQ 核对。": "Check QQ to confirm whether it was sent.",
			"消息未发送{0}。": "Message was not sent{0}.",
			"暂未取得发送回执，请查询状态。": "No receipt yet. Check status.",
			"暂时无法取得 QQ 发送结果。": "Could not retrieve QQ delivery status.",
			"请核对机器人、接收方和正文。": "Check the bot, recipient, and message.",
			"查询发送状态": "Check delivery status",
			"正在发送…": "Sending…",
			"确认发送": "Confirm send",
			"接收方": "Recipient",
			"QQ 群聊": "QQ group",
			"QQ 私聊": "QQ private chat",
			"待发送正文": "Message to send",
			"此对话允许网页回答自动推送。若 QQ 已有这条回答，手动发送会再发一条。": "Web replies can be sent to this chat automatically. Sending manually will send another copy if QQ already has this reply.",
			"此对话已关闭消息保存，发送结果在此查看。": "Recording is paused for this chat. Check delivery status here.",
			"正在读取回答…": "Loading reply…",
			"{0} · {1}": "{0} · {1}",
			"{0} {1}": "{0} {1}",
			"显示私聊工具成功结果": "Show successful tool results in private chats",
			"群聊只发送最终答复。": "Group chats receive the final answer."
		};
		function locale() {
			const language = typeof document === "undefined" ? "" : document.documentElement?.lang;
			return !language || language.startsWith("zh") ? "zh-CN" : "en";
		}
		function t(key, ...params) {
			return (locale() === "en" ? english[key] : key).replace(/\{(\d+)\}/g, (_, position) => String(params[Number(position)] ?? ""));
		}
		function subscribe(listener) {
			if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
			const observer = new MutationObserver(listener);
			observer.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ["lang"]
			});
			return () => observer.disconnect();
		}
		function useQqLocale() {
			return (0, react.useSyncExternalStore)(subscribe, locale);
		}
		//#endregion
		//#region src/shared/workbench-timeline-protocol.ts
		const WORKBENCH_TIMELINE_PATH = "/api/qqbot/workbench/timeline";
		const WORKBENCH_SEND_PATH = "/api/qqbot/workbench/send";
		const QQ_MANUAL_MESSAGE_LIMIT = 2e3;
		function canQuoteTimelineEntry(row) {
			return row?.direction === "inbound" && row.status === "received" && typeof row.platformId === "string" && row.platformId.length > 0 && row.text !== "配对码已隐藏" && !/^\/[a-z]/i.test(row.text) && (!!row.text || !!row.attachments);
		}
		//#endregion
		//#region src/client/http.ts
		/** Same-origin JSON requests with bounded waiting and actionable HTTP errors. */
		var HttpError = class extends Error {
			status;
			constructor(status, message) {
				super(message);
				this.status = status;
			}
		};
		async function fetchJson(path, init = {}, timeoutMs = 1e4) {
			const controller = new AbortController();
			const callerSignal = init.signal;
			let timedOut = false;
			const onCancel = () => {
				controller.abort(callerSignal?.reason);
			};
			if (callerSignal?.aborted) onCancel();
			else callerSignal?.addEventListener("abort", onCancel, { once: true });
			const timer = setTimeout(() => {
				if (controller.signal.aborted) return;
				timedOut = true;
				controller.abort();
			}, timeoutMs);
			try {
				if (controller.signal.aborted) throw new DOMException("请求已取消", "AbortError");
				const response = await fetch(path, {
					...init,
					signal: controller.signal
				});
				if (!response.ok) {
					const body = await response.json().catch(() => null);
					throw new HttpError(response.status, body?.error ?? `请求失败（HTTP ${response.status}）`);
				}
				return await response.json();
			} catch (error) {
				if (controller.signal.aborted) {
					if (timedOut) throw new Error("请求超时，请重试");
					throw new DOMException("请求已取消", "AbortError");
				}
				throw error;
			} finally {
				clearTimeout(timer);
				callerSignal?.removeEventListener("abort", onCancel);
			}
		}
		//#endregion
		//#region src/client/workbench-composer.ts
		var ComposerState = class {
			drafts = /* @__PURE__ */ new Map();
			operations = /* @__PURE__ */ new Map();
		};
		function rememberedOperation(activeOperations, key) {
			try {
				return activeOperations.get(key) ?? sessionStorage.getItem(key) ?? void 0;
			} catch {
				return activeOperations.get(key);
			}
		}
		function rememberOperation(activeOperations, key, id) {
			if (id) activeOperations.set(key, id);
			else activeOperations.delete(key);
			try {
				if (id) sessionStorage.setItem(key, id);
				else sessionStorage.removeItem(key);
			} catch {}
		}
		const QqComposer = (0, react.forwardRef)(function QqComposer({ state, appId, peer, robotName, disabledReason, onUpdate }, ref) {
			const { drafts, operations } = state;
			const target = {
				appId,
				scope: peer.scope,
				openId: peer.openId
			};
			const key = "qqbot-send:" + JSON.stringify([
				appId,
				peer.scope,
				peer.openId
			]);
			const [draft, setDraft] = (0, react.useState)(() => drafts.get(key) ?? { text: "" });
			const [operation, setOperation] = (0, react.useState)(() => rememberedOperation(operations, key));
			const [status, setStatus] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [uncertain, setUncertain] = (0, react.useState)(false);
			const [retryable, setRetryable] = (0, react.useState)(false);
			const inFlight = (0, react.useRef)(false);
			const mounted = (0, react.useRef)(false);
			const input = (0, react.useRef)(null);
			const fileInput = (0, react.useRef)(null);
			const edit = (value) => {
				if (retryable) {
					rememberOperation(operations, key);
					setOperation(void 0);
					setRetryable(false);
				}
				if (value.text || value.attachment || value.quote) {
					drafts.delete(key);
					drafts.set(key, value);
					if (drafts.size > 100) drafts.delete(drafts.keys().next().value);
				} else drafts.delete(key);
				setDraft(value);
			};
			const finish = (id, result) => {
				const current = rememberedOperation(operations, key);
				if (current && current !== id) return;
				const done = result.status === "accepted";
				if (done && current === id) {
					rememberOperation(operations, key);
					if (result.status === "accepted") drafts.delete(key);
				}
				if (!mounted.current) return;
				if (result.status === "accepted") setDraft({ text: "" });
				if (done) setOperation(void 0);
				setUncertain(result.status === "unknown");
				setRetryable(result.status === "rejected" && (!!draft.text.trim() || !!draft.attachment));
				if (result.status === "rejected" && !draft.text.trim() && !draft.attachment) {
					rememberOperation(operations, key);
					setOperation(void 0);
				}
				const codes = [result.httpStatus && `HTTP ${result.httpStatus}`, result.platformCode && `QQ ${result.platformCode}`].filter(Boolean).join(" · ");
				setStatus(result.status === "accepted" ? t("QQ 接口已接受") : result.status === "rejected" ? t("消息未发送{0}，请检查连接或权限后重试。", codes ? `（${codes}）` : "") : result.status === "sending" ? t("正在等待 QQ 回执…") : t("发送结果未知，请先在 QQ 核对。"));
				onUpdate();
			};
			const run = async (id, submit) => {
				if (inFlight.current) return;
				inFlight.current = true;
				setBusy(true);
				setStatus(submit !== void 0 ? t("发送中…") : t("正在查询发送结果…"));
				try {
					const query = new URLSearchParams({
						...target,
						operation: id
					});
					let request = { cache: "no-store" };
					if (submit?.attachment) {
						const form = new FormData();
						query.forEach((value, key) => form.set(key, value));
						form.set("text", submit.text);
						form.set("attachment", submit.attachment);
						request = {
							method: "POST",
							body: form
						};
					} else if (submit) request = {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							...target,
							operation: id,
							text: submit.text,
							replyTo: submit.quote?.id
						})
					};
					const result = await fetchJson(submit === void 0 ? `${WORKBENCH_SEND_PATH}?${query}` : WORKBENCH_SEND_PATH, request, 24e3);
					finish(id, result);
				} catch (cause) {
					if (rememberedOperation(operations, key) !== id) return;
					const declined = submit !== void 0 && cause instanceof HttpError && [
						400,
						401,
						403,
						404,
						409,
						413
					].includes(cause.status);
					if (declined) rememberOperation(operations, key);
					if (mounted.current) {
						if (declined) setOperation(void 0);
						setUncertain(!declined);
						setStatus(declined ? cause.message : t("暂未确认发送结果，请查询回执或先在 QQ 核对。"));
					}
				} finally {
					inFlight.current = false;
					if (mounted.current) setBusy(false);
				}
			};
			(0, react.useEffect)(() => {
				mounted.current = true;
				const id = rememberedOperation(operations, key);
				if (id) run(id);
				return () => {
					mounted.current = false;
				};
			}, [key]);
			const send = () => {
				const previous = rememberedOperation(operations, key);
				if (inFlight.current || disabledReason || !draft.text.trim() && !draft.attachment || previous && !retryable) return;
				const id = previous ?? crypto.randomUUID();
				rememberOperation(operations, key, id);
				setOperation(id);
				setUncertain(false);
				setRetryable(false);
				run(id, draft);
			};
			const onKeyDown = (event) => {
				if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
				event.preventDefault();
				send();
			};
			const editLocked = !!disabledReason || busy || !!operation && !retryable;
			(0, react.useImperativeHandle)(ref, () => ({ replyTo(row, sender) {
				if (editLocked || inFlight.current || !retryable && rememberedOperation(operations, key)) return;
				if (draft.attachment) {
					setStatus(t("请先移除附件，再引用回复。"));
					return;
				}
				edit({
					...draft,
					quote: {
						id: row.id,
						text: (row.displayText ?? row.text).slice(0, 400),
						attachments: row.attachments,
						sender
					}
				});
				setStatus("");
				input.current?.focus();
			} }));
			const feedback = status || disabledReason || "";
			return (0, react.createElement)("form", {
				className: "imqw-composer",
				"aria-label": t("发送到 QQ"),
				onSubmit: (event) => {
					event.preventDefault();
					send();
				}
			}, (0, react.createElement)("input", {
				ref: fileInput,
				type: "file",
				hidden: true,
				"aria-label": t("选择 QQ 附件"),
				disabled: editLocked,
				onChange: (event) => {
					const file = event.currentTarget.files?.[0];
					event.currentTarget.value = "";
					if (!file || editLocked || draft.quote) return;
					if (!file.size || file.size > 4194304) {
						setStatus(t("请选择一个非空附件，最多 4 MiB。"));
						return;
					}
					edit({
						...draft,
						attachment: file
					});
					setStatus("");
				}
			}), draft.attachment ? (0, react.createElement)("div", { className: "imqw-composer-attachment" }, (0, react.createElement)("span", { title: draft.attachment.name }, draft.attachment.name), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "ghost",
				disabled: editLocked,
				onClick: () => {
					edit({ text: draft.text });
					setStatus("");
				}
			}, t("移除附件"))) : null, draft.quote ? (0, react.createElement)("div", { className: "imqw-composer-attachment imqw-composer-quote" }, (0, react.createElement)("span", { title: draft.quote.text }, t("回复 {0} · {1}", draft.quote.sender, draft.quote.text || t("附件 {0} 项", draft.quote.attachments))), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "ghost",
				disabled: editLocked,
				onClick: () => {
					edit({ text: draft.text });
					setStatus("");
					input.current?.focus();
				}
			}, t("取消引用"))) : null, (0, react.createElement)("textarea", {
				ref: input,
				"aria-label": t("发送到 QQ 的消息"),
				rows: 2,
				maxLength: QQ_MANUAL_MESSAGE_LIMIT,
				value: draft.text,
				readOnly: editLocked,
				disabled: !!disabledReason,
				placeholder: t("输入消息"),
				onChange: (event) => {
					edit({
						...draft,
						text: event.currentTarget.value
					});
					setStatus("");
				},
				onKeyDown
			}), (0, react.createElement)("div", { className: "imqw-composer-toolbar" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "ghost",
				disabled: editLocked || !!draft.quote,
				onClick: () => fileInput.current?.click(),
				title: draft.quote ? t("取消引用后可添加附件") : t("每次可发送一个附件，最多 4 MiB")
			}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconPaperclipOutlineRegular, { size: 15 }), t("附件")), (0, react.createElement)("span", {
				className: "imqw-compose-as imqw-muted",
				title: robotName
			}, robotName), (0, react.createElement)("span", { className: "imqw-compose-shortcut imqw-muted" }, t("Shift + Enter 换行")), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "submit",
				size: "sm",
				variant: "primary",
				className: "imqw-send",
				disabled: editLocked || !draft.text.trim() && !draft.attachment
			}, t("发送到 QQ"))), (0, react.createElement)("div", {
				className: "imqw-composer-feedback",
				hidden: !feedback && (!operation || busy)
			}, (0, react.createElement)("span", {
				className: "imqw-muted",
				role: "status"
			}, feedback), operation && !busy ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				variant: "outline",
				size: "sm",
				onClick: () => {
					run(operation);
				}
			}, t("查询回执")) : null, operation && !busy && uncertain ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				variant: "ghost",
				size: "sm",
				onClick: () => {
					rememberOperation(operations, key);
					setOperation(void 0);
					setUncertain(false);
					setStatus(t("已结束查询。发送前请在 QQ 核对。"));
					input.current?.focus();
				}
			}, t("结束查询")) : null));
		});
		//#endregion
		//#region node_modules/.pnpm/mdast-util-to-string@4.0.0/node_modules/mdast-util-to-string/lib/index.js
		/**
		* @typedef {import('mdast').Nodes} Nodes
		*
		* @typedef Options
		*   Configuration (optional).
		* @property {boolean | null | undefined} [includeImageAlt=true]
		*   Whether to use `alt` for `image`s (default: `true`).
		* @property {boolean | null | undefined} [includeHtml=true]
		*   Whether to use `value` of HTML (default: `true`).
		*/
		/** @type {Options} */
		const emptyOptions = {};
		/**
		* Get the text content of a node or list of nodes.
		*
		* Prefers the node’s plain-text fields, otherwise serializes its children,
		* and if the given value is an array, serialize the nodes in it.
		*
		* @param {unknown} [value]
		*   Thing to serialize, typically `Node`.
		* @param {Options | null | undefined} [options]
		*   Configuration (optional).
		* @returns {string}
		*   Serialized `value`.
		*/
		function toString(value, options) {
			const settings = options || emptyOptions;
			return one(value, typeof settings.includeImageAlt === "boolean" ? settings.includeImageAlt : true, typeof settings.includeHtml === "boolean" ? settings.includeHtml : true);
		}
		/**
		* One node or several nodes.
		*
		* @param {unknown} value
		*   Thing to serialize.
		* @param {boolean} includeImageAlt
		*   Include image `alt`s.
		* @param {boolean} includeHtml
		*   Include HTML.
		* @returns {string}
		*   Serialized node.
		*/
		function one(value, includeImageAlt, includeHtml) {
			if (node(value)) {
				if ("value" in value) return value.type === "html" && !includeHtml ? "" : value.value;
				if (includeImageAlt && "alt" in value && value.alt) return value.alt;
				if ("children" in value) return all(value.children, includeImageAlt, includeHtml);
			}
			if (Array.isArray(value)) return all(value, includeImageAlt, includeHtml);
			return "";
		}
		/**
		* Serialize a list of nodes.
		*
		* @param {Array<unknown>} values
		*   Thing to serialize.
		* @param {boolean} includeImageAlt
		*   Include image `alt`s.
		* @param {boolean} includeHtml
		*   Include HTML.
		* @returns {string}
		*   Serialized nodes.
		*/
		function all(values, includeImageAlt, includeHtml) {
			/** @type {Array<string>} */
			const result = [];
			let index = -1;
			while (++index < values.length) result[index] = one(values[index], includeImageAlt, includeHtml);
			return result.join("");
		}
		/**
		* Check if `value` looks like a node.
		*
		* @param {unknown} value
		*   Thing.
		* @returns {value is Nodes}
		*   Whether `value` is a node.
		*/
		function node(value) {
			return Boolean(value && typeof value === "object");
		}
		//#endregion
		//#region node_modules/.pnpm/character-entities@2.0.2/node_modules/character-entities/index.js
		/**
		* Map of named character references.
		*
		* @type {Record<string, string>}
		*/
		const characterEntities = {
			AElig: "Æ",
			AMP: "&",
			Aacute: "Á",
			Abreve: "Ă",
			Acirc: "Â",
			Acy: "А",
			Afr: "𝔄",
			Agrave: "À",
			Alpha: "Α",
			Amacr: "Ā",
			And: "⩓",
			Aogon: "Ą",
			Aopf: "𝔸",
			ApplyFunction: "⁡",
			Aring: "Å",
			Ascr: "𝒜",
			Assign: "≔",
			Atilde: "Ã",
			Auml: "Ä",
			Backslash: "∖",
			Barv: "⫧",
			Barwed: "⌆",
			Bcy: "Б",
			Because: "∵",
			Bernoullis: "ℬ",
			Beta: "Β",
			Bfr: "𝔅",
			Bopf: "𝔹",
			Breve: "˘",
			Bscr: "ℬ",
			Bumpeq: "≎",
			CHcy: "Ч",
			COPY: "©",
			Cacute: "Ć",
			Cap: "⋒",
			CapitalDifferentialD: "ⅅ",
			Cayleys: "ℭ",
			Ccaron: "Č",
			Ccedil: "Ç",
			Ccirc: "Ĉ",
			Cconint: "∰",
			Cdot: "Ċ",
			Cedilla: "¸",
			CenterDot: "·",
			Cfr: "ℭ",
			Chi: "Χ",
			CircleDot: "⊙",
			CircleMinus: "⊖",
			CirclePlus: "⊕",
			CircleTimes: "⊗",
			ClockwiseContourIntegral: "∲",
			CloseCurlyDoubleQuote: "”",
			CloseCurlyQuote: "’",
			Colon: "∷",
			Colone: "⩴",
			Congruent: "≡",
			Conint: "∯",
			ContourIntegral: "∮",
			Copf: "ℂ",
			Coproduct: "∐",
			CounterClockwiseContourIntegral: "∳",
			Cross: "⨯",
			Cscr: "𝒞",
			Cup: "⋓",
			CupCap: "≍",
			DD: "ⅅ",
			DDotrahd: "⤑",
			DJcy: "Ђ",
			DScy: "Ѕ",
			DZcy: "Џ",
			Dagger: "‡",
			Darr: "↡",
			Dashv: "⫤",
			Dcaron: "Ď",
			Dcy: "Д",
			Del: "∇",
			Delta: "Δ",
			Dfr: "𝔇",
			DiacriticalAcute: "´",
			DiacriticalDot: "˙",
			DiacriticalDoubleAcute: "˝",
			DiacriticalGrave: "`",
			DiacriticalTilde: "˜",
			Diamond: "⋄",
			DifferentialD: "ⅆ",
			Dopf: "𝔻",
			Dot: "¨",
			DotDot: "⃜",
			DotEqual: "≐",
			DoubleContourIntegral: "∯",
			DoubleDot: "¨",
			DoubleDownArrow: "⇓",
			DoubleLeftArrow: "⇐",
			DoubleLeftRightArrow: "⇔",
			DoubleLeftTee: "⫤",
			DoubleLongLeftArrow: "⟸",
			DoubleLongLeftRightArrow: "⟺",
			DoubleLongRightArrow: "⟹",
			DoubleRightArrow: "⇒",
			DoubleRightTee: "⊨",
			DoubleUpArrow: "⇑",
			DoubleUpDownArrow: "⇕",
			DoubleVerticalBar: "∥",
			DownArrow: "↓",
			DownArrowBar: "⤓",
			DownArrowUpArrow: "⇵",
			DownBreve: "̑",
			DownLeftRightVector: "⥐",
			DownLeftTeeVector: "⥞",
			DownLeftVector: "↽",
			DownLeftVectorBar: "⥖",
			DownRightTeeVector: "⥟",
			DownRightVector: "⇁",
			DownRightVectorBar: "⥗",
			DownTee: "⊤",
			DownTeeArrow: "↧",
			Downarrow: "⇓",
			Dscr: "𝒟",
			Dstrok: "Đ",
			ENG: "Ŋ",
			ETH: "Ð",
			Eacute: "É",
			Ecaron: "Ě",
			Ecirc: "Ê",
			Ecy: "Э",
			Edot: "Ė",
			Efr: "𝔈",
			Egrave: "È",
			Element: "∈",
			Emacr: "Ē",
			EmptySmallSquare: "◻",
			EmptyVerySmallSquare: "▫",
			Eogon: "Ę",
			Eopf: "𝔼",
			Epsilon: "Ε",
			Equal: "⩵",
			EqualTilde: "≂",
			Equilibrium: "⇌",
			Escr: "ℰ",
			Esim: "⩳",
			Eta: "Η",
			Euml: "Ë",
			Exists: "∃",
			ExponentialE: "ⅇ",
			Fcy: "Ф",
			Ffr: "𝔉",
			FilledSmallSquare: "◼",
			FilledVerySmallSquare: "▪",
			Fopf: "𝔽",
			ForAll: "∀",
			Fouriertrf: "ℱ",
			Fscr: "ℱ",
			GJcy: "Ѓ",
			GT: ">",
			Gamma: "Γ",
			Gammad: "Ϝ",
			Gbreve: "Ğ",
			Gcedil: "Ģ",
			Gcirc: "Ĝ",
			Gcy: "Г",
			Gdot: "Ġ",
			Gfr: "𝔊",
			Gg: "⋙",
			Gopf: "𝔾",
			GreaterEqual: "≥",
			GreaterEqualLess: "⋛",
			GreaterFullEqual: "≧",
			GreaterGreater: "⪢",
			GreaterLess: "≷",
			GreaterSlantEqual: "⩾",
			GreaterTilde: "≳",
			Gscr: "𝒢",
			Gt: "≫",
			HARDcy: "Ъ",
			Hacek: "ˇ",
			Hat: "^",
			Hcirc: "Ĥ",
			Hfr: "ℌ",
			HilbertSpace: "ℋ",
			Hopf: "ℍ",
			HorizontalLine: "─",
			Hscr: "ℋ",
			Hstrok: "Ħ",
			HumpDownHump: "≎",
			HumpEqual: "≏",
			IEcy: "Е",
			IJlig: "Ĳ",
			IOcy: "Ё",
			Iacute: "Í",
			Icirc: "Î",
			Icy: "И",
			Idot: "İ",
			Ifr: "ℑ",
			Igrave: "Ì",
			Im: "ℑ",
			Imacr: "Ī",
			ImaginaryI: "ⅈ",
			Implies: "⇒",
			Int: "∬",
			Integral: "∫",
			Intersection: "⋂",
			InvisibleComma: "⁣",
			InvisibleTimes: "⁢",
			Iogon: "Į",
			Iopf: "𝕀",
			Iota: "Ι",
			Iscr: "ℐ",
			Itilde: "Ĩ",
			Iukcy: "І",
			Iuml: "Ï",
			Jcirc: "Ĵ",
			Jcy: "Й",
			Jfr: "𝔍",
			Jopf: "𝕁",
			Jscr: "𝒥",
			Jsercy: "Ј",
			Jukcy: "Є",
			KHcy: "Х",
			KJcy: "Ќ",
			Kappa: "Κ",
			Kcedil: "Ķ",
			Kcy: "К",
			Kfr: "𝔎",
			Kopf: "𝕂",
			Kscr: "𝒦",
			LJcy: "Љ",
			LT: "<",
			Lacute: "Ĺ",
			Lambda: "Λ",
			Lang: "⟪",
			Laplacetrf: "ℒ",
			Larr: "↞",
			Lcaron: "Ľ",
			Lcedil: "Ļ",
			Lcy: "Л",
			LeftAngleBracket: "⟨",
			LeftArrow: "←",
			LeftArrowBar: "⇤",
			LeftArrowRightArrow: "⇆",
			LeftCeiling: "⌈",
			LeftDoubleBracket: "⟦",
			LeftDownTeeVector: "⥡",
			LeftDownVector: "⇃",
			LeftDownVectorBar: "⥙",
			LeftFloor: "⌊",
			LeftRightArrow: "↔",
			LeftRightVector: "⥎",
			LeftTee: "⊣",
			LeftTeeArrow: "↤",
			LeftTeeVector: "⥚",
			LeftTriangle: "⊲",
			LeftTriangleBar: "⧏",
			LeftTriangleEqual: "⊴",
			LeftUpDownVector: "⥑",
			LeftUpTeeVector: "⥠",
			LeftUpVector: "↿",
			LeftUpVectorBar: "⥘",
			LeftVector: "↼",
			LeftVectorBar: "⥒",
			Leftarrow: "⇐",
			Leftrightarrow: "⇔",
			LessEqualGreater: "⋚",
			LessFullEqual: "≦",
			LessGreater: "≶",
			LessLess: "⪡",
			LessSlantEqual: "⩽",
			LessTilde: "≲",
			Lfr: "𝔏",
			Ll: "⋘",
			Lleftarrow: "⇚",
			Lmidot: "Ŀ",
			LongLeftArrow: "⟵",
			LongLeftRightArrow: "⟷",
			LongRightArrow: "⟶",
			Longleftarrow: "⟸",
			Longleftrightarrow: "⟺",
			Longrightarrow: "⟹",
			Lopf: "𝕃",
			LowerLeftArrow: "↙",
			LowerRightArrow: "↘",
			Lscr: "ℒ",
			Lsh: "↰",
			Lstrok: "Ł",
			Lt: "≪",
			Map: "⤅",
			Mcy: "М",
			MediumSpace: " ",
			Mellintrf: "ℳ",
			Mfr: "𝔐",
			MinusPlus: "∓",
			Mopf: "𝕄",
			Mscr: "ℳ",
			Mu: "Μ",
			NJcy: "Њ",
			Nacute: "Ń",
			Ncaron: "Ň",
			Ncedil: "Ņ",
			Ncy: "Н",
			NegativeMediumSpace: "​",
			NegativeThickSpace: "​",
			NegativeThinSpace: "​",
			NegativeVeryThinSpace: "​",
			NestedGreaterGreater: "≫",
			NestedLessLess: "≪",
			NewLine: "\n",
			Nfr: "𝔑",
			NoBreak: "⁠",
			NonBreakingSpace: "\xA0",
			Nopf: "ℕ",
			Not: "⫬",
			NotCongruent: "≢",
			NotCupCap: "≭",
			NotDoubleVerticalBar: "∦",
			NotElement: "∉",
			NotEqual: "≠",
			NotEqualTilde: "≂̸",
			NotExists: "∄",
			NotGreater: "≯",
			NotGreaterEqual: "≱",
			NotGreaterFullEqual: "≧̸",
			NotGreaterGreater: "≫̸",
			NotGreaterLess: "≹",
			NotGreaterSlantEqual: "⩾̸",
			NotGreaterTilde: "≵",
			NotHumpDownHump: "≎̸",
			NotHumpEqual: "≏̸",
			NotLeftTriangle: "⋪",
			NotLeftTriangleBar: "⧏̸",
			NotLeftTriangleEqual: "⋬",
			NotLess: "≮",
			NotLessEqual: "≰",
			NotLessGreater: "≸",
			NotLessLess: "≪̸",
			NotLessSlantEqual: "⩽̸",
			NotLessTilde: "≴",
			NotNestedGreaterGreater: "⪢̸",
			NotNestedLessLess: "⪡̸",
			NotPrecedes: "⊀",
			NotPrecedesEqual: "⪯̸",
			NotPrecedesSlantEqual: "⋠",
			NotReverseElement: "∌",
			NotRightTriangle: "⋫",
			NotRightTriangleBar: "⧐̸",
			NotRightTriangleEqual: "⋭",
			NotSquareSubset: "⊏̸",
			NotSquareSubsetEqual: "⋢",
			NotSquareSuperset: "⊐̸",
			NotSquareSupersetEqual: "⋣",
			NotSubset: "⊂⃒",
			NotSubsetEqual: "⊈",
			NotSucceeds: "⊁",
			NotSucceedsEqual: "⪰̸",
			NotSucceedsSlantEqual: "⋡",
			NotSucceedsTilde: "≿̸",
			NotSuperset: "⊃⃒",
			NotSupersetEqual: "⊉",
			NotTilde: "≁",
			NotTildeEqual: "≄",
			NotTildeFullEqual: "≇",
			NotTildeTilde: "≉",
			NotVerticalBar: "∤",
			Nscr: "𝒩",
			Ntilde: "Ñ",
			Nu: "Ν",
			OElig: "Œ",
			Oacute: "Ó",
			Ocirc: "Ô",
			Ocy: "О",
			Odblac: "Ő",
			Ofr: "𝔒",
			Ograve: "Ò",
			Omacr: "Ō",
			Omega: "Ω",
			Omicron: "Ο",
			Oopf: "𝕆",
			OpenCurlyDoubleQuote: "“",
			OpenCurlyQuote: "‘",
			Or: "⩔",
			Oscr: "𝒪",
			Oslash: "Ø",
			Otilde: "Õ",
			Otimes: "⨷",
			Ouml: "Ö",
			OverBar: "‾",
			OverBrace: "⏞",
			OverBracket: "⎴",
			OverParenthesis: "⏜",
			PartialD: "∂",
			Pcy: "П",
			Pfr: "𝔓",
			Phi: "Φ",
			Pi: "Π",
			PlusMinus: "±",
			Poincareplane: "ℌ",
			Popf: "ℙ",
			Pr: "⪻",
			Precedes: "≺",
			PrecedesEqual: "⪯",
			PrecedesSlantEqual: "≼",
			PrecedesTilde: "≾",
			Prime: "″",
			Product: "∏",
			Proportion: "∷",
			Proportional: "∝",
			Pscr: "𝒫",
			Psi: "Ψ",
			QUOT: "\"",
			Qfr: "𝔔",
			Qopf: "ℚ",
			Qscr: "𝒬",
			RBarr: "⤐",
			REG: "®",
			Racute: "Ŕ",
			Rang: "⟫",
			Rarr: "↠",
			Rarrtl: "⤖",
			Rcaron: "Ř",
			Rcedil: "Ŗ",
			Rcy: "Р",
			Re: "ℜ",
			ReverseElement: "∋",
			ReverseEquilibrium: "⇋",
			ReverseUpEquilibrium: "⥯",
			Rfr: "ℜ",
			Rho: "Ρ",
			RightAngleBracket: "⟩",
			RightArrow: "→",
			RightArrowBar: "⇥",
			RightArrowLeftArrow: "⇄",
			RightCeiling: "⌉",
			RightDoubleBracket: "⟧",
			RightDownTeeVector: "⥝",
			RightDownVector: "⇂",
			RightDownVectorBar: "⥕",
			RightFloor: "⌋",
			RightTee: "⊢",
			RightTeeArrow: "↦",
			RightTeeVector: "⥛",
			RightTriangle: "⊳",
			RightTriangleBar: "⧐",
			RightTriangleEqual: "⊵",
			RightUpDownVector: "⥏",
			RightUpTeeVector: "⥜",
			RightUpVector: "↾",
			RightUpVectorBar: "⥔",
			RightVector: "⇀",
			RightVectorBar: "⥓",
			Rightarrow: "⇒",
			Ropf: "ℝ",
			RoundImplies: "⥰",
			Rrightarrow: "⇛",
			Rscr: "ℛ",
			Rsh: "↱",
			RuleDelayed: "⧴",
			SHCHcy: "Щ",
			SHcy: "Ш",
			SOFTcy: "Ь",
			Sacute: "Ś",
			Sc: "⪼",
			Scaron: "Š",
			Scedil: "Ş",
			Scirc: "Ŝ",
			Scy: "С",
			Sfr: "𝔖",
			ShortDownArrow: "↓",
			ShortLeftArrow: "←",
			ShortRightArrow: "→",
			ShortUpArrow: "↑",
			Sigma: "Σ",
			SmallCircle: "∘",
			Sopf: "𝕊",
			Sqrt: "√",
			Square: "□",
			SquareIntersection: "⊓",
			SquareSubset: "⊏",
			SquareSubsetEqual: "⊑",
			SquareSuperset: "⊐",
			SquareSupersetEqual: "⊒",
			SquareUnion: "⊔",
			Sscr: "𝒮",
			Star: "⋆",
			Sub: "⋐",
			Subset: "⋐",
			SubsetEqual: "⊆",
			Succeeds: "≻",
			SucceedsEqual: "⪰",
			SucceedsSlantEqual: "≽",
			SucceedsTilde: "≿",
			SuchThat: "∋",
			Sum: "∑",
			Sup: "⋑",
			Superset: "⊃",
			SupersetEqual: "⊇",
			Supset: "⋑",
			THORN: "Þ",
			TRADE: "™",
			TSHcy: "Ћ",
			TScy: "Ц",
			Tab: "	",
			Tau: "Τ",
			Tcaron: "Ť",
			Tcedil: "Ţ",
			Tcy: "Т",
			Tfr: "𝔗",
			Therefore: "∴",
			Theta: "Θ",
			ThickSpace: "  ",
			ThinSpace: " ",
			Tilde: "∼",
			TildeEqual: "≃",
			TildeFullEqual: "≅",
			TildeTilde: "≈",
			Topf: "𝕋",
			TripleDot: "⃛",
			Tscr: "𝒯",
			Tstrok: "Ŧ",
			Uacute: "Ú",
			Uarr: "↟",
			Uarrocir: "⥉",
			Ubrcy: "Ў",
			Ubreve: "Ŭ",
			Ucirc: "Û",
			Ucy: "У",
			Udblac: "Ű",
			Ufr: "𝔘",
			Ugrave: "Ù",
			Umacr: "Ū",
			UnderBar: "_",
			UnderBrace: "⏟",
			UnderBracket: "⎵",
			UnderParenthesis: "⏝",
			Union: "⋃",
			UnionPlus: "⊎",
			Uogon: "Ų",
			Uopf: "𝕌",
			UpArrow: "↑",
			UpArrowBar: "⤒",
			UpArrowDownArrow: "⇅",
			UpDownArrow: "↕",
			UpEquilibrium: "⥮",
			UpTee: "⊥",
			UpTeeArrow: "↥",
			Uparrow: "⇑",
			Updownarrow: "⇕",
			UpperLeftArrow: "↖",
			UpperRightArrow: "↗",
			Upsi: "ϒ",
			Upsilon: "Υ",
			Uring: "Ů",
			Uscr: "𝒰",
			Utilde: "Ũ",
			Uuml: "Ü",
			VDash: "⊫",
			Vbar: "⫫",
			Vcy: "В",
			Vdash: "⊩",
			Vdashl: "⫦",
			Vee: "⋁",
			Verbar: "‖",
			Vert: "‖",
			VerticalBar: "∣",
			VerticalLine: "|",
			VerticalSeparator: "❘",
			VerticalTilde: "≀",
			VeryThinSpace: " ",
			Vfr: "𝔙",
			Vopf: "𝕍",
			Vscr: "𝒱",
			Vvdash: "⊪",
			Wcirc: "Ŵ",
			Wedge: "⋀",
			Wfr: "𝔚",
			Wopf: "𝕎",
			Wscr: "𝒲",
			Xfr: "𝔛",
			Xi: "Ξ",
			Xopf: "𝕏",
			Xscr: "𝒳",
			YAcy: "Я",
			YIcy: "Ї",
			YUcy: "Ю",
			Yacute: "Ý",
			Ycirc: "Ŷ",
			Ycy: "Ы",
			Yfr: "𝔜",
			Yopf: "𝕐",
			Yscr: "𝒴",
			Yuml: "Ÿ",
			ZHcy: "Ж",
			Zacute: "Ź",
			Zcaron: "Ž",
			Zcy: "З",
			Zdot: "Ż",
			ZeroWidthSpace: "​",
			Zeta: "Ζ",
			Zfr: "ℨ",
			Zopf: "ℤ",
			Zscr: "𝒵",
			aacute: "á",
			abreve: "ă",
			ac: "∾",
			acE: "∾̳",
			acd: "∿",
			acirc: "â",
			acute: "´",
			acy: "а",
			aelig: "æ",
			af: "⁡",
			afr: "𝔞",
			agrave: "à",
			alefsym: "ℵ",
			aleph: "ℵ",
			alpha: "α",
			amacr: "ā",
			amalg: "⨿",
			amp: "&",
			and: "∧",
			andand: "⩕",
			andd: "⩜",
			andslope: "⩘",
			andv: "⩚",
			ang: "∠",
			ange: "⦤",
			angle: "∠",
			angmsd: "∡",
			angmsdaa: "⦨",
			angmsdab: "⦩",
			angmsdac: "⦪",
			angmsdad: "⦫",
			angmsdae: "⦬",
			angmsdaf: "⦭",
			angmsdag: "⦮",
			angmsdah: "⦯",
			angrt: "∟",
			angrtvb: "⊾",
			angrtvbd: "⦝",
			angsph: "∢",
			angst: "Å",
			angzarr: "⍼",
			aogon: "ą",
			aopf: "𝕒",
			ap: "≈",
			apE: "⩰",
			apacir: "⩯",
			ape: "≊",
			apid: "≋",
			apos: "'",
			approx: "≈",
			approxeq: "≊",
			aring: "å",
			ascr: "𝒶",
			ast: "*",
			asymp: "≈",
			asympeq: "≍",
			atilde: "ã",
			auml: "ä",
			awconint: "∳",
			awint: "⨑",
			bNot: "⫭",
			backcong: "≌",
			backepsilon: "϶",
			backprime: "‵",
			backsim: "∽",
			backsimeq: "⋍",
			barvee: "⊽",
			barwed: "⌅",
			barwedge: "⌅",
			bbrk: "⎵",
			bbrktbrk: "⎶",
			bcong: "≌",
			bcy: "б",
			bdquo: "„",
			becaus: "∵",
			because: "∵",
			bemptyv: "⦰",
			bepsi: "϶",
			bernou: "ℬ",
			beta: "β",
			beth: "ℶ",
			between: "≬",
			bfr: "𝔟",
			bigcap: "⋂",
			bigcirc: "◯",
			bigcup: "⋃",
			bigodot: "⨀",
			bigoplus: "⨁",
			bigotimes: "⨂",
			bigsqcup: "⨆",
			bigstar: "★",
			bigtriangledown: "▽",
			bigtriangleup: "△",
			biguplus: "⨄",
			bigvee: "⋁",
			bigwedge: "⋀",
			bkarow: "⤍",
			blacklozenge: "⧫",
			blacksquare: "▪",
			blacktriangle: "▴",
			blacktriangledown: "▾",
			blacktriangleleft: "◂",
			blacktriangleright: "▸",
			blank: "␣",
			blk12: "▒",
			blk14: "░",
			blk34: "▓",
			block: "█",
			bne: "=⃥",
			bnequiv: "≡⃥",
			bnot: "⌐",
			bopf: "𝕓",
			bot: "⊥",
			bottom: "⊥",
			bowtie: "⋈",
			boxDL: "╗",
			boxDR: "╔",
			boxDl: "╖",
			boxDr: "╓",
			boxH: "═",
			boxHD: "╦",
			boxHU: "╩",
			boxHd: "╤",
			boxHu: "╧",
			boxUL: "╝",
			boxUR: "╚",
			boxUl: "╜",
			boxUr: "╙",
			boxV: "║",
			boxVH: "╬",
			boxVL: "╣",
			boxVR: "╠",
			boxVh: "╫",
			boxVl: "╢",
			boxVr: "╟",
			boxbox: "⧉",
			boxdL: "╕",
			boxdR: "╒",
			boxdl: "┐",
			boxdr: "┌",
			boxh: "─",
			boxhD: "╥",
			boxhU: "╨",
			boxhd: "┬",
			boxhu: "┴",
			boxminus: "⊟",
			boxplus: "⊞",
			boxtimes: "⊠",
			boxuL: "╛",
			boxuR: "╘",
			boxul: "┘",
			boxur: "└",
			boxv: "│",
			boxvH: "╪",
			boxvL: "╡",
			boxvR: "╞",
			boxvh: "┼",
			boxvl: "┤",
			boxvr: "├",
			bprime: "‵",
			breve: "˘",
			brvbar: "¦",
			bscr: "𝒷",
			bsemi: "⁏",
			bsim: "∽",
			bsime: "⋍",
			bsol: "\\",
			bsolb: "⧅",
			bsolhsub: "⟈",
			bull: "•",
			bullet: "•",
			bump: "≎",
			bumpE: "⪮",
			bumpe: "≏",
			bumpeq: "≏",
			cacute: "ć",
			cap: "∩",
			capand: "⩄",
			capbrcup: "⩉",
			capcap: "⩋",
			capcup: "⩇",
			capdot: "⩀",
			caps: "∩︀",
			caret: "⁁",
			caron: "ˇ",
			ccaps: "⩍",
			ccaron: "č",
			ccedil: "ç",
			ccirc: "ĉ",
			ccups: "⩌",
			ccupssm: "⩐",
			cdot: "ċ",
			cedil: "¸",
			cemptyv: "⦲",
			cent: "¢",
			centerdot: "·",
			cfr: "𝔠",
			chcy: "ч",
			check: "✓",
			checkmark: "✓",
			chi: "χ",
			cir: "○",
			cirE: "⧃",
			circ: "ˆ",
			circeq: "≗",
			circlearrowleft: "↺",
			circlearrowright: "↻",
			circledR: "®",
			circledS: "Ⓢ",
			circledast: "⊛",
			circledcirc: "⊚",
			circleddash: "⊝",
			cire: "≗",
			cirfnint: "⨐",
			cirmid: "⫯",
			cirscir: "⧂",
			clubs: "♣",
			clubsuit: "♣",
			colon: ":",
			colone: "≔",
			coloneq: "≔",
			comma: ",",
			commat: "@",
			comp: "∁",
			compfn: "∘",
			complement: "∁",
			complexes: "ℂ",
			cong: "≅",
			congdot: "⩭",
			conint: "∮",
			copf: "𝕔",
			coprod: "∐",
			copy: "©",
			copysr: "℗",
			crarr: "↵",
			cross: "✗",
			cscr: "𝒸",
			csub: "⫏",
			csube: "⫑",
			csup: "⫐",
			csupe: "⫒",
			ctdot: "⋯",
			cudarrl: "⤸",
			cudarrr: "⤵",
			cuepr: "⋞",
			cuesc: "⋟",
			cularr: "↶",
			cularrp: "⤽",
			cup: "∪",
			cupbrcap: "⩈",
			cupcap: "⩆",
			cupcup: "⩊",
			cupdot: "⊍",
			cupor: "⩅",
			cups: "∪︀",
			curarr: "↷",
			curarrm: "⤼",
			curlyeqprec: "⋞",
			curlyeqsucc: "⋟",
			curlyvee: "⋎",
			curlywedge: "⋏",
			curren: "¤",
			curvearrowleft: "↶",
			curvearrowright: "↷",
			cuvee: "⋎",
			cuwed: "⋏",
			cwconint: "∲",
			cwint: "∱",
			cylcty: "⌭",
			dArr: "⇓",
			dHar: "⥥",
			dagger: "†",
			daleth: "ℸ",
			darr: "↓",
			dash: "‐",
			dashv: "⊣",
			dbkarow: "⤏",
			dblac: "˝",
			dcaron: "ď",
			dcy: "д",
			dd: "ⅆ",
			ddagger: "‡",
			ddarr: "⇊",
			ddotseq: "⩷",
			deg: "°",
			delta: "δ",
			demptyv: "⦱",
			dfisht: "⥿",
			dfr: "𝔡",
			dharl: "⇃",
			dharr: "⇂",
			diam: "⋄",
			diamond: "⋄",
			diamondsuit: "♦",
			diams: "♦",
			die: "¨",
			digamma: "ϝ",
			disin: "⋲",
			div: "÷",
			divide: "÷",
			divideontimes: "⋇",
			divonx: "⋇",
			djcy: "ђ",
			dlcorn: "⌞",
			dlcrop: "⌍",
			dollar: "$",
			dopf: "𝕕",
			dot: "˙",
			doteq: "≐",
			doteqdot: "≑",
			dotminus: "∸",
			dotplus: "∔",
			dotsquare: "⊡",
			doublebarwedge: "⌆",
			downarrow: "↓",
			downdownarrows: "⇊",
			downharpoonleft: "⇃",
			downharpoonright: "⇂",
			drbkarow: "⤐",
			drcorn: "⌟",
			drcrop: "⌌",
			dscr: "𝒹",
			dscy: "ѕ",
			dsol: "⧶",
			dstrok: "đ",
			dtdot: "⋱",
			dtri: "▿",
			dtrif: "▾",
			duarr: "⇵",
			duhar: "⥯",
			dwangle: "⦦",
			dzcy: "џ",
			dzigrarr: "⟿",
			eDDot: "⩷",
			eDot: "≑",
			eacute: "é",
			easter: "⩮",
			ecaron: "ě",
			ecir: "≖",
			ecirc: "ê",
			ecolon: "≕",
			ecy: "э",
			edot: "ė",
			ee: "ⅇ",
			efDot: "≒",
			efr: "𝔢",
			eg: "⪚",
			egrave: "è",
			egs: "⪖",
			egsdot: "⪘",
			el: "⪙",
			elinters: "⏧",
			ell: "ℓ",
			els: "⪕",
			elsdot: "⪗",
			emacr: "ē",
			empty: "∅",
			emptyset: "∅",
			emptyv: "∅",
			emsp13: " ",
			emsp14: " ",
			emsp: " ",
			eng: "ŋ",
			ensp: " ",
			eogon: "ę",
			eopf: "𝕖",
			epar: "⋕",
			eparsl: "⧣",
			eplus: "⩱",
			epsi: "ε",
			epsilon: "ε",
			epsiv: "ϵ",
			eqcirc: "≖",
			eqcolon: "≕",
			eqsim: "≂",
			eqslantgtr: "⪖",
			eqslantless: "⪕",
			equals: "=",
			equest: "≟",
			equiv: "≡",
			equivDD: "⩸",
			eqvparsl: "⧥",
			erDot: "≓",
			erarr: "⥱",
			escr: "ℯ",
			esdot: "≐",
			esim: "≂",
			eta: "η",
			eth: "ð",
			euml: "ë",
			euro: "€",
			excl: "!",
			exist: "∃",
			expectation: "ℰ",
			exponentiale: "ⅇ",
			fallingdotseq: "≒",
			fcy: "ф",
			female: "♀",
			ffilig: "ﬃ",
			fflig: "ﬀ",
			ffllig: "ﬄ",
			ffr: "𝔣",
			filig: "ﬁ",
			fjlig: "fj",
			flat: "♭",
			fllig: "ﬂ",
			fltns: "▱",
			fnof: "ƒ",
			fopf: "𝕗",
			forall: "∀",
			fork: "⋔",
			forkv: "⫙",
			fpartint: "⨍",
			frac12: "½",
			frac13: "⅓",
			frac14: "¼",
			frac15: "⅕",
			frac16: "⅙",
			frac18: "⅛",
			frac23: "⅔",
			frac25: "⅖",
			frac34: "¾",
			frac35: "⅗",
			frac38: "⅜",
			frac45: "⅘",
			frac56: "⅚",
			frac58: "⅝",
			frac78: "⅞",
			frasl: "⁄",
			frown: "⌢",
			fscr: "𝒻",
			gE: "≧",
			gEl: "⪌",
			gacute: "ǵ",
			gamma: "γ",
			gammad: "ϝ",
			gap: "⪆",
			gbreve: "ğ",
			gcirc: "ĝ",
			gcy: "г",
			gdot: "ġ",
			ge: "≥",
			gel: "⋛",
			geq: "≥",
			geqq: "≧",
			geqslant: "⩾",
			ges: "⩾",
			gescc: "⪩",
			gesdot: "⪀",
			gesdoto: "⪂",
			gesdotol: "⪄",
			gesl: "⋛︀",
			gesles: "⪔",
			gfr: "𝔤",
			gg: "≫",
			ggg: "⋙",
			gimel: "ℷ",
			gjcy: "ѓ",
			gl: "≷",
			glE: "⪒",
			gla: "⪥",
			glj: "⪤",
			gnE: "≩",
			gnap: "⪊",
			gnapprox: "⪊",
			gne: "⪈",
			gneq: "⪈",
			gneqq: "≩",
			gnsim: "⋧",
			gopf: "𝕘",
			grave: "`",
			gscr: "ℊ",
			gsim: "≳",
			gsime: "⪎",
			gsiml: "⪐",
			gt: ">",
			gtcc: "⪧",
			gtcir: "⩺",
			gtdot: "⋗",
			gtlPar: "⦕",
			gtquest: "⩼",
			gtrapprox: "⪆",
			gtrarr: "⥸",
			gtrdot: "⋗",
			gtreqless: "⋛",
			gtreqqless: "⪌",
			gtrless: "≷",
			gtrsim: "≳",
			gvertneqq: "≩︀",
			gvnE: "≩︀",
			hArr: "⇔",
			hairsp: " ",
			half: "½",
			hamilt: "ℋ",
			hardcy: "ъ",
			harr: "↔",
			harrcir: "⥈",
			harrw: "↭",
			hbar: "ℏ",
			hcirc: "ĥ",
			hearts: "♥",
			heartsuit: "♥",
			hellip: "…",
			hercon: "⊹",
			hfr: "𝔥",
			hksearow: "⤥",
			hkswarow: "⤦",
			hoarr: "⇿",
			homtht: "∻",
			hookleftarrow: "↩",
			hookrightarrow: "↪",
			hopf: "𝕙",
			horbar: "―",
			hscr: "𝒽",
			hslash: "ℏ",
			hstrok: "ħ",
			hybull: "⁃",
			hyphen: "‐",
			iacute: "í",
			ic: "⁣",
			icirc: "î",
			icy: "и",
			iecy: "е",
			iexcl: "¡",
			iff: "⇔",
			ifr: "𝔦",
			igrave: "ì",
			ii: "ⅈ",
			iiiint: "⨌",
			iiint: "∭",
			iinfin: "⧜",
			iiota: "℩",
			ijlig: "ĳ",
			imacr: "ī",
			image: "ℑ",
			imagline: "ℐ",
			imagpart: "ℑ",
			imath: "ı",
			imof: "⊷",
			imped: "Ƶ",
			in: "∈",
			incare: "℅",
			infin: "∞",
			infintie: "⧝",
			inodot: "ı",
			int: "∫",
			intcal: "⊺",
			integers: "ℤ",
			intercal: "⊺",
			intlarhk: "⨗",
			intprod: "⨼",
			iocy: "ё",
			iogon: "į",
			iopf: "𝕚",
			iota: "ι",
			iprod: "⨼",
			iquest: "¿",
			iscr: "𝒾",
			isin: "∈",
			isinE: "⋹",
			isindot: "⋵",
			isins: "⋴",
			isinsv: "⋳",
			isinv: "∈",
			it: "⁢",
			itilde: "ĩ",
			iukcy: "і",
			iuml: "ï",
			jcirc: "ĵ",
			jcy: "й",
			jfr: "𝔧",
			jmath: "ȷ",
			jopf: "𝕛",
			jscr: "𝒿",
			jsercy: "ј",
			jukcy: "є",
			kappa: "κ",
			kappav: "ϰ",
			kcedil: "ķ",
			kcy: "к",
			kfr: "𝔨",
			kgreen: "ĸ",
			khcy: "х",
			kjcy: "ќ",
			kopf: "𝕜",
			kscr: "𝓀",
			lAarr: "⇚",
			lArr: "⇐",
			lAtail: "⤛",
			lBarr: "⤎",
			lE: "≦",
			lEg: "⪋",
			lHar: "⥢",
			lacute: "ĺ",
			laemptyv: "⦴",
			lagran: "ℒ",
			lambda: "λ",
			lang: "⟨",
			langd: "⦑",
			langle: "⟨",
			lap: "⪅",
			laquo: "«",
			larr: "←",
			larrb: "⇤",
			larrbfs: "⤟",
			larrfs: "⤝",
			larrhk: "↩",
			larrlp: "↫",
			larrpl: "⤹",
			larrsim: "⥳",
			larrtl: "↢",
			lat: "⪫",
			latail: "⤙",
			late: "⪭",
			lates: "⪭︀",
			lbarr: "⤌",
			lbbrk: "❲",
			lbrace: "{",
			lbrack: "[",
			lbrke: "⦋",
			lbrksld: "⦏",
			lbrkslu: "⦍",
			lcaron: "ľ",
			lcedil: "ļ",
			lceil: "⌈",
			lcub: "{",
			lcy: "л",
			ldca: "⤶",
			ldquo: "“",
			ldquor: "„",
			ldrdhar: "⥧",
			ldrushar: "⥋",
			ldsh: "↲",
			le: "≤",
			leftarrow: "←",
			leftarrowtail: "↢",
			leftharpoondown: "↽",
			leftharpoonup: "↼",
			leftleftarrows: "⇇",
			leftrightarrow: "↔",
			leftrightarrows: "⇆",
			leftrightharpoons: "⇋",
			leftrightsquigarrow: "↭",
			leftthreetimes: "⋋",
			leg: "⋚",
			leq: "≤",
			leqq: "≦",
			leqslant: "⩽",
			les: "⩽",
			lescc: "⪨",
			lesdot: "⩿",
			lesdoto: "⪁",
			lesdotor: "⪃",
			lesg: "⋚︀",
			lesges: "⪓",
			lessapprox: "⪅",
			lessdot: "⋖",
			lesseqgtr: "⋚",
			lesseqqgtr: "⪋",
			lessgtr: "≶",
			lesssim: "≲",
			lfisht: "⥼",
			lfloor: "⌊",
			lfr: "𝔩",
			lg: "≶",
			lgE: "⪑",
			lhard: "↽",
			lharu: "↼",
			lharul: "⥪",
			lhblk: "▄",
			ljcy: "љ",
			ll: "≪",
			llarr: "⇇",
			llcorner: "⌞",
			llhard: "⥫",
			lltri: "◺",
			lmidot: "ŀ",
			lmoust: "⎰",
			lmoustache: "⎰",
			lnE: "≨",
			lnap: "⪉",
			lnapprox: "⪉",
			lne: "⪇",
			lneq: "⪇",
			lneqq: "≨",
			lnsim: "⋦",
			loang: "⟬",
			loarr: "⇽",
			lobrk: "⟦",
			longleftarrow: "⟵",
			longleftrightarrow: "⟷",
			longmapsto: "⟼",
			longrightarrow: "⟶",
			looparrowleft: "↫",
			looparrowright: "↬",
			lopar: "⦅",
			lopf: "𝕝",
			loplus: "⨭",
			lotimes: "⨴",
			lowast: "∗",
			lowbar: "_",
			loz: "◊",
			lozenge: "◊",
			lozf: "⧫",
			lpar: "(",
			lparlt: "⦓",
			lrarr: "⇆",
			lrcorner: "⌟",
			lrhar: "⇋",
			lrhard: "⥭",
			lrm: "‎",
			lrtri: "⊿",
			lsaquo: "‹",
			lscr: "𝓁",
			lsh: "↰",
			lsim: "≲",
			lsime: "⪍",
			lsimg: "⪏",
			lsqb: "[",
			lsquo: "‘",
			lsquor: "‚",
			lstrok: "ł",
			lt: "<",
			ltcc: "⪦",
			ltcir: "⩹",
			ltdot: "⋖",
			lthree: "⋋",
			ltimes: "⋉",
			ltlarr: "⥶",
			ltquest: "⩻",
			ltrPar: "⦖",
			ltri: "◃",
			ltrie: "⊴",
			ltrif: "◂",
			lurdshar: "⥊",
			luruhar: "⥦",
			lvertneqq: "≨︀",
			lvnE: "≨︀",
			mDDot: "∺",
			macr: "¯",
			male: "♂",
			malt: "✠",
			maltese: "✠",
			map: "↦",
			mapsto: "↦",
			mapstodown: "↧",
			mapstoleft: "↤",
			mapstoup: "↥",
			marker: "▮",
			mcomma: "⨩",
			mcy: "м",
			mdash: "—",
			measuredangle: "∡",
			mfr: "𝔪",
			mho: "℧",
			micro: "µ",
			mid: "∣",
			midast: "*",
			midcir: "⫰",
			middot: "·",
			minus: "−",
			minusb: "⊟",
			minusd: "∸",
			minusdu: "⨪",
			mlcp: "⫛",
			mldr: "…",
			mnplus: "∓",
			models: "⊧",
			mopf: "𝕞",
			mp: "∓",
			mscr: "𝓂",
			mstpos: "∾",
			mu: "μ",
			multimap: "⊸",
			mumap: "⊸",
			nGg: "⋙̸",
			nGt: "≫⃒",
			nGtv: "≫̸",
			nLeftarrow: "⇍",
			nLeftrightarrow: "⇎",
			nLl: "⋘̸",
			nLt: "≪⃒",
			nLtv: "≪̸",
			nRightarrow: "⇏",
			nVDash: "⊯",
			nVdash: "⊮",
			nabla: "∇",
			nacute: "ń",
			nang: "∠⃒",
			nap: "≉",
			napE: "⩰̸",
			napid: "≋̸",
			napos: "ŉ",
			napprox: "≉",
			natur: "♮",
			natural: "♮",
			naturals: "ℕ",
			nbsp: "\xA0",
			nbump: "≎̸",
			nbumpe: "≏̸",
			ncap: "⩃",
			ncaron: "ň",
			ncedil: "ņ",
			ncong: "≇",
			ncongdot: "⩭̸",
			ncup: "⩂",
			ncy: "н",
			ndash: "–",
			ne: "≠",
			neArr: "⇗",
			nearhk: "⤤",
			nearr: "↗",
			nearrow: "↗",
			nedot: "≐̸",
			nequiv: "≢",
			nesear: "⤨",
			nesim: "≂̸",
			nexist: "∄",
			nexists: "∄",
			nfr: "𝔫",
			ngE: "≧̸",
			nge: "≱",
			ngeq: "≱",
			ngeqq: "≧̸",
			ngeqslant: "⩾̸",
			nges: "⩾̸",
			ngsim: "≵",
			ngt: "≯",
			ngtr: "≯",
			nhArr: "⇎",
			nharr: "↮",
			nhpar: "⫲",
			ni: "∋",
			nis: "⋼",
			nisd: "⋺",
			niv: "∋",
			njcy: "њ",
			nlArr: "⇍",
			nlE: "≦̸",
			nlarr: "↚",
			nldr: "‥",
			nle: "≰",
			nleftarrow: "↚",
			nleftrightarrow: "↮",
			nleq: "≰",
			nleqq: "≦̸",
			nleqslant: "⩽̸",
			nles: "⩽̸",
			nless: "≮",
			nlsim: "≴",
			nlt: "≮",
			nltri: "⋪",
			nltrie: "⋬",
			nmid: "∤",
			nopf: "𝕟",
			not: "¬",
			notin: "∉",
			notinE: "⋹̸",
			notindot: "⋵̸",
			notinva: "∉",
			notinvb: "⋷",
			notinvc: "⋶",
			notni: "∌",
			notniva: "∌",
			notnivb: "⋾",
			notnivc: "⋽",
			npar: "∦",
			nparallel: "∦",
			nparsl: "⫽⃥",
			npart: "∂̸",
			npolint: "⨔",
			npr: "⊀",
			nprcue: "⋠",
			npre: "⪯̸",
			nprec: "⊀",
			npreceq: "⪯̸",
			nrArr: "⇏",
			nrarr: "↛",
			nrarrc: "⤳̸",
			nrarrw: "↝̸",
			nrightarrow: "↛",
			nrtri: "⋫",
			nrtrie: "⋭",
			nsc: "⊁",
			nsccue: "⋡",
			nsce: "⪰̸",
			nscr: "𝓃",
			nshortmid: "∤",
			nshortparallel: "∦",
			nsim: "≁",
			nsime: "≄",
			nsimeq: "≄",
			nsmid: "∤",
			nspar: "∦",
			nsqsube: "⋢",
			nsqsupe: "⋣",
			nsub: "⊄",
			nsubE: "⫅̸",
			nsube: "⊈",
			nsubset: "⊂⃒",
			nsubseteq: "⊈",
			nsubseteqq: "⫅̸",
			nsucc: "⊁",
			nsucceq: "⪰̸",
			nsup: "⊅",
			nsupE: "⫆̸",
			nsupe: "⊉",
			nsupset: "⊃⃒",
			nsupseteq: "⊉",
			nsupseteqq: "⫆̸",
			ntgl: "≹",
			ntilde: "ñ",
			ntlg: "≸",
			ntriangleleft: "⋪",
			ntrianglelefteq: "⋬",
			ntriangleright: "⋫",
			ntrianglerighteq: "⋭",
			nu: "ν",
			num: "#",
			numero: "№",
			numsp: " ",
			nvDash: "⊭",
			nvHarr: "⤄",
			nvap: "≍⃒",
			nvdash: "⊬",
			nvge: "≥⃒",
			nvgt: ">⃒",
			nvinfin: "⧞",
			nvlArr: "⤂",
			nvle: "≤⃒",
			nvlt: "<⃒",
			nvltrie: "⊴⃒",
			nvrArr: "⤃",
			nvrtrie: "⊵⃒",
			nvsim: "∼⃒",
			nwArr: "⇖",
			nwarhk: "⤣",
			nwarr: "↖",
			nwarrow: "↖",
			nwnear: "⤧",
			oS: "Ⓢ",
			oacute: "ó",
			oast: "⊛",
			ocir: "⊚",
			ocirc: "ô",
			ocy: "о",
			odash: "⊝",
			odblac: "ő",
			odiv: "⨸",
			odot: "⊙",
			odsold: "⦼",
			oelig: "œ",
			ofcir: "⦿",
			ofr: "𝔬",
			ogon: "˛",
			ograve: "ò",
			ogt: "⧁",
			ohbar: "⦵",
			ohm: "Ω",
			oint: "∮",
			olarr: "↺",
			olcir: "⦾",
			olcross: "⦻",
			oline: "‾",
			olt: "⧀",
			omacr: "ō",
			omega: "ω",
			omicron: "ο",
			omid: "⦶",
			ominus: "⊖",
			oopf: "𝕠",
			opar: "⦷",
			operp: "⦹",
			oplus: "⊕",
			or: "∨",
			orarr: "↻",
			ord: "⩝",
			order: "ℴ",
			orderof: "ℴ",
			ordf: "ª",
			ordm: "º",
			origof: "⊶",
			oror: "⩖",
			orslope: "⩗",
			orv: "⩛",
			oscr: "ℴ",
			oslash: "ø",
			osol: "⊘",
			otilde: "õ",
			otimes: "⊗",
			otimesas: "⨶",
			ouml: "ö",
			ovbar: "⌽",
			par: "∥",
			para: "¶",
			parallel: "∥",
			parsim: "⫳",
			parsl: "⫽",
			part: "∂",
			pcy: "п",
			percnt: "%",
			period: ".",
			permil: "‰",
			perp: "⊥",
			pertenk: "‱",
			pfr: "𝔭",
			phi: "φ",
			phiv: "ϕ",
			phmmat: "ℳ",
			phone: "☎",
			pi: "π",
			pitchfork: "⋔",
			piv: "ϖ",
			planck: "ℏ",
			planckh: "ℎ",
			plankv: "ℏ",
			plus: "+",
			plusacir: "⨣",
			plusb: "⊞",
			pluscir: "⨢",
			plusdo: "∔",
			plusdu: "⨥",
			pluse: "⩲",
			plusmn: "±",
			plussim: "⨦",
			plustwo: "⨧",
			pm: "±",
			pointint: "⨕",
			popf: "𝕡",
			pound: "£",
			pr: "≺",
			prE: "⪳",
			prap: "⪷",
			prcue: "≼",
			pre: "⪯",
			prec: "≺",
			precapprox: "⪷",
			preccurlyeq: "≼",
			preceq: "⪯",
			precnapprox: "⪹",
			precneqq: "⪵",
			precnsim: "⋨",
			precsim: "≾",
			prime: "′",
			primes: "ℙ",
			prnE: "⪵",
			prnap: "⪹",
			prnsim: "⋨",
			prod: "∏",
			profalar: "⌮",
			profline: "⌒",
			profsurf: "⌓",
			prop: "∝",
			propto: "∝",
			prsim: "≾",
			prurel: "⊰",
			pscr: "𝓅",
			psi: "ψ",
			puncsp: " ",
			qfr: "𝔮",
			qint: "⨌",
			qopf: "𝕢",
			qprime: "⁗",
			qscr: "𝓆",
			quaternions: "ℍ",
			quatint: "⨖",
			quest: "?",
			questeq: "≟",
			quot: "\"",
			rAarr: "⇛",
			rArr: "⇒",
			rAtail: "⤜",
			rBarr: "⤏",
			rHar: "⥤",
			race: "∽̱",
			racute: "ŕ",
			radic: "√",
			raemptyv: "⦳",
			rang: "⟩",
			rangd: "⦒",
			range: "⦥",
			rangle: "⟩",
			raquo: "»",
			rarr: "→",
			rarrap: "⥵",
			rarrb: "⇥",
			rarrbfs: "⤠",
			rarrc: "⤳",
			rarrfs: "⤞",
			rarrhk: "↪",
			rarrlp: "↬",
			rarrpl: "⥅",
			rarrsim: "⥴",
			rarrtl: "↣",
			rarrw: "↝",
			ratail: "⤚",
			ratio: "∶",
			rationals: "ℚ",
			rbarr: "⤍",
			rbbrk: "❳",
			rbrace: "}",
			rbrack: "]",
			rbrke: "⦌",
			rbrksld: "⦎",
			rbrkslu: "⦐",
			rcaron: "ř",
			rcedil: "ŗ",
			rceil: "⌉",
			rcub: "}",
			rcy: "р",
			rdca: "⤷",
			rdldhar: "⥩",
			rdquo: "”",
			rdquor: "”",
			rdsh: "↳",
			real: "ℜ",
			realine: "ℛ",
			realpart: "ℜ",
			reals: "ℝ",
			rect: "▭",
			reg: "®",
			rfisht: "⥽",
			rfloor: "⌋",
			rfr: "𝔯",
			rhard: "⇁",
			rharu: "⇀",
			rharul: "⥬",
			rho: "ρ",
			rhov: "ϱ",
			rightarrow: "→",
			rightarrowtail: "↣",
			rightharpoondown: "⇁",
			rightharpoonup: "⇀",
			rightleftarrows: "⇄",
			rightleftharpoons: "⇌",
			rightrightarrows: "⇉",
			rightsquigarrow: "↝",
			rightthreetimes: "⋌",
			ring: "˚",
			risingdotseq: "≓",
			rlarr: "⇄",
			rlhar: "⇌",
			rlm: "‏",
			rmoust: "⎱",
			rmoustache: "⎱",
			rnmid: "⫮",
			roang: "⟭",
			roarr: "⇾",
			robrk: "⟧",
			ropar: "⦆",
			ropf: "𝕣",
			roplus: "⨮",
			rotimes: "⨵",
			rpar: ")",
			rpargt: "⦔",
			rppolint: "⨒",
			rrarr: "⇉",
			rsaquo: "›",
			rscr: "𝓇",
			rsh: "↱",
			rsqb: "]",
			rsquo: "’",
			rsquor: "’",
			rthree: "⋌",
			rtimes: "⋊",
			rtri: "▹",
			rtrie: "⊵",
			rtrif: "▸",
			rtriltri: "⧎",
			ruluhar: "⥨",
			rx: "℞",
			sacute: "ś",
			sbquo: "‚",
			sc: "≻",
			scE: "⪴",
			scap: "⪸",
			scaron: "š",
			sccue: "≽",
			sce: "⪰",
			scedil: "ş",
			scirc: "ŝ",
			scnE: "⪶",
			scnap: "⪺",
			scnsim: "⋩",
			scpolint: "⨓",
			scsim: "≿",
			scy: "с",
			sdot: "⋅",
			sdotb: "⊡",
			sdote: "⩦",
			seArr: "⇘",
			searhk: "⤥",
			searr: "↘",
			searrow: "↘",
			sect: "§",
			semi: ";",
			seswar: "⤩",
			setminus: "∖",
			setmn: "∖",
			sext: "✶",
			sfr: "𝔰",
			sfrown: "⌢",
			sharp: "♯",
			shchcy: "щ",
			shcy: "ш",
			shortmid: "∣",
			shortparallel: "∥",
			shy: "­",
			sigma: "σ",
			sigmaf: "ς",
			sigmav: "ς",
			sim: "∼",
			simdot: "⩪",
			sime: "≃",
			simeq: "≃",
			simg: "⪞",
			simgE: "⪠",
			siml: "⪝",
			simlE: "⪟",
			simne: "≆",
			simplus: "⨤",
			simrarr: "⥲",
			slarr: "←",
			smallsetminus: "∖",
			smashp: "⨳",
			smeparsl: "⧤",
			smid: "∣",
			smile: "⌣",
			smt: "⪪",
			smte: "⪬",
			smtes: "⪬︀",
			softcy: "ь",
			sol: "/",
			solb: "⧄",
			solbar: "⌿",
			sopf: "𝕤",
			spades: "♠",
			spadesuit: "♠",
			spar: "∥",
			sqcap: "⊓",
			sqcaps: "⊓︀",
			sqcup: "⊔",
			sqcups: "⊔︀",
			sqsub: "⊏",
			sqsube: "⊑",
			sqsubset: "⊏",
			sqsubseteq: "⊑",
			sqsup: "⊐",
			sqsupe: "⊒",
			sqsupset: "⊐",
			sqsupseteq: "⊒",
			squ: "□",
			square: "□",
			squarf: "▪",
			squf: "▪",
			srarr: "→",
			sscr: "𝓈",
			ssetmn: "∖",
			ssmile: "⌣",
			sstarf: "⋆",
			star: "☆",
			starf: "★",
			straightepsilon: "ϵ",
			straightphi: "ϕ",
			strns: "¯",
			sub: "⊂",
			subE: "⫅",
			subdot: "⪽",
			sube: "⊆",
			subedot: "⫃",
			submult: "⫁",
			subnE: "⫋",
			subne: "⊊",
			subplus: "⪿",
			subrarr: "⥹",
			subset: "⊂",
			subseteq: "⊆",
			subseteqq: "⫅",
			subsetneq: "⊊",
			subsetneqq: "⫋",
			subsim: "⫇",
			subsub: "⫕",
			subsup: "⫓",
			succ: "≻",
			succapprox: "⪸",
			succcurlyeq: "≽",
			succeq: "⪰",
			succnapprox: "⪺",
			succneqq: "⪶",
			succnsim: "⋩",
			succsim: "≿",
			sum: "∑",
			sung: "♪",
			sup1: "¹",
			sup2: "²",
			sup3: "³",
			sup: "⊃",
			supE: "⫆",
			supdot: "⪾",
			supdsub: "⫘",
			supe: "⊇",
			supedot: "⫄",
			suphsol: "⟉",
			suphsub: "⫗",
			suplarr: "⥻",
			supmult: "⫂",
			supnE: "⫌",
			supne: "⊋",
			supplus: "⫀",
			supset: "⊃",
			supseteq: "⊇",
			supseteqq: "⫆",
			supsetneq: "⊋",
			supsetneqq: "⫌",
			supsim: "⫈",
			supsub: "⫔",
			supsup: "⫖",
			swArr: "⇙",
			swarhk: "⤦",
			swarr: "↙",
			swarrow: "↙",
			swnwar: "⤪",
			szlig: "ß",
			target: "⌖",
			tau: "τ",
			tbrk: "⎴",
			tcaron: "ť",
			tcedil: "ţ",
			tcy: "т",
			tdot: "⃛",
			telrec: "⌕",
			tfr: "𝔱",
			there4: "∴",
			therefore: "∴",
			theta: "θ",
			thetasym: "ϑ",
			thetav: "ϑ",
			thickapprox: "≈",
			thicksim: "∼",
			thinsp: " ",
			thkap: "≈",
			thksim: "∼",
			thorn: "þ",
			tilde: "˜",
			times: "×",
			timesb: "⊠",
			timesbar: "⨱",
			timesd: "⨰",
			tint: "∭",
			toea: "⤨",
			top: "⊤",
			topbot: "⌶",
			topcir: "⫱",
			topf: "𝕥",
			topfork: "⫚",
			tosa: "⤩",
			tprime: "‴",
			trade: "™",
			triangle: "▵",
			triangledown: "▿",
			triangleleft: "◃",
			trianglelefteq: "⊴",
			triangleq: "≜",
			triangleright: "▹",
			trianglerighteq: "⊵",
			tridot: "◬",
			trie: "≜",
			triminus: "⨺",
			triplus: "⨹",
			trisb: "⧍",
			tritime: "⨻",
			trpezium: "⏢",
			tscr: "𝓉",
			tscy: "ц",
			tshcy: "ћ",
			tstrok: "ŧ",
			twixt: "≬",
			twoheadleftarrow: "↞",
			twoheadrightarrow: "↠",
			uArr: "⇑",
			uHar: "⥣",
			uacute: "ú",
			uarr: "↑",
			ubrcy: "ў",
			ubreve: "ŭ",
			ucirc: "û",
			ucy: "у",
			udarr: "⇅",
			udblac: "ű",
			udhar: "⥮",
			ufisht: "⥾",
			ufr: "𝔲",
			ugrave: "ù",
			uharl: "↿",
			uharr: "↾",
			uhblk: "▀",
			ulcorn: "⌜",
			ulcorner: "⌜",
			ulcrop: "⌏",
			ultri: "◸",
			umacr: "ū",
			uml: "¨",
			uogon: "ų",
			uopf: "𝕦",
			uparrow: "↑",
			updownarrow: "↕",
			upharpoonleft: "↿",
			upharpoonright: "↾",
			uplus: "⊎",
			upsi: "υ",
			upsih: "ϒ",
			upsilon: "υ",
			upuparrows: "⇈",
			urcorn: "⌝",
			urcorner: "⌝",
			urcrop: "⌎",
			uring: "ů",
			urtri: "◹",
			uscr: "𝓊",
			utdot: "⋰",
			utilde: "ũ",
			utri: "▵",
			utrif: "▴",
			uuarr: "⇈",
			uuml: "ü",
			uwangle: "⦧",
			vArr: "⇕",
			vBar: "⫨",
			vBarv: "⫩",
			vDash: "⊨",
			vangrt: "⦜",
			varepsilon: "ϵ",
			varkappa: "ϰ",
			varnothing: "∅",
			varphi: "ϕ",
			varpi: "ϖ",
			varpropto: "∝",
			varr: "↕",
			varrho: "ϱ",
			varsigma: "ς",
			varsubsetneq: "⊊︀",
			varsubsetneqq: "⫋︀",
			varsupsetneq: "⊋︀",
			varsupsetneqq: "⫌︀",
			vartheta: "ϑ",
			vartriangleleft: "⊲",
			vartriangleright: "⊳",
			vcy: "в",
			vdash: "⊢",
			vee: "∨",
			veebar: "⊻",
			veeeq: "≚",
			vellip: "⋮",
			verbar: "|",
			vert: "|",
			vfr: "𝔳",
			vltri: "⊲",
			vnsub: "⊂⃒",
			vnsup: "⊃⃒",
			vopf: "𝕧",
			vprop: "∝",
			vrtri: "⊳",
			vscr: "𝓋",
			vsubnE: "⫋︀",
			vsubne: "⊊︀",
			vsupnE: "⫌︀",
			vsupne: "⊋︀",
			vzigzag: "⦚",
			wcirc: "ŵ",
			wedbar: "⩟",
			wedge: "∧",
			wedgeq: "≙",
			weierp: "℘",
			wfr: "𝔴",
			wopf: "𝕨",
			wp: "℘",
			wr: "≀",
			wreath: "≀",
			wscr: "𝓌",
			xcap: "⋂",
			xcirc: "◯",
			xcup: "⋃",
			xdtri: "▽",
			xfr: "𝔵",
			xhArr: "⟺",
			xharr: "⟷",
			xi: "ξ",
			xlArr: "⟸",
			xlarr: "⟵",
			xmap: "⟼",
			xnis: "⋻",
			xodot: "⨀",
			xopf: "𝕩",
			xoplus: "⨁",
			xotime: "⨂",
			xrArr: "⟹",
			xrarr: "⟶",
			xscr: "𝓍",
			xsqcup: "⨆",
			xuplus: "⨄",
			xutri: "△",
			xvee: "⋁",
			xwedge: "⋀",
			yacute: "ý",
			yacy: "я",
			ycirc: "ŷ",
			ycy: "ы",
			yen: "¥",
			yfr: "𝔶",
			yicy: "ї",
			yopf: "𝕪",
			yscr: "𝓎",
			yucy: "ю",
			yuml: "ÿ",
			zacute: "ź",
			zcaron: "ž",
			zcy: "з",
			zdot: "ż",
			zeetrf: "ℨ",
			zeta: "ζ",
			zfr: "𝔷",
			zhcy: "ж",
			zigrarr: "⇝",
			zopf: "𝕫",
			zscr: "𝓏",
			zwj: "‍",
			zwnj: "‌"
		};
		//#endregion
		//#region node_modules/.pnpm/decode-named-character-reference@1.3.0/node_modules/decode-named-character-reference/index.js
		const own$1 = {}.hasOwnProperty;
		/**
		* Decode a single character reference (without the `&` or `;`).
		* You probably only need this when you’re building parsers yourself that follow
		* different rules compared to HTML.
		* This is optimized to be tiny in browsers.
		*
		* @param {string} value
		*   `notin` (named), `#123` (deci), `#x123` (hexa).
		* @returns {string|false}
		*   Decoded reference.
		*/
		function decodeNamedCharacterReference(value) {
			return own$1.call(characterEntities, value) ? characterEntities[value] : false;
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-util-chunked@2.0.1/node_modules/micromark-util-chunked/index.js
		/**
		* Like `Array#splice`, but smarter for giant arrays.
		*
		* `Array#splice` takes all items to be inserted as individual argument which
		* causes a stack overflow in V8 when trying to insert 100k items for instance.
		*
		* Otherwise, this does not return the removed items, and takes `items` as an
		* array instead of rest parameters.
		*
		* @template {unknown} T
		*   Item type.
		* @param {Array<T>} list
		*   List to operate on.
		* @param {number} start
		*   Index to remove/insert at (can be negative).
		* @param {number} remove
		*   Number of items to remove.
		* @param {Array<T>} items
		*   Items to inject into `list`.
		* @returns {undefined}
		*   Nothing.
		*/
		function splice(list, start, remove, items) {
			const end = list.length;
			let chunkStart = 0;
			/** @type {Array<unknown>} */
			let parameters;
			if (start < 0) start = -start > end ? 0 : end + start;
			else start = start > end ? end : start;
			remove = remove > 0 ? remove : 0;
			if (items.length < 1e4) {
				parameters = Array.from(items);
				parameters.unshift(start, remove);
				list.splice(...parameters);
			} else {
				if (remove) list.splice(start, remove);
				while (chunkStart < items.length) {
					parameters = items.slice(chunkStart, chunkStart + 1e4);
					parameters.unshift(start, 0);
					list.splice(...parameters);
					chunkStart += 1e4;
					start += 1e4;
				}
			}
		}
		/**
		* Append `items` (an array) at the end of `list` (another array).
		* When `list` was empty, returns `items` instead.
		*
		* This prevents a potentially expensive operation when `list` is empty,
		* and adds items in batches to prevent V8 from hanging.
		*
		* @template {unknown} T
		*   Item type.
		* @param {Array<T>} list
		*   List to operate on.
		* @param {Array<T>} items
		*   Items to add to `list`.
		* @returns {Array<T>}
		*   Either `list` or `items`.
		*/
		function push(list, items) {
			if (list.length > 0) {
				splice(list, list.length, 0, items);
				return list;
			}
			return items;
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-util-combine-extensions@2.0.1/node_modules/micromark-util-combine-extensions/index.js
		/**
		* @import {
		*   Extension,
		*   Handles,
		*   HtmlExtension,
		*   NormalizedExtension
		* } from 'micromark-util-types'
		*/
		const hasOwnProperty = {}.hasOwnProperty;
		/**
		* Combine multiple syntax extensions into one.
		*
		* @param {ReadonlyArray<Extension>} extensions
		*   List of syntax extensions.
		* @returns {NormalizedExtension}
		*   A single combined extension.
		*/
		function combineExtensions(extensions) {
			/** @type {NormalizedExtension} */
			const all = {};
			let index = -1;
			while (++index < extensions.length) syntaxExtension(all, extensions[index]);
			return all;
		}
		/**
		* Merge `extension` into `all`.
		*
		* @param {NormalizedExtension} all
		*   Extension to merge into.
		* @param {Extension} extension
		*   Extension to merge.
		* @returns {undefined}
		*   Nothing.
		*/
		function syntaxExtension(all, extension) {
			/** @type {keyof Extension} */
			let hook;
			for (hook in extension) {
				/** @type {Record<string, unknown>} */
				const left = (hasOwnProperty.call(all, hook) ? all[hook] : void 0) || (all[hook] = {});
				/** @type {Record<string, unknown> | undefined} */
				const right = extension[hook];
				/** @type {string} */
				let code;
				if (right) for (code in right) {
					if (!hasOwnProperty.call(left, code)) left[code] = [];
					const value = right[code];
					constructs(left[code], Array.isArray(value) ? value : value ? [value] : []);
				}
			}
		}
		/**
		* Merge `list` into `existing` (both lists of constructs).
		* Mutates `existing`.
		*
		* @param {Array<unknown>} existing
		*   List of constructs to merge into.
		* @param {Array<unknown>} list
		*   List of constructs to merge.
		* @returns {undefined}
		*   Nothing.
		*/
		function constructs(existing, list) {
			let index = -1;
			/** @type {Array<unknown>} */
			const before = [];
			while (++index < list.length) (list[index].add === "after" ? existing : before).push(list[index]);
			splice(existing, 0, 0, before);
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-util-decode-numeric-character-reference@2.0.2/node_modules/micromark-util-decode-numeric-character-reference/index.js
		/**
		* Turn the number (in string form as either hexa- or plain decimal) coming from
		* a numeric character reference into a character.
		*
		* Sort of like `String.fromCodePoint(Number.parseInt(value, base))`, but makes
		* non-characters and control characters safe.
		*
		* @param {string} value
		*   Value to decode.
		* @param {number} base
		*   Numeric base.
		* @returns {string}
		*   Character.
		*/
		function decodeNumericCharacterReference(value, base) {
			const code = Number.parseInt(value, base);
			if (code < 9 || code === 11 || code > 13 && code < 32 || code > 126 && code < 160 || code > 55295 && code < 57344 || code > 64975 && code < 65008 || (code & 65535) === 65535 || (code & 65535) === 65534 || code > 1114111) return "�";
			return String.fromCodePoint(code);
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-util-normalize-identifier@2.0.1/node_modules/micromark-util-normalize-identifier/index.js
		/**
		* Normalize an identifier (as found in references, definitions).
		*
		* Collapses markdown whitespace, trim, and then lower- and uppercase.
		*
		* Some characters are considered “uppercase”, such as U+03F4 (`ϴ`), but if their
		* lowercase counterpart (U+03B8 (`θ`)) is uppercased will result in a different
		* uppercase character (U+0398 (`Θ`)).
		* So, to get a canonical form, we perform both lower- and uppercase.
		*
		* Using uppercase last makes sure keys will never interact with default
		* prototypal values (such as `constructor`): nothing in the prototype of
		* `Object` is uppercase.
		*
		* @param {string} value
		*   Identifier to normalize.
		* @returns {string}
		*   Normalized identifier.
		*/
		function normalizeIdentifier(value) {
			return value.replace(/[\t\n\r ]+/g, " ").replace(/^ | $/g, "").toLowerCase().toUpperCase();
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-util-character@2.1.1/node_modules/micromark-util-character/index.js
		/**
		* @import {Code} from 'micromark-util-types'
		*/
		/**
		* Check whether the character code represents an ASCII alpha (`a` through `z`,
		* case insensitive).
		*
		* An **ASCII alpha** is an ASCII upper alpha or ASCII lower alpha.
		*
		* An **ASCII upper alpha** is a character in the inclusive range U+0041 (`A`)
		* to U+005A (`Z`).
		*
		* An **ASCII lower alpha** is a character in the inclusive range U+0061 (`a`)
		* to U+007A (`z`).
		*
		* @param code
		*   Code.
		* @returns {boolean}
		*   Whether it matches.
		*/
		const asciiAlpha = regexCheck(/[A-Za-z]/);
		/**
		* Check whether the character code represents an ASCII alphanumeric (`a`
		* through `z`, case insensitive, or `0` through `9`).
		*
		* An **ASCII alphanumeric** is an ASCII digit (see `asciiDigit`) or ASCII alpha
		* (see `asciiAlpha`).
		*
		* @param code
		*   Code.
		* @returns {boolean}
		*   Whether it matches.
		*/
		const asciiAlphanumeric = regexCheck(/[\dA-Za-z]/);
		/**
		* Check whether the character code represents an ASCII atext.
		*
		* atext is an ASCII alphanumeric (see `asciiAlphanumeric`), or a character in
		* the inclusive ranges U+0023 NUMBER SIGN (`#`) to U+0027 APOSTROPHE (`'`),
		* U+002A ASTERISK (`*`), U+002B PLUS SIGN (`+`), U+002D DASH (`-`), U+002F
		* SLASH (`/`), U+003D EQUALS TO (`=`), U+003F QUESTION MARK (`?`), U+005E
		* CARET (`^`) to U+0060 GRAVE ACCENT (`` ` ``), or U+007B LEFT CURLY BRACE
		* (`{`) to U+007E TILDE (`~`).
		*
		* See:
		* **\[RFC5322]**:
		* [Internet Message Format](https://tools.ietf.org/html/rfc5322).
		* P. Resnick.
		* IETF.
		*
		* @param code
		*   Code.
		* @returns {boolean}
		*   Whether it matches.
		*/
		const asciiAtext = regexCheck(/[#-'*+\--9=?A-Z^-~]/);
		/**
		* Check whether a character code is an ASCII control character.
		*
		* An **ASCII control** is a character in the inclusive range U+0000 NULL (NUL)
		* to U+001F (US), or U+007F (DEL).
		*
		* @param {Code} code
		*   Code.
		* @returns {boolean}
		*   Whether it matches.
		*/
		function asciiControl(code) {
			return code !== null && (code < 32 || code === 127);
		}
		/**
		* Check whether the character code represents an ASCII digit (`0` through `9`).
		*
		* An **ASCII digit** is a character in the inclusive range U+0030 (`0`) to
		* U+0039 (`9`).
		*
		* @param code
		*   Code.
		* @returns {boolean}
		*   Whether it matches.
		*/
		const asciiDigit = regexCheck(/\d/);
		/**
		* Check whether the character code represents an ASCII hex digit (`a` through
		* `f`, case insensitive, or `0` through `9`).
		*
		* An **ASCII hex digit** is an ASCII digit (see `asciiDigit`), ASCII upper hex
		* digit, or an ASCII lower hex digit.
		*
		* An **ASCII upper hex digit** is a character in the inclusive range U+0041
		* (`A`) to U+0046 (`F`).
		*
		* An **ASCII lower hex digit** is a character in the inclusive range U+0061
		* (`a`) to U+0066 (`f`).
		*
		* @param code
		*   Code.
		* @returns {boolean}
		*   Whether it matches.
		*/
		const asciiHexDigit = regexCheck(/[\dA-Fa-f]/);
		/**
		* Check whether the character code represents ASCII punctuation.
		*
		* An **ASCII punctuation** is a character in the inclusive ranges U+0021
		* EXCLAMATION MARK (`!`) to U+002F SLASH (`/`), U+003A COLON (`:`) to U+0040 AT
		* SIGN (`@`), U+005B LEFT SQUARE BRACKET (`[`) to U+0060 GRAVE ACCENT
		* (`` ` ``), or U+007B LEFT CURLY BRACE (`{`) to U+007E TILDE (`~`).
		*
		* @param code
		*   Code.
		* @returns {boolean}
		*   Whether it matches.
		*/
		const asciiPunctuation = regexCheck(/[!-/:-@[-`{-~]/);
		/**
		* Check whether a character code is a markdown line ending.
		*
		* A **markdown line ending** is the virtual characters M-0003 CARRIAGE RETURN
		* LINE FEED (CRLF), M-0004 LINE FEED (LF) and M-0005 CARRIAGE RETURN (CR).
		*
		* In micromark, the actual character U+000A LINE FEED (LF) and U+000D CARRIAGE
		* RETURN (CR) are replaced by these virtual characters depending on whether
		* they occurred together.
		*
		* @param {Code} code
		*   Code.
		* @returns {boolean}
		*   Whether it matches.
		*/
		function markdownLineEnding(code) {
			return code !== null && code < -2;
		}
		/**
		* Check whether a character code is a markdown line ending (see
		* `markdownLineEnding`) or markdown space (see `markdownSpace`).
		*
		* @param {Code} code
		*   Code.
		* @returns {boolean}
		*   Whether it matches.
		*/
		function markdownLineEndingOrSpace(code) {
			return code !== null && (code < 0 || code === 32);
		}
		/**
		* Check whether a character code is a markdown space.
		*
		* A **markdown space** is the concrete character U+0020 SPACE (SP) and the
		* virtual characters M-0001 VIRTUAL SPACE (VS) and M-0002 HORIZONTAL TAB (HT).
		*
		* In micromark, the actual character U+0009 CHARACTER TABULATION (HT) is
		* replaced by one M-0002 HORIZONTAL TAB (HT) and between 0 and 3 M-0001 VIRTUAL
		* SPACE (VS) characters, depending on the column at which the tab occurred.
		*
		* @param {Code} code
		*   Code.
		* @returns {boolean}
		*   Whether it matches.
		*/
		function markdownSpace(code) {
			return code === -2 || code === -1 || code === 32;
		}
		/**
		* Check whether the character code represents Unicode punctuation.
		*
		* A **Unicode punctuation** is a character in the Unicode `Pc` (Punctuation,
		* Connector), `Pd` (Punctuation, Dash), `Pe` (Punctuation, Close), `Pf`
		* (Punctuation, Final quote), `Pi` (Punctuation, Initial quote), `Po`
		* (Punctuation, Other), or `Ps` (Punctuation, Open) categories, or an ASCII
		* punctuation (see `asciiPunctuation`).
		*
		* See:
		* **\[UNICODE]**:
		* [The Unicode Standard](https://www.unicode.org/versions/).
		* Unicode Consortium.
		*
		* @param code
		*   Code.
		* @returns
		*   Whether it matches.
		*/
		const unicodePunctuation = regexCheck(/\p{P}|\p{S}/u);
		/**
		* Check whether the character code represents Unicode whitespace.
		*
		* Note that this does handle micromark specific markdown whitespace characters.
		* See `markdownLineEndingOrSpace` to check that.
		*
		* A **Unicode whitespace** is a character in the Unicode `Zs` (Separator,
		* Space) category, or U+0009 CHARACTER TABULATION (HT), U+000A LINE FEED (LF),
		* U+000C (FF), or U+000D CARRIAGE RETURN (CR) (**\[UNICODE]**).
		*
		* See:
		* **\[UNICODE]**:
		* [The Unicode Standard](https://www.unicode.org/versions/).
		* Unicode Consortium.
		*
		* @param code
		*   Code.
		* @returns
		*   Whether it matches.
		*/
		const unicodeWhitespace = regexCheck(/\s/);
		/**
		* Create a code check from a regex.
		*
		* @param {RegExp} regex
		*   Expression.
		* @returns {(code: Code) => boolean}
		*   Check.
		*/
		function regexCheck(regex) {
			return check;
			/**
			* Check whether a code matches the bound regex.
			*
			* @param {Code} code
			*   Character code.
			* @returns {boolean}
			*   Whether the character code matches the bound regex.
			*/
			function check(code) {
				return code !== null && code > -1 && regex.test(String.fromCharCode(code));
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-factory-space@2.1.0/node_modules/micromark-factory-space/index.js
		/**
		* @import {Effects, State, TokenType} from 'micromark-util-types'
		*/
		/**
		* Parse spaces and tabs.
		*
		* There is no `nok` parameter:
		*
		* *   spaces in markdown are often optional, in which case this factory can be
		*     used and `ok` will be switched to whether spaces were found or not
		* *   one line ending or space can be detected with `markdownSpace(code)` right
		*     before using `factorySpace`
		*
		* ###### Examples
		*
		* Where `␉` represents a tab (plus how much it expands) and `␠` represents a
		* single space.
		*
		* ```markdown
		* ␉
		* ␠␠␠␠
		* ␉␠
		* ```
		*
		* @param {Effects} effects
		*   Context.
		* @param {State} ok
		*   State switched to when successful.
		* @param {TokenType} type
		*   Type of the whole whitespace.
		* @param {number | undefined} [max=Infinity]
		*   Max (exclusive).
		* @returns {State}
		*   Start state.
		*/
		function factorySpace(effects, ok, type, max) {
			const limit = max ? max - 1 : Infinity;
			let size = 0;
			return start;
			/** @type {State} */
			function start(code) {
				if (markdownSpace(code)) {
					effects.enter(type);
					return prefix(code);
				}
				return ok(code);
			}
			/** @type {State} */
			function prefix(code) {
				if (markdownSpace(code) && size++ < limit) {
					effects.consume(code);
					return prefix;
				}
				effects.exit(type);
				return ok(code);
			}
		}
		/**
		* Parse spaces and tabs, with a required minimum and maximum, matching
		* `markdown-rs`’s `space_or_tab_min_max`.
		*
		* Unlike `factorySpace`, this can fail: `nok` is used when fewer than
		* `min` spaces or tabs are found.
		*
		* @param {Effects} effects
		*   Context.
		* @param {State} ok
		*   State switched to when successful.
		* @param {State} nok
		*   State switched to when unsuccessful.
		* @param {TokenType} type
		*   Type of the whole whitespace.
		* @param {number} min
		*   Minimum allowed characters (inclusive).
		* @param {number} max
		*   Maximum allowed characters (inclusive).
		* @returns {State}
		*   Start state.
		*/
		function factorySpaceMinMax(effects, ok, nok, type, min, max) {
			let size = 0;
			return start;
			/** @type {State} */
			function start(code) {
				if (max > 0 && markdownSpace(code)) {
					effects.enter(type);
					return prefix(code);
				}
				return after(code);
			}
			/** @type {State} */
			function prefix(code) {
				if (markdownSpace(code) && size < max) {
					effects.consume(code);
					size++;
					return prefix;
				}
				effects.exit(type);
				return after(code);
			}
			/** @type {State} */
			function after(code) {
				return size >= min ? ok(code) : nok(code);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark@4.0.3/node_modules/micromark/lib/initialize/content.js
		/**
		* @import {
		*   InitialConstruct,
		*   Initializer,
		*   State,
		*   TokenizeContext,
		*   Token
		* } from 'micromark-util-types'
		*/
		/** @type {InitialConstruct} */
		const content$1 = { tokenize: initializeContent };
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Initializer}
		*   Content.
		*/
		function initializeContent(effects) {
			const contentStart = effects.attempt(this.parser.constructs.contentInitial, afterContentStartConstruct, paragraphInitial);
			/** @type {Token} */
			let previous;
			return contentStart;
			/** @type {State} */
			function afterContentStartConstruct(code) {
				if (code === null) {
					effects.consume(code);
					return;
				}
				effects.enter("lineEnding");
				effects.consume(code);
				effects.exit("lineEnding");
				return factorySpace(effects, contentStart, "linePrefix");
			}
			/** @type {State} */
			function paragraphInitial(code) {
				effects.enter("paragraph");
				return lineStart(code);
			}
			/** @type {State} */
			function lineStart(code) {
				const token = effects.enter("chunkText", {
					contentType: "text",
					previous
				});
				if (previous) previous.next = token;
				previous = token;
				return data(code);
			}
			/** @type {State} */
			function data(code) {
				if (code === null) {
					effects.exit("chunkText");
					effects.exit("paragraph");
					effects.consume(code);
					return;
				}
				if (markdownLineEnding(code)) {
					effects.consume(code);
					effects.exit("chunkText");
					return lineStart;
				}
				effects.consume(code);
				return data;
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-util-edit-map@1.0.0/node_modules/micromark-util-edit-map/index.js
		/**
		* @import {Event} from 'micromark-util-types'
		*/
		/**
		* @typedef {[number, number, Array<Event>]} Change
		* @typedef {[number, number, number]} Jump
		*/
		/**
		* Tracks a bunch of edits.
		*
		* Port of `edit_map.rs` from `markdown-rs`:
		* <https://github.com/wooorm/markdown-rs/blob/1506572f/src/util/edit_map.rs>.
		*
		* Deal with several changes in events, batching them together.
		*
		* Preferably, changes should be kept to a minimum.
		* Sometimes, it’s needed to change the list of events, because parsing can be
		* messy, and it helps to expose a cleaner interface of events to the compiler
		* and other users.
		* It can also help to merge many adjacent similar events.
		* And, in other cases, it’s needed to parse subcontent: pass some events
		* through another tokenizer and inject the result.
		*/
		var EditMap = class {
			/**
			* Create a new edit map.
			*
			* @returns
			*   New instance.
			*/
			constructor() {
				/**
				* Changes by index, so `add` does not need to scan `map` (which is
				* quadratic for documents with many edits at different places).
				*
				* @type {Map<number, Change>}
				*/
				this.index = /* @__PURE__ */ new Map();
				/**
				* Record of changes.
				*
				* @type {Array<Change>}
				*/
				this.map = [];
			}
			/**
			* Create an edit: a remove and/or add at a certain place.
			*
			* @param {number} index
			*   Index at which to apply the edit.
			* @param {number} remove
			*   Count of items to remove at the index.
			* @param {Array<Event>} add
			*   Items to add at the index.
			* @returns {undefined}
			*   Nothing.
			*/
			add(index, remove, add) {
				addImplementation(this, index, remove, add, false);
			}
			/**
			* Create an edit: but insert `add` before existing additions, instead of
			* after them.
			*
			* @param {number} index
			*   Index at which to apply the edit.
			* @param {number} remove
			*   Count of items to remove at the index.
			* @param {Array<Event>} add
			*   Items to add at the index.
			* @returns {undefined}
			*   Nothing.
			*/
			addBefore(index, remove, add) {
				addImplementation(this, index, remove, add, true);
			}
			/**
			* Done, change the events.
			*
			* @param {Array<Event>} events
			*   List of events to apply the edits to.
			* @returns {undefined}
			*   Nothing.
			*/
			consume(events) {
				this.map.sort(function(a, b) {
					return a[0] - b[0];
				});
				if (this.map.length === 0) return;
				let index = this.map.length;
				/** @type {Array<Array<Event>>} */
				const vecs = [];
				while (index > 0) {
					index -= 1;
					vecs.push(events.slice(this.map[index][0] + this.map[index][1]), this.map[index][2]);
					events.length = this.map[index][0];
				}
				vecs.push(events.slice());
				events.length = 0;
				let slice = vecs.pop();
				while (slice) {
					for (const element of slice) events.push(element);
					slice = vecs.pop();
				}
				this.map.length = 0;
				this.index.clear();
			}
		};
		/**
		* Create an edit.
		*
		* @param {EditMap} editMap
		*   Edit map to apply to.
		* @param {number} at
		*   Index at which to apply the edit.
		* @param {number} remove
		*   Count of items to remove at the index.
		* @param {Array<Event>} add
		*   Items to add at the index.
		* @param {boolean} before
		*   Insert `add` before existing additions at `at`, instead of after them.
		* @returns {undefined}
		*   Nothing.
		*/
		function addImplementation(editMap, at, remove, add, before) {
			if (remove === 0 && add.length === 0) return;
			const existing = editMap.index.get(at);
			if (existing) {
				existing[1] += remove;
				if (before) {
					add.push(...existing[2]);
					existing[2] = add;
				} else existing[2].push(...add);
				return;
			}
			/** @type {Change} */
			const change = [
				at,
				remove,
				add
			];
			editMap.map.push(change);
			editMap.index.set(at, change);
		}
		//#endregion
		//#region node_modules/.pnpm/micromark@4.0.3/node_modules/micromark/lib/initialize/document.js
		/**
		* @import {
		*   Construct,
		*   ContainerState,
		*   InitialConstruct,
		*   Initializer,
		*   Point,
		*   State,
		*   TokenizeContext,
		*   Tokenizer,
		*   Token
		* } from 'micromark-util-types'
		*/
		/**
		* @typedef {[Construct, ContainerState]} StackItem
		*   Construct and its state.
		*/
		/** @type {InitialConstruct} */
		const document$2 = { tokenize: initializeDocument };
		/** @type {Construct} */
		const containerConstruct = { tokenize: tokenizeContainer };
		/**
		* @this {TokenizeContext}
		*   Self.
		* @type {Initializer}
		*   Initializer.
		*/
		function initializeDocument(effects) {
			const self = this;
			/** @type {Array<StackItem>} */
			const stack = [];
			let continued = 0;
			/** @type {TokenizeContext | undefined} */
			let childFlow;
			/** @type {Token | undefined} */
			let childToken;
			/** @type {number} */
			let lineStartOffset;
			return start;
			/** @type {State} */
			function start(code) {
				if (continued < stack.length) {
					const item = stack[continued];
					self.containerState = item[1];
					return effects.attempt(item[0].continuation, documentContinue, checkNewContainers)(code);
				}
				return checkNewContainers(code);
			}
			/** @type {State} */
			function documentContinue(code) {
				continued++;
				if (self.containerState._closeFlow) {
					self.containerState._closeFlow = void 0;
					if (childFlow) closeFlow();
					const indexBeforeExits = self.events.length;
					let indexBeforeFlow = indexBeforeExits;
					/** @type {Point | undefined} */
					let point;
					while (indexBeforeFlow--) if (self.events[indexBeforeFlow][0] === "exit" && self.events[indexBeforeFlow][1].type === "chunkFlow") {
						point = self.events[indexBeforeFlow][1].end;
						break;
					}
					exitContainers(continued);
					let index = indexBeforeExits;
					while (index < self.events.length) {
						self.events[index][1].end = { ...point };
						index++;
					}
					const editMap = new EditMap();
					editMap.add(indexBeforeFlow + 1, 0, self.events.slice(indexBeforeExits));
					editMap.add(indexBeforeExits, index - indexBeforeExits, []);
					editMap.consume(self.events);
					return checkNewContainers(code);
				}
				return start(code);
			}
			/** @type {State} */
			function checkNewContainers(code) {
				if (continued === stack.length) {
					if (!childFlow) return documentContinued(code);
					if (childFlow.currentConstruct && childFlow.currentConstruct.concrete) return flowStart(code);
					self.interrupt = Boolean(childFlow.currentConstruct && !childFlow._gfmTableDynamicInterruptHack);
				}
				self.containerState = {};
				return effects.check(containerConstruct, thereIsANewContainer, thereIsNoNewContainer)(code);
			}
			/** @type {State} */
			function thereIsANewContainer(code) {
				if (childFlow) closeFlow();
				exitContainers(continued);
				return documentContinued(code);
			}
			/** @type {State} */
			function thereIsNoNewContainer(code) {
				self.parser.lazy[self.now().line] = continued !== stack.length;
				lineStartOffset = self.now().offset;
				return flowStart(code);
			}
			/** @type {State} */
			function documentContinued(code) {
				self.containerState = {};
				return effects.attempt(containerConstruct, containerContinue, flowStart)(code);
			}
			/** @type {State} */
			function containerContinue(code) {
				continued++;
				stack.push([self.currentConstruct, self.containerState]);
				return documentContinued(code);
			}
			/** @type {State} */
			function flowStart(code) {
				if (code === null) {
					if (childFlow) closeFlow();
					exitContainers(0);
					effects.consume(code);
					return;
				}
				childFlow = childFlow || self.parser.flow(self.now());
				effects.enter("chunkFlow", {
					_tokenizer: childFlow,
					contentType: "flow",
					previous: childToken
				});
				return flowContinue(code);
			}
			/** @type {State} */
			function flowContinue(code) {
				if (code === null) {
					writeToChild(effects.exit("chunkFlow"), true);
					exitContainers(0);
					effects.consume(code);
					return;
				}
				if (markdownLineEnding(code)) {
					effects.consume(code);
					writeToChild(effects.exit("chunkFlow"));
					continued = 0;
					self.interrupt = void 0;
					return start;
				}
				effects.consume(code);
				return flowContinue;
			}
			/**
			* @param {Token} token
			*   Token.
			* @param {boolean | undefined} [endOfFile]
			*   Whether the token is at the end of the file (default: `false`).
			* @returns {undefined}
			*   Nothing.
			*/
			function writeToChild(token, endOfFile) {
				const stream = self.sliceStream(token);
				if (endOfFile) stream.push(null);
				token.previous = childToken;
				if (childToken) childToken.next = token;
				childToken = token;
				childFlow.defineSkip(token.start);
				childFlow.write(stream);
				if (self.parser.lazy[token.start.line]) {
					let index = childFlow.events.length;
					while (index--) if (childFlow.events[index][1].start.offset < lineStartOffset && (!childFlow.events[index][1].end || childFlow.events[index][1].end.offset > lineStartOffset)) return;
					const indexBeforeExits = self.events.length;
					let indexBeforeFlow = indexBeforeExits;
					/** @type {boolean | undefined} */
					let seen;
					/** @type {Point | undefined} */
					let point;
					while (indexBeforeFlow--) if (self.events[indexBeforeFlow][0] === "exit" && self.events[indexBeforeFlow][1].type === "chunkFlow") {
						if (seen) {
							point = self.events[indexBeforeFlow][1].end;
							break;
						}
						seen = true;
					}
					exitContainers(continued);
					index = indexBeforeExits;
					while (index < self.events.length) {
						self.events[index][1].end = { ...point };
						index++;
					}
					const editMap = new EditMap();
					editMap.add(indexBeforeFlow + 1, 0, self.events.slice(indexBeforeExits));
					editMap.add(indexBeforeExits, index - indexBeforeExits, []);
					editMap.consume(self.events);
				}
			}
			/**
			* @param {number} size
			*   Size.
			* @returns {undefined}
			*   Nothing.
			*/
			function exitContainers(size) {
				let index = stack.length;
				while (index-- > size) {
					const entry = stack[index];
					self.containerState = entry[1];
					entry[0].exit.call(self, effects);
				}
				stack.length = size;
			}
			function closeFlow() {
				childFlow.write([null]);
				childToken = void 0;
				childFlow = void 0;
				self.containerState._closeFlow = void 0;
			}
		}
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*   Tokenizer.
		*/
		function tokenizeContainer(effects, ok, nok) {
			return factorySpace(effects, effects.attempt(this.parser.constructs.document, ok, nok), "linePrefix", this.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4);
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-util-classify-character@2.0.1/node_modules/micromark-util-classify-character/index.js
		/**
		* @import {Code} from 'micromark-util-types'
		*/
		/**
		* Classify whether a code represents whitespace, punctuation, or something
		* else.
		*
		* Used for attention (emphasis, strong), whose sequences can open or close
		* based on the class of surrounding characters.
		*
		* > 👉 **Note**: eof (`null`) is seen as whitespace.
		*
		* @param {Code} code
		*   Code.
		* @returns {typeof constants.characterGroupWhitespace | typeof constants.characterGroupPunctuation | undefined}
		*   Group.
		*/
		function classifyCharacter(code) {
			if (code === null || markdownLineEndingOrSpace(code) || unicodeWhitespace(code)) return 1;
			if (unicodePunctuation(code)) return 2;
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-util-resolve-all@2.0.1/node_modules/micromark-util-resolve-all/index.js
		/**
		* @import {Event, Resolver, TokenizeContext} from 'micromark-util-types'
		*/
		/**
		* Call all `resolveAll`s.
		*
		* @param {ReadonlyArray<{resolveAll?: Resolver | undefined}>} constructs
		*   List of constructs, optionally with `resolveAll`s.
		* @param {Array<Event>} events
		*   List of events.
		* @param {TokenizeContext} context
		*   Context used by `tokenize`.
		* @returns {Array<Event>}
		*   Changed events.
		*/
		function resolveAll(constructs, events, context) {
			/** @type {Array<Resolver>} */
			const called = [];
			let index = -1;
			while (++index < constructs.length) {
				const resolve = constructs[index].resolveAll;
				if (resolve && !called.includes(resolve)) {
					events = resolve(events, context);
					called.push(resolve);
				}
			}
			return events;
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/attention.js
		/**
		* @import {
		*   Code,
		*   Construct,
		*   Event,
		*   Point,
		*   Resolver,
		*   State,
		*   TokenizeContext,
		*   Tokenizer,
		*   Token
		* } from 'micromark-util-types'
		*/
		/** @type {Construct} */
		const attention = {
			name: "attention",
			resolveAll: resolveAllAttention,
			tokenize: tokenizeAttention
		};
		/**
		* Take all events and resolve attention to emphasis or strong.
		*
		* @type {Resolver}
		*/
		function resolveAllAttention(events, context) {
			let index = -1;
			/** @type {Array<Event>} */
			let nextEvents;
			while (++index < events.length) if (events[index][0] === "enter" && events[index][1].type === "attentionSequence" && events[index][1]._close) {
				let open = index;
				while (open--) if (events[open][0] === "exit" && events[open][1].type === "attentionSequence" && events[open][1]._open && context.sliceSerialize(events[open][1]).charCodeAt(0) === context.sliceSerialize(events[index][1]).charCodeAt(0)) {
					if ((events[open][1]._close || events[index][1]._open) && (events[index][1].end.offset - events[index][1].start.offset) % 3 && !((events[open][1].end.offset - events[open][1].start.offset + events[index][1].end.offset - events[index][1].start.offset) % 3)) continue;
					const use = events[open][1].end.offset - events[open][1].start.offset > 1 && events[index][1].end.offset - events[index][1].start.offset > 1 ? 2 : 1;
					const start = { ...events[open][1].end };
					const end = { ...events[index][1].start };
					movePoint(start, -use);
					movePoint(end, use);
					const openingSequence = {
						type: use > 1 ? "strongSequence" : "emphasisSequence",
						start,
						end: { ...events[open][1].end }
					};
					const closingSequence = {
						type: use > 1 ? "strongSequence" : "emphasisSequence",
						start: { ...events[index][1].start },
						end
					};
					const text = {
						type: use > 1 ? "strongText" : "emphasisText",
						start: { ...events[open][1].end },
						end: { ...events[index][1].start }
					};
					const group = {
						type: use > 1 ? "strong" : "emphasis",
						start: { ...openingSequence.start },
						end: { ...closingSequence.end }
					};
					events[open][1].end = { ...openingSequence.start };
					events[index][1].start = { ...closingSequence.end };
					nextEvents = [];
					if (events[open][1].end.offset - events[open][1].start.offset) nextEvents = push(nextEvents, [[
						"enter",
						events[open][1],
						context
					], [
						"exit",
						events[open][1],
						context
					]]);
					nextEvents = push(nextEvents, [
						[
							"enter",
							group,
							context
						],
						[
							"enter",
							openingSequence,
							context
						],
						[
							"exit",
							openingSequence,
							context
						],
						[
							"enter",
							text,
							context
						]
					]);
					nextEvents = push(nextEvents, resolveAll(context.parser.constructs.insideSpan.null, events.slice(open + 1, index), context));
					nextEvents = push(nextEvents, [
						[
							"exit",
							text,
							context
						],
						[
							"enter",
							closingSequence,
							context
						],
						[
							"exit",
							closingSequence,
							context
						],
						[
							"exit",
							group,
							context
						]
					]);
					/** @type {number} */
					let offset = 0;
					if (events[index][1].end.offset - events[index][1].start.offset) {
						offset = 2;
						nextEvents = push(nextEvents, [[
							"enter",
							events[index][1],
							context
						], [
							"exit",
							events[index][1],
							context
						]]);
					}
					splice(events, open - 1, index - open + 3, nextEvents);
					index = open + nextEvents.length - offset - 2;
					break;
				}
			}
			index = -1;
			while (++index < events.length) if (events[index][1].type === "attentionSequence") events[index][1].type = "data";
			return events;
		}
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeAttention(effects, ok) {
			const attentionMarkers = this.parser.constructs.attentionMarkers.null;
			const previous = this.previous;
			const before = classifyCharacter(previous);
			/** @type {NonNullable<Code>} */
			let marker;
			return start;
			/**
			* Before a sequence.
			*
			* ```markdown
			* > | **
			*     ^
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				marker = code;
				effects.enter("attentionSequence");
				return inside(code);
			}
			/**
			* In a sequence.
			*
			* ```markdown
			* > | **
			*     ^^
			* ```
			*
			* @type {State}
			*/
			function inside(code) {
				if (code === marker) {
					effects.consume(code);
					return inside;
				}
				const token = effects.exit("attentionSequence");
				const after = classifyCharacter(code);
				const open = !after || after === 2 && before || attentionMarkers.includes(code) && code !== 42 && code !== 95;
				const close = !before || before === 2 && after || attentionMarkers.includes(previous) && previous !== 42 && previous !== 95;
				token._open = Boolean(marker === 42 ? open : open && (before || !close));
				token._close = Boolean(marker === 42 ? close : close && (after || !open));
				return ok(code);
			}
		}
		/**
		* Move a point a bit.
		*
		* Note: `move` only works inside lines! It’s not possible to move past other
		* chunks (replacement characters, tabs, or line endings).
		*
		* @param {Point} point
		*   Point.
		* @param {number} offset
		*   Amount to move.
		* @returns {undefined}
		*   Nothing.
		*/
		function movePoint(point, offset) {
			point.column += offset;
			point.offset += offset;
			point._bufferIndex += offset;
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/autolink.js
		/**
		* @import {
		*   Construct,
		*   State,
		*   TokenizeContext,
		*   Tokenizer
		* } from 'micromark-util-types'
		*/
		/** @type {Construct} */
		const autolink = {
			name: "autolink",
			tokenize: tokenizeAutolink
		};
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeAutolink(effects, ok, nok) {
			let size = 0;
			return start;
			/**
			* Start of an autolink.
			*
			* ```markdown
			* > | a<https://example.com>b
			*      ^
			* > | a<user@example.com>b
			*      ^
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				effects.enter("autolink");
				effects.enter("autolinkMarker");
				effects.consume(code);
				effects.exit("autolinkMarker");
				effects.enter("autolinkProtocol");
				return open;
			}
			/**
			* After `<`, at protocol or atext.
			*
			* ```markdown
			* > | a<https://example.com>b
			*       ^
			* > | a<user@example.com>b
			*       ^
			* ```
			*
			* @type {State}
			*/
			function open(code) {
				if (asciiAlpha(code)) {
					effects.consume(code);
					return schemeOrEmailAtext;
				}
				if (code === 64) return nok(code);
				return emailAtext(code);
			}
			/**
			* At second byte of protocol or atext.
			*
			* ```markdown
			* > | a<https://example.com>b
			*        ^
			* > | a<user@example.com>b
			*        ^
			* ```
			*
			* @type {State}
			*/
			function schemeOrEmailAtext(code) {
				if (code === 43 || code === 45 || code === 46 || asciiAlphanumeric(code)) {
					size = 1;
					return schemeInsideOrEmailAtext(code);
				}
				return emailAtext(code);
			}
			/**
			* In ambiguous protocol or atext.
			*
			* ```markdown
			* > | a<https://example.com>b
			*        ^
			* > | a<user@example.com>b
			*        ^
			* ```
			*
			* @type {State}
			*/
			function schemeInsideOrEmailAtext(code) {
				if (code === 58) {
					effects.consume(code);
					size = 0;
					return urlInside;
				}
				if ((code === 43 || code === 45 || code === 46 || asciiAlphanumeric(code)) && size++ < 32) {
					effects.consume(code);
					return schemeInsideOrEmailAtext;
				}
				size = 0;
				return emailAtext(code);
			}
			/**
			* After protocol, in URL.
			*
			* ```markdown
			* > | a<https://example.com>b
			*             ^
			* ```
			*
			* @type {State}
			*/
			function urlInside(code) {
				if (code === 62) {
					effects.exit("autolinkProtocol");
					effects.enter("autolinkMarker");
					effects.consume(code);
					effects.exit("autolinkMarker");
					effects.exit("autolink");
					return ok;
				}
				if (code === null || code === 32 || code === 60 || asciiControl(code)) return nok(code);
				effects.consume(code);
				return urlInside;
			}
			/**
			* In email atext.
			*
			* ```markdown
			* > | a<user.name@example.com>b
			*              ^
			* ```
			*
			* @type {State}
			*/
			function emailAtext(code) {
				if (code === 64) {
					effects.consume(code);
					return emailAtSignOrDot;
				}
				if (asciiAtext(code)) {
					effects.consume(code);
					return emailAtext;
				}
				return nok(code);
			}
			/**
			* In label, after at-sign or dot.
			*
			* ```markdown
			* > | a<user.name@example.com>b
			*                 ^       ^
			* ```
			*
			* @type {State}
			*/
			function emailAtSignOrDot(code) {
				return asciiAlphanumeric(code) ? emailLabel(code) : nok(code);
			}
			/**
			* In label, where `.` and `>` are allowed.
			*
			* ```markdown
			* > | a<user.name@example.com>b
			*                   ^
			* ```
			*
			* @type {State}
			*/
			function emailLabel(code) {
				if (code === 46) {
					effects.consume(code);
					size = 0;
					return emailAtSignOrDot;
				}
				if (code === 62) {
					effects.exit("autolinkProtocol").type = "autolinkEmail";
					effects.enter("autolinkMarker");
					effects.consume(code);
					effects.exit("autolinkMarker");
					effects.exit("autolink");
					return ok;
				}
				return emailValue(code);
			}
			/**
			* In label, where `.` and `>` are *not* allowed.
			*
			* Though, this is also used in `emailLabel` to parse other values.
			*
			* ```markdown
			* > | a<user.name@ex-ample.com>b
			*                    ^
			* ```
			*
			* @type {State}
			*/
			function emailValue(code) {
				if ((code === 45 || asciiAlphanumeric(code)) && size++ < 63) {
					const next = code === 45 ? emailValue : emailLabel;
					effects.consume(code);
					return next;
				}
				return nok(code);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/blank-line.js
		/**
		* @import {
		*   Construct,
		*   State,
		*   TokenizeContext,
		*   Tokenizer
		* } from 'micromark-util-types'
		*/
		/** @type {Construct} */
		const blankLine = {
			partial: true,
			tokenize: tokenizeBlankLine
		};
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeBlankLine(effects, ok, nok) {
			return start;
			/**
			* Start of blank line.
			*
			* > 👉 **Note**: `␠` represents a space character.
			*
			* ```markdown
			* > | ␠␠␊
			*     ^
			* > | ␊
			*     ^
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				return markdownSpace(code) ? factorySpace(effects, after, "linePrefix")(code) : after(code);
			}
			/**
			* At eof/eol, after optional whitespace.
			*
			* > 👉 **Note**: `␠` represents a space character.
			*
			* ```markdown
			* > | ␠␠␊
			*       ^
			* > | ␊
			*     ^
			* ```
			*
			* @type {State}
			*/
			function after(code) {
				return code === null || markdownLineEnding(code) ? ok(code) : nok(code);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/block-quote.js
		/**
		* @import {
		*   Construct,
		*   Exiter,
		*   State,
		*   TokenizeContext,
		*   Tokenizer
		* } from 'micromark-util-types'
		*/
		/** @type {Construct} */
		const blockQuote = {
			continuation: { tokenize: tokenizeBlockQuoteContinuation },
			exit,
			name: "blockQuote",
			tokenize: tokenizeBlockQuoteStart
		};
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeBlockQuoteStart(effects, ok, nok) {
			const self = this;
			return start;
			/**
			* Start of block quote.
			*
			* ```markdown
			* > | > a
			*     ^
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				if (code === 62) {
					const state = self.containerState;
					if (!state.open) {
						effects.enter("blockQuote", { _container: true });
						state.open = true;
					}
					effects.enter("blockQuotePrefix");
					effects.enter("blockQuoteMarker");
					effects.consume(code);
					effects.exit("blockQuoteMarker");
					return after;
				}
				return nok(code);
			}
			/**
			* After `>`, before optional whitespace.
			*
			* ```markdown
			* > | > a
			*      ^
			* ```
			*
			* @type {State}
			*/
			function after(code) {
				if (markdownSpace(code)) {
					effects.enter("blockQuotePrefixWhitespace");
					effects.consume(code);
					effects.exit("blockQuotePrefixWhitespace");
					effects.exit("blockQuotePrefix");
					return ok;
				}
				effects.exit("blockQuotePrefix");
				return ok(code);
			}
		}
		/**
		* Start of block quote continuation.
		*
		* ```markdown
		*   | > a
		* > | > b
		*     ^
		* ```
		*
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeBlockQuoteContinuation(effects, ok, nok) {
			const self = this;
			return contStart;
			/**
			* Start of block quote continuation.
			*
			* Also used to parse the first block quote opening.
			*
			* ```markdown
			*   | > a
			* > | > b
			*     ^
			* ```
			*
			* @type {State}
			*/
			function contStart(code) {
				if (markdownSpace(code)) return factorySpace(effects, contBefore, "linePrefix", self.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(code);
				return contBefore(code);
			}
			/**
			* At `>`, after optional whitespace.
			*
			* Also used to parse the first block quote opening.
			*
			* ```markdown
			*   | > a
			* > | > b
			*     ^
			* ```
			*
			* @type {State}
			*/
			function contBefore(code) {
				return effects.attempt(blockQuote, ok, nok)(code);
			}
		}
		/** @type {Exiter} */
		function exit(effects) {
			effects.exit("blockQuote");
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/character-escape.js
		/**
		* @import {
		*   Construct,
		*   State,
		*   TokenizeContext,
		*   Tokenizer
		* } from 'micromark-util-types'
		*/
		/** @type {Construct} */
		const characterEscape = {
			name: "characterEscape",
			tokenize: tokenizeCharacterEscape
		};
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeCharacterEscape(effects, ok, nok) {
			return start;
			/**
			* Start of character escape.
			*
			* ```markdown
			* > | a\*b
			*      ^
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				effects.enter("characterEscape");
				effects.enter("escapeMarker");
				effects.consume(code);
				effects.exit("escapeMarker");
				return inside;
			}
			/**
			* After `\`, at punctuation.
			*
			* ```markdown
			* > | a\*b
			*       ^
			* ```
			*
			* @type {State}
			*/
			function inside(code) {
				if (asciiPunctuation(code)) {
					effects.enter("characterEscapeValue");
					effects.consume(code);
					effects.exit("characterEscapeValue");
					effects.exit("characterEscape");
					return ok;
				}
				return nok(code);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/character-reference.js
		/**
		* @import {
		*   Code,
		*   Construct,
		*   State,
		*   TokenizeContext,
		*   Tokenizer
		* } from 'micromark-util-types'
		*/
		/** @type {Construct} */
		const characterReference = {
			name: "characterReference",
			tokenize: tokenizeCharacterReference
		};
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeCharacterReference(effects, ok, nok) {
			const self = this;
			let size = 0;
			/** @type {number} */
			let max;
			/** @type {(code: Code) => boolean} */
			let test;
			return start;
			/**
			* Start of character reference.
			*
			* ```markdown
			* > | a&amp;b
			*      ^
			* > | a&#123;b
			*      ^
			* > | a&#x9;b
			*      ^
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				effects.enter("characterReference");
				effects.enter("characterReferenceMarker");
				effects.consume(code);
				effects.exit("characterReferenceMarker");
				return open;
			}
			/**
			* After `&`, at `#` for numeric references or alphanumeric for named
			* references.
			*
			* ```markdown
			* > | a&amp;b
			*       ^
			* > | a&#123;b
			*       ^
			* > | a&#x9;b
			*       ^
			* ```
			*
			* @type {State}
			*/
			function open(code) {
				if (code === 35) {
					effects.enter("characterReferenceMarkerNumeric");
					effects.consume(code);
					effects.exit("characterReferenceMarkerNumeric");
					return numeric;
				}
				effects.enter("characterReferenceValue");
				max = 31;
				test = asciiAlphanumeric;
				return value(code);
			}
			/**
			* After `#`, at `x` for hexadecimals or digit for decimals.
			*
			* ```markdown
			* > | a&#123;b
			*        ^
			* > | a&#x9;b
			*        ^
			* ```
			*
			* @type {State}
			*/
			function numeric(code) {
				if (code === 88 || code === 120) {
					effects.enter("characterReferenceMarkerHexadecimal");
					effects.consume(code);
					effects.exit("characterReferenceMarkerHexadecimal");
					effects.enter("characterReferenceValue");
					max = 6;
					test = asciiHexDigit;
					return value;
				}
				effects.enter("characterReferenceValue");
				max = 7;
				test = asciiDigit;
				return value(code);
			}
			/**
			* After markers (`&#x`, `&#`, or `&`), in value, before `;`.
			*
			* The character reference kind defines what and how many characters are
			* allowed.
			*
			* ```markdown
			* > | a&amp;b
			*       ^^^
			* > | a&#123;b
			*        ^^^
			* > | a&#x9;b
			*         ^
			* ```
			*
			* @type {State}
			*/
			function value(code) {
				if (code === 59 && size) {
					const token = effects.exit("characterReferenceValue");
					if (test === asciiAlphanumeric && !decodeNamedCharacterReference(self.sliceSerialize(token))) return nok(code);
					effects.enter("characterReferenceMarker");
					effects.consume(code);
					effects.exit("characterReferenceMarker");
					effects.exit("characterReference");
					return ok;
				}
				if (test(code) && size++ < max) {
					effects.consume(code);
					return value;
				}
				return nok(code);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/partial-non-lazy-continuation.js
		/** @type {Construct} */
		const nonLazyContinuation = {
			partial: true,
			tokenize: tokenizeNonLazyContinuation
		};
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeNonLazyContinuation(effects, ok, nok) {
			const self = this;
			return start;
			/**
			* At eol, before continuation.
			*
			* ```markdown
			* > | * ```js
			*            ^
			*   | b
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				if (code === null) return nok(code);
				effects.enter("lineEnding");
				effects.consume(code);
				effects.exit("lineEnding");
				return after;
			}
			/**
			* A continuation.
			*
			* ```markdown
			*   | * ```js
			* > | b
			*     ^
			* ```
			*
			* @type {State}
			*/
			function after(code) {
				return self.parser.lazy[self.now().line] ? nok(code) : ok(code);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/code-fenced.js
		/**
		* @import {
		*   Code,
		*   Construct,
		*   State,
		*   TokenizeContext,
		*   Tokenizer
		* } from 'micromark-util-types'
		*/
		/** @type {Construct} */
		const codeFenced = {
			concrete: true,
			name: "codeFenced",
			tokenize: tokenizeCodeFenced
		};
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeCodeFenced(effects, ok, nok) {
			const self = this;
			/** @type {Construct} */
			const closeStart = {
				partial: true,
				tokenize: tokenizeCloseStart
			};
			let initialPrefix = 0;
			let sizeOpen = 0;
			/** @type {NonNullable<Code>} */
			let marker;
			return start;
			/**
			* Start of code.
			*
			* ```markdown
			* > | ~~~js
			*     ^
			*   | alert(1)
			*   | ~~~
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				return beforeSequenceOpen(code);
			}
			/**
			* In opening fence, after prefix, at sequence.
			*
			* ```markdown
			* > | ~~~js
			*     ^
			*   | alert(1)
			*   | ~~~
			* ```
			*
			* @type {State}
			*/
			function beforeSequenceOpen(code) {
				const tail = self.events[self.events.length - 1];
				initialPrefix = tail && tail[1].type === "linePrefix" ? tail[2].sliceSerialize(tail[1], true).length : 0;
				marker = code;
				effects.enter("codeFenced");
				effects.enter("codeFencedFence");
				effects.enter("codeFencedFenceSequence");
				return sequenceOpen(code);
			}
			/**
			* In opening fence sequence.
			*
			* ```markdown
			* > | ~~~js
			*      ^
			*   | alert(1)
			*   | ~~~
			* ```
			*
			* @type {State}
			*/
			function sequenceOpen(code) {
				if (code === marker) {
					sizeOpen++;
					effects.consume(code);
					return sequenceOpen;
				}
				if (sizeOpen < 3) return nok(code);
				effects.exit("codeFencedFenceSequence");
				return markdownSpace(code) ? factorySpace(effects, infoBefore, "whitespace")(code) : infoBefore(code);
			}
			/**
			* In opening fence, after the sequence (and optional whitespace), before info.
			*
			* ```markdown
			* > | ~~~js
			*        ^
			*   | alert(1)
			*   | ~~~
			* ```
			*
			* @type {State}
			*/
			function infoBefore(code) {
				if (code === null || markdownLineEnding(code)) {
					effects.exit("codeFencedFence");
					return self.interrupt ? ok(code) : effects.check(nonLazyContinuation, atNonLazyBreak, after)(code);
				}
				effects.enter("codeFencedFenceInfo");
				effects.enter("chunkString", { contentType: "string" });
				return info(code);
			}
			/**
			* In info.
			*
			* ```markdown
			* > | ~~~js
			*        ^
			*   | alert(1)
			*   | ~~~
			* ```
			*
			* @type {State}
			*/
			function info(code) {
				if (code === null || markdownLineEnding(code)) {
					effects.exit("chunkString");
					effects.exit("codeFencedFenceInfo");
					return infoBefore(code);
				}
				if (markdownSpace(code)) {
					effects.exit("chunkString");
					effects.exit("codeFencedFenceInfo");
					return factorySpace(effects, metaBefore, "whitespace")(code);
				}
				if (code === 96 && code === marker) return nok(code);
				effects.consume(code);
				return info;
			}
			/**
			* In opening fence, after info and whitespace, before meta.
			*
			* ```markdown
			* > | ~~~js eval
			*           ^
			*   | alert(1)
			*   | ~~~
			* ```
			*
			* @type {State}
			*/
			function metaBefore(code) {
				if (code === null || markdownLineEnding(code)) return infoBefore(code);
				effects.enter("codeFencedFenceMeta");
				effects.enter("chunkString", { contentType: "string" });
				return meta(code);
			}
			/**
			* In meta.
			*
			* ```markdown
			* > | ~~~js eval
			*           ^
			*   | alert(1)
			*   | ~~~
			* ```
			*
			* @type {State}
			*/
			function meta(code) {
				if (code === null || markdownLineEnding(code)) {
					effects.exit("chunkString");
					effects.exit("codeFencedFenceMeta");
					return infoBefore(code);
				}
				if (code === 96 && code === marker) return nok(code);
				effects.consume(code);
				return meta;
			}
			/**
			* At eol/eof in code, before a non-lazy closing fence or content.
			*
			* ```markdown
			* > | ~~~js
			*          ^
			* > | alert(1)
			*             ^
			*   | ~~~
			* ```
			*
			* @type {State}
			*/
			function atNonLazyBreak(code) {
				return effects.attempt(closeStart, after, contentBefore)(code);
			}
			/**
			* Before code content, not a closing fence, at eol.
			*
			* ```markdown
			*   | ~~~js
			* > | alert(1)
			*             ^
			*   | ~~~
			* ```
			*
			* @type {State}
			*/
			function contentBefore(code) {
				effects.enter("lineEnding");
				effects.consume(code);
				effects.exit("lineEnding");
				return contentStart;
			}
			/**
			* Before code content, not a closing fence.
			*
			* ```markdown
			*   | ~~~js
			* > | alert(1)
			*     ^
			*   | ~~~
			* ```
			*
			* @type {State}
			*/
			function contentStart(code) {
				return initialPrefix > 0 && markdownSpace(code) ? factorySpace(effects, beforeContentChunk, "linePrefix", initialPrefix + 1)(code) : beforeContentChunk(code);
			}
			/**
			* Before code content, after optional prefix.
			*
			* ```markdown
			*   | ~~~js
			* > | alert(1)
			*     ^
			*   | ~~~
			* ```
			*
			* @type {State}
			*/
			function beforeContentChunk(code) {
				if (code === null || markdownLineEnding(code)) return effects.check(nonLazyContinuation, atNonLazyBreak, after)(code);
				effects.enter("codeFlowValue");
				return contentChunk(code);
			}
			/**
			* In code content.
			*
			* ```markdown
			*   | ~~~js
			* > | alert(1)
			*     ^^^^^^^^
			*   | ~~~
			* ```
			*
			* @type {State}
			*/
			function contentChunk(code) {
				if (code === null || markdownLineEnding(code)) {
					effects.exit("codeFlowValue");
					return beforeContentChunk(code);
				}
				effects.consume(code);
				return contentChunk;
			}
			/**
			* After code.
			*
			* ```markdown
			*   | ~~~js
			*   | alert(1)
			* > | ~~~
			*        ^
			* ```
			*
			* @type {State}
			*/
			function after(code) {
				effects.exit("codeFenced");
				return ok(code);
			}
			/**
			* @this {TokenizeContext}
			*   Context.
			* @type {Tokenizer}
			*/
			function tokenizeCloseStart(effects, ok, nok) {
				let size = 0;
				return startBefore;
				/**
				*
				*
				* @type {State}
				*/
				function startBefore(code) {
					effects.enter("lineEnding");
					effects.consume(code);
					effects.exit("lineEnding");
					return start;
				}
				/**
				* Before closing fence, at optional whitespace.
				*
				* ```markdown
				*   | ~~~js
				*   | alert(1)
				* > | ~~~
				*     ^
				* ```
				*
				* @type {State}
				*/
				function start(code) {
					effects.enter("codeFencedFence");
					return markdownSpace(code) ? factorySpace(effects, beforeSequenceClose, "linePrefix", self.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(code) : beforeSequenceClose(code);
				}
				/**
				* In closing fence, after optional whitespace, at sequence.
				*
				* ```markdown
				*   | ~~~js
				*   | alert(1)
				* > | ~~~
				*     ^
				* ```
				*
				* @type {State}
				*/
				function beforeSequenceClose(code) {
					if (code === marker) {
						effects.enter("codeFencedFenceSequence");
						return sequenceClose(code);
					}
					return nok(code);
				}
				/**
				* In closing fence sequence.
				*
				* ```markdown
				*   | ~~~js
				*   | alert(1)
				* > | ~~~
				*     ^
				* ```
				*
				* @type {State}
				*/
				function sequenceClose(code) {
					if (code === marker) {
						size++;
						effects.consume(code);
						return sequenceClose;
					}
					if (size >= sizeOpen) {
						effects.exit("codeFencedFenceSequence");
						return markdownSpace(code) ? factorySpace(effects, sequenceCloseAfter, "whitespace")(code) : sequenceCloseAfter(code);
					}
					return nok(code);
				}
				/**
				* After closing fence sequence, after optional whitespace.
				*
				* ```markdown
				*   | ~~~js
				*   | alert(1)
				* > | ~~~
				*        ^
				* ```
				*
				* @type {State}
				*/
				function sequenceCloseAfter(code) {
					if (code === null || markdownLineEnding(code)) {
						effects.exit("codeFencedFence");
						return ok(code);
					}
					return nok(code);
				}
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/code-indented.js
		/**
		* @import {
		*   Construct,
		*   State,
		*   TokenizeContext,
		*   Tokenizer
		* } from 'micromark-util-types'
		*/
		/** @type {Construct} */
		const codeIndented = {
			name: "codeIndented",
			tokenize: tokenizeCodeIndented
		};
		/** @type {Construct} */
		const furtherStart = {
			partial: true,
			tokenize: tokenizeFurtherStart
		};
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeCodeIndented(effects, ok, nok) {
			return start;
			/**
			* Start of code (indented).
			*
			* > **Parsing note**: it is not needed to check if this first line is a
			* > filled line (that it has a non-whitespace character), because blank lines
			* > are parsed already, so we never run into that.
			*
			* ```markdown
			* > |     aaa
			*     ^
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				effects.enter("codeIndented");
				return factorySpaceMinMax(effects, atBreak, nok, "linePrefix", 4, 4)(code);
			}
			/**
			* At a break.
			*
			* ```markdown
			* > |     aaa
			*         ^  ^
			* ```
			*
			* @type {State}
			*/
			function atBreak(code) {
				if (code === null) return after(code);
				if (markdownLineEnding(code)) return effects.attempt(furtherStart, atBreak, after)(code);
				effects.enter("codeFlowValue");
				return inside(code);
			}
			/**
			* In code content.
			*
			* ```markdown
			* > |     aaa
			*         ^^^^
			* ```
			*
			* @type {State}
			*/
			function inside(code) {
				if (code === null || markdownLineEnding(code)) {
					effects.exit("codeFlowValue");
					return atBreak(code);
				}
				effects.consume(code);
				return inside;
			}
			/** @type {State} */
			function after(code) {
				effects.exit("codeIndented");
				return ok(code);
			}
		}
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeFurtherStart(effects, ok, nok) {
			const self = this;
			return furtherStart;
			/**
			* At eol, trying to parse another indent.
			*
			* ```markdown
			* > |     aaa
			*            ^
			*   |     bbb
			* ```
			*
			* @type {State}
			*/
			function furtherStart(code) {
				if (self.parser.lazy[self.now().line]) return nok(code);
				if (markdownLineEnding(code)) {
					effects.enter("lineEnding");
					effects.consume(code);
					effects.exit("lineEnding");
					return furtherStart;
				}
				return factorySpaceMinMax(effects, ok, onNotEnoughPrefix, "linePrefix", 4, 4)(code);
			}
			/**
			* After not enough of a prefix.
			*
			* A following line ending is another (potentially blank) line to try,
			* anything else means this isn’t a continuation.
			*
			* ```markdown
			* > |     aaa
			*
			*   |     bbb
			* ```
			*
			* @type {State}
			*/
			function onNotEnoughPrefix(code) {
				return markdownLineEnding(code) ? furtherStart(code) : nok(code);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/code-text.js
		/**
		* @import {
		*   Construct,
		*   Previous,
		*   Resolver,
		*   State,
		*   TokenizeContext,
		*   Tokenizer,
		*   Token
		* } from 'micromark-util-types'
		*/
		/** @type {Construct} */
		const codeText = {
			name: "codeText",
			previous,
			resolve: resolveCodeText,
			tokenize: tokenizeCodeText
		};
		/** @type {Resolver} */
		function resolveCodeText(events) {
			let tailExitIndex = events.length - 4;
			let headEnterIndex = 3;
			/** @type {number} */
			let index;
			/** @type {number | undefined} */
			let enter;
			if ((events[headEnterIndex][1].type === "lineEnding" || events[headEnterIndex][1].type === "space") && (events[tailExitIndex][1].type === "lineEnding" || events[tailExitIndex][1].type === "space")) {
				index = headEnterIndex;
				while (++index < tailExitIndex) if (events[index][1].type === "codeTextData") {
					events[headEnterIndex][1].type = "codeTextPadding";
					events[tailExitIndex][1].type = "codeTextPadding";
					headEnterIndex += 2;
					tailExitIndex -= 2;
					break;
				}
			}
			index = headEnterIndex - 1;
			tailExitIndex++;
			while (++index <= tailExitIndex) if (enter === void 0) {
				if (index !== tailExitIndex && events[index][1].type !== "lineEnding") enter = index;
			} else if (index === tailExitIndex || events[index][1].type === "lineEnding") {
				events[enter][1].type = "codeTextData";
				if (index !== enter + 2) {
					events[enter][1].end = events[index - 1][1].end;
					events.splice(enter + 2, index - enter - 2);
					tailExitIndex -= index - enter - 2;
					index = enter + 2;
				}
				enter = void 0;
			}
			return events;
		}
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Previous}
		*/
		function previous(code) {
			return code !== 96 || this.events[this.events.length - 1][1].type === "characterEscape";
		}
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeCodeText(effects, ok, nok) {
			let sizeOpen = 0;
			/** @type {number} */
			let size;
			/** @type {Token} */
			let token;
			return start;
			/**
			* Start of code (text).
			*
			* ```markdown
			* > | `a`
			*     ^
			* > | \`a`
			*      ^
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				effects.enter("codeText");
				effects.enter("codeTextSequence");
				return sequenceOpen(code);
			}
			/**
			* In opening sequence.
			*
			* ```markdown
			* > | `a`
			*     ^
			* ```
			*
			* @type {State}
			*/
			function sequenceOpen(code) {
				if (code === 96) {
					effects.consume(code);
					sizeOpen++;
					return sequenceOpen;
				}
				effects.exit("codeTextSequence");
				return between(code);
			}
			/**
			* Between something and something else.
			*
			* ```markdown
			* > | `a`
			*      ^^
			* ```
			*
			* @type {State}
			*/
			function between(code) {
				if (code === null) return nok(code);
				if (code === 32) {
					effects.enter("space");
					effects.consume(code);
					effects.exit("space");
					return between;
				}
				if (code === 96) {
					token = effects.enter("codeTextSequence");
					size = 0;
					return sequenceClose(code);
				}
				if (markdownLineEnding(code)) {
					effects.enter("lineEnding");
					effects.consume(code);
					effects.exit("lineEnding");
					return between;
				}
				effects.enter("codeTextData");
				return data(code);
			}
			/**
			* In data.
			*
			* ```markdown
			* > | `a`
			*      ^
			* ```
			*
			* @type {State}
			*/
			function data(code) {
				if (code === null || code === 32 || code === 96 || markdownLineEnding(code)) {
					effects.exit("codeTextData");
					return between(code);
				}
				effects.consume(code);
				return data;
			}
			/**
			* In closing sequence.
			*
			* ```markdown
			* > | `a`
			*       ^
			* ```
			*
			* @type {State}
			*/
			function sequenceClose(code) {
				if (code === 96) {
					effects.consume(code);
					size++;
					return sequenceClose;
				}
				if (size === sizeOpen) {
					effects.exit("codeTextSequence");
					effects.exit("codeText");
					return ok(code);
				}
				token.type = "codeTextData";
				return data(code);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-util-subtokenize@2.1.0/node_modules/micromark-util-subtokenize/lib/splice-buffer.js
		/**
		* Some of the internal operations of micromark do lots of editing
		* operations on very large arrays. This runs into problems with two
		* properties of most circa-2020 JavaScript interpreters:
		*
		*  - Array-length modifications at the high end of an array (push/pop) are
		*    expected to be common and are implemented in (amortized) time
		*    proportional to the number of elements added or removed, whereas
		*    other operations (shift/unshift and splice) are much less efficient.
		*  - Function arguments are passed on the stack, so adding tens of thousands
		*    of elements to an array with `arr.push(...newElements)` will frequently
		*    cause stack overflows. (see <https://stackoverflow.com/questions/22123769/rangeerror-maximum-call-stack-size-exceeded-why>)
		*
		* SpliceBuffers are an implementation of gap buffers, which are a
		* generalization of the "queue made of two stacks" idea. The splice buffer
		* maintains a cursor, and moving the cursor has cost proportional to the
		* distance the cursor moves, but inserting, deleting, or splicing in
		* new information at the cursor is as efficient as the push/pop operation.
		* This allows for an efficient sequence of splices (or pushes, pops, shifts,
		* or unshifts) as long such edits happen at the same part of the array or
		* generally sweep through the array from the beginning to the end.
		*
		* The interface for splice buffers also supports large numbers of inputs by
		* passing a single array argument rather passing multiple arguments on the
		* function call stack.
		*
		* @template T
		*   Item type.
		*/
		var SpliceBuffer = class {
			/**
			* @param {ReadonlyArray<T> | null | undefined} [initial]
			*   Initial items (optional).
			* @returns
			*   Splice buffer.
			*/
			constructor(initial) {
				/** @type {Array<T>} */
				this.left = initial ? [...initial] : [];
				/** @type {Array<T>} */
				this.right = [];
			}
			/**
			* Array access;
			* does not move the cursor.
			*
			* @param {number} index
			*   Index.
			* @return {T}
			*   Item.
			*/
			get(index) {
				if (index < 0 || index >= this.left.length + this.right.length) throw new RangeError("Cannot access index `" + index + "` in a splice buffer of size `" + (this.left.length + this.right.length) + "`");
				if (index < this.left.length) return this.left[index];
				return this.right[this.right.length - index + this.left.length - 1];
			}
			/**
			* The length of the splice buffer, one greater than the largest index in the
			* array.
			*/
			get length() {
				return this.left.length + this.right.length;
			}
			/**
			* Remove and return `list[0]`;
			* moves the cursor to `0`.
			*
			* @returns {T | undefined}
			*   Item, optional.
			*/
			shift() {
				this.setCursor(0);
				return this.right.pop();
			}
			/**
			* Slice the buffer to get an array;
			* does not move the cursor.
			*
			* @param {number} start
			*   Start.
			* @param {number | null | undefined} [end]
			*   End (optional).
			* @returns {Array<T>}
			*   Array of items.
			*/
			slice(start, end) {
				/** @type {number} */
				const stop = end === null || end === void 0 ? Number.POSITIVE_INFINITY : end;
				if (stop < this.left.length) return this.left.slice(start, stop);
				if (start > this.left.length) return this.right.slice(this.right.length - stop + this.left.length, this.right.length - start + this.left.length).reverse();
				return this.left.slice(start).concat(this.right.slice(this.right.length - stop + this.left.length).reverse());
			}
			/**
			* Mimics the behavior of Array.prototype.splice() except for the change of
			* interface necessary to avoid segfaults when patching in very large arrays.
			*
			* This operation moves cursor is moved to `start` and results in the cursor
			* placed after any inserted items.
			*
			* @param {number} start
			*   Start;
			*   zero-based index at which to start changing the array;
			*   negative numbers count backwards from the end of the array and values
			*   that are out-of bounds are clamped to the appropriate end of the array.
			* @param {number | null | undefined} [deleteCount=0]
			*   Delete count (default: `0`);
			*   maximum number of elements to delete, starting from start.
			* @param {Array<T> | null | undefined} [items=[]]
			*   Items to include in place of the deleted items (default: `[]`).
			* @return {Array<T>}
			*   Any removed items.
			*/
			splice(start, deleteCount, items) {
				/** @type {number} */
				const count = deleteCount || 0;
				this.setCursor(Math.trunc(start));
				const removed = this.right.splice(this.right.length - count, Number.POSITIVE_INFINITY);
				if (items) chunkedPush(this.left, items);
				return removed.reverse();
			}
			/**
			* Remove and return the highest-numbered item in the array, so
			* `list[list.length - 1]`;
			* Moves the cursor to `length`.
			*
			* @returns {T | undefined}
			*   Item, optional.
			*/
			pop() {
				this.setCursor(Number.POSITIVE_INFINITY);
				return this.left.pop();
			}
			/**
			* Inserts a single item to the high-numbered side of the array;
			* moves the cursor to `length`.
			*
			* @param {T} item
			*   Item.
			* @returns {undefined}
			*   Nothing.
			*/
			push(item) {
				this.setCursor(Number.POSITIVE_INFINITY);
				this.left.push(item);
			}
			/**
			* Inserts many items to the high-numbered side of the array.
			* Moves the cursor to `length`.
			*
			* @param {Array<T>} items
			*   Items.
			* @returns {undefined}
			*   Nothing.
			*/
			pushMany(items) {
				this.setCursor(Number.POSITIVE_INFINITY);
				chunkedPush(this.left, items);
			}
			/**
			* Inserts a single item to the low-numbered side of the array;
			* Moves the cursor to `0`.
			*
			* @param {T} item
			*   Item.
			* @returns {undefined}
			*   Nothing.
			*/
			unshift(item) {
				this.setCursor(0);
				this.right.push(item);
			}
			/**
			* Inserts many items to the low-numbered side of the array;
			* moves the cursor to `0`.
			*
			* @param {Array<T>} items
			*   Items.
			* @returns {undefined}
			*   Nothing.
			*/
			unshiftMany(items) {
				this.setCursor(0);
				chunkedPush(this.right, items.reverse());
			}
			/**
			* Move the cursor to a specific position in the array. Requires
			* time proportional to the distance moved.
			*
			* If `n < 0`, the cursor will end up at the beginning.
			* If `n > length`, the cursor will end up at the end.
			*
			* @param {number} n
			*   Position.
			* @return {undefined}
			*   Nothing.
			*/
			setCursor(n) {
				if (n === this.left.length || n > this.left.length && this.right.length === 0 || n < 0 && this.left.length === 0) return;
				if (n < this.left.length) {
					const removed = this.left.splice(n, Number.POSITIVE_INFINITY);
					chunkedPush(this.right, removed.reverse());
				} else {
					const removed = this.right.splice(this.left.length + this.right.length - n, Number.POSITIVE_INFINITY);
					chunkedPush(this.left, removed.reverse());
				}
			}
		};
		/**
		* Avoid stack overflow by pushing items onto the stack in segments
		*
		* @template T
		*   Item type.
		* @param {Array<T>} list
		*   List to inject into.
		* @param {ReadonlyArray<T>} right
		*   Items to inject.
		* @return {undefined}
		*   Nothing.
		*/
		function chunkedPush(list, right) {
			/** @type {number} */
			let chunkStart = 0;
			if (right.length < 1e4) list.push(...right);
			else while (chunkStart < right.length) {
				list.push(...right.slice(chunkStart, chunkStart + 1e4));
				chunkStart += 1e4;
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-util-subtokenize@2.1.0/node_modules/micromark-util-subtokenize/index.js
		/**
		* @import {Chunk, Event, Token} from 'micromark-util-types'
		*/
		/**
		* Tokenize subcontent.
		*
		* @param {Array<Event>} eventsArray
		*   List of events.
		* @returns {boolean}
		*   Whether subtokens were found.
		*/
		function subtokenize(eventsArray) {
			/** @type {Record<string, number>} */
			const jumps = {};
			let index = -1;
			/** @type {Event} */
			let event;
			/** @type {number | undefined} */
			let lineIndex;
			/** @type {number} */
			let otherIndex;
			/** @type {Event} */
			let otherEvent;
			/** @type {Array<Event>} */
			let parameters;
			/** @type {Array<Event>} */
			let subevents;
			/** @type {boolean | undefined} */
			let more;
			const events = new SpliceBuffer(eventsArray);
			while (++index < events.length) {
				while (index in jumps) index = jumps[index];
				event = events.get(index);
				if (index && event[1].type === "chunkFlow" && events.get(index - 1)[1].type === "listItemPrefix") {
					subevents = event[1]._tokenizer.events;
					otherIndex = 0;
					if (otherIndex < subevents.length && subevents[otherIndex][1].type === "lineEndingBlank") otherIndex += 2;
					if (otherIndex < subevents.length && subevents[otherIndex][1].type === "content") while (++otherIndex < subevents.length) {
						if (subevents[otherIndex][1].type === "content") break;
						if (subevents[otherIndex][1].type === "chunkText") {
							subevents[otherIndex][1]._isInFirstContentOfListItem = true;
							otherIndex++;
						}
					}
				}
				if (event[0] === "enter") {
					if (event[1].contentType) {
						Object.assign(jumps, subcontent(events, index));
						index = jumps[index];
						more = true;
					}
				} else if (event[1]._container) {
					otherIndex = index;
					lineIndex = void 0;
					while (otherIndex--) {
						otherEvent = events.get(otherIndex);
						if (otherEvent[1].type === "lineEnding" || otherEvent[1].type === "lineEndingBlank") {
							if (otherEvent[0] === "enter") {
								if (lineIndex) events.get(lineIndex)[1].type = "lineEndingBlank";
								otherEvent[1].type = "lineEnding";
								lineIndex = otherIndex;
							}
						} else if (otherEvent[1].type === "linePrefix" || otherEvent[1].type === "listItemIndent") {} else break;
					}
					if (lineIndex) {
						event[1].end = { ...events.get(lineIndex)[1].start };
						parameters = events.slice(lineIndex, index);
						parameters.unshift(event);
						events.splice(lineIndex, index - lineIndex + 1, parameters);
					}
				}
			}
			splice(eventsArray, 0, Number.POSITIVE_INFINITY, events.slice(0));
			return !more;
		}
		/**
		* Tokenize embedded tokens.
		*
		* @param {SpliceBuffer<Event>} events
		*   Events.
		* @param {number} eventIndex
		*   Index.
		* @returns {Record<string, number>}
		*   Gaps.
		*/
		function subcontent(events, eventIndex) {
			const token = events.get(eventIndex)[1];
			const context = events.get(eventIndex)[2];
			let startPosition = eventIndex - 1;
			/** @type {Array<number>} */
			const startPositions = [];
			let tokenizer = token._tokenizer;
			if (!tokenizer) {
				tokenizer = context.parser[token.contentType](token.start);
				if (token._contentTypeTextTrailing) tokenizer._contentTypeTextTrailing = true;
			}
			const childEvents = tokenizer.events;
			/** @type {Array<[number, number]>} */
			const jumps = [];
			/** @type {Record<string, number>} */
			const gaps = {};
			/** @type {Array<Chunk>} */
			let stream;
			/** @type {Token | undefined} */
			let previous;
			let index = -1;
			/** @type {Token | undefined} */
			let current = token;
			let adjust = 0;
			let start = 0;
			const breaks = [start];
			while (current) {
				while (events.get(++startPosition)[1] !== current);
				startPositions.push(startPosition);
				if (!current._tokenizer) {
					stream = context.sliceStream(current);
					if (!current.next) stream.push(null);
					if (previous) tokenizer.defineSkip(current.start);
					if (current._isInFirstContentOfListItem) tokenizer._gfmTasklistFirstContentOfListItem = true;
					tokenizer.write(stream);
					if (current._isInFirstContentOfListItem) tokenizer._gfmTasklistFirstContentOfListItem = void 0;
				}
				previous = current;
				current = current.next;
			}
			current = token;
			while (++index < childEvents.length) if (childEvents[index][0] === "exit" && childEvents[index - 1][0] === "enter" && childEvents[index][1].type === childEvents[index - 1][1].type && childEvents[index][1].start.line !== childEvents[index][1].end.line) {
				start = index + 1;
				breaks.push(start);
				current._tokenizer = void 0;
				current.previous = void 0;
				current = current.next;
			}
			tokenizer.events = [];
			if (current) {
				current._tokenizer = void 0;
				current.previous = void 0;
			} else breaks.pop();
			index = breaks.length;
			while (index--) {
				const slice = childEvents.slice(breaks[index], breaks[index + 1]);
				const start = startPositions.pop();
				jumps.push([start, start + slice.length - 1]);
				events.splice(start, 2, slice);
			}
			jumps.reverse();
			index = -1;
			while (++index < jumps.length) {
				gaps[adjust + jumps[index][0]] = adjust + jumps[index][1];
				adjust += jumps[index][1] - jumps[index][0] - 1;
			}
			return gaps;
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/content.js
		/**
		* @import {
		*   Construct,
		*   Resolver,
		*   State,
		*   TokenizeContext,
		*   Tokenizer,
		*   Token
		* } from 'micromark-util-types'
		*/
		/**
		* No name because it must not be turned off.
		* @type {Construct}
		*/
		const content = {
			resolve: resolveContent,
			tokenize: tokenizeContent
		};
		/** @type {Construct} */
		const continuationConstruct = {
			partial: true,
			tokenize: tokenizeContinuation
		};
		/**
		* Content is transparent: it’s parsed right now. That way, definitions are also
		* parsed right now: before text in paragraphs (specifically, media) are parsed.
		*
		* @type {Resolver}
		*/
		function resolveContent(events) {
			subtokenize(events);
			return events;
		}
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeContent(effects, ok) {
			/** @type {Token | undefined} */
			let previous;
			return chunkStart;
			/**
			* Before a content chunk.
			*
			* ```markdown
			* > | abc
			*     ^
			* ```
			*
			* @type {State}
			*/
			function chunkStart(code) {
				effects.enter("content");
				previous = effects.enter("chunkContent", { contentType: "content" });
				return chunkInside(code);
			}
			/**
			* In a content chunk.
			*
			* ```markdown
			* > | abc
			*     ^^^
			* ```
			*
			* @type {State}
			*/
			function chunkInside(code) {
				if (code === null) return contentEnd(code);
				if (markdownLineEnding(code)) return effects.check(continuationConstruct, contentContinue, contentEnd)(code);
				effects.consume(code);
				return chunkInside;
			}
			/**
			*
			*
			* @type {State}
			*/
			function contentEnd(code) {
				effects.exit("chunkContent");
				effects.exit("content");
				return ok(code);
			}
			/**
			*
			*
			* @type {State}
			*/
			function contentContinue(code) {
				effects.consume(code);
				effects.exit("chunkContent");
				previous.next = effects.enter("chunkContent", {
					contentType: "content",
					previous
				});
				previous = previous.next;
				return chunkInside;
			}
		}
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeContinuation(effects, ok, nok) {
			const self = this;
			return startLookahead;
			/**
			*
			*
			* @type {State}
			*/
			function startLookahead(code) {
				effects.exit("chunkContent");
				effects.enter("lineEnding");
				effects.consume(code);
				effects.exit("lineEnding");
				return factorySpace(effects, prefixed, "linePrefix");
			}
			/**
			*
			*
			* @type {State}
			*/
			function prefixed(code) {
				if (code === null || markdownLineEnding(code)) return nok(code);
				const tail = self.events[self.events.length - 1];
				if (!self.parser.constructs.disable.null.includes("codeIndented") && tail && tail[1].type === "linePrefix" && tail[2].sliceSerialize(tail[1], true).length >= 4) return ok(code);
				return effects.interrupt(self.parser.constructs.flow, nok, ok)(code);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-factory-destination@2.0.1/node_modules/micromark-factory-destination/index.js
		/**
		* @import {Effects, State, TokenType} from 'micromark-util-types'
		*/
		/**
		* Parse destinations.
		*
		* ###### Examples
		*
		* ```markdown
		* <a>
		* <a\>b>
		* <a b>
		* <a)>
		* a
		* a\)b
		* a(b)c
		* a(b)
		* ```
		*
		* @param {Effects} effects
		*   Context.
		* @param {State} ok
		*   State switched to when successful.
		* @param {State} nok
		*   State switched to when unsuccessful.
		* @param {TokenType} type
		*   Type for whole (`<a>` or `b`).
		* @param {TokenType} literalType
		*   Type when enclosed (`<a>`).
		* @param {TokenType} literalMarkerType
		*   Type for enclosing (`<` and `>`).
		* @param {TokenType} rawType
		*   Type when not enclosed (`b`).
		* @param {TokenType} stringType
		*   Type for the value (`a` or `b`).
		* @param {number | undefined} [max=Infinity]
		*   Depth of nested parens (inclusive).
		* @returns {State}
		*   Start state.
		*/
		function factoryDestination(effects, ok, nok, type, literalType, literalMarkerType, rawType, stringType, max) {
			const limit = max || Number.POSITIVE_INFINITY;
			let balance = 0;
			return start;
			/**
			* Start of destination.
			*
			* ```markdown
			* > | <aa>
			*     ^
			* > | aa
			*     ^
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				if (code === 60) {
					effects.enter(type);
					effects.enter(literalType);
					effects.enter(literalMarkerType);
					effects.consume(code);
					effects.exit(literalMarkerType);
					return enclosedBefore;
				}
				if (code === null || code === 32 || code === 41 || asciiControl(code)) return nok(code);
				effects.enter(type);
				effects.enter(rawType);
				effects.enter(stringType);
				effects.enter("chunkString", { contentType: "string" });
				return raw(code);
			}
			/**
			* After `<`, at an enclosed destination.
			*
			* ```markdown
			* > | <aa>
			*      ^
			* ```
			*
			* @type {State}
			*/
			function enclosedBefore(code) {
				if (code === 62) {
					effects.enter(literalMarkerType);
					effects.consume(code);
					effects.exit(literalMarkerType);
					effects.exit(literalType);
					effects.exit(type);
					return ok;
				}
				effects.enter(stringType);
				effects.enter("chunkString", { contentType: "string" });
				return enclosed(code);
			}
			/**
			* In enclosed destination.
			*
			* ```markdown
			* > | <aa>
			*      ^
			* ```
			*
			* @type {State}
			*/
			function enclosed(code) {
				if (code === 62) {
					effects.exit("chunkString");
					effects.exit(stringType);
					return enclosedBefore(code);
				}
				if (code === null || code === 60 || markdownLineEnding(code)) return nok(code);
				effects.consume(code);
				return code === 92 ? enclosedEscape : enclosed;
			}
			/**
			* After `\`, at a special character.
			*
			* ```markdown
			* > | <a\*a>
			*        ^
			* ```
			*
			* @type {State}
			*/
			function enclosedEscape(code) {
				if (code === 60 || code === 62 || code === 92) {
					effects.consume(code);
					return enclosed;
				}
				return enclosed(code);
			}
			/**
			* In raw destination.
			*
			* ```markdown
			* > | aa
			*     ^
			* ```
			*
			* @type {State}
			*/
			function raw(code) {
				if (!balance && (code === null || code === 41 || markdownLineEndingOrSpace(code))) {
					effects.exit("chunkString");
					effects.exit(stringType);
					effects.exit(rawType);
					effects.exit(type);
					return ok(code);
				}
				if (balance < limit && code === 40) {
					effects.consume(code);
					balance++;
					return raw;
				}
				if (code === 41) {
					effects.consume(code);
					balance--;
					return raw;
				}
				if (code === null || code === 32 || code === 40 || asciiControl(code)) return nok(code);
				effects.consume(code);
				return code === 92 ? rawEscape : raw;
			}
			/**
			* After `\`, at special character.
			*
			* ```markdown
			* > | a\*a
			*       ^
			* ```
			*
			* @type {State}
			*/
			function rawEscape(code) {
				if (code === 40 || code === 41 || code === 92) {
					effects.consume(code);
					return raw;
				}
				return raw(code);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-factory-label@2.0.1/node_modules/micromark-factory-label/index.js
		/**
		* @import {
		*   Effects,
		*   State,
		*   TokenizeContext,
		*   TokenType
		* } from 'micromark-util-types'
		*/
		/**
		* Parse labels.
		*
		* > 👉 **Note**: labels in markdown are capped at 999 characters in the string.
		*
		* ###### Examples
		*
		* ```markdown
		* [a]
		* [a
		* b]
		* [a\]b]
		* ```
		*
		* @this {TokenizeContext}
		*   Tokenize context.
		* @param {Effects} effects
		*   Context.
		* @param {State} ok
		*   State switched to when successful.
		* @param {State} nok
		*   State switched to when unsuccessful.
		* @param {TokenType} type
		*   Type of the whole label (`[a]`).
		* @param {TokenType} markerType
		*   Type for the markers (`[` and `]`).
		* @param {TokenType} stringType
		*   Type for the identifier (`a`).
		* @returns {State}
		*   Start state.
		*/
		function factoryLabel(effects, ok, nok, type, markerType, stringType) {
			const self = this;
			let size = 0;
			/** @type {boolean} */
			let seen;
			return start;
			/**
			* Start of label.
			*
			* ```markdown
			* > | [a]
			*     ^
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				effects.enter(type);
				effects.enter(markerType);
				effects.consume(code);
				effects.exit(markerType);
				effects.enter(stringType);
				return atBreak;
			}
			/**
			* In label, at something, before something else.
			*
			* ```markdown
			* > | [a]
			*      ^
			* ```
			*
			* @type {State}
			*/
			function atBreak(code) {
				if (size > 999 || code === null || code === 91 || code === 93 && !seen || 
				/* c8 ignore next 3 */
				code === 94 && !size && "_hiddenFootnoteSupport" in self.parser.constructs) return nok(code);
				if (code === 93) {
					effects.exit(stringType);
					effects.enter(markerType);
					effects.consume(code);
					effects.exit(markerType);
					effects.exit(type);
					return ok;
				}
				if (markdownLineEnding(code)) {
					effects.enter("lineEnding");
					effects.consume(code);
					effects.exit("lineEnding");
					return atBreak;
				}
				effects.enter("chunkString", { contentType: "string" });
				return labelInside(code);
			}
			/**
			* In label, in text.
			*
			* ```markdown
			* > | [a]
			*      ^
			* ```
			*
			* @type {State}
			*/
			function labelInside(code) {
				if (code === null || code === 91 || code === 93 || markdownLineEnding(code) || size++ > 999) {
					effects.exit("chunkString");
					return atBreak(code);
				}
				effects.consume(code);
				if (!seen) seen = !markdownSpace(code);
				return code === 92 ? labelEscape : labelInside;
			}
			/**
			* After `\`, at a special character.
			*
			* ```markdown
			* > | [a\*a]
			*        ^
			* ```
			*
			* @type {State}
			*/
			function labelEscape(code) {
				if (code === 91 || code === 92 || code === 93) {
					effects.consume(code);
					size++;
					return labelInside;
				}
				return labelInside(code);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-factory-title@2.0.1/node_modules/micromark-factory-title/index.js
		/**
		* @import {
		*   Code,
		*   Effects,
		*   State,
		*   TokenType
		* } from 'micromark-util-types'
		*/
		/**
		* Parse titles.
		*
		* ###### Examples
		*
		* ```markdown
		* "a"
		* 'b'
		* (c)
		* "a
		* b"
		* 'a
		*     b'
		* (a\)b)
		* ```
		*
		* @param {Effects} effects
		*   Context.
		* @param {State} ok
		*   State switched to when successful.
		* @param {State} nok
		*   State switched to when unsuccessful.
		* @param {TokenType} type
		*   Type of the whole title (`"a"`, `'b'`, `(c)`).
		* @param {TokenType} markerType
		*   Type for the markers (`"`, `'`, `(`, and `)`).
		* @param {TokenType} stringType
		*   Type for the value (`a`).
		* @returns {State}
		*   Start state.
		*/
		function factoryTitle(effects, ok, nok, type, markerType, stringType) {
			/** @type {NonNullable<Code>} */
			let marker;
			return start;
			/**
			* Start of title.
			*
			* ```markdown
			* > | "a"
			*     ^
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				if (code === 34 || code === 39 || code === 40) {
					effects.enter(type);
					effects.enter(markerType);
					effects.consume(code);
					effects.exit(markerType);
					marker = code === 40 ? 41 : code;
					return begin;
				}
				return nok(code);
			}
			/**
			* After opening marker.
			*
			* This is also used at the closing marker.
			*
			* ```markdown
			* > | "a"
			*      ^
			* ```
			*
			* @type {State}
			*/
			function begin(code) {
				if (code === marker) {
					effects.enter(markerType);
					effects.consume(code);
					effects.exit(markerType);
					effects.exit(type);
					return ok;
				}
				effects.enter(stringType);
				return atBreak(code);
			}
			/**
			* At something, before something else.
			*
			* ```markdown
			* > | "a"
			*      ^
			* ```
			*
			* @type {State}
			*/
			function atBreak(code) {
				if (code === marker) {
					effects.exit(stringType);
					return begin(marker);
				}
				if (code === null) return nok(code);
				if (markdownLineEnding(code)) {
					effects.enter("lineEnding");
					effects.consume(code);
					effects.exit("lineEnding");
					return factorySpace(effects, atBreak, "linePrefix");
				}
				effects.enter("chunkString", { contentType: "string" });
				return inside(code);
			}
			/**
			*
			*
			* @type {State}
			*/
			function inside(code) {
				if (code === marker || code === null || markdownLineEnding(code)) {
					effects.exit("chunkString");
					return atBreak(code);
				}
				effects.consume(code);
				return code === 92 ? escape : inside;
			}
			/**
			* After `\`, at a special character.
			*
			* ```markdown
			* > | "a\*b"
			*      ^
			* ```
			*
			* @type {State}
			*/
			function escape(code) {
				if (code === marker || code === 92) {
					effects.consume(code);
					return inside;
				}
				return inside(code);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-factory-whitespace@2.0.1/node_modules/micromark-factory-whitespace/index.js
		/**
		* @import {Effects, State} from 'micromark-util-types'
		*/
		/**
		* Parse spaces and tabs.
		*
		* There is no `nok` parameter:
		*
		* *   line endings or spaces in markdown are often optional, in which case this
		*     factory can be used and `ok` will be switched to whether spaces were found
		*     or not
		* *   one line ending or space can be detected with
		*     `markdownLineEndingOrSpace(code)` right before using `factoryWhitespace`
		*
		* @param {Effects} effects
		*   Context.
		* @param {State} ok
		*   State switched to when successful.
		* @returns {State}
		*   Start state.
		*/
		function factoryWhitespace(effects, ok) {
			/** @type {boolean} */
			let seen;
			return start;
			/** @type {State} */
			function start(code) {
				if (markdownLineEnding(code)) {
					effects.enter("lineEnding");
					effects.consume(code);
					effects.exit("lineEnding");
					seen = true;
					return start;
				}
				if (markdownSpace(code)) return factorySpace(effects, start, seen ? "linePrefix" : "lineSuffix")(code);
				return ok(code);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/definition.js
		/**
		* @import {
		*   Construct,
		*   State,
		*   TokenizeContext,
		*   Tokenizer
		* } from 'micromark-util-types'
		*/
		/** @type {Construct} */
		const definition = {
			name: "definition",
			tokenize: tokenizeDefinition
		};
		/** @type {Construct} */
		const titleBefore = {
			partial: true,
			tokenize: tokenizeTitleBefore
		};
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeDefinition(effects, ok, nok) {
			const self = this;
			/** @type {string} */
			let identifier;
			return start;
			/**
			* At start of a definition.
			*
			* ```markdown
			* > | [a]: b "c"
			*     ^
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				effects.enter("definition");
				return before(code);
			}
			/**
			* After optional whitespace, at `[`.
			*
			* ```markdown
			* > | [a]: b "c"
			*     ^
			* ```
			*
			* @type {State}
			*/
			function before(code) {
				return factoryLabel.call(self, effects, labelAfter, nok, "definitionLabel", "definitionLabelMarker", "definitionLabelString")(code);
			}
			/**
			* After label.
			*
			* ```markdown
			* > | [a]: b "c"
			*        ^
			* ```
			*
			* @type {State}
			*/
			function labelAfter(code) {
				identifier = normalizeIdentifier(self.sliceSerialize(self.events[self.events.length - 1][1]).slice(1, -1));
				if (code === 58) {
					effects.enter("definitionMarker");
					effects.consume(code);
					effects.exit("definitionMarker");
					return markerAfter;
				}
				return nok(code);
			}
			/**
			* After marker.
			*
			* ```markdown
			* > | [a]: b "c"
			*         ^
			* ```
			*
			* @type {State}
			*/
			function markerAfter(code) {
				return markdownLineEndingOrSpace(code) ? factoryWhitespace(effects, destinationBefore)(code) : destinationBefore(code);
			}
			/**
			* Before destination.
			*
			* ```markdown
			* > | [a]: b "c"
			*          ^
			* ```
			*
			* @type {State}
			*/
			function destinationBefore(code) {
				return factoryDestination(effects, destinationAfter, nok, "definitionDestination", "definitionDestinationLiteral", "definitionDestinationLiteralMarker", "definitionDestinationRaw", "definitionDestinationString")(code);
			}
			/**
			* After destination.
			*
			* ```markdown
			* > | [a]: b "c"
			*           ^
			* ```
			*
			* @type {State}
			*/
			function destinationAfter(code) {
				return effects.attempt(titleBefore, after, after)(code);
			}
			/**
			* After definition.
			*
			* ```markdown
			* > | [a]: b
			*           ^
			* > | [a]: b "c"
			*               ^
			* ```
			*
			* @type {State}
			*/
			function after(code) {
				return markdownSpace(code) ? factorySpace(effects, afterWhitespace, "whitespace")(code) : afterWhitespace(code);
			}
			/**
			* After definition, after optional whitespace.
			*
			* ```markdown
			* > | [a]: b
			*           ^
			* > | [a]: b "c"
			*               ^
			* ```
			*
			* @type {State}
			*/
			function afterWhitespace(code) {
				if (code === null || markdownLineEnding(code)) {
					effects.exit("definition");
					self.parser.defined.push(identifier);
					return ok(code);
				}
				return nok(code);
			}
		}
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeTitleBefore(effects, ok, nok) {
			return titleBefore;
			/**
			* After destination, at whitespace.
			*
			* ```markdown
			* > | [a]: b
			*           ^
			* > | [a]: b "c"
			*           ^
			* ```
			*
			* @type {State}
			*/
			function titleBefore(code) {
				return markdownLineEndingOrSpace(code) ? factoryWhitespace(effects, beforeMarker)(code) : nok(code);
			}
			/**
			* At title.
			*
			* ```markdown
			*   | [a]: b
			* > | "c"
			*     ^
			* ```
			*
			* @type {State}
			*/
			function beforeMarker(code) {
				return factoryTitle(effects, titleAfter, nok, "definitionTitle", "definitionTitleMarker", "definitionTitleString")(code);
			}
			/**
			* After title.
			*
			* ```markdown
			* > | [a]: b "c"
			*               ^
			* ```
			*
			* @type {State}
			*/
			function titleAfter(code) {
				return markdownSpace(code) ? factorySpace(effects, titleAfterOptionalWhitespace, "whitespace")(code) : titleAfterOptionalWhitespace(code);
			}
			/**
			* After title, after optional whitespace.
			*
			* ```markdown
			* > | [a]: b "c"
			*               ^
			* ```
			*
			* @type {State}
			*/
			function titleAfterOptionalWhitespace(code) {
				return code === null || markdownLineEnding(code) ? ok(code) : nok(code);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/hard-break-escape.js
		/**
		* @import {
		*   Construct,
		*   State,
		*   TokenizeContext,
		*   Tokenizer
		* } from 'micromark-util-types'
		*/
		/** @type {Construct} */
		const hardBreakEscape = {
			name: "hardBreakEscape",
			tokenize: tokenizeHardBreakEscape
		};
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeHardBreakEscape(effects, ok, nok) {
			return start;
			/**
			* Start of a hard break (escape).
			*
			* ```markdown
			* > | a\
			*      ^
			*   | b
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				effects.enter("hardBreakEscape");
				effects.consume(code);
				return after;
			}
			/**
			* After `\`, at eol.
			*
			* ```markdown
			* > | a\
			*       ^
			*   | b
			* ```
			*
			*  @type {State}
			*/
			function after(code) {
				if (markdownLineEnding(code)) {
					effects.exit("hardBreakEscape");
					return ok(code);
				}
				return nok(code);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/heading-atx.js
		/**
		* @import {
		*   Construct,
		*   Resolver,
		*   State,
		*   TokenizeContext,
		*   Tokenizer,
		*   Token
		* } from 'micromark-util-types'
		*/
		/** @type {Construct} */
		const headingAtx = {
			name: "headingAtx",
			resolve: resolveHeadingAtx,
			tokenize: tokenizeHeadingAtx
		};
		/** @type {Resolver} */
		function resolveHeadingAtx(events, context) {
			let contentEnd = events.length - 2;
			let contentStart = 3;
			if (events[contentStart][1].type === "whitespace") contentStart += 2;
			if (contentEnd - 2 > contentStart && events[contentEnd][1].type === "whitespace") contentEnd -= 2;
			if (events[contentEnd][1].type === "atxHeadingSequence" && (contentStart === contentEnd - 1 || contentEnd - 4 > contentStart && events[contentEnd - 2][1].type === "whitespace")) contentEnd -= contentStart + 1 === contentEnd ? 2 : 4;
			if (contentEnd > contentStart) {
				const content = {
					type: "atxHeadingText",
					start: events[contentStart][1].start,
					end: events[contentEnd][1].end
				};
				const text = {
					type: "chunkText",
					start: events[contentStart][1].start,
					end: events[contentEnd][1].end,
					contentType: "text"
				};
				splice(events, contentStart, contentEnd - contentStart + 1, [
					[
						"enter",
						content,
						context
					],
					[
						"enter",
						text,
						context
					],
					[
						"exit",
						text,
						context
					],
					[
						"exit",
						content,
						context
					]
				]);
			}
			return events;
		}
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeHeadingAtx(effects, ok, nok) {
			let size = 0;
			return start;
			/**
			* Start of a heading (atx).
			*
			* ```markdown
			* > | ## aa
			*     ^
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				effects.enter("atxHeading");
				return before(code);
			}
			/**
			* After optional whitespace, at `#`.
			*
			* ```markdown
			* > | ## aa
			*     ^
			* ```
			*
			* @type {State}
			*/
			function before(code) {
				effects.enter("atxHeadingSequence");
				return sequenceOpen(code);
			}
			/**
			* In opening sequence.
			*
			* ```markdown
			* > | ## aa
			*     ^
			* ```
			*
			* @type {State}
			*/
			function sequenceOpen(code) {
				if (code === 35 && size++ < 6) {
					effects.consume(code);
					return sequenceOpen;
				}
				if (code === null || markdownLineEndingOrSpace(code)) {
					effects.exit("atxHeadingSequence");
					return atBreak(code);
				}
				return nok(code);
			}
			/**
			* After something, before something else.
			*
			* ```markdown
			* > | ## aa
			*       ^
			* ```
			*
			* @type {State}
			*/
			function atBreak(code) {
				if (code === 35) {
					effects.enter("atxHeadingSequence");
					return sequenceFurther(code);
				}
				if (code === null || markdownLineEnding(code)) {
					effects.exit("atxHeading");
					return ok(code);
				}
				if (markdownSpace(code)) return factorySpace(effects, atBreak, "whitespace")(code);
				effects.enter("atxHeadingText");
				return data(code);
			}
			/**
			* In further sequence (after whitespace).
			*
			* Could be normal “visible” hashes in the heading or a final sequence.
			*
			* ```markdown
			* > | ## aa ##
			*           ^
			* ```
			*
			* @type {State}
			*/
			function sequenceFurther(code) {
				if (code === 35) {
					effects.consume(code);
					return sequenceFurther;
				}
				effects.exit("atxHeadingSequence");
				return atBreak(code);
			}
			/**
			* In text.
			*
			* ```markdown
			* > | ## aa
			*        ^
			* ```
			*
			* @type {State}
			*/
			function data(code) {
				if (code === null || code === 35 || markdownLineEndingOrSpace(code)) {
					effects.exit("atxHeadingText");
					return atBreak(code);
				}
				effects.consume(code);
				return data;
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-util-html-tag-name@2.0.1/node_modules/micromark-util-html-tag-name/index.js
		/**
		* List of lowercase HTML “block” tag names.
		*
		* The list, when parsing HTML (flow), results in more relaxed rules (condition
		* 6).
		* Because they are known blocks, the HTML-like syntax doesn’t have to be
		* strictly parsed.
		* For tag names not in this list, a more strict algorithm (condition 7) is used
		* to detect whether the HTML-like syntax is seen as HTML (flow) or not.
		*
		* This is copied from:
		* <https://spec.commonmark.org/0.30/#html-blocks>.
		*
		* > 👉 **Note**: `search` was added in `CommonMark@0.31`.
		*/
		const htmlBlockNames = [
			"address",
			"article",
			"aside",
			"base",
			"basefont",
			"blockquote",
			"body",
			"caption",
			"center",
			"col",
			"colgroup",
			"dd",
			"details",
			"dialog",
			"dir",
			"div",
			"dl",
			"dt",
			"fieldset",
			"figcaption",
			"figure",
			"footer",
			"form",
			"frame",
			"frameset",
			"h1",
			"h2",
			"h3",
			"h4",
			"h5",
			"h6",
			"head",
			"header",
			"hr",
			"html",
			"iframe",
			"legend",
			"li",
			"link",
			"main",
			"menu",
			"menuitem",
			"nav",
			"noframes",
			"ol",
			"optgroup",
			"option",
			"p",
			"param",
			"search",
			"section",
			"summary",
			"table",
			"tbody",
			"td",
			"tfoot",
			"th",
			"thead",
			"title",
			"tr",
			"track",
			"ul"
		];
		/**
		* List of lowercase HTML “raw” tag names.
		*
		* The list, when parsing HTML (flow), results in HTML that can include lines
		* without exiting, until a closing tag also in this list is found (condition
		* 1).
		*
		* This module is copied from:
		* <https://spec.commonmark.org/0.30/#html-blocks>.
		*
		* > 👉 **Note**: `textarea` was added in `CommonMark@0.30`.
		*/
		const htmlRawNames = [
			"pre",
			"script",
			"style",
			"textarea"
		];
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/html-flow.js
		/**
		* @import {
		*   Code,
		*   Construct,
		*   Resolver,
		*   State,
		*   TokenizeContext,
		*   Tokenizer
		* } from 'micromark-util-types'
		*/
		/** @type {Construct} */
		const htmlFlow = {
			concrete: true,
			name: "htmlFlow",
			resolveTo: resolveToHtmlFlow,
			tokenize: tokenizeHtmlFlow
		};
		/** @type {Construct} */
		const blankLineBefore = {
			partial: true,
			tokenize: tokenizeBlankLineBefore
		};
		/** @type {Resolver} */
		function resolveToHtmlFlow(events) {
			let index = events.length;
			while (index--) if (events[index][0] === "enter" && events[index][1].type === "htmlFlow") break;
			if (index > 1 && events[index - 2][1].type === "linePrefix") {
				events[index][1].start = events[index - 2][1].start;
				events[index + 1][1].start = events[index - 2][1].start;
				events.splice(index - 2, 2);
			}
			return events;
		}
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeHtmlFlow(effects, ok, nok) {
			const self = this;
			/** @type {number} */
			let marker;
			/** @type {boolean} */
			let closingTag;
			/** @type {string} */
			let buffer;
			/** @type {number} */
			let index;
			/** @type {Code} */
			let markerB;
			return start;
			/**
			* Start of HTML (flow).
			*
			* ```markdown
			* > | <x />
			*     ^
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				return before(code);
			}
			/**
			* At `<`, after optional whitespace.
			*
			* ```markdown
			* > | <x />
			*     ^
			* ```
			*
			* @type {State}
			*/
			function before(code) {
				effects.enter("htmlFlow");
				effects.enter("htmlFlowData");
				effects.consume(code);
				return open;
			}
			/**
			* After `<`, at tag name or other stuff.
			*
			* ```markdown
			* > | <x />
			*      ^
			* > | <!doctype>
			*      ^
			* > | <!--xxx-->
			*      ^
			* ```
			*
			* @type {State}
			*/
			function open(code) {
				if (code === 33) {
					effects.consume(code);
					return declarationOpen;
				}
				if (code === 47) {
					effects.consume(code);
					closingTag = true;
					return tagCloseStart;
				}
				if (code === 63) {
					effects.consume(code);
					marker = 3;
					return self.interrupt ? ok : continuationDeclarationInside;
				}
				if (asciiAlpha(code)) {
					effects.consume(code);
					buffer = String.fromCharCode(code);
					return tagName;
				}
				return nok(code);
			}
			/**
			* After `<!`, at declaration, comment, or CDATA.
			*
			* ```markdown
			* > | <!doctype>
			*       ^
			* > | <!--xxx-->
			*       ^
			* > | <![CDATA[>&<]]>
			*       ^
			* ```
			*
			* @type {State}
			*/
			function declarationOpen(code) {
				if (code === 45) {
					effects.consume(code);
					marker = 2;
					return commentOpenInside;
				}
				if (code === 91) {
					effects.consume(code);
					marker = 5;
					index = 0;
					return cdataOpenInside;
				}
				if (asciiAlpha(code)) {
					effects.consume(code);
					marker = 4;
					return self.interrupt ? ok : continuationDeclarationInside;
				}
				return nok(code);
			}
			/**
			* After `<!-`, inside a comment, at another `-`.
			*
			* ```markdown
			* > | <!--xxx-->
			*        ^
			* ```
			*
			* @type {State}
			*/
			function commentOpenInside(code) {
				if (code === 45) {
					effects.consume(code);
					return self.interrupt ? ok : continuationDeclarationInside;
				}
				return nok(code);
			}
			/**
			* After `<![`, inside CDATA, expecting `CDATA[`.
			*
			* ```markdown
			* > | <![CDATA[>&<]]>
			*        ^^^^^^
			* ```
			*
			* @type {State}
			*/
			function cdataOpenInside(code) {
				if (code === "CDATA[".charCodeAt(index++)) {
					effects.consume(code);
					if (index === 6) return self.interrupt ? ok : continuation;
					return cdataOpenInside;
				}
				return nok(code);
			}
			/**
			* After `</`, in closing tag, at tag name.
			*
			* ```markdown
			* > | </x>
			*       ^
			* ```
			*
			* @type {State}
			*/
			function tagCloseStart(code) {
				if (asciiAlpha(code)) {
					effects.consume(code);
					buffer = String.fromCharCode(code);
					return tagName;
				}
				return nok(code);
			}
			/**
			* In tag name.
			*
			* ```markdown
			* > | <ab>
			*      ^^
			* > | </ab>
			*       ^^
			* ```
			*
			* @type {State}
			*/
			function tagName(code) {
				if (code === null || code === 47 || code === 62 || markdownLineEndingOrSpace(code)) {
					const slash = code === 47;
					const name = buffer.toLowerCase();
					if (!slash && !closingTag && htmlRawNames.includes(name)) {
						marker = 1;
						return self.interrupt ? ok(code) : continuation(code);
					}
					if (htmlBlockNames.includes(buffer.toLowerCase())) {
						marker = 6;
						if (slash) {
							effects.consume(code);
							return basicSelfClosing;
						}
						return self.interrupt ? ok(code) : continuation(code);
					}
					marker = 7;
					return self.interrupt && !self.parser.lazy[self.now().line] ? nok(code) : closingTag ? completeClosingTagAfter(code) : completeAttributeNameBefore(code);
				}
				if (code === 45 || asciiAlphanumeric(code)) {
					effects.consume(code);
					buffer += String.fromCharCode(code);
					return tagName;
				}
				return nok(code);
			}
			/**
			* After closing slash of a basic tag name.
			*
			* ```markdown
			* > | <div/>
			*          ^
			* ```
			*
			* @type {State}
			*/
			function basicSelfClosing(code) {
				if (code === 62) {
					effects.consume(code);
					return self.interrupt ? ok : continuation;
				}
				return nok(code);
			}
			/**
			* After closing slash of a complete tag name.
			*
			* ```markdown
			* > | <x/>
			*        ^
			* ```
			*
			* @type {State}
			*/
			function completeClosingTagAfter(code) {
				if (markdownSpace(code)) {
					effects.consume(code);
					return completeClosingTagAfter;
				}
				return completeEnd(code);
			}
			/**
			* At an attribute name.
			*
			* At first, this state is used after a complete tag name, after whitespace,
			* where it expects optional attributes or the end of the tag.
			* It is also reused after attributes, when expecting more optional
			* attributes.
			*
			* ```markdown
			* > | <a />
			*        ^
			* > | <a :b>
			*        ^
			* > | <a _b>
			*        ^
			* > | <a b>
			*        ^
			* > | <a >
			*        ^
			* ```
			*
			* @type {State}
			*/
			function completeAttributeNameBefore(code) {
				if (code === 47) {
					effects.consume(code);
					return completeEnd;
				}
				if (code === 58 || code === 95 || asciiAlpha(code)) {
					effects.consume(code);
					return completeAttributeName;
				}
				if (markdownSpace(code)) {
					effects.consume(code);
					return completeAttributeNameBefore;
				}
				return completeEnd(code);
			}
			/**
			* In attribute name.
			*
			* ```markdown
			* > | <a :b>
			*         ^
			* > | <a _b>
			*         ^
			* > | <a b>
			*         ^
			* ```
			*
			* @type {State}
			*/
			function completeAttributeName(code) {
				if (code === 45 || code === 46 || code === 58 || code === 95 || asciiAlphanumeric(code)) {
					effects.consume(code);
					return completeAttributeName;
				}
				return completeAttributeNameAfter(code);
			}
			/**
			* After attribute name, at an optional initializer, the end of the tag, or
			* whitespace.
			*
			* ```markdown
			* > | <a b>
			*         ^
			* > | <a b=c>
			*         ^
			* ```
			*
			* @type {State}
			*/
			function completeAttributeNameAfter(code) {
				if (code === 61) {
					effects.consume(code);
					return completeAttributeValueBefore;
				}
				if (markdownSpace(code)) {
					effects.consume(code);
					return completeAttributeNameAfter;
				}
				return completeAttributeNameBefore(code);
			}
			/**
			* Before unquoted, double quoted, or single quoted attribute value, allowing
			* whitespace.
			*
			* ```markdown
			* > | <a b=c>
			*          ^
			* > | <a b="c">
			*          ^
			* ```
			*
			* @type {State}
			*/
			function completeAttributeValueBefore(code) {
				if (code === null || code === 60 || code === 61 || code === 62 || code === 96) return nok(code);
				if (code === 34 || code === 39) {
					effects.consume(code);
					markerB = code;
					return completeAttributeValueQuoted;
				}
				if (markdownSpace(code)) {
					effects.consume(code);
					return completeAttributeValueBefore;
				}
				return completeAttributeValueUnquoted(code);
			}
			/**
			* In double or single quoted attribute value.
			*
			* ```markdown
			* > | <a b="c">
			*           ^
			* > | <a b='c'>
			*           ^
			* ```
			*
			* @type {State}
			*/
			function completeAttributeValueQuoted(code) {
				if (code === markerB) {
					effects.consume(code);
					markerB = null;
					return completeAttributeValueQuotedAfter;
				}
				if (code === null || markdownLineEnding(code)) return nok(code);
				effects.consume(code);
				return completeAttributeValueQuoted;
			}
			/**
			* In unquoted attribute value.
			*
			* ```markdown
			* > | <a b=c>
			*          ^
			* ```
			*
			* @type {State}
			*/
			function completeAttributeValueUnquoted(code) {
				if (code === null || code === 34 || code === 39 || code === 47 || code === 60 || code === 61 || code === 62 || code === 96 || markdownLineEndingOrSpace(code)) return completeAttributeNameAfter(code);
				effects.consume(code);
				return completeAttributeValueUnquoted;
			}
			/**
			* After double or single quoted attribute value, before whitespace or the
			* end of the tag.
			*
			* ```markdown
			* > | <a b="c">
			*            ^
			* ```
			*
			* @type {State}
			*/
			function completeAttributeValueQuotedAfter(code) {
				if (code === 47 || code === 62 || markdownSpace(code)) return completeAttributeNameBefore(code);
				return nok(code);
			}
			/**
			* In certain circumstances of a complete tag where only an `>` is allowed.
			*
			* ```markdown
			* > | <a b="c">
			*             ^
			* ```
			*
			* @type {State}
			*/
			function completeEnd(code) {
				if (code === 62) {
					effects.consume(code);
					return completeAfter;
				}
				return nok(code);
			}
			/**
			* After `>` in a complete tag.
			*
			* ```markdown
			* > | <x>
			*        ^
			* ```
			*
			* @type {State}
			*/
			function completeAfter(code) {
				if (code === null || markdownLineEnding(code)) return continuation(code);
				if (markdownSpace(code)) {
					effects.consume(code);
					return completeAfter;
				}
				return nok(code);
			}
			/**
			* In continuation of any HTML kind.
			*
			* ```markdown
			* > | <!--xxx-->
			*          ^
			* ```
			*
			* @type {State}
			*/
			function continuation(code) {
				if (code === 45 && marker === 2) {
					effects.consume(code);
					return continuationCommentInside;
				}
				if (code === 60 && marker === 1) {
					effects.consume(code);
					return continuationRawTagOpen;
				}
				if (code === 62 && marker === 4) {
					effects.consume(code);
					return continuationClose;
				}
				if (code === 63 && marker === 3) {
					effects.consume(code);
					return continuationDeclarationInside;
				}
				if (code === 93 && marker === 5) {
					effects.consume(code);
					return continuationCdataInside;
				}
				if (markdownLineEnding(code) && (marker === 6 || marker === 7)) {
					effects.exit("htmlFlowData");
					return effects.check(blankLineBefore, continuationAfter, continuationStart)(code);
				}
				if (code === null || markdownLineEnding(code)) {
					effects.exit("htmlFlowData");
					return continuationStart(code);
				}
				effects.consume(code);
				return continuation;
			}
			/**
			* In continuation, at eol.
			*
			* ```markdown
			* > | <x>
			*        ^
			*   | asd
			* ```
			*
			* @type {State}
			*/
			function continuationStart(code) {
				return effects.check(nonLazyContinuation, continuationStartNonLazy, continuationAfter)(code);
			}
			/**
			* In continuation, at eol, before non-lazy content.
			*
			* ```markdown
			* > | <x>
			*        ^
			*   | asd
			* ```
			*
			* @type {State}
			*/
			function continuationStartNonLazy(code) {
				effects.enter("lineEnding");
				effects.consume(code);
				effects.exit("lineEnding");
				return continuationBefore;
			}
			/**
			* In continuation, before non-lazy content.
			*
			* ```markdown
			*   | <x>
			* > | asd
			*     ^
			* ```
			*
			* @type {State}
			*/
			function continuationBefore(code) {
				if (code === null || markdownLineEnding(code)) return continuationStart(code);
				effects.enter("htmlFlowData");
				return continuation(code);
			}
			/**
			* In comment continuation, after one `-`, expecting another.
			*
			* ```markdown
			* > | <!--xxx-->
			*             ^
			* ```
			*
			* @type {State}
			*/
			function continuationCommentInside(code) {
				if (code === 45) {
					effects.consume(code);
					return continuationDeclarationInside;
				}
				return continuation(code);
			}
			/**
			* In raw continuation, after `<`, at `/`.
			*
			* ```markdown
			* > | <script>console.log(1)<\/script>
			*                            ^
			* ```
			*
			* @type {State}
			*/
			function continuationRawTagOpen(code) {
				if (code === 47) {
					effects.consume(code);
					buffer = "";
					return continuationRawEndTag;
				}
				return continuation(code);
			}
			/**
			* In raw continuation, after `</`, in a raw tag name.
			*
			* ```markdown
			* > | <script>console.log(1)<\/script>
			*                             ^^^^^^
			* ```
			*
			* @type {State}
			*/
			function continuationRawEndTag(code) {
				if (code === 62) {
					const name = buffer.toLowerCase();
					if (htmlRawNames.includes(name)) {
						effects.consume(code);
						return continuationClose;
					}
					return continuation(code);
				}
				if (asciiAlpha(code) && buffer.length < 8) {
					effects.consume(code);
					buffer += String.fromCharCode(code);
					return continuationRawEndTag;
				}
				return continuation(code);
			}
			/**
			* In cdata continuation, after `]`, expecting `]>`.
			*
			* ```markdown
			* > | <![CDATA[>&<]]>
			*                  ^
			* ```
			*
			* @type {State}
			*/
			function continuationCdataInside(code) {
				if (code === 93) {
					effects.consume(code);
					return continuationDeclarationInside;
				}
				return continuation(code);
			}
			/**
			* In declaration or instruction continuation, at `>`.
			*
			* ```markdown
			* > | <!-->
			*         ^
			* > | <?>
			*       ^
			* > | <!q>
			*        ^
			* > | <!--ab-->
			*             ^
			* > | <![CDATA[>&<]]>
			*                   ^
			* ```
			*
			* @type {State}
			*/
			function continuationDeclarationInside(code) {
				if (code === 62) {
					effects.consume(code);
					return continuationClose;
				}
				if (code === 45 && marker === 2) {
					effects.consume(code);
					return continuationDeclarationInside;
				}
				return continuation(code);
			}
			/**
			* In closed continuation: everything we get until the eol/eof is part of it.
			*
			* ```markdown
			* > | <!doctype>
			*               ^
			* ```
			*
			* @type {State}
			*/
			function continuationClose(code) {
				if (code === null || markdownLineEnding(code)) {
					effects.exit("htmlFlowData");
					return continuationAfter(code);
				}
				effects.consume(code);
				return continuationClose;
			}
			/**
			* Done.
			*
			* ```markdown
			* > | <!doctype>
			*               ^
			* ```
			*
			* @type {State}
			*/
			function continuationAfter(code) {
				effects.exit("htmlFlow");
				return ok(code);
			}
		}
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeBlankLineBefore(effects, ok, nok) {
			return start;
			/**
			* Before eol, expecting blank line.
			*
			* ```markdown
			* > | <div>
			*          ^
			*   |
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				effects.enter("lineEnding");
				effects.consume(code);
				effects.exit("lineEnding");
				return effects.attempt(blankLine, ok, nok);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/html-text.js
		/**
		* @import {
		*   Code,
		*   Construct,
		*   State,
		*   TokenizeContext,
		*   Tokenizer
		* } from 'micromark-util-types'
		*/
		/** @type {Construct} */
		const htmlText = {
			name: "htmlText",
			tokenize: tokenizeHtmlText
		};
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeHtmlText(effects, ok, nok) {
			const self = this;
			/** @type {NonNullable<Code> | undefined} */
			let marker;
			/** @type {number} */
			let index;
			/** @type {State} */
			let returnState;
			return start;
			/**
			* Start of HTML (text).
			*
			* ```markdown
			* > | a <b> c
			*       ^
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				effects.enter("htmlText");
				effects.enter("htmlTextData");
				effects.consume(code);
				return open;
			}
			/**
			* After `<`, at tag name or other stuff.
			*
			* ```markdown
			* > | a <b> c
			*        ^
			* > | a <!doctype> c
			*        ^
			* > | a <!--b--> c
			*        ^
			* ```
			*
			* @type {State}
			*/
			function open(code) {
				if (code === 33) {
					effects.consume(code);
					return declarationOpen;
				}
				if (code === 47) {
					effects.consume(code);
					return tagCloseStart;
				}
				if (code === 63) {
					effects.consume(code);
					return instruction;
				}
				if (asciiAlpha(code)) {
					effects.consume(code);
					return tagOpen;
				}
				return nok(code);
			}
			/**
			* After `<!`, at declaration, comment, or CDATA.
			*
			* ```markdown
			* > | a <!doctype> c
			*         ^
			* > | a <!--b--> c
			*         ^
			* > | a <![CDATA[>&<]]> c
			*         ^
			* ```
			*
			* @type {State}
			*/
			function declarationOpen(code) {
				if (code === 45) {
					effects.consume(code);
					return commentOpenInside;
				}
				if (code === 91) {
					effects.consume(code);
					index = 0;
					return cdataOpenInside;
				}
				if (asciiAlpha(code)) {
					effects.consume(code);
					return declaration;
				}
				return nok(code);
			}
			/**
			* In a comment, after `<!-`, at another `-`.
			*
			* ```markdown
			* > | a <!--b--> c
			*          ^
			* ```
			*
			* @type {State}
			*/
			function commentOpenInside(code) {
				if (code === 45) {
					effects.consume(code);
					return commentEnd;
				}
				return nok(code);
			}
			/**
			* In comment.
			*
			* ```markdown
			* > | a <!--b--> c
			*           ^
			* ```
			*
			* @type {State}
			*/
			function comment(code) {
				if (code === null) return nok(code);
				if (code === 45) {
					effects.consume(code);
					return commentClose;
				}
				if (markdownLineEnding(code)) {
					returnState = comment;
					return lineEndingBefore(code);
				}
				effects.consume(code);
				return comment;
			}
			/**
			* In comment, after `-`.
			*
			* ```markdown
			* > | a <!--b--> c
			*             ^
			* ```
			*
			* @type {State}
			*/
			function commentClose(code) {
				if (code === 45) {
					effects.consume(code);
					return commentEnd;
				}
				return comment(code);
			}
			/**
			* In comment, after `--`.
			*
			* ```markdown
			* > | a <!--b--> c
			*              ^
			* ```
			*
			* @type {State}
			*/
			function commentEnd(code) {
				return code === 62 ? end(code) : code === 45 ? commentClose(code) : comment(code);
			}
			/**
			* After `<![`, in CDATA, expecting `CDATA[`.
			*
			* ```markdown
			* > | a <![CDATA[>&<]]> b
			*          ^^^^^^
			* ```
			*
			* @type {State}
			*/
			function cdataOpenInside(code) {
				if (code === "CDATA[".charCodeAt(index++)) {
					effects.consume(code);
					return index === 6 ? cdata : cdataOpenInside;
				}
				return nok(code);
			}
			/**
			* In CDATA.
			*
			* ```markdown
			* > | a <![CDATA[>&<]]> b
			*                ^^^
			* ```
			*
			* @type {State}
			*/
			function cdata(code) {
				if (code === null) return nok(code);
				if (code === 93) {
					effects.consume(code);
					return cdataClose;
				}
				if (markdownLineEnding(code)) {
					returnState = cdata;
					return lineEndingBefore(code);
				}
				effects.consume(code);
				return cdata;
			}
			/**
			* In CDATA, after `]`, at another `]`.
			*
			* ```markdown
			* > | a <![CDATA[>&<]]> b
			*                    ^
			* ```
			*
			* @type {State}
			*/
			function cdataClose(code) {
				if (code === 93) {
					effects.consume(code);
					return cdataEnd;
				}
				return cdata(code);
			}
			/**
			* In CDATA, after `]]`, at `>`.
			*
			* ```markdown
			* > | a <![CDATA[>&<]]> b
			*                     ^
			* ```
			*
			* @type {State}
			*/
			function cdataEnd(code) {
				if (code === 62) return end(code);
				if (code === 93) {
					effects.consume(code);
					return cdataEnd;
				}
				return cdata(code);
			}
			/**
			* In declaration.
			*
			* ```markdown
			* > | a <!b> c
			*          ^
			* ```
			*
			* @type {State}
			*/
			function declaration(code) {
				if (code === null || code === 62) return end(code);
				if (markdownLineEnding(code)) {
					returnState = declaration;
					return lineEndingBefore(code);
				}
				effects.consume(code);
				return declaration;
			}
			/**
			* In instruction.
			*
			* ```markdown
			* > | a <?b?> c
			*         ^
			* ```
			*
			* @type {State}
			*/
			function instruction(code) {
				if (code === null) return nok(code);
				if (code === 63) {
					effects.consume(code);
					return instructionClose;
				}
				if (markdownLineEnding(code)) {
					returnState = instruction;
					return lineEndingBefore(code);
				}
				effects.consume(code);
				return instruction;
			}
			/**
			* In instruction, after `?`, at `>`.
			*
			* ```markdown
			* > | a <?b?> c
			*           ^
			* ```
			*
			* @type {State}
			*/
			function instructionClose(code) {
				return code === 62 ? end(code) : instruction(code);
			}
			/**
			* After `</`, in closing tag, at tag name.
			*
			* ```markdown
			* > | a </b> c
			*         ^
			* ```
			*
			* @type {State}
			*/
			function tagCloseStart(code) {
				if (asciiAlpha(code)) {
					effects.consume(code);
					return tagClose;
				}
				return nok(code);
			}
			/**
			* After `</x`, in a tag name.
			*
			* ```markdown
			* > | a </b> c
			*          ^
			* ```
			*
			* @type {State}
			*/
			function tagClose(code) {
				if (code === 45 || asciiAlphanumeric(code)) {
					effects.consume(code);
					return tagClose;
				}
				return tagCloseBetween(code);
			}
			/**
			* In closing tag, after tag name.
			*
			* ```markdown
			* > | a </b> c
			*          ^
			* ```
			*
			* @type {State}
			*/
			function tagCloseBetween(code) {
				if (markdownLineEnding(code)) {
					returnState = tagCloseBetween;
					return lineEndingBefore(code);
				}
				if (markdownSpace(code)) {
					effects.consume(code);
					return tagCloseBetween;
				}
				return end(code);
			}
			/**
			* After `<x`, in opening tag name.
			*
			* ```markdown
			* > | a <b> c
			*         ^
			* ```
			*
			* @type {State}
			*/
			function tagOpen(code) {
				if (code === 45 || asciiAlphanumeric(code)) {
					effects.consume(code);
					return tagOpen;
				}
				if (code === 47 || code === 62 || markdownLineEndingOrSpace(code)) return tagOpenBetween(code);
				return nok(code);
			}
			/**
			* In opening tag, after tag name.
			*
			* ```markdown
			* > | a <b> c
			*         ^
			* ```
			*
			* @type {State}
			*/
			function tagOpenBetween(code) {
				if (code === 47) {
					effects.consume(code);
					return end;
				}
				if (code === 58 || code === 95 || asciiAlpha(code)) {
					effects.consume(code);
					return tagOpenAttributeName;
				}
				if (markdownLineEnding(code)) {
					returnState = tagOpenBetween;
					return lineEndingBefore(code);
				}
				if (markdownSpace(code)) {
					effects.consume(code);
					return tagOpenBetween;
				}
				return end(code);
			}
			/**
			* In attribute name.
			*
			* ```markdown
			* > | a <b c> d
			*          ^
			* ```
			*
			* @type {State}
			*/
			function tagOpenAttributeName(code) {
				if (code === 45 || code === 46 || code === 58 || code === 95 || asciiAlphanumeric(code)) {
					effects.consume(code);
					return tagOpenAttributeName;
				}
				return tagOpenAttributeNameAfter(code);
			}
			/**
			* After attribute name, before initializer, the end of the tag, or
			* whitespace.
			*
			* ```markdown
			* > | a <b c> d
			*           ^
			* ```
			*
			* @type {State}
			*/
			function tagOpenAttributeNameAfter(code) {
				if (code === 61) {
					effects.consume(code);
					return tagOpenAttributeValueBefore;
				}
				if (markdownLineEnding(code)) {
					returnState = tagOpenAttributeNameAfter;
					return lineEndingBefore(code);
				}
				if (markdownSpace(code)) {
					effects.consume(code);
					return tagOpenAttributeNameAfter;
				}
				return tagOpenBetween(code);
			}
			/**
			* Before unquoted, double quoted, or single quoted attribute value, allowing
			* whitespace.
			*
			* ```markdown
			* > | a <b c=d> e
			*            ^
			* ```
			*
			* @type {State}
			*/
			function tagOpenAttributeValueBefore(code) {
				if (code === null || code === 60 || code === 61 || code === 62 || code === 96) return nok(code);
				if (code === 34 || code === 39) {
					effects.consume(code);
					marker = code;
					return tagOpenAttributeValueQuoted;
				}
				if (markdownLineEnding(code)) {
					returnState = tagOpenAttributeValueBefore;
					return lineEndingBefore(code);
				}
				if (markdownSpace(code)) {
					effects.consume(code);
					return tagOpenAttributeValueBefore;
				}
				effects.consume(code);
				return tagOpenAttributeValueUnquoted;
			}
			/**
			* In double or single quoted attribute value.
			*
			* ```markdown
			* > | a <b c="d"> e
			*             ^
			* ```
			*
			* @type {State}
			*/
			function tagOpenAttributeValueQuoted(code) {
				if (code === marker) {
					effects.consume(code);
					marker = void 0;
					return tagOpenAttributeValueQuotedAfter;
				}
				if (code === null) return nok(code);
				if (markdownLineEnding(code)) {
					returnState = tagOpenAttributeValueQuoted;
					return lineEndingBefore(code);
				}
				effects.consume(code);
				return tagOpenAttributeValueQuoted;
			}
			/**
			* In unquoted attribute value.
			*
			* ```markdown
			* > | a <b c=d> e
			*            ^
			* ```
			*
			* @type {State}
			*/
			function tagOpenAttributeValueUnquoted(code) {
				if (code === null || code === 34 || code === 39 || code === 60 || code === 61 || code === 96) return nok(code);
				if (code === 47 || code === 62 || markdownLineEndingOrSpace(code)) return tagOpenBetween(code);
				effects.consume(code);
				return tagOpenAttributeValueUnquoted;
			}
			/**
			* After double or single quoted attribute value, before whitespace or the end
			* of the tag.
			*
			* ```markdown
			* > | a <b c="d"> e
			*               ^
			* ```
			*
			* @type {State}
			*/
			function tagOpenAttributeValueQuotedAfter(code) {
				if (code === 47 || code === 62 || markdownLineEndingOrSpace(code)) return tagOpenBetween(code);
				return nok(code);
			}
			/**
			* In certain circumstances of a tag where only an `>` is allowed.
			*
			* ```markdown
			* > | a <b c="d"> e
			*               ^
			* ```
			*
			* @type {State}
			*/
			function end(code) {
				if (code === 62) {
					effects.consume(code);
					effects.exit("htmlTextData");
					effects.exit("htmlText");
					return ok;
				}
				return nok(code);
			}
			/**
			* At eol.
			*
			* > 👉 **Note**: we can’t have blank lines in text, so no need to worry about
			* > empty tokens.
			*
			* ```markdown
			* > | a <!--a
			*            ^
			*   | b-->
			* ```
			*
			* @type {State}
			*/
			function lineEndingBefore(code) {
				effects.exit("htmlTextData");
				effects.enter("lineEnding");
				effects.consume(code);
				effects.exit("lineEnding");
				return lineEndingAfter;
			}
			/**
			* After eol, at optional whitespace.
			*
			* > 👉 **Note**: we can’t have blank lines in text, so no need to worry about
			* > empty tokens.
			*
			* ```markdown
			*   | a <!--a
			* > | b-->
			*     ^
			* ```
			*
			* @type {State}
			*/
			function lineEndingAfter(code) {
				return markdownSpace(code) ? factorySpace(effects, lineEndingAfterPrefix, "linePrefix", self.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(code) : lineEndingAfterPrefix(code);
			}
			/**
			* After eol, after optional whitespace.
			*
			* > 👉 **Note**: we can’t have blank lines in text, so no need to worry about
			* > empty tokens.
			*
			* ```markdown
			*   | a <!--a
			* > | b-->
			*     ^
			* ```
			*
			* @type {State}
			*/
			function lineEndingAfterPrefix(code) {
				effects.enter("htmlTextData");
				return returnState(code);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/label-end.js
		/**
		* @import {
		*   Construct,
		*   Event,
		*   Resolver,
		*   State,
		*   TokenizeContext,
		*   Tokenizer,
		*   Token
		* } from 'micromark-util-types'
		*/
		/** @type {Construct} */
		const labelEnd = {
			name: "labelEnd",
			resolveAll: resolveAllLabelEnd,
			resolveTo: resolveToLabelEnd,
			tokenize: tokenizeLabelEnd
		};
		/** @type {Construct} */
		const resourceConstruct = { tokenize: tokenizeResource };
		/** @type {Construct} */
		const referenceFullConstruct = { tokenize: tokenizeReferenceFull };
		/** @type {Construct} */
		const referenceCollapsedConstruct = { tokenize: tokenizeReferenceCollapsed };
		/** @type {Resolver} */
		function resolveAllLabelEnd(events) {
			let index = -1;
			/** @type {Array<Event>} */
			const newEvents = [];
			while (++index < events.length) {
				const token = events[index][1];
				newEvents.push(events[index]);
				if (token.type === "labelImage" || token.type === "labelLink" || token.type === "labelEnd") {
					const offset = token.type === "labelImage" ? 4 : 2;
					token.type = "data";
					index += offset;
				}
			}
			if (events.length !== newEvents.length) splice(events, 0, events.length, newEvents);
			return events;
		}
		/** @type {Resolver} */
		function resolveToLabelEnd(events, context) {
			let index = events.length;
			let offset = 0;
			/** @type {number | undefined} */
			let open;
			/** @type {number | undefined} */
			let close;
			/** @type {Array<Event>} */
			let media;
			while (index--) {
				const token = events[index][1];
				if (open) {
					if (token.type === "link" || token.type === "labelLink" && token._inactive) break;
					if (events[index][0] === "enter" && token.type === "labelLink") token._inactive = true;
				} else if (close) {
					if (events[index][0] === "enter" && (token.type === "labelImage" || token.type === "labelLink") && !token._balanced) {
						open = index;
						if (token.type !== "labelLink") {
							offset = 2;
							break;
						}
					}
				} else if (token.type === "labelEnd") close = index;
			}
			const group = {
				type: events[open][1].type === "labelLink" ? "link" : "image",
				start: { ...events[open][1].start },
				end: { ...events[events.length - 1][1].end }
			};
			const label = {
				type: "label",
				start: { ...events[open][1].start },
				end: { ...events[close][1].end }
			};
			const text = {
				type: "labelText",
				start: { ...events[open + offset + 2][1].end },
				end: { ...events[close - 2][1].start }
			};
			media = [[
				"enter",
				group,
				context
			], [
				"enter",
				label,
				context
			]];
			media = push(media, events.slice(open + 1, open + offset + 3));
			media = push(media, [[
				"enter",
				text,
				context
			]]);
			media = push(media, resolveAll(context.parser.constructs.insideSpan.null, events.slice(open + offset + 4, close - 3), context));
			media = push(media, [
				[
					"exit",
					text,
					context
				],
				events[close - 2],
				events[close - 1],
				[
					"exit",
					label,
					context
				]
			]);
			media = push(media, events.slice(close + 1));
			media = push(media, [[
				"exit",
				group,
				context
			]]);
			splice(events, open, events.length, media);
			return events;
		}
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeLabelEnd(effects, ok, nok) {
			const self = this;
			const labelStarts = self._labelStarts;
			/** @type {Token} */
			let labelStart;
			/** @type {boolean} */
			let defined;
			if (labelStarts) {
				while (labelStarts.length > 0 && labelStarts[labelStarts.length - 1]._balanced) labelStarts.pop();
				labelStart = labelStarts[labelStarts.length - 1];
			}
			return start;
			/**
			* Start of label end.
			*
			* ```markdown
			* > | [a](b) c
			*       ^
			* > | [a][b] c
			*       ^
			* > | [a][] b
			*       ^
			* > | [a] b
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				if (!labelStart) return nok(code);
				if (labelStart._inactive) return labelEndNok(code);
				defined = self.parser.defined.includes(normalizeIdentifier(self.sliceSerialize({
					start: labelStart.end,
					end: self.now()
				})));
				effects.enter("labelEnd");
				effects.enter("labelMarker");
				effects.consume(code);
				effects.exit("labelMarker");
				effects.exit("labelEnd");
				return after;
			}
			/**
			* After `]`.
			*
			* ```markdown
			* > | [a](b) c
			*       ^
			* > | [a][b] c
			*       ^
			* > | [a][] b
			*       ^
			* > | [a] b
			*       ^
			* ```
			*
			* @type {State}
			*/
			function after(code) {
				if (code === 40) return effects.attempt(resourceConstruct, labelEndOk, defined ? labelEndOk : labelEndNok)(code);
				if (code === 91) return effects.attempt(referenceFullConstruct, labelEndOk, defined ? referenceNotFull : labelEndNok)(code);
				return defined ? labelEndOk(code) : labelEndNok(code);
			}
			/**
			* After `]`, at `[`, but not at a full reference.
			*
			* > 👉 **Note**: we only get here if the label is defined.
			*
			* ```markdown
			* > | [a][] b
			*        ^
			* > | [a] b
			*        ^
			* ```
			*
			* @type {State}
			*/
			function referenceNotFull(code) {
				return effects.attempt(referenceCollapsedConstruct, labelEndOk, labelEndNok)(code);
			}
			/**
			* Done, we found something.
			*
			* ```markdown
			* > | [a](b) c
			*           ^
			* > | [a][b] c
			*           ^
			* > | [a][] b
			*          ^
			* > | [a] b
			*        ^
			* ```
			*
			* @type {State}
			*/
			function labelEndOk(code) {
				labelStarts.pop();
				return ok(code);
			}
			/**
			* Done, it’s nothing.
			*
			* There was an okay opening, but we didn’t match anything.
			*
			* ```markdown
			* > | [a](b c
			*        ^
			* > | [a][b c
			*        ^
			* > | [a] b
			*        ^
			* ```
			*
			* @type {State}
			*/
			function labelEndNok(code) {
				labelStart._balanced = true;
				return nok(code);
			}
		}
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeResource(effects, ok, nok) {
			return resourceStart;
			/**
			* At a resource.
			*
			* ```markdown
			* > | [a](b) c
			*        ^
			* ```
			*
			* @type {State}
			*/
			function resourceStart(code) {
				effects.enter("resource");
				effects.enter("resourceMarker");
				effects.consume(code);
				effects.exit("resourceMarker");
				return resourceBefore;
			}
			/**
			* In resource, after `(`, at optional whitespace.
			*
			* ```markdown
			* > | [a](b) c
			*         ^
			* ```
			*
			* @type {State}
			*/
			function resourceBefore(code) {
				return markdownLineEndingOrSpace(code) ? factoryWhitespace(effects, resourceOpen)(code) : resourceOpen(code);
			}
			/**
			* In resource, after optional whitespace, at `)` or a destination.
			*
			* ```markdown
			* > | [a](b) c
			*         ^
			* ```
			*
			* @type {State}
			*/
			function resourceOpen(code) {
				if (code === 41) return resourceEnd(code);
				return factoryDestination(effects, resourceDestinationAfter, resourceDestinationMissing, "resourceDestination", "resourceDestinationLiteral", "resourceDestinationLiteralMarker", "resourceDestinationRaw", "resourceDestinationString", 32)(code);
			}
			/**
			* In resource, after destination, at optional whitespace.
			*
			* ```markdown
			* > | [a](b) c
			*          ^
			* ```
			*
			* @type {State}
			*/
			function resourceDestinationAfter(code) {
				return markdownLineEndingOrSpace(code) ? factoryWhitespace(effects, resourceBetween)(code) : resourceEnd(code);
			}
			/**
			* At invalid destination.
			*
			* ```markdown
			* > | [a](<<) b
			*         ^
			* ```
			*
			* @type {State}
			*/
			function resourceDestinationMissing(code) {
				return nok(code);
			}
			/**
			* In resource, after destination and whitespace, at `(` or title.
			*
			* ```markdown
			* > | [a](b ) c
			*           ^
			* ```
			*
			* @type {State}
			*/
			function resourceBetween(code) {
				if (code === 34 || code === 39 || code === 40) return factoryTitle(effects, resourceTitleAfter, nok, "resourceTitle", "resourceTitleMarker", "resourceTitleString")(code);
				return resourceEnd(code);
			}
			/**
			* In resource, after title, at optional whitespace.
			*
			* ```markdown
			* > | [a](b "c") d
			*              ^
			* ```
			*
			* @type {State}
			*/
			function resourceTitleAfter(code) {
				return markdownLineEndingOrSpace(code) ? factoryWhitespace(effects, resourceEnd)(code) : resourceEnd(code);
			}
			/**
			* In resource, at `)`.
			*
			* ```markdown
			* > | [a](b) d
			*          ^
			* ```
			*
			* @type {State}
			*/
			function resourceEnd(code) {
				if (code === 41) {
					effects.enter("resourceMarker");
					effects.consume(code);
					effects.exit("resourceMarker");
					effects.exit("resource");
					return ok;
				}
				return nok(code);
			}
		}
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeReferenceFull(effects, ok, nok) {
			const self = this;
			return referenceFull;
			/**
			* In a reference (full), at the `[`.
			*
			* ```markdown
			* > | [a][b] d
			*        ^
			* ```
			*
			* @type {State}
			*/
			function referenceFull(code) {
				return factoryLabel.call(self, effects, referenceFullAfter, referenceFullMissing, "reference", "referenceMarker", "referenceString")(code);
			}
			/**
			* In a reference (full), after `]`.
			*
			* ```markdown
			* > | [a][b] d
			*          ^
			* ```
			*
			* @type {State}
			*/
			function referenceFullAfter(code) {
				return self.parser.defined.includes(normalizeIdentifier(self.sliceSerialize(self.events[self.events.length - 1][1]).slice(1, -1))) ? ok(code) : nok(code);
			}
			/**
			* In reference (full) that was missing.
			*
			* ```markdown
			* > | [a][b d
			*        ^
			* ```
			*
			* @type {State}
			*/
			function referenceFullMissing(code) {
				return nok(code);
			}
		}
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeReferenceCollapsed(effects, ok, nok) {
			return referenceCollapsedStart;
			/**
			* In reference (collapsed), at `[`.
			*
			* > 👉 **Note**: we only get here if the label is defined.
			*
			* ```markdown
			* > | [a][] d
			*        ^
			* ```
			*
			* @type {State}
			*/
			function referenceCollapsedStart(code) {
				effects.enter("reference");
				effects.enter("referenceMarker");
				effects.consume(code);
				effects.exit("referenceMarker");
				return referenceCollapsedOpen;
			}
			/**
			* In reference (collapsed), at `]`.
			*
			* > 👉 **Note**: we only get here if the label is defined.
			*
			* ```markdown
			* > | [a][] d
			*         ^
			* ```
			*
			*  @type {State}
			*/
			function referenceCollapsedOpen(code) {
				if (code === 93) {
					effects.enter("referenceMarker");
					effects.consume(code);
					effects.exit("referenceMarker");
					effects.exit("reference");
					return ok;
				}
				return nok(code);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/label-start-image.js
		/**
		* @import {
		*   Construct,
		*   State,
		*   Token,
		*   TokenizeContext,
		*   Tokenizer
		* } from 'micromark-util-types'
		*/
		/** @type {Construct} */
		const labelStartImage = {
			name: "labelStartImage",
			resolveAll: labelEnd.resolveAll,
			tokenize: tokenizeLabelStartImage
		};
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeLabelStartImage(effects, ok, nok) {
			const self = this;
			/** @type {Token} */
			let labelImage;
			return start;
			/**
			* Start of label (image) start.
			*
			* ```markdown
			* > | a ![b] c
			*       ^
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				effects.enter("labelImage");
				effects.enter("labelImageMarker");
				effects.consume(code);
				effects.exit("labelImageMarker");
				return open;
			}
			/**
			* After `!`, at `[`.
			*
			* ```markdown
			* > | a ![b] c
			*        ^
			* ```
			*
			* @type {State}
			*/
			function open(code) {
				if (code === 91) {
					effects.enter("labelMarker");
					effects.consume(code);
					effects.exit("labelMarker");
					labelImage = effects.exit("labelImage");
					return after;
				}
				return nok(code);
			}
			/**
			* After `![`.
			*
			* ```markdown
			* > | a ![b] c
			*         ^
			* ```
			*
			* This is needed in because, when GFM footnotes are enabled, images never
			* form when started with a `^`.
			* Instead, links form:
			*
			* ```markdown
			* ![^a](b)
			*
			* ![^a][b]
			*
			* [b]: c
			* ```
			*
			* ```html
			* <p>!<a href=\"b\">^a</a></p>
			* <p>!<a href=\"c\">^a</a></p>
			* ```
			*
			* @type {State}
			*/
			function after(code) {
				/* c8 ignore next 6 */
				if (code === 94 && "_hiddenFootnoteSupport" in self.parser.constructs) return nok(code);
				self._labelStarts = self._labelStarts || [];
				self._labelStarts.push(labelImage);
				return ok(code);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/label-start-link.js
		/**
		* @import {
		*   Construct,
		*   State,
		*   Token,
		*   TokenizeContext,
		*   Tokenizer
		* } from 'micromark-util-types'
		*/
		/** @type {Construct} */
		const labelStartLink = {
			name: "labelStartLink",
			resolveAll: labelEnd.resolveAll,
			tokenize: tokenizeLabelStartLink
		};
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeLabelStartLink(effects, ok, nok) {
			const self = this;
			/** @type {Token} */
			let labelLink;
			return start;
			/**
			* Start of label (link) start.
			*
			* ```markdown
			* > | a [b] c
			*       ^
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				effects.enter("labelLink");
				effects.enter("labelMarker");
				effects.consume(code);
				effects.exit("labelMarker");
				labelLink = effects.exit("labelLink");
				return after;
			}
			/** @type {State} */
			function after(code) {
				/* c8 ignore next 6 */
				if (code === 94 && "_hiddenFootnoteSupport" in self.parser.constructs) return nok(code);
				self._labelStarts = self._labelStarts || [];
				self._labelStarts.push(labelLink);
				return ok(code);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/line-ending.js
		/**
		* @import {
		*   Construct,
		*   State,
		*   TokenizeContext,
		*   Tokenizer
		* } from 'micromark-util-types'
		*/
		/** @type {Construct} */
		const lineEnding = {
			name: "lineEnding",
			tokenize: tokenizeLineEnding
		};
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeLineEnding(effects, ok) {
			return start;
			/** @type {State} */
			function start(code) {
				effects.enter("lineEnding");
				effects.consume(code);
				effects.exit("lineEnding");
				return factorySpace(effects, ok, "linePrefix");
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/thematic-break.js
		/**
		* @import {
		*   Code,
		*   Construct,
		*   State,
		*   TokenizeContext,
		*   Tokenizer
		* } from 'micromark-util-types'
		*/
		/** @type {Construct} */
		const thematicBreak = {
			name: "thematicBreak",
			tokenize: tokenizeThematicBreak
		};
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeThematicBreak(effects, ok, nok) {
			let size = 0;
			/** @type {NonNullable<Code>} */
			let marker;
			return start;
			/**
			* Start of thematic break.
			*
			* ```markdown
			* > | ***
			*     ^
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				effects.enter("thematicBreak");
				return before(code);
			}
			/**
			* After optional whitespace, at marker.
			*
			* ```markdown
			* > | ***
			*     ^
			* ```
			*
			* @type {State}
			*/
			function before(code) {
				marker = code;
				return atBreak(code);
			}
			/**
			* After something, before something else.
			*
			* ```markdown
			* > | ***
			*     ^
			* ```
			*
			* @type {State}
			*/
			function atBreak(code) {
				if (code === marker) {
					effects.enter("thematicBreakSequence");
					return sequence(code);
				}
				if (size >= 3 && (code === null || markdownLineEnding(code))) {
					effects.exit("thematicBreak");
					return ok(code);
				}
				return nok(code);
			}
			/**
			* In sequence.
			*
			* ```markdown
			* > | ***
			*     ^
			* ```
			*
			* @type {State}
			*/
			function sequence(code) {
				if (code === marker) {
					effects.consume(code);
					size++;
					return sequence;
				}
				effects.exit("thematicBreakSequence");
				return markdownSpace(code) ? factorySpace(effects, atBreak, "whitespace")(code) : atBreak(code);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/list.js
		/**
		* @import {
		*   Code,
		*   Construct,
		*   Exiter,
		*   State,
		*   TokenizeContext,
		*   Tokenizer
		* } from 'micromark-util-types'
		*/
		/** @type {Construct} */
		const list = {
			continuation: { tokenize: tokenizeListContinuation },
			exit: tokenizeListEnd,
			name: "list",
			tokenize: tokenizeListStart
		};
		/** @type {Construct} */
		const listItemPrefixWhitespaceConstruct = {
			partial: true,
			tokenize: tokenizeListItemPrefixWhitespace
		};
		/** @type {Construct} */
		const indentConstruct = {
			partial: true,
			tokenize: tokenizeIndent
		};
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeListStart(effects, ok, nok) {
			const self = this;
			const tail = self.events[self.events.length - 1];
			let initialSize = tail && tail[1].type === "linePrefix" ? tail[2].sliceSerialize(tail[1], true).length : 0;
			let size = 0;
			return start;
			/** @type {State} */
			function start(code) {
				const kind = self.containerState.type || (code === 42 || code === 43 || code === 45 ? "listUnordered" : "listOrdered");
				if (kind === "listUnordered" ? !self.containerState.marker || code === self.containerState.marker : asciiDigit(code)) {
					if (!self.containerState.type) {
						self.containerState.type = kind;
						effects.enter(kind, { _container: true });
					}
					if (kind === "listUnordered") {
						effects.enter("listItemPrefix");
						return code === 42 || code === 45 ? effects.check(thematicBreak, nok, atMarker)(code) : atMarker(code);
					}
					if (!self.interrupt || code === 49) {
						effects.enter("listItemPrefix");
						effects.enter("listItemValue");
						return inside(code);
					}
				}
				return nok(code);
			}
			/** @type {State} */
			function inside(code) {
				if (asciiDigit(code) && ++size < 10) {
					effects.consume(code);
					return inside;
				}
				if ((!self.interrupt || size < 2) && (self.containerState.marker ? code === self.containerState.marker : code === 41 || code === 46)) {
					effects.exit("listItemValue");
					return atMarker(code);
				}
				return nok(code);
			}
			/**
			* @type {State}
			**/
			function atMarker(code) {
				effects.enter("listItemMarker");
				effects.consume(code);
				effects.exit("listItemMarker");
				self.containerState.marker = self.containerState.marker || code;
				return effects.check(blankLine, self.interrupt ? nok : onBlank, effects.attempt(listItemPrefixWhitespaceConstruct, endOfPrefix, otherPrefix));
			}
			/** @type {State} */
			function onBlank(code) {
				self.containerState.initialBlankLine = true;
				initialSize++;
				return endOfPrefix(code);
			}
			/** @type {State} */
			function otherPrefix(code) {
				if (markdownSpace(code)) {
					effects.enter("listItemPrefixWhitespace");
					effects.consume(code);
					effects.exit("listItemPrefixWhitespace");
					return endOfPrefix;
				}
				return nok(code);
			}
			/** @type {State} */
			function endOfPrefix(code) {
				self.containerState.size = initialSize + self.sliceSerialize(effects.exit("listItemPrefix"), true).length;
				return ok(code);
			}
		}
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeListContinuation(effects, ok, nok) {
			const self = this;
			self.containerState._closeFlow = void 0;
			return effects.check(blankLine, onBlank, notBlank);
			/** @type {State} */
			function onBlank(code) {
				self.containerState.furtherBlankLines = self.containerState.furtherBlankLines || self.containerState.initialBlankLine;
				return factorySpace(effects, ok, "listItemIndent", self.containerState.size + 1)(code);
			}
			/** @type {State} */
			function notBlank(code) {
				if (self.containerState.furtherBlankLines || !markdownSpace(code)) {
					self.containerState.furtherBlankLines = void 0;
					self.containerState.initialBlankLine = void 0;
					return notInCurrentItem(code);
				}
				self.containerState.furtherBlankLines = void 0;
				self.containerState.initialBlankLine = void 0;
				return effects.attempt(indentConstruct, ok, notInCurrentItem)(code);
			}
			/** @type {State} */
			function notInCurrentItem(code) {
				self.containerState._closeFlow = true;
				self.interrupt = void 0;
				return factorySpace(effects, effects.attempt(list, ok, nok), "linePrefix", self.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(code);
			}
		}
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeIndent(effects, ok, nok) {
			const self = this;
			return factorySpace(effects, afterPrefix, "listItemIndent", self.containerState.size + 1);
			/** @type {State} */
			function afterPrefix(code) {
				const tail = self.events[self.events.length - 1];
				return tail && tail[1].type === "listItemIndent" && tail[2].sliceSerialize(tail[1], true).length === self.containerState.size ? ok(code) : nok(code);
			}
		}
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Exiter}
		*/
		function tokenizeListEnd(effects) {
			effects.exit(this.containerState.type);
		}
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeListItemPrefixWhitespace(effects, ok, nok) {
			const self = this;
			return factorySpace(effects, afterPrefix, "listItemPrefixWhitespace", self.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 5);
			/** @type {State} */
			function afterPrefix(code) {
				const tail = self.events[self.events.length - 1];
				return !markdownSpace(code) && tail && tail[1].type === "listItemPrefixWhitespace" ? ok(code) : nok(code);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-core-commonmark@2.0.4/node_modules/micromark-core-commonmark/lib/setext-underline.js
		/**
		* @import {
		*   Code,
		*   Construct,
		*   Resolver,
		*   State,
		*   TokenizeContext,
		*   Tokenizer
		* } from 'micromark-util-types'
		*/
		/** @type {Construct} */
		const setextUnderline = {
			name: "setextUnderline",
			resolveTo: resolveToSetextUnderline,
			tokenize: tokenizeSetextUnderline
		};
		/** @type {Resolver} */
		function resolveToSetextUnderline(events, context) {
			const editMap = new EditMap();
			let index = events.length;
			/** @type {number | undefined} */
			let content;
			/** @type {number | undefined} */
			let text;
			/** @type {number | undefined} */
			let definition;
			while (index--) if (events[index][0] === "enter") {
				if (events[index][1].type === "content") {
					content = index;
					break;
				}
				if (events[index][1].type === "paragraph") text = index;
			} else {
				if (events[index][1].type === "content") editMap.add(index, 1, []);
				if (!definition && events[index][1].type === "definition") definition = index;
			}
			const heading = {
				type: "setextHeading",
				start: { ...events[content][1].start },
				end: { ...events[events.length - 1][1].end }
			};
			events[text][1].type = "setextHeadingText";
			if (definition) {
				editMap.add(text, 0, [[
					"enter",
					heading,
					context
				]]);
				editMap.add(definition + 1, 0, [[
					"exit",
					events[content][1],
					context
				]]);
				events[content][1].end = { ...events[definition][1].end };
			} else events[content][1] = heading;
			editMap.add(events.length, 0, [[
				"exit",
				heading,
				context
			]]);
			editMap.consume(events);
			return events;
		}
		/**
		* @this {TokenizeContext}
		*   Context.
		* @type {Tokenizer}
		*/
		function tokenizeSetextUnderline(effects, ok, nok) {
			const self = this;
			/** @type {NonNullable<Code>} */
			let marker;
			return start;
			/**
			* At start of heading (setext) underline.
			*
			* ```markdown
			*   | aa
			* > | ==
			*     ^
			* ```
			*
			* @type {State}
			*/
			function start(code) {
				let index = self.events.length;
				/** @type {boolean | undefined} */
				let paragraph;
				while (index--) if (self.events[index][1].type !== "lineEnding" && self.events[index][1].type !== "linePrefix" && self.events[index][1].type !== "content") {
					paragraph = self.events[index][1].type === "paragraph";
					break;
				}
				if (!self.parser.lazy[self.now().line] && (self.interrupt || paragraph)) {
					effects.enter("setextHeadingLine");
					marker = code;
					return before(code);
				}
				return nok(code);
			}
			/**
			* After optional whitespace, at `-` or `=`.
			*
			* ```markdown
			*   | aa
			* > | ==
			*     ^
			* ```
			*
			* @type {State}
			*/
			function before(code) {
				effects.enter("setextHeadingLineSequence");
				return inside(code);
			}
			/**
			* In sequence.
			*
			* ```markdown
			*   | aa
			* > | ==
			*     ^
			* ```
			*
			* @type {State}
			*/
			function inside(code) {
				if (code === marker) {
					effects.consume(code);
					return inside;
				}
				effects.exit("setextHeadingLineSequence");
				return markdownSpace(code) ? factorySpace(effects, after, "lineSuffix")(code) : after(code);
			}
			/**
			* After sequence, after optional whitespace.
			*
			* ```markdown
			*   | aa
			* > | ==
			*       ^
			* ```
			*
			* @type {State}
			*/
			function after(code) {
				if (code === null || markdownLineEnding(code)) {
					effects.exit("setextHeadingLine");
					return ok(code);
				}
				return nok(code);
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark@4.0.3/node_modules/micromark/lib/initialize/flow.js
		/**
		* @import {
		*   InitialConstruct,
		*   Initializer,
		*   State,
		*   TokenizeContext
		* } from 'micromark-util-types'
		*/
		/** @type {InitialConstruct} */
		const flow$1 = { tokenize: initializeFlow };
		/**
		* @this {TokenizeContext}
		*   Self.
		* @type {Initializer}
		*   Initializer.
		*/
		function initializeFlow(effects) {
			const self = this;
			const initial = effects.attempt(blankLine, atBlankEnding, effects.attempt(this.parser.constructs.flowInitial, afterConstruct, factorySpace(effects, effects.attempt(this.parser.constructs.flow, afterConstruct, effects.attempt(content, afterConstruct)), "linePrefix")));
			return initial;
			/** @type {State} */
			function atBlankEnding(code) {
				if (code === null) {
					effects.consume(code);
					return;
				}
				effects.enter("lineEndingBlank");
				effects.consume(code);
				effects.exit("lineEndingBlank");
				self.currentConstruct = void 0;
				return initial;
			}
			/** @type {State} */
			function afterConstruct(code) {
				if (code === null) {
					effects.consume(code);
					return;
				}
				effects.enter("lineEnding");
				effects.consume(code);
				effects.exit("lineEnding");
				self.currentConstruct = void 0;
				return initial;
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark@4.0.3/node_modules/micromark/lib/initialize/text.js
		/**
		* @import {
		*   Code,
		*   InitialConstruct,
		*   Initializer,
		*   Resolver,
		*   State,
		*   TokenizeContext
		* } from 'micromark-util-types'
		*/
		const resolver = { resolveAll: createResolver() };
		const string$1 = initializeFactory("string");
		const text$1 = initializeFactory("text");
		/**
		* @param {'string' | 'text'} field
		*   Field.
		* @returns {InitialConstruct}
		*   Construct.
		*/
		function initializeFactory(field) {
			return {
				resolveAll: createResolver(field === "text" ? resolveAllLineSuffixes : void 0),
				tokenize: initializeText
			};
			/**
			* @this {TokenizeContext}
			*   Context.
			* @type {Initializer}
			*/
			function initializeText(effects) {
				const self = this;
				const constructs = this.parser.constructs[field];
				const text = effects.attempt(constructs, start, notText);
				return start;
				/** @type {State} */
				function start(code) {
					return atBreak(code) ? text(code) : notText(code);
				}
				/** @type {State} */
				function notText(code) {
					if (code === null) {
						effects.consume(code);
						return;
					}
					effects.enter("data");
					effects.consume(code);
					return data;
				}
				/** @type {State} */
				function data(code) {
					if (atBreak(code)) {
						effects.exit("data");
						return text(code);
					}
					effects.consume(code);
					return data;
				}
				/**
				* @param {Code} code
				*   Code.
				* @returns {boolean}
				*   Whether the code is a break.
				*/
				function atBreak(code) {
					if (code === null) return true;
					const list = constructs[code];
					let index = -1;
					if (list) while (++index < list.length) {
						const item = list[index];
						if (!item.previous || item.previous.call(self, self.previous)) return true;
					}
					return false;
				}
			}
		}
		/**
		* @param {Resolver | undefined} [extraResolver]
		*   Resolver.
		* @returns {Resolver}
		*   Resolver.
		*/
		function createResolver(extraResolver) {
			return resolveAllText;
			/** @type {Resolver} */
			function resolveAllText(events, context) {
				let index = -1;
				/** @type {number | undefined} */
				let enter;
				while (++index <= events.length) if (enter === void 0) {
					if (events[index] && events[index][1].type === "data") {
						enter = index;
						index++;
					}
				} else if (!events[index] || events[index][1].type !== "data") {
					if (index !== enter + 2) {
						events[enter][1].end = events[index - 1][1].end;
						events.splice(enter + 2, index - enter - 2);
						index = enter + 2;
					}
					enter = void 0;
				}
				return extraResolver ? extraResolver(events, context) : events;
			}
		}
		/**
		* A rather ugly set of instructions which again looks at chunks in the input
		* stream.
		* The reason to do this here is that it is *much* faster to parse in reverse.
		* And that we can’t hook into `null` to split the line suffix before an EOF.
		* To do: figure out if we can make this into a clean utility, or even in core.
		* As it will be useful for GFMs literal autolink extension (and maybe even
		* tables?)
		*
		* @type {Resolver}
		*/
		function resolveAllLineSuffixes(events, context) {
			const editMap = new EditMap();
			let eventIndex = 0;
			while (++eventIndex <= events.length) if ((eventIndex === events.length || events[eventIndex][1].type === "lineEnding") && events[eventIndex - 1][1].type === "data") {
				const data = events[eventIndex - 1][1];
				const chunks = context.sliceStream(data);
				let index = chunks.length;
				let bufferIndex = -1;
				let size = 0;
				/** @type {boolean | undefined} */
				let tabs;
				while (index--) {
					const chunk = chunks[index];
					if (typeof chunk === "string") {
						bufferIndex = chunk.length;
						while (chunk.charCodeAt(bufferIndex - 1) === 32) {
							size++;
							bufferIndex--;
						}
						if (bufferIndex) break;
						bufferIndex = -1;
					} else if (chunk === -2) {
						tabs = true;
						size++;
					} else if (chunk === -1) {} else {
						index++;
						break;
					}
				}
				if (context._contentTypeTextTrailing && eventIndex === events.length) size = 0;
				if (size) {
					const token = {
						type: eventIndex === events.length || tabs || size < 2 ? "lineSuffix" : "hardBreakTrailing",
						start: {
							_bufferIndex: index ? bufferIndex : data.start._bufferIndex + bufferIndex,
							_index: data.start._index + index,
							line: data.end.line,
							column: data.end.column - size,
							offset: data.end.offset - size
						},
						end: { ...data.end }
					};
					data.end = { ...token.start };
					if (data.start.offset === data.end.offset) Object.assign(data, token);
					else editMap.add(eventIndex, 0, [[
						"enter",
						token,
						context
					], [
						"exit",
						token,
						context
					]]);
				}
				eventIndex++;
			}
			editMap.consume(events);
			return events;
		}
		//#endregion
		//#region node_modules/.pnpm/micromark@4.0.3/node_modules/micromark/lib/constructs.js
		/**
		* @import {Extension} from 'micromark-util-types'
		*/
		var constructs_exports = /* @__PURE__ */ __exportAll({
			attentionMarkers: () => attentionMarkers,
			contentInitial: () => contentInitial,
			disable: () => disable,
			document: () => document$1,
			flow: () => flow,
			flowInitial: () => flowInitial,
			insideSpan: () => insideSpan,
			string: () => string,
			text: () => text
		});
		/** @satisfies {Extension['document']} */
		const document$1 = {
			[42]: list,
			[43]: list,
			[45]: list,
			[48]: list,
			[49]: list,
			[50]: list,
			[51]: list,
			[52]: list,
			[53]: list,
			[54]: list,
			[55]: list,
			[56]: list,
			[57]: list,
			[62]: blockQuote
		};
		/** @satisfies {Extension['contentInitial']} */
		const contentInitial = { [91]: definition };
		/** @satisfies {Extension['flowInitial']} */
		const flowInitial = {
			[-2]: codeIndented,
			[-1]: codeIndented,
			[32]: codeIndented
		};
		/** @satisfies {Extension['flow']} */
		const flow = {
			[35]: headingAtx,
			[42]: thematicBreak,
			[45]: [setextUnderline, thematicBreak],
			[60]: htmlFlow,
			[61]: setextUnderline,
			[95]: thematicBreak,
			[96]: codeFenced,
			[126]: codeFenced
		};
		/** @satisfies {Extension['string']} */
		const string = {
			[38]: characterReference,
			[92]: characterEscape
		};
		/** @satisfies {Extension['text']} */
		const text = {
			[-5]: lineEnding,
			[-4]: lineEnding,
			[-3]: lineEnding,
			[33]: labelStartImage,
			[38]: characterReference,
			[42]: attention,
			[60]: [autolink, htmlText],
			[91]: labelStartLink,
			[92]: [hardBreakEscape, characterEscape],
			[93]: labelEnd,
			[95]: attention,
			[96]: codeText
		};
		/** @satisfies {Extension['insideSpan']} */
		const insideSpan = { null: [attention, resolver] };
		/** @satisfies {Extension['attentionMarkers']} */
		const attentionMarkers = { null: [42, 95] };
		/** @satisfies {Extension['disable']} */
		const disable = { null: [] };
		//#endregion
		//#region node_modules/.pnpm/micromark@4.0.3/node_modules/micromark/lib/create-tokenizer.js
		/**
		* @import {
		*   Chunk,
		*   Code,
		*   ConstructRecord,
		*   Construct,
		*   Effects,
		*   InitialConstruct,
		*   ParseContext,
		*   Point,
		*   State,
		*   TokenizeContext,
		*   Token
		* } from 'micromark-util-types'
		*/
		/**
		* @callback Restore
		*   Restore the state.
		* @returns {undefined}
		*   Nothing.
		*
		* @typedef Info
		*   Info.
		* @property {Restore} restore
		*   Restore.
		* @property {number} from
		*   From.
		*
		* @callback ReturnHandle
		*   Handle a successful run.
		* @param {Construct} construct
		*   Construct.
		* @param {Info} info
		*   Info.
		* @returns {undefined}
		*   Nothing.
		*/
		/**
		* Create a tokenizer.
		* Tokenizers deal with one type of data (e.g., containers, flow, text).
		* The parser is the object dealing with it all.
		* `initialize` works like other constructs, except that only its `tokenize`
		* function is used, in which case it doesn’t receive an `ok` or `nok`.
		* `from` can be given to set the point before the first character, although
		* when further lines are indented, they must be set with `defineSkip`.
		*
		* @param {ParseContext} parser
		*   Parser.
		* @param {InitialConstruct} initialize
		*   Construct.
		* @param {Omit<Point, '_bufferIndex' | '_index'> | undefined} [from]
		*   Point (optional).
		* @returns {TokenizeContext}
		*   Context.
		*/
		function createTokenizer(parser, initialize, from) {
			/** @type {Point} */
			let point = {
				_bufferIndex: -1,
				_index: 0,
				line: from && from.line || 1,
				column: from && from.column || 1,
				offset: from && from.offset || 0
			};
			/** @type {Record<string, number>} */
			const columnStart = {};
			/** @type {Array<Construct>} */
			const resolveAllConstructs = [];
			/** @type {Array<Chunk>} */
			let chunks = [];
			/** @type {Array<Token>} */
			let stack = [];
			/**
			* Tools used for tokenizing.
			*
			* @type {Effects}
			*/
			const effects = {
				attempt: constructFactory(onsuccessfulconstruct),
				check: constructFactory(onsuccessfulcheck),
				consume,
				enter,
				exit,
				interrupt: constructFactory(onsuccessfulcheck, { interrupt: true })
			};
			/**
			* State and tools for resolving and serializing.
			*
			* @type {TokenizeContext}
			*/
			const context = {
				code: null,
				containerState: {},
				defineSkip,
				events: [],
				now,
				parser,
				previous: null,
				sliceSerialize,
				sliceStream,
				write
			};
			/**
			* The state function.
			*
			* @type {State | undefined}
			*/
			let state = initialize.tokenize.call(context, effects);
			if (initialize.resolveAll) resolveAllConstructs.push(initialize);
			return context;
			/** @type {TokenizeContext['write']} */
			function write(slice) {
				chunks = push(chunks, slice);
				main();
				if (chunks[chunks.length - 1] !== null) return [];
				addResult(initialize, 0);
				context.events = resolveAll(resolveAllConstructs, context.events, context);
				return context.events;
			}
			/** @type {TokenizeContext['sliceSerialize']} */
			function sliceSerialize(token, expandTabs) {
				return serializeChunks(sliceStream(token), expandTabs);
			}
			/** @type {TokenizeContext['sliceStream']} */
			function sliceStream(token) {
				return sliceChunks(chunks, token);
			}
			/** @type {TokenizeContext['now']} */
			function now() {
				const { _bufferIndex, _index, line, column, offset } = point;
				return {
					_bufferIndex,
					_index,
					line,
					column,
					offset
				};
			}
			/** @type {TokenizeContext['defineSkip']} */
			function defineSkip(value) {
				columnStart[value.line] = value.column;
				accountForPotentialSkip();
			}
			/**
			* Main loop (note that `_index` and `_bufferIndex` in `point` are modified by
			* `consume`).
			* Here is where we walk through the chunks, which either include strings of
			* several characters, or numerical character codes.
			* The reason to do this in a loop instead of a call is so the stack can
			* drain.
			*
			* @returns {undefined}
			*   Nothing.
			*/
			function main() {
				while (point._index < chunks.length) {
					const chunk = chunks[point._index];
					if (typeof chunk === "string") {
						const chunkIndex = point._index;
						if (point._bufferIndex < 0) point._bufferIndex = 0;
						while (point._index === chunkIndex && point._bufferIndex < chunk.length) go(chunk.charCodeAt(point._bufferIndex));
					} else go(chunk);
				}
			}
			/**
			* Deal with one code.
			*
			* @param {Code} code
			*   Code.
			* @returns {undefined}
			*   Nothing.
			*/
			function go(code) {
				state = state(code);
			}
			/** @type {Effects['consume']} */
			function consume(code) {
				if (markdownLineEnding(code)) {
					point.line++;
					point.column = 1;
					point.offset += code === -3 ? 2 : 1;
					accountForPotentialSkip();
				} else if (code !== -1) {
					point.column++;
					point.offset++;
				}
				if (point._bufferIndex < 0) point._index++;
				else {
					point._bufferIndex++;
					if (point._bufferIndex === chunks[point._index].length) {
						point._bufferIndex = -1;
						point._index++;
					}
				}
				context.previous = code;
			}
			/** @type {Effects['enter']} */
			function enter(type, fields) {
				/** @type {Token} */
				const token = fields || {};
				token.type = type;
				token.start = now();
				context.events.push([
					"enter",
					token,
					context
				]);
				stack.push(token);
				return token;
			}
			/** @type {Effects['exit']} */
			function exit(type) {
				const token = stack.pop();
				token.end = now();
				context.events.push([
					"exit",
					token,
					context
				]);
				return token;
			}
			/**
			* Use results.
			*
			* @type {ReturnHandle}
			*/
			function onsuccessfulconstruct(construct, info) {
				addResult(construct, info.from);
			}
			/**
			* Discard results.
			*
			* @type {ReturnHandle}
			*/
			function onsuccessfulcheck(_, info) {
				info.restore();
			}
			/**
			* Factory to attempt/check/interrupt.
			*
			* @param {ReturnHandle} onreturn
			*   Callback.
			* @param {{interrupt?: boolean | undefined} | undefined} [fields]
			*   Fields.
			*/
			function constructFactory(onreturn, fields) {
				return hook;
				/**
				* Handle either an object mapping codes to constructs, a list of
				* constructs, or a single construct.
				*
				* @param {Array<Construct> | ConstructRecord | Construct} constructs
				*   Constructs.
				* @param {State} returnState
				*   State.
				* @param {State | undefined} [bogusState]
				*   State.
				* @returns {State}
				*   State.
				*/
				function hook(constructs, returnState, bogusState) {
					/** @type {ReadonlyArray<Construct>} */
					let listOfConstructs;
					/** @type {number} */
					let constructIndex;
					/** @type {Construct} */
					let currentConstruct;
					/** @type {Info} */
					let info;
					return Array.isArray(constructs) ? handleListOfConstructs(constructs) : "tokenize" in constructs ? handleListOfConstructs([constructs]) : handleMapOfConstructs(constructs);
					/**
					* Handle a list of construct.
					*
					* @param {ConstructRecord} map
					*   Constructs.
					* @returns {State}
					*   State.
					*/
					function handleMapOfConstructs(map) {
						return start;
						/** @type {State} */
						function start(code) {
							const left = code !== null && map[code];
							const all = code !== null && map.null;
							return handleListOfConstructs([...Array.isArray(left) ? left : left ? [left] : [], ...Array.isArray(all) ? all : all ? [all] : []])(code);
						}
					}
					/**
					* Handle a list of construct.
					*
					* @param {ReadonlyArray<Construct>} list
					*   Constructs.
					* @returns {State}
					*   State.
					*/
					function handleListOfConstructs(list) {
						listOfConstructs = list;
						constructIndex = 0;
						if (list.length === 0) return bogusState;
						return handleConstruct(list[constructIndex]);
					}
					/**
					* Handle a single construct.
					*
					* @param {Construct} construct
					*   Construct.
					* @returns {State}
					*   State.
					*/
					function handleConstruct(construct) {
						return start;
						/** @type {State} */
						function start(code) {
							info = store();
							currentConstruct = construct;
							if (!construct.partial) context.currentConstruct = construct;
							if (construct.name && context.parser.constructs.disable.null.includes(construct.name)) return nok(code);
							return construct.tokenize.call(fields ? Object.assign(Object.create(context), fields) : context, effects, ok, nok)(code);
						}
					}
					/** @type {State} */
					function ok(code) {
						onreturn(currentConstruct, info);
						return returnState;
					}
					/** @type {State} */
					function nok(code) {
						info.restore();
						if (++constructIndex < listOfConstructs.length) return handleConstruct(listOfConstructs[constructIndex]);
						return bogusState;
					}
				}
			}
			/**
			* @param {Construct} construct
			*   Construct.
			* @param {number} from
			*   From.
			* @returns {undefined}
			*   Nothing.
			*/
			function addResult(construct, from) {
				if (construct.resolveAll && !resolveAllConstructs.includes(construct)) resolveAllConstructs.push(construct);
				if (construct.resolve) splice(context.events, from, context.events.length - from, construct.resolve(context.events.slice(from), context));
				if (construct.resolveTo) context.events = construct.resolveTo(context.events, context);
			}
			/**
			* Store state.
			*
			* @returns {Info}
			*   Info.
			*/
			function store() {
				const startPoint = now();
				const startPrevious = context.previous;
				const startCurrentConstruct = context.currentConstruct;
				const startEventsIndex = context.events.length;
				const startStack = Array.from(stack);
				return {
					from: startEventsIndex,
					restore
				};
				/**
				* Restore state.
				*
				* @returns {undefined}
				*   Nothing.
				*/
				function restore() {
					point = startPoint;
					context.previous = startPrevious;
					context.currentConstruct = startCurrentConstruct;
					context.events.length = startEventsIndex;
					stack = startStack;
					accountForPotentialSkip();
				}
			}
			/**
			* Move the current point a bit forward in the line when it’s on a column
			* skip.
			*
			* @returns {undefined}
			*   Nothing.
			*/
			function accountForPotentialSkip() {
				if (point.line in columnStart && point.column < 2) {
					point.column = columnStart[point.line];
					point.offset += columnStart[point.line] - 1;
				}
			}
		}
		/**
		* Get the chunks from a slice of chunks in the range of a token.
		*
		* @param {ReadonlyArray<Chunk>} chunks
		*   Chunks.
		* @param {Pick<Token, 'end' | 'start'>} token
		*   Token.
		* @returns {Array<Chunk>}
		*   Chunks.
		*/
		function sliceChunks(chunks, token) {
			const startIndex = token.start._index;
			const startBufferIndex = token.start._bufferIndex;
			const endIndex = token.end._index;
			const endBufferIndex = token.end._bufferIndex;
			/** @type {Array<Chunk>} */
			let view;
			if (startIndex === endIndex) view = [chunks[startIndex].slice(startBufferIndex, endBufferIndex)];
			else {
				view = chunks.slice(startIndex, endIndex);
				if (startBufferIndex > -1) {
					const head = view[0];
					if (typeof head === "string") view[0] = head.slice(startBufferIndex);
					else view.shift();
				}
				if (endBufferIndex > 0) view.push(chunks[endIndex].slice(0, endBufferIndex));
			}
			return view;
		}
		/**
		* Get the string value of a slice of chunks.
		*
		* @param {ReadonlyArray<Chunk>} chunks
		*   Chunks.
		* @param {boolean | undefined} [expandTabs=false]
		*   Whether to expand tabs (default: `false`).
		* @returns {string}
		*   Result.
		*/
		function serializeChunks(chunks, expandTabs) {
			let index = -1;
			/** @type {Array<string>} */
			const result = [];
			/** @type {boolean | undefined} */
			let atTab;
			while (++index < chunks.length) {
				const chunk = chunks[index];
				/** @type {string} */
				let value;
				if (typeof chunk === "string") value = chunk;
				else switch (chunk) {
					case -5:
						value = "\r";
						break;
					case -4:
						value = "\n";
						break;
					case -3:
						value = "\r\n";
						break;
					case -2:
						value = expandTabs ? " " : "	";
						break;
					case -1:
						if (!expandTabs && atTab) continue;
						value = " ";
						break;
					default: value = String.fromCharCode(chunk);
				}
				atTab = chunk === -2;
				result.push(value);
			}
			return result.join("");
		}
		//#endregion
		//#region node_modules/.pnpm/micromark@4.0.3/node_modules/micromark/lib/parse.js
		/**
		* @import {
		*   Create,
		*   FullNormalizedExtension,
		*   InitialConstruct,
		*   ParseContext,
		*   ParseOptions
		* } from 'micromark-util-types'
		*/
		/**
		* @param {ParseOptions | null | undefined} [options]
		*   Configuration (optional).
		* @returns {ParseContext}
		*   Parser.
		*/
		function parse(options) {
			/** @type {ParseContext} */
			const parser = {
				constructs: combineExtensions([constructs_exports, ...(options || {}).extensions || []]),
				content: create(content$1),
				defined: [],
				document: create(document$2),
				flow: create(flow$1),
				lazy: {},
				string: create(string$1),
				text: create(text$1)
			};
			return parser;
			/**
			* @param {InitialConstruct} initial
			*   Construct to start with.
			* @returns {Create}
			*   Create a tokenizer.
			*/
			function create(initial) {
				return creator;
				/** @type {Create} */
				function creator(from) {
					return createTokenizer(parser, initial, from);
				}
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark@4.0.3/node_modules/micromark/lib/postprocess.js
		/**
		* @import {Event} from 'micromark-util-types'
		*/
		/**
		* @param {Array<Event>} events
		*   Events.
		* @returns {Array<Event>}
		*   Events.
		*/
		function postprocess(events) {
			while (!subtokenize(events));
			return events;
		}
		//#endregion
		//#region node_modules/.pnpm/micromark@4.0.3/node_modules/micromark/lib/preprocess.js
		/**
		* @import {Chunk, Code, Encoding, Value} from 'micromark-util-types'
		*/
		/**
		* @callback Preprocessor
		*   Preprocess a value.
		* @param {Value} value
		*   Value.
		* @param {Encoding | null | undefined} [encoding]
		*   Encoding when `value` is a typed array (optional).
		* @param {boolean | null | undefined} [end=false]
		*   Whether this is the last chunk (default: `false`).
		* @returns {Array<Chunk>}
		*   Chunks.
		*/
		const search = /[\0\t\n\r]/g;
		/**
		* @returns {Preprocessor}
		*   Preprocess a value.
		*/
		function preprocess() {
			let column = 1;
			let buffer = "";
			/** @type {boolean | undefined} */
			let start = true;
			/** @type {boolean | undefined} */
			let atCarriageReturn;
			return preprocessor;
			/** @type {Preprocessor} */
			function preprocessor(value, encoding, end) {
				value = buffer + (typeof value === "string" ? value.toString() : new TextDecoder(encoding || void 0).decode(value));
				/** @type {Array<Chunk>} */
				const chunks = [];
				let startPosition = 0;
				buffer = "";
				if (start) {
					if (value.charCodeAt(0) === 65279) startPosition++;
					start = void 0;
				}
				while (startPosition < value.length) {
					search.lastIndex = startPosition;
					const match = search.exec(value);
					const endPosition = match && match.index !== void 0 ? match.index : value.length;
					const code = value.charCodeAt(endPosition);
					if (!match) {
						buffer = value.slice(startPosition);
						break;
					}
					if (code === 10 && startPosition === endPosition && atCarriageReturn) {
						chunks.push(-3);
						atCarriageReturn = void 0;
					} else {
						if (atCarriageReturn) {
							chunks.push(-5);
							atCarriageReturn = void 0;
						}
						if (startPosition < endPosition) {
							chunks.push(value.slice(startPosition, endPosition));
							column += endPosition - startPosition;
						}
						switch (code) {
							case 0:
								chunks.push(65533);
								column++;
								break;
							case 9: {
								const next = Math.ceil(column / 4) * 4;
								chunks.push(-2);
								while (column++ < next) chunks.push(-1);
								break;
							}
							case 10:
								chunks.push(-4);
								column = 1;
								break;
							default:
								atCarriageReturn = true;
								column = 1;
						}
					}
					startPosition = endPosition + 1;
				}
				if (end) {
					if (atCarriageReturn) chunks.push(-5);
					if (buffer) chunks.push(buffer);
					chunks.push(null);
				}
				return chunks;
			}
		}
		//#endregion
		//#region node_modules/.pnpm/micromark-util-decode-string@2.0.1/node_modules/micromark-util-decode-string/index.js
		const characterEscapeOrReference = /\\([!-/:-@[-`{-~])|&(#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/gi;
		/**
		* Decode markdown strings (which occur in places such as fenced code info
		* strings, destinations, labels, and titles).
		*
		* The “string” content type allows character escapes and -references.
		* This decodes those.
		*
		* @param {string} value
		*   Value to decode.
		* @returns {string}
		*   Decoded value.
		*/
		function decodeString(value) {
			return value.replace(characterEscapeOrReference, decode);
		}
		/**
		* @param {string} $0
		*   Match.
		* @param {string} $1
		*   Character escape.
		* @param {string} $2
		*   Character reference.
		* @returns {string}
		*   Decoded value
		*/
		function decode($0, $1, $2) {
			if ($1) return $1;
			if ($2.charCodeAt(0) === 35) {
				const head = $2.charCodeAt(1);
				const hex = head === 120 || head === 88;
				return decodeNumericCharacterReference($2.slice(hex ? 2 : 1), hex ? 16 : 10);
			}
			return decodeNamedCharacterReference($2) || $0;
		}
		//#endregion
		//#region node_modules/.pnpm/unist-util-stringify-position@4.0.0/node_modules/unist-util-stringify-position/lib/index.js
		/**
		* @typedef {import('unist').Node} Node
		* @typedef {import('unist').Point} Point
		* @typedef {import('unist').Position} Position
		*/
		/**
		* @typedef NodeLike
		* @property {string} type
		* @property {PositionLike | null | undefined} [position]
		*
		* @typedef PointLike
		* @property {number | null | undefined} [line]
		* @property {number | null | undefined} [column]
		* @property {number | null | undefined} [offset]
		*
		* @typedef PositionLike
		* @property {PointLike | null | undefined} [start]
		* @property {PointLike | null | undefined} [end]
		*/
		/**
		* Serialize the positional info of a point, position (start and end points),
		* or node.
		*
		* @param {Node | NodeLike | Point | PointLike | Position | PositionLike | null | undefined} [value]
		*   Node, position, or point.
		* @returns {string}
		*   Pretty printed positional info of a node (`string`).
		*
		*   In the format of a range `ls:cs-le:ce` (when given `node` or `position`)
		*   or a point `l:c` (when given `point`), where `l` stands for line, `c` for
		*   column, `s` for `start`, and `e` for end.
		*   An empty string (`''`) is returned if the given value is neither `node`,
		*   `position`, nor `point`.
		*/
		function stringifyPosition(value) {
			if (!value || typeof value !== "object") return "";
			if ("position" in value || "type" in value) return position(value.position);
			if ("start" in value || "end" in value) return position(value);
			if ("line" in value || "column" in value) return point$1(value);
			return "";
		}
		/**
		* @param {Point | PointLike | null | undefined} point
		* @returns {string}
		*/
		function point$1(point) {
			return index(point && point.line) + ":" + index(point && point.column);
		}
		/**
		* @param {Position | PositionLike | null | undefined} pos
		* @returns {string}
		*/
		function position(pos) {
			return point$1(pos && pos.start) + "-" + point$1(pos && pos.end);
		}
		/**
		* @param {number | null | undefined} value
		* @returns {number}
		*/
		function index(value) {
			return value && typeof value === "number" ? value : 1;
		}
		//#endregion
		//#region node_modules/.pnpm/mdast-util-from-markdown@2.0.3/node_modules/mdast-util-from-markdown/lib/index.js
		/**
		* @import {
		*   Break,
		*   Blockquote,
		*   Code,
		*   Definition,
		*   Emphasis,
		*   Heading,
		*   Html,
		*   Image,
		*   InlineCode,
		*   Link,
		*   ListItem,
		*   List,
		*   Nodes,
		*   Paragraph,
		*   PhrasingContent,
		*   ReferenceType,
		*   Root,
		*   Strong,
		*   Text,
		*   ThematicBreak
		* } from 'mdast'
		* @import {
		*   Encoding,
		*   Event,
		*   Token,
		*   Value
		* } from 'micromark-util-types'
		* @import {Point} from 'unist'
		* @import {
		*   CompileContext,
		*   CompileData,
		*   Config,
		*   Extension,
		*   Handle,
		*   OnEnterError,
		*   Options
		* } from './types.js'
		*/
		const own = {}.hasOwnProperty;
		/**
		* Turn markdown into a syntax tree.
		*
		* @overload
		* @param {Value} value
		* @param {Encoding | null | undefined} [encoding]
		* @param {Options | null | undefined} [options]
		* @returns {Root}
		*
		* @overload
		* @param {Value} value
		* @param {Options | null | undefined} [options]
		* @returns {Root}
		*
		* @param {Value} value
		*   Markdown to parse.
		* @param {Encoding | Options | null | undefined} [encoding]
		*   Character encoding for when `value` is `Buffer`.
		* @param {Options | null | undefined} [options]
		*   Configuration.
		* @returns {Root}
		*   mdast tree.
		*/
		function fromMarkdown(value, encoding, options) {
			if (encoding && typeof encoding === "object") {
				options = encoding;
				encoding = void 0;
			}
			return compiler(options)(postprocess(parse(options).document().write(preprocess()(value, encoding, true))));
		}
		/**
		* Note this compiler only understand complete buffering, not streaming.
		*
		* @param {Options | null | undefined} [options]
		*/
		function compiler(options) {
			/** @type {Config} */
			const config = {
				transforms: [],
				canContainEols: [
					"emphasis",
					"fragment",
					"heading",
					"paragraph",
					"strong"
				],
				enter: {
					autolink: opener(link),
					autolinkProtocol: onenterdata,
					autolinkEmail: onenterdata,
					atxHeading: opener(heading),
					blockQuote: opener(blockQuote),
					characterEscape: onenterdata,
					characterReference: onenterdata,
					codeFenced: opener(codeFlow),
					codeFencedFenceInfo: buffer,
					codeFencedFenceMeta: buffer,
					codeIndented: opener(codeFlow, buffer),
					codeText: opener(codeText, buffer),
					codeTextData: onenterdata,
					data: onenterdata,
					codeFlowValue: onenterdata,
					definition: opener(definition),
					definitionDestinationString: buffer,
					definitionLabelString: buffer,
					definitionTitleString: buffer,
					emphasis: opener(emphasis),
					hardBreakEscape: opener(hardBreak),
					hardBreakTrailing: opener(hardBreak),
					htmlFlow: opener(html, buffer),
					htmlFlowData: onenterdata,
					htmlText: opener(html, buffer),
					htmlTextData: onenterdata,
					image: opener(image),
					label: buffer,
					link: opener(link),
					listItem: opener(listItem),
					listItemValue: onenterlistitemvalue,
					listOrdered: opener(list, onenterlistordered),
					listUnordered: opener(list),
					paragraph: opener(paragraph),
					reference: onenterreference,
					referenceString: buffer,
					resourceDestinationString: buffer,
					resourceTitleString: buffer,
					setextHeading: opener(heading),
					strong: opener(strong),
					thematicBreak: opener(thematicBreak)
				},
				exit: {
					atxHeading: closer(),
					atxHeadingSequence: onexitatxheadingsequence,
					autolink: closer(),
					autolinkEmail: onexitautolinkemail,
					autolinkProtocol: onexitautolinkprotocol,
					blockQuote: closer(),
					characterEscapeValue: onexitdata,
					characterReferenceMarkerHexadecimal: onexitcharacterreferencemarker,
					characterReferenceMarkerNumeric: onexitcharacterreferencemarker,
					characterReferenceValue: onexitcharacterreferencevalue,
					characterReference: onexitcharacterreference,
					codeFenced: closer(onexitcodefenced),
					codeFencedFence: onexitcodefencedfence,
					codeFencedFenceInfo: onexitcodefencedfenceinfo,
					codeFencedFenceMeta: onexitcodefencedfencemeta,
					codeFlowValue: onexitdata,
					codeIndented: closer(onexitcodeindented),
					codeText: closer(onexitcodetext),
					codeTextData: onexitdata,
					data: onexitdata,
					definition: closer(),
					definitionDestinationString: onexitdefinitiondestinationstring,
					definitionLabelString: onexitdefinitionlabelstring,
					definitionTitleString: onexitdefinitiontitlestring,
					emphasis: closer(),
					hardBreakEscape: closer(onexithardbreak),
					hardBreakTrailing: closer(onexithardbreak),
					htmlFlow: closer(onexithtmlflow),
					htmlFlowData: onexitdata,
					htmlText: closer(onexithtmltext),
					htmlTextData: onexitdata,
					image: closer(onexitimage),
					label: onexitlabel,
					labelText: onexitlabeltext,
					lineEnding: onexitlineending,
					link: closer(onexitlink),
					listItem: closer(),
					listOrdered: closer(),
					listUnordered: closer(),
					paragraph: closer(),
					referenceString: onexitreferencestring,
					resourceDestinationString: onexitresourcedestinationstring,
					resourceTitleString: onexitresourcetitlestring,
					resource: onexitresource,
					setextHeading: closer(onexitsetextheading),
					setextHeadingLineSequence: onexitsetextheadinglinesequence,
					setextHeadingText: onexitsetextheadingtext,
					strong: closer(),
					thematicBreak: closer()
				}
			};
			configure(config, (options || {}).mdastExtensions || []);
			/** @type {CompileData} */
			const data = {};
			return compile;
			/**
			* Turn micromark events into an mdast tree.
			*
			* @param {Array<Event>} events
			*   Events.
			* @returns {Root}
			*   mdast tree.
			*/
			function compile(events) {
				/** @type {Root} */
				let tree = {
					type: "root",
					children: []
				};
				/** @type {Omit<CompileContext, 'sliceSerialize'>} */
				const context = {
					stack: [tree],
					tokenStack: [],
					config,
					enter,
					exit,
					buffer,
					resume,
					data
				};
				/** @type {Array<number>} */
				const listStack = [];
				let index = -1;
				while (++index < events.length) if (events[index][1].type === "listOrdered" || events[index][1].type === "listUnordered") {
					if (events[index][0] === "enter") listStack.push(index);
					else index = prepareList(events, listStack.pop(), index);
				}
				index = -1;
				while (++index < events.length) {
					const handler = config[events[index][0]];
					if (own.call(handler, events[index][1].type)) handler[events[index][1].type].call(Object.assign({ sliceSerialize: events[index][2].sliceSerialize }, context), events[index][1]);
				}
				if (context.tokenStack.length > 0) {
					const tail = context.tokenStack[context.tokenStack.length - 1];
					(tail[1] || defaultOnError).call(context, void 0, tail[0]);
				}
				tree.position = {
					start: point(events.length > 0 ? events[0][1].start : {
						line: 1,
						column: 1,
						offset: 0
					}),
					end: point(events.length > 0 ? events[events.length - 2][1].end : {
						line: 1,
						column: 1,
						offset: 0
					})
				};
				index = -1;
				while (++index < config.transforms.length) tree = config.transforms[index](tree) || tree;
				return tree;
			}
			/**
			* @param {Array<Event>} events
			* @param {number} start
			* @param {number} length
			* @returns {number}
			*/
			function prepareList(events, start, length) {
				let index = start - 1;
				let containerBalance = -1;
				let listSpread = false;
				/** @type {Token | undefined} */
				let listItem;
				/** @type {number | undefined} */
				let lineIndex;
				/** @type {number | undefined} */
				let firstBlankLineIndex;
				/** @type {boolean | undefined} */
				let atMarker;
				while (++index <= length) {
					const event = events[index];
					switch (event[1].type) {
						case "listUnordered":
						case "listOrdered":
						case "blockQuote":
							if (event[0] === "enter") containerBalance++;
							else containerBalance--;
							atMarker = void 0;
							break;
						case "lineEndingBlank":
							if (event[0] === "enter") {
								if (listItem && !atMarker && !containerBalance && !firstBlankLineIndex) firstBlankLineIndex = index;
								atMarker = void 0;
							}
							break;
						case "linePrefix":
						case "listItemValue":
						case "listItemMarker":
						case "listItemPrefix":
						case "listItemPrefixWhitespace": break;
						default: atMarker = void 0;
					}
					if (!containerBalance && event[0] === "enter" && event[1].type === "listItemPrefix" || containerBalance === -1 && event[0] === "exit" && (event[1].type === "listUnordered" || event[1].type === "listOrdered")) {
						if (listItem) {
							let tailIndex = index;
							lineIndex = void 0;
							while (tailIndex--) {
								const tailEvent = events[tailIndex];
								if (tailEvent[1].type === "lineEnding" || tailEvent[1].type === "lineEndingBlank") {
									if (tailEvent[0] === "exit") continue;
									if (lineIndex) {
										events[lineIndex][1].type = "lineEndingBlank";
										listSpread = true;
									}
									tailEvent[1].type = "lineEnding";
									lineIndex = tailIndex;
								} else if (tailEvent[1].type === "linePrefix" || tailEvent[1].type === "blockQuotePrefix" || tailEvent[1].type === "blockQuotePrefixWhitespace" || tailEvent[1].type === "blockQuoteMarker" || tailEvent[1].type === "listItemIndent") {} else break;
							}
							if (firstBlankLineIndex && (!lineIndex || firstBlankLineIndex < lineIndex)) listItem._spread = true;
							listItem.end = Object.assign({}, lineIndex ? events[lineIndex][1].start : event[1].end);
							events.splice(lineIndex || index, 0, [
								"exit",
								listItem,
								event[2]
							]);
							index++;
							length++;
						}
						if (event[1].type === "listItemPrefix") {
							/** @type {Token} */
							const item = {
								type: "listItem",
								_spread: false,
								start: Object.assign({}, event[1].start),
								end: void 0
							};
							listItem = item;
							events.splice(index, 0, [
								"enter",
								item,
								event[2]
							]);
							index++;
							length++;
							firstBlankLineIndex = void 0;
							atMarker = true;
						}
					}
				}
				events[start][1]._spread = listSpread;
				return length;
			}
			/**
			* Create an opener handle.
			*
			* @param {(token: Token) => Nodes} create
			*   Create a node.
			* @param {Handle | undefined} [and]
			*   Optional function to also run.
			* @returns {Handle}
			*   Handle.
			*/
			function opener(create, and) {
				return open;
				/**
				* @this {CompileContext}
				* @param {Token} token
				* @returns {undefined}
				*/
				function open(token) {
					enter.call(this, create(token), token);
					if (and) and.call(this, token);
				}
			}
			/**
			* @type {CompileContext['buffer']}
			*/
			function buffer() {
				this.stack.push({
					type: "fragment",
					children: []
				});
			}
			/**
			* @type {CompileContext['enter']}
			*/
			function enter(node, token, errorHandler) {
				this.stack[this.stack.length - 1].children.push(node);
				this.stack.push(node);
				this.tokenStack.push([token, errorHandler || void 0]);
				node.position = {
					start: point(token.start),
					end: void 0
				};
			}
			/**
			* Create a closer handle.
			*
			* @param {Handle | undefined} [and]
			*   Optional function to also run.
			* @returns {Handle}
			*   Handle.
			*/
			function closer(and) {
				return close;
				/**
				* @this {CompileContext}
				* @param {Token} token
				* @returns {undefined}
				*/
				function close(token) {
					if (and) and.call(this, token);
					exit.call(this, token);
				}
			}
			/**
			* @type {CompileContext['exit']}
			*/
			function exit(token, onExitError) {
				const node = this.stack.pop();
				const open = this.tokenStack.pop();
				if (!open) throw new Error("Cannot close `" + token.type + "` (" + stringifyPosition({
					start: token.start,
					end: token.end
				}) + "): it’s not open");
				else if (open[0].type !== token.type) {
					if (onExitError) onExitError.call(this, token, open[0]);
					else (open[1] || defaultOnError).call(this, token, open[0]);
				}
				node.position.end = point(token.end);
			}
			/**
			* @type {CompileContext['resume']}
			*/
			function resume() {
				return toString(this.stack.pop());
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onenterlistordered() {
				this.data.expectingFirstListItemValue = true;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onenterlistitemvalue(token) {
				if (this.data.expectingFirstListItemValue) {
					const ancestor = this.stack[this.stack.length - 2];
					ancestor.start = Number.parseInt(this.sliceSerialize(token), 10);
					this.data.expectingFirstListItemValue = void 0;
				}
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitcodefencedfenceinfo() {
				const data = this.resume();
				const node = this.stack[this.stack.length - 1];
				node.lang = data;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitcodefencedfencemeta() {
				const data = this.resume();
				const node = this.stack[this.stack.length - 1];
				node.meta = data;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitcodefencedfence() {
				if (this.data.flowCodeInside) return;
				this.buffer();
				this.data.flowCodeInside = true;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitcodefenced() {
				const data = this.resume();
				const node = this.stack[this.stack.length - 1];
				node.value = data.replace(/^(\r?\n|\r)|(\r?\n|\r)$/g, "");
				this.data.flowCodeInside = void 0;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitcodeindented() {
				const data = this.resume();
				const node = this.stack[this.stack.length - 1];
				node.value = data.replace(/(\r?\n|\r)$/g, "");
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitdefinitionlabelstring(token) {
				const label = this.resume();
				const node = this.stack[this.stack.length - 1];
				node.label = label;
				node.identifier = normalizeIdentifier(this.sliceSerialize(token)).toLowerCase();
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitdefinitiontitlestring() {
				const data = this.resume();
				const node = this.stack[this.stack.length - 1];
				node.title = data;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitdefinitiondestinationstring() {
				const data = this.resume();
				const node = this.stack[this.stack.length - 1];
				node.url = data;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitatxheadingsequence(token) {
				const node = this.stack[this.stack.length - 1];
				if (!node.depth) node.depth = this.sliceSerialize(token).length;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitsetextheadingtext() {
				this.data.setextHeadingSlurpLineEnding = true;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitsetextheadinglinesequence(token) {
				const node = this.stack[this.stack.length - 1];
				node.depth = this.sliceSerialize(token).codePointAt(0) === 61 ? 1 : 2;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitsetextheading() {
				this.data.setextHeadingSlurpLineEnding = void 0;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onenterdata(token) {
				/** @type {Array<Nodes>} */
				const siblings = this.stack[this.stack.length - 1].children;
				let tail = siblings[siblings.length - 1];
				if (!tail || tail.type !== "text") {
					tail = text();
					tail.position = {
						start: point(token.start),
						end: void 0
					};
					siblings.push(tail);
				}
				this.stack.push(tail);
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitdata(token) {
				const tail = this.stack.pop();
				tail.value += this.sliceSerialize(token);
				tail.position.end = point(token.end);
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitlineending(token) {
				const context = this.stack[this.stack.length - 1];
				if (this.data.atHardBreak) {
					const tail = context.children[context.children.length - 1];
					tail.position.end = point(token.end);
					this.data.atHardBreak = void 0;
					return;
				}
				if (!this.data.setextHeadingSlurpLineEnding && config.canContainEols.includes(context.type)) {
					onenterdata.call(this, token);
					onexitdata.call(this, token);
				}
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexithardbreak() {
				this.data.atHardBreak = true;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexithtmlflow() {
				const data = this.resume();
				const node = this.stack[this.stack.length - 1];
				node.value = data;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexithtmltext() {
				const data = this.resume();
				const node = this.stack[this.stack.length - 1];
				node.value = data;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitcodetext() {
				const data = this.resume();
				const node = this.stack[this.stack.length - 1];
				node.value = data;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitlink() {
				const node = this.stack[this.stack.length - 1];
				if (this.data.inReference) {
					/** @type {ReferenceType} */
					const referenceType = this.data.referenceType || "shortcut";
					node.type += "Reference";
					node.referenceType = referenceType;
					delete node.url;
					delete node.title;
				} else {
					delete node.identifier;
					delete node.label;
				}
				this.data.referenceType = void 0;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitimage() {
				const node = this.stack[this.stack.length - 1];
				if (this.data.inReference) {
					/** @type {ReferenceType} */
					const referenceType = this.data.referenceType || "shortcut";
					node.type += "Reference";
					node.referenceType = referenceType;
					delete node.url;
					delete node.title;
				} else {
					delete node.identifier;
					delete node.label;
				}
				this.data.referenceType = void 0;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitlabeltext(token) {
				const string = this.sliceSerialize(token);
				const ancestor = this.stack[this.stack.length - 2];
				ancestor.label = decodeString(string);
				ancestor.identifier = normalizeIdentifier(string).toLowerCase();
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitlabel() {
				const fragment = this.stack[this.stack.length - 1];
				const value = this.resume();
				const node = this.stack[this.stack.length - 1];
				this.data.inReference = true;
				if (node.type === "link") node.children = fragment.children;
				else node.alt = value;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitresourcedestinationstring() {
				const data = this.resume();
				const node = this.stack[this.stack.length - 1];
				node.url = data;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitresourcetitlestring() {
				const data = this.resume();
				const node = this.stack[this.stack.length - 1];
				node.title = data;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitresource() {
				this.data.inReference = void 0;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onenterreference() {
				this.data.referenceType = "collapsed";
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitreferencestring(token) {
				const label = this.resume();
				const node = this.stack[this.stack.length - 1];
				node.label = label;
				node.identifier = normalizeIdentifier(this.sliceSerialize(token)).toLowerCase();
				this.data.referenceType = "full";
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitcharacterreferencemarker(token) {
				this.data.characterReferenceType = token.type;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitcharacterreferencevalue(token) {
				const data = this.sliceSerialize(token);
				const type = this.data.characterReferenceType;
				/** @type {string} */
				let value;
				if (type) {
					value = decodeNumericCharacterReference(data, type === "characterReferenceMarkerNumeric" ? 10 : 16);
					this.data.characterReferenceType = void 0;
				} else value = decodeNamedCharacterReference(data);
				const tail = this.stack[this.stack.length - 1];
				tail.value += value;
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitcharacterreference(token) {
				const tail = this.stack.pop();
				tail.position.end = point(token.end);
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitautolinkprotocol(token) {
				onexitdata.call(this, token);
				const node = this.stack[this.stack.length - 1];
				node.url = this.sliceSerialize(token);
			}
			/**
			* @this {CompileContext}
			* @type {Handle}
			*/
			function onexitautolinkemail(token) {
				onexitdata.call(this, token);
				const node = this.stack[this.stack.length - 1];
				node.url = "mailto:" + this.sliceSerialize(token);
			}
			/** @returns {Blockquote} */
			function blockQuote() {
				return {
					type: "blockquote",
					children: []
				};
			}
			/** @returns {Code} */
			function codeFlow() {
				return {
					type: "code",
					lang: null,
					meta: null,
					value: ""
				};
			}
			/** @returns {InlineCode} */
			function codeText() {
				return {
					type: "inlineCode",
					value: ""
				};
			}
			/** @returns {Definition} */
			function definition() {
				return {
					type: "definition",
					identifier: "",
					label: null,
					title: null,
					url: ""
				};
			}
			/** @returns {Emphasis} */
			function emphasis() {
				return {
					type: "emphasis",
					children: []
				};
			}
			/** @returns {Heading} */
			function heading() {
				return {
					type: "heading",
					depth: 0,
					children: []
				};
			}
			/** @returns {Break} */
			function hardBreak() {
				return { type: "break" };
			}
			/** @returns {Html} */
			function html() {
				return {
					type: "html",
					value: ""
				};
			}
			/** @returns {Image} */
			function image() {
				return {
					type: "image",
					title: null,
					url: "",
					alt: null
				};
			}
			/** @returns {Link} */
			function link() {
				return {
					type: "link",
					title: null,
					url: "",
					children: []
				};
			}
			/**
			* @param {Token} token
			* @returns {List}
			*/
			function list(token) {
				return {
					type: "list",
					ordered: token.type === "listOrdered",
					start: null,
					spread: token._spread,
					children: []
				};
			}
			/**
			* @param {Token} token
			* @returns {ListItem}
			*/
			function listItem(token) {
				return {
					type: "listItem",
					spread: token._spread,
					checked: null,
					children: []
				};
			}
			/** @returns {Paragraph} */
			function paragraph() {
				return {
					type: "paragraph",
					children: []
				};
			}
			/** @returns {Strong} */
			function strong() {
				return {
					type: "strong",
					children: []
				};
			}
			/** @returns {Text} */
			function text() {
				return {
					type: "text",
					value: ""
				};
			}
			/** @returns {ThematicBreak} */
			function thematicBreak() {
				return { type: "thematicBreak" };
			}
		}
		/**
		* Copy a point-like value.
		*
		* @param {Point} d
		*   Point-like value.
		* @returns {Point}
		*   unist point.
		*/
		function point(d) {
			return {
				line: d.line,
				column: d.column,
				offset: d.offset
			};
		}
		/**
		* @param {Config} combined
		* @param {Array<Array<Extension> | Extension>} extensions
		* @returns {undefined}
		*/
		function configure(combined, extensions) {
			let index = -1;
			while (++index < extensions.length) {
				const value = extensions[index];
				if (Array.isArray(value)) configure(combined, value);
				else extension(combined, value);
			}
		}
		/**
		* @param {Config} combined
		* @param {Extension} extension
		* @returns {undefined}
		*/
		function extension(combined, extension) {
			/** @type {keyof Extension} */
			let key;
			for (key in extension) if (own.call(extension, key)) switch (key) {
				case "canContainEols": {
					const right = extension[key];
					if (right) combined[key].push(...right);
					break;
				}
				case "transforms": {
					const right = extension[key];
					if (right) combined[key].push(...right);
					break;
				}
				case "enter":
				case "exit": {
					const right = extension[key];
					if (right) Object.assign(combined[key], right);
					break;
				}
			}
		}
		/** @type {OnEnterError} */
		function defaultOnError(left, right) {
			if (left) throw new Error("Cannot close `" + left.type + "` (" + stringifyPosition({
				start: left.start,
				end: left.end
			}) + "): a different token (`" + right.type + "`, " + stringifyPosition({
				start: right.start,
				end: right.end
			}) + ") is open");
			else throw new Error("Cannot close document, a token (`" + right.type + "`, " + stringifyPosition({
				start: right.start,
				end: right.end
			}) + ") is still open");
		}
		//#endregion
		//#region src/client/qq-system-faces.ts
		const qzoneFaceCodes = {
			0: 114,
			1: 101,
			2: 102,
			3: 103,
			4: 104,
			5: 105,
			6: 106,
			7: 107,
			8: 108,
			9: 109,
			10: 110,
			11: 111,
			12: 112,
			13: 113,
			14: 100,
			15: 115,
			16: 116,
			18: 118,
			19: 119,
			20: 120,
			21: 121,
			22: 122,
			23: 123,
			24: 124,
			25: 125,
			26: 126,
			27: 127,
			28: 128,
			29: 129,
			30: 130,
			31: 131,
			32: 132,
			33: 133,
			34: 134,
			35: 135,
			36: 136,
			37: 137,
			38: 138,
			39: 139,
			41: 193,
			42: 190,
			43: 192,
			46: 162,
			49: 178,
			53: 168,
			55: 170,
			56: 171,
			59: 174,
			60: 160,
			63: 163,
			64: 164,
			66: 166,
			67: 167,
			74: 176,
			75: 175,
			76: 179,
			77: 180,
			78: 181,
			79: 182,
			85: 191,
			86: 194,
			89: 156,
			96: 117,
			97: 140,
			98: 141,
			99: 142,
			100: 143,
			101: 144,
			102: 145,
			103: 146,
			104: 147,
			105: 148,
			106: 149,
			107: 150,
			108: 151,
			109: 152,
			110: 153,
			111: 154,
			112: 155,
			114: 158,
			116: 165,
			118: 183,
			119: 184,
			120: 185,
			121: 186,
			122: 187,
			123: 188,
			124: 189,
			125: 195,
			129: 199,
			137: 121002,
			144: 121009,
			146: 121011,
			147: 121012,
			148: 121013,
			169: 121034,
			171: 241,
			172: 242,
			173: 243,
			174: 244,
			175: 245,
			176: 246,
			177: 247,
			178: 248,
			179: 249,
			180: 250,
			181: 251,
			182: 252,
			183: 253,
			185: 255,
			187: 257,
			193: 263,
			194: 264,
			198: 268,
			200: 270,
			201: 271,
			202: 272,
			203: 273,
			204: 274,
			206: 276,
			210: 280,
			211: 281,
			212: 282,
			214: 284,
			215: 285,
			216: 286,
			217: 287,
			218: 288,
			219: 289,
			221: 291,
			222: 292,
			223: 293,
			224: 295,
			225: 296,
			226: 297,
			227: 294,
			229: 299,
			230: 300,
			231: 301,
			232: 302,
			233: 303,
			235: 305,
			237: 307,
			238: 308,
			239: 309,
			240: 310,
			241: 311,
			243: 313,
			244: 312,
			262: 10262,
			263: 10263,
			264: 10264,
			265: 10265,
			266: 10266,
			267: 10267,
			268: 10268,
			269: 10269,
			270: 10270,
			271: 10271,
			272: 10272,
			273: 10273,
			277: 10277,
			278: 20237,
			281: 10281,
			282: 10282,
			283: 10283,
			284: 10284,
			285: 10285,
			286: 10286,
			287: 10287,
			288: 10288,
			289: 10289,
			290: 20240,
			292: 20242,
			293: 10293,
			294: 10294,
			295: 10295,
			297: 10297,
			298: 10298,
			299: 10299,
			300: 10300,
			301: 10301,
			302: 10302,
			303: 10303,
			305: 10305,
			306: 10306,
			307: 10307,
			311: 10311,
			312: 10312,
			314: 10314,
			317: 10317,
			318: 10318,
			319: 10319,
			320: 10320,
			322: 10322,
			323: 10323,
			324: 10324,
			325: 10325,
			326: 10326,
			332: 10332,
			333: 10333,
			334: 10334,
			336: 10336,
			337: 10337,
			338: 10338,
			339: 10339,
			341: 10341,
			342: 10342,
			343: 10343,
			344: 10344,
			345: 10345,
			346: 10346,
			347: 10347,
			348: 10348,
			349: 10349,
			350: 10350,
			351: 10351,
			352: 10352,
			353: 10353,
			354: 10354,
			355: 10355,
			356: 10356,
			357: 10357,
			358: 10358,
			359: 10359,
			360: 10360,
			361: 10361,
			362: 10362,
			363: 10363,
			364: 10364,
			365: 10365,
			366: 10366,
			367: 10367,
			368: 10368,
			369: 10369,
			370: 10370,
			371: 10371,
			372: 10372,
			373: 10373,
			374: 10374,
			375: 10375,
			376: 10376,
			377: 10377,
			378: 10378,
			379: 10379,
			380: 10380,
			381: 10381,
			382: 10382,
			383: 10383,
			384: 10384,
			385: 10385,
			386: 10386,
			387: 10387,
			388: 10388,
			389: 10389,
			390: 10390,
			391: 10391,
			392: 10392,
			393: 10393,
			394: 10394,
			395: 10395,
			396: 10396,
			397: 10397,
			398: 10398,
			399: 10399,
			400: 10400,
			401: 10401,
			402: 10402,
			403: 10403,
			404: 10404,
			405: 10405,
			406: 10406,
			407: 10407,
			408: 10408,
			409: 10409,
			410: 10410,
			411: 10411,
			412: 10412,
			413: 10413,
			415: 10415,
			416: 10416,
			417: 10417,
			418: 10418,
			419: 10419,
			420: 10420,
			421: 10421,
			422: 10422,
			423: 10423,
			424: 10424,
			425: 10425,
			426: 10426,
			427: 10427,
			428: 10428,
			429: 10429,
			430: 10430,
			431: 10431,
			432: 10432,
			433: 10433,
			434: 10434,
			435: 10435,
			436: 10436,
			437: 10437,
			438: 10438,
			439: 10439,
			440: 10440,
			441: 10441,
			442: 10442,
			443: 10443,
			444: 10444,
			445: 10445,
			446: 10446,
			447: 10443,
			448: 10448,
			449: 10449,
			450: 10450,
			451: 10451,
			452: 10452,
			453: 10453,
			454: 10454,
			455: 10455,
			456: 10456,
			457: 10457,
			458: 10458,
			459: 10459,
			460: 10460,
			461: 10461,
			462: 10462,
			463: 10463,
			464: 10464,
			465: 10465,
			466: 10466,
			467: 10467,
			468: 10468,
			469: 10469,
			470: 10470,
			471: 10471,
			472: 10472,
			473: 10473,
			474: 10474,
			475: 10475,
			476: 10476,
			477: 10477,
			478: 10478,
			479: 10479,
			480: 10480,
			481: 10481,
			482: 10482,
			483: 10483,
			484: 10484,
			485: 10485,
			486: 10486,
			487: 10487,
			488: 10488,
			489: 10489,
			490: 10490,
			491: 10491,
			492: 10492,
			493: 10493,
			494: 10494,
			495: 10495,
			496: 10496,
			497: 10497,
			498: 10498,
			499: 10499,
			500: 10500,
			501: 10501,
			502: 10502,
			503: 10503,
			504: 10504,
			505: 10505,
			506: 10506,
			507: 10507,
			508: 10508,
			509: 10509,
			510: 10510,
			511: 10511,
			512: 10512,
			513: 10513,
			514: 10514,
			515: 10515,
			524: 10524
		};
		//#endregion
		//#region src/client/timeline-markdown.ts
		const special = /(?<image>!\[)|(?<shortcut><qqbot-cmd-input\s+text="[^"\r\n]*"\s+show="(?<show>[^"\r\n]*)"\s*\/>)|<faceType=(?<type>\d{1,3}),faceId="(?<faceId>[^"\r\n]{0,24})",ext="(?<ext>[^"\r\n]{0,2048})">|\[<face,id=(?<oldId>\d{1,4})\/?>]/g;
		function escapedText(text) {
			return text.replace(/[\\\u0060*_~[\]()<>!&|]/g, "\\$&");
		}
		function faceName(ext) {
			if (!ext) return void 0;
			try {
				const bytes = Uint8Array.from(atob(ext), (char) => char.charCodeAt(0));
				const data = JSON.parse(new TextDecoder().decode(bytes));
				if (data && typeof data === "object" && "text" in data && typeof data.text === "string") return data.text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80) || void 0;
			} catch {}
		}
		function unicodeEmoji(id) {
			const numeric = /^\d{4,7}$/.test(id) ? Number(id) : void 0;
			if (numeric !== void 0 && numeric > 1114111) return void 0;
			const text = numeric === void 0 ? id : String.fromCodePoint(numeric);
			return /\p{Extended_Pictographic}|\p{Emoji_Presentation}/u.test(text) ? escapedText(text) : void 0;
		}
		function faceMarkdown(groups, options) {
			const id = groups.faceId ?? groups.oldId ?? "";
			const type = groups.type ?? "1";
			if (type === "6" && options.hasImage) return " ";
			const label = escapedText(faceName(groups.ext) ?? (type === "6" ? options.stickerLabel : options.faceLabel));
			const asset = type === "1" && /^\d{1,4}$/.test(id) ? qzoneFaceCodes[Number(id)] : void 0;
			if (asset !== void 0) return "![" + label + "](https://qzonestyle.gtimg.cn/qzone/em/e" + asset + ".gif)";
			if (type === "2") return unicodeEmoji(id) ?? label;
			return label;
		}
		function displayShortcut(text, index, length, display) {
			const value = display.trim();
			if (!value) return " ";
			const backtick = "`";
			let width = 1;
			for (const run of value.matchAll(/\u0060+/g)) width = Math.max(width, run[0].length + 1);
			const delimiter = backtick.repeat(width);
			return ((index === 0 || text[index - 1] === "\n") && /^[ \t]*(?:\r?\n|$)/.test(text.slice(index + length)) ? "- " : "") + delimiter + " " + value + " " + delimiter;
		}
		/** Project QQ tokens to Markdown. Command labels are inert and only known face assets load automatically. */
		function timelineMarkdown(text, options) {
			const matches = [...text.matchAll(special)];
			if (!matches.length) return text;
			const literals = [];
			const pending = [fromMarkdown(text)];
			while (pending.length) {
				const node = pending.pop();
				if (!node) break;
				if (node.type === "code" || node.type === "inlineCode") {
					const start = node.position?.start.offset;
					const end = node.position?.end.offset;
					if (start !== void 0 && end !== void 0) literals.push({
						start,
						end
					});
				} else if (node.children) pending.push(...node.children);
			}
			let output = "";
			let done = 0;
			for (const match of matches) {
				const index = match.index;
				const groups = match.groups;
				if (!groups || literals.some(({ start, end }) => start <= index && index < end)) continue;
				let slashes = 0;
				while (text[index - slashes - 1] === "\\") slashes++;
				if (slashes % 2) continue;
				output += text.slice(done, index);
				output += groups.image ? "\\![" : groups.shortcut ? displayShortcut(text, index, match[0].length, groups.show ?? "") : faceMarkdown(groups, options);
				done = index + match[0].length;
			}
			return output + text.slice(done);
		}
		//#endregion
		//#region src/client/workbench-timeline.ts
		function statusLabel(status) {
			return {
				received: t("已收到"),
				sending: t("发送中"),
				partial: t("QQ 已接受部分内容"),
				accepted: t("QQ 接口已接受"),
				rejected: t("QQ 拒绝"),
				unknown: t("结果未知")
			}[status];
		}
		function inboundLabel(outcome) {
			return {
				"mention-required": t("已收到，未 @ 机器人"),
				"rate-limited": t("触发频率限制"),
				"queue-full": t("处理队列已满"),
				empty: t("没有可提交给 DSH 的内容"),
				submitted: t("已提交到 DSH"),
				"submit-failed": t("提交到 DSH 失败"),
				"session-archived": t("当前 Session 已归档，消息未提交")
			}[outcome];
		}
		function sourceLabel(source) {
			return {
				automatic: t("自动回复"),
				agent: t("Agent 投递"),
				manual: t("网页直发"),
				answer: t("Session 回答")
			}[source];
		}
		var TimelineState = class {
			readingPositions = /* @__PURE__ */ new Map();
			composer = new ComposerState();
		};
		function rowOffset(list, row) {
			return row.getBoundingClientRect().top - list.getBoundingClientRect().top;
		}
		function visiblePosition(list) {
			const top = list.getBoundingClientRect().top;
			for (const row of list.querySelectorAll("[data-entry-id]")) {
				const entryId = row.dataset.entryId;
				if (entryId && row.getBoundingClientRect().bottom > top) return {
					entryId,
					offset: rowOffset(list, row)
				};
			}
		}
		function grouped(previous, row) {
			return !!previous && previous.direction === row.direction && (row.direction === "outbound" || !!row.senderId && previous.senderId === row.senderId) && row.at >= previous.at && row.at - previous.at < 18e4;
		}
		function updateLatest(current, latest) {
			if (!current || current.generation !== latest.generation || !latest.entries.length) return latest;
			const overlap = current.entries.findIndex((row) => row.id === latest.entries[0]?.id);
			if (overlap < 0) return latest;
			return {
				...latest,
				entries: [...current.entries.slice(0, overlap), ...latest.entries],
				before: overlap > 0 ? current.before : latest.before
			};
		}
		function QqTimelineView({ state, appId, peer, robotName, disabledReason, openSession, refreshKey }) {
			const language = useQqLocale();
			const dateFormat = new Intl.DateTimeFormat(language, { dateStyle: "medium" });
			const { readingPositions } = state;
			const { scope, openId, recording } = peer;
			const key = JSON.stringify([
				appId,
				scope,
				openId
			]);
			const [resume] = (0, react.useState)(() => readingPositions.get(key));
			const [page, setPage] = (0, react.useState)();
			const [error, setError] = (0, react.useState)("");
			const [readingOlder, setReadingOlder] = (0, react.useState)(false);
			const [refresh, setRefresh] = (0, react.useState)(0);
			const [newMessages, setNewMessages] = (0, react.useState)(false);
			const latestId = (0, react.useRef)(void 0);
			const list = (0, react.useRef)(null);
			const composer = (0, react.useRef)(null);
			const lifetime = (0, react.useRef)(null);
			const follow = (0, react.useRef)(!resume);
			const olderHeight = (0, react.useRef)(void 0);
			const pendingPosition = (0, react.useRef)(resume);
			const openedFrom = (0, react.useRef)();
			(0, react.useLayoutEffect)(() => {
				const node = list.current;
				return () => {
					readingPositions.delete(key);
					const position = openedFrom.current ?? pendingPosition.current ?? (node && node.clientHeight > 0 && !follow.current ? visiblePosition(node) : void 0);
					if (!position) return;
					readingPositions.set(key, position);
					if (readingPositions.size > 100) {
						const oldest = readingPositions.keys().next();
						if (!oldest.done) readingPositions.delete(oldest.value);
					}
				};
			}, [key]);
			const params = (before) => {
				const query = new URLSearchParams({
					appId,
					scope,
					openId
				});
				if (before) query.set("before", before);
				return `${WORKBENCH_TIMELINE_PATH}?${query}`;
			};
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				lifetime.current = controller;
				let timer;
				const read = async () => {
					try {
						const options = {
							signal: controller.signal,
							cache: "no-store"
						};
						const latest = await fetchJson(params(), options);
						let visible = latest;
						const position = pendingPosition.current;
						if (position && latest.before && !latest.entries.some((row) => row.id === position.entryId)) {
							const target = `${params()}&${new URLSearchParams({ entryId: position.entryId })}`;
							const exists = await fetch(target, options);
							exists.body?.cancel();
							if (exists.ok) while (visible.before && !visible.entries.some((row) => row.id === position.entryId)) {
								const older = await fetchJson(params(visible.before), options);
								if (older.generation !== visible.generation) break;
								visible = {
									...visible,
									entries: [...older.entries, ...visible.entries],
									before: older.before,
									incomplete: older.incomplete || visible.incomplete
								};
							}
						}
						if (controller.signal.aborted) return;
						const tail = latest.entries.at(-1)?.id;
						if (!follow.current && latestId.current && tail !== latestId.current) setNewMessages(true);
						latestId.current = tail;
						setPage((previous) => position ? visible : updateLatest(previous, latest));
						setError("");
					} catch (cause) {
						if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t("无法读取 QQ 流水"));
					} finally {
						if (!controller.signal.aborted) timer = setTimeout(() => {
							read();
						}, 4e3);
					}
				};
				read();
				return () => {
					controller.abort();
					clearTimeout(timer);
				};
			}, [
				appId,
				scope,
				openId,
				refresh,
				refreshKey
			]);
			(0, react.useLayoutEffect)(() => {
				const node = list.current;
				if (!node) return;
				const position = pendingPosition.current;
				if (position && page) {
					pendingPosition.current = void 0;
					const row = node.querySelector(`[data-entry-id="${CSS.escape(position.entryId)}"]`);
					if (row) node.scrollTop += rowOffset(node, row) - position.offset;
					else follow.current = true;
					if (follow.current) node.scrollTop = node.scrollHeight;
				} else if (olderHeight.current !== void 0) {
					node.scrollTop += node.scrollHeight - olderHeight.current;
					olderHeight.current = void 0;
				} else if (follow.current) node.scrollTop = node.scrollHeight;
			}, [page]);
			const openLinked = async (row, element) => {
				if (!openSession || !row.sessionId) return;
				const node = list.current;
				const message = element.closest("[data-entry-id]");
				const position = node && message ? {
					entryId: row.id,
					offset: rowOffset(node, message)
				} : void 0;
				openedFrom.current = position;
				if (await openSession(row.sessionId) === false && openedFrom.current === position) openedFrom.current = void 0;
			};
			const loadOlder = async () => {
				const before = page?.before;
				const signal = lifetime.current?.signal;
				if (!before || !signal || readingOlder) return;
				setReadingOlder(true);
				try {
					const older = await fetchJson(params(before), {
						signal,
						cache: "no-store"
					});
					if (signal.aborted) return;
					olderHeight.current = list.current?.scrollHeight;
					setPage((current) => current?.before === before && current.generation === older.generation ? {
						...current,
						entries: [...older.entries, ...current.entries],
						before: older.before,
						incomplete: current.incomplete || older.incomplete
					} : current);
					setError("");
				} catch (cause) {
					if (!signal.aborted) {
						if (cause instanceof HttpError && cause.status === 404) setRefresh((value) => value + 1);
						else setError(cause instanceof Error ? cause.message : t("无法读取更早记录"));
					}
				} finally {
					setReadingOlder(false);
				}
			};
			const refreshEntry = async (id) => {
				const signal = lifetime.current?.signal;
				if (!signal || signal.aborted) return void 0;
				const query = new URLSearchParams({
					appId,
					scope,
					openId,
					entryId: id
				});
				const entry = await fetchJson(`${WORKBENCH_TIMELINE_PATH}?${query}`, {
					signal,
					cache: "no-store"
				});
				if (signal.aborted) return void 0;
				setPage((current) => current && {
					...current,
					entries: current.entries.map((row) => row.id === id ? entry : row)
				});
				return entry;
			};
			const reload = () => setRefresh((value) => value + 1);
			const jump = () => {
				follow.current = true;
				setNewMessages(false);
				if (list.current) list.current.scrollTop = list.current.scrollHeight;
			};
			const entries = page?.entries ?? [];
			return (0, react.createElement)("section", {
				className: "imqw-timeline",
				"aria-label": t("QQ 消息")
			}, !recording || refreshKey === void 0 ? (0, react.createElement)("div", { className: "imqw-timeline-notice" }, !recording ? (0, react.createElement)("span", { className: "imqw-muted" }, t("已暂停记录新消息")) : null, refreshKey === void 0 ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				disabled: readingOlder,
				onClick: reload
			}, t("刷新消息")) : null) : null, error || page?.incomplete ? (0, react.createElement)("div", { className: "imqw-timeline-notice" }, (0, react.createElement)("p", {
				role: "alert",
				className: "imqb-error"
			}, error || t("消息记录可能不完整。")), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				disabled: readingOlder,
				onClick: reload
			}, t("重试"))) : null, (0, react.createElement)("div", {
				className: "imqw-timeline-scroll",
				ref: list,
				onScroll: () => {
					const node = list.current;
					if (!node) return;
					follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
					if (follow.current) setNewMessages(false);
				}
			}, !page && !error ? (0, react.createElement)("p", {
				role: "status",
				className: "imqw-timeline-empty imqw-muted"
			}, t("正在读取消息…")) : null, page?.entries.length === 0 ? (0, react.createElement)("p", { className: "imqw-timeline-empty imqw-muted" }, t("还没有已保存的 QQ 消息。")) : null, page?.before ? (0, react.createElement)("div", { className: "imqw-timeline-older" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				disabled: readingOlder,
				onClick: () => {
					loadOlder();
				}
			}, readingOlder ? t("正在读取…") : t("加载更早消息"))) : null, (0, react.createElement)("ol", { className: "imqw-timeline-list" }, entries.flatMap((row, index) => {
				const previous = entries[index - 1];
				const newDay = !previous || dateFormat.format(previous.at) !== dateFormat.format(row.at);
				const message = (0, react.createElement)(MessageRow, {
					key: row.id,
					row,
					appId,
					scope,
					openId,
					robotName,
					openLinked: openSession && openLinked,
					refreshEntry,
					peerName: scope === "c2c" ? peer.alias || peer.name : void 0,
					onReply: !disabledReason && canQuoteTimelineEntry(row) ? (sender) => composer.current?.replyTo(row, sender) : void 0,
					compact: !newDay && grouped(previous, row)
				});
				return newDay ? [(0, react.createElement)("li", {
					key: "date-" + row.id,
					className: "imqw-message-day"
				}, dateFormat.format(row.at)), message] : [message];
			}))), newMessages ? (0, react.createElement)("div", { className: "imqw-message-jump" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				onClick: jump
			}, t("查看最新消息 ↓"))) : null, (0, react.createElement)(QqComposer, {
				state: state.composer,
				ref: composer,
				appId,
				peer,
				robotName,
				disabledReason,
				onUpdate: reload
			}));
		}
		function MessageRow({ row, appId, scope, openId, robotName, peerName, openLinked, refreshEntry, onReply, compact }) {
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const [detailsOpen, setDetailsOpen] = (0, react.useState)(false);
			const [showSource, setShowSource] = (0, react.useState)(false);
			const [checking, setChecking] = (0, react.useState)(false);
			const [receiptNote, setReceiptNote] = (0, react.useState)("");
			const menuButton = (0, react.useRef)(null);
			const outbound = row.direction === "outbound";
			const sender = outbound ? robotName : peerName || row.senderName || (scope === "c2c" ? t("私聊 {0}", openId.slice(-8)) : row.senderId ? t("成员 {0}", row.senderId.slice(-8)) : t("QQ 成员"));
			const errorCode = [row.httpStatus && `HTTP ${row.httpStatus}`, row.platformCode && `QQ ${row.platformCode}`].filter(Boolean).join(" · ");
			const linkedSession = row.sessionId;
			const actions = [];
			if (onReply) actions.push({
				id: "quote",
				label: t("引用回复")
			});
			if (linkedSession && openLinked) actions.push({
				id: "session",
				label: t("打开关联 Session")
			});
			if (row.text) actions.push({
				id: "source",
				label: showSource ? t("查看排版") : t("查看原文")
			});
			actions.push({
				id: "details",
				label: detailsOpen ? t("收起响应详情") : t("响应详情")
			});
			const queryReceipt = async () => {
				setChecking(true);
				setReceiptNote("");
				try {
					if ((await refreshEntry(row.id))?.status === "unknown") setReceiptNote(t("记录仍未确认结果，请在 QQ 核对。"));
				} catch (error) {
					setReceiptNote(error instanceof Error ? error.message : t("无法查询发送记录。"));
				} finally {
					setChecking(false);
				}
			};
			const detail = row.inboundOutcome ? inboundLabel(row.inboundOutcome) : statusLabel("received");
			const pendingReceipt = outbound && (row.status === "unknown" || row.status === "sending");
			const showStatus = outbound && row.status !== "accepted";
			const submissionFailed = !outbound && row.inboundOutcome === "submit-failed";
			const imageCount = row.imageCount ?? 0;
			const remaining = (row.attachments ?? 0) - imageCount;
			return (0, react.createElement)("li", {
				className: "imqw-timeline-row",
				"data-direction": row.direction,
				"data-compact": compact,
				"data-entry-id": row.id
			}, (0, react.createElement)("span", {
				className: "imqw-message-avatar",
				"aria-hidden": true
			}, !compact && [...sender][0]?.toUpperCase()), (0, react.createElement)("div", { className: "imqw-message-body" }, compact ? null : (0, react.createElement)("div", { className: "imqw-timeline-meta" }, (0, react.createElement)("strong", { title: sender }, sender), (0, react.createElement)("time", { dateTime: new Date(row.at).toISOString() }, new Intl.DateTimeFormat(locale(), { timeStyle: "short" }).format(row.at))), (0, react.createElement)("div", { className: "imqw-message-line" }, (0, react.createElement)("div", { className: "imqw-timeline-bubble" }, row.quote ? (0, react.createElement)("blockquote", null, row.quote.senderName ? (0, react.createElement)("strong", null, row.quote.senderName) : null, row.quote.text ? (0, react.createElement)("div", null, row.quote.displayText ?? row.quote.text) : null, row.quote.attachments ? (0, react.createElement)("span", { className: "imqw-muted" }, t("引用附件 · {0} 项", row.quote.attachments)) : null) : null, row.text ? showSource ? (0, react.createElement)("pre", {
				className: "imqw-timeline-text imqw-timeline-source",
				"aria-label": t("消息原文")
			}, row.text) : (0, react.createElement)(MessageMarkdown, {
				text: row.displayText ?? row.text,
				hasImage: imageCount > 0
			}) : null, imageCount > 0 ? (0, react.createElement)("div", { className: "imqw-message-images" }, Array.from({ length: imageCount }, (_, index) => {
				const query = new URLSearchParams({
					appId,
					scope,
					openId,
					entryId: row.id,
					image: String(index)
				});
				return (0, react.createElement)(MessageImage, {
					key: index,
					url: `${WORKBENCH_TIMELINE_PATH}?${query}`,
					number: index + 1
				});
			})) : null, remaining > 0 ? (0, react.createElement)("div", { className: "imqw-muted" }, row.attachmentName ? t("附件 · {0}", row.attachmentName) : t("附件 · {0} 项", remaining)) : null), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
				open: menuOpen,
				items: actions,
				portal: true,
				align: outbound ? "end" : "start",
				compact: true,
				autoFocus: true,
				onClose: () => setMenuOpen(false),
				onSelect: (id) => {
					setMenuOpen(false);
					if (id === "quote") onReply?.(sender);
					if (id === "session" && menuButton.current) openLinked?.(row, menuButton.current);
					if (id === "source") setShowSource((value) => !value);
					if (id === "details") setDetailsOpen((value) => !value);
				},
				anchor: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					ref: menuButton,
					type: "button",
					size: "sm",
					variant: "ghost",
					className: "imqw-message-action",
					"aria-label": t("{0}的消息操作", sender),
					title: t("消息操作"),
					"aria-haspopup": "menu",
					"aria-expanded": menuOpen,
					onClick: () => setMenuOpen((open) => !open)
				}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconEllipsisOutlineRegular, { size: 14 }))
			})), showStatus || submissionFailed ? (0, react.createElement)("div", { className: "imqw-timeline-meta" }, (0, react.createElement)("span", { "data-status": submissionFailed ? "rejected" : row.status }, submissionFailed ? detail : statusLabel(row.status)), pendingReceipt ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				variant: "ghost",
				size: "sm",
				disabled: checking,
				onClick: () => {
					queryReceipt();
				}
			}, checking ? t("查询中…") : t("查询回执")) : null) : null, detailsOpen ? (0, react.createElement)("div", {
				className: "imqw-response-detail",
				role: "region",
				"aria-label": t("响应详情")
			}, outbound ? (0, react.createElement)("p", null, row.source ? t("来源 · {0}", sourceLabel(row.source)) : t("来源未记录"), (0, react.createElement)("br"), statusLabel(row.status), errorCode ? ` · ${errorCode}` : "") : (0, react.createElement)("p", null, detail)) : null, receiptNote ? (0, react.createElement)("p", {
				className: "imqw-response-detail",
				role: "status"
			}, receiptNote) : null));
		}
		function MessageMarkdown({ text, hasImage }) {
			const language = useQqLocale();
			const faceLabel = t("QQ 表情");
			const stickerLabel = t("表情包");
			const prepared = (0, react.useMemo)(() => timelineMarkdown(text, {
				hasImage,
				faceLabel,
				stickerLabel
			}), [
				text,
				hasImage,
				faceLabel,
				stickerLabel
			]);
			const labels = (0, react.useMemo)(() => ({
				code: {
					copyLabel: t("复制"),
					copiedLabel: t("已复制")
				},
				footnotes: t("脚注")
			}), [language]);
			if (!prepared.trim()) return null;
			if (!_deepseek_ai_dsh_client_ui_primitives.MarkdownText) return (0, react.createElement)("div", { className: "imqw-timeline-text" }, text);
			return (0, react.createElement)("div", { className: "imqw-timeline-markdown" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.MarkdownText, {
				text: prepared,
				labels,
				variant: "compact",
				omitHtml: true
			}));
		}
		function MessageImage({ url, number }) {
			const [unavailable, setUnavailable] = (0, react.useState)(false);
			if (unavailable) return (0, react.createElement)("span", { className: "imqw-muted" }, t("图片已过期或无法预览"));
			return (0, react.createElement)("a", {
				className: "imqw-message-image",
				href: url,
				target: "_blank",
				rel: "noopener noreferrer",
				"aria-label": t("打开原图 {0}", number)
			}, (0, react.createElement)("img", {
				src: url,
				alt: t("QQ 图片 {0}", number),
				loading: "lazy",
				decoding: "async",
				onError: () => setUnavailable(true)
			}));
		}
		//#endregion
		//#region src/shared/workbench-extension.ts
		const QQ_HISTORY_VIEW_ID = "qq-history";
		//#endregion
		//#region src/client/history-extension.ts
		const name = "im-qqbot-workbench-history-client";
		const inject = ["qqbotWorkbench"];
		function apply(ctx) {
			const state = new TimelineState();
			const component = (props) => (0, react.createElement)(QqTimelineView, {
				...props,
				state
			});
			ctx.effect(() => ctx.qqbotWorkbench.registerView({
				id: QQ_HISTORY_VIEW_ID,
				title: t("QQ 记录"),
				component,
				refreshable: true
			}));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map