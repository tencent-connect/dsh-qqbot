window.__ModuleLoader__.load({
	id: "@tencent-connect/dsh-qqbot-workbench-history",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
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
			}, !compact && [...sender][0]?.toUpperCase()), (0, react.createElement)("div", { className: "imqw-message-body" }, compact ? null : (0, react.createElement)("div", { className: "imqw-timeline-meta" }, (0, react.createElement)("strong", { title: sender }, sender), (0, react.createElement)("time", { dateTime: new Date(row.at).toISOString() }, new Intl.DateTimeFormat(locale(), { timeStyle: "short" }).format(row.at))), (0, react.createElement)("div", { className: "imqw-message-line" }, (0, react.createElement)("div", { className: "imqw-timeline-bubble" }, row.quote ? (0, react.createElement)("blockquote", null, row.quote.senderName ? (0, react.createElement)("strong", null, row.quote.senderName) : null, row.quote.text ? (0, react.createElement)("div", null, row.quote.displayText ?? row.quote.text) : null, row.quote.attachments ? (0, react.createElement)("span", { className: "imqw-muted" }, t("引用附件 · {0} 项", row.quote.attachments)) : null) : null, row.text ? (0, react.createElement)("div", { className: "imqw-timeline-text" }, row.displayText ?? row.text) : null, imageCount > 0 ? (0, react.createElement)("div", { className: "imqw-message-images" }, Array.from({ length: imageCount }, (_, index) => {
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