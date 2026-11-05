<div align="center">

<img width="120" src="https://img.shields.io/badge/🤖-QQ_Bot-blue?style=for-the-badge" alt="QQ Bot" />

**基于 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) 的 QQ Bot 插件，将 DeepSeek AI 助手接入 QQ 私聊与群聊。**

[![npm version](https://img.shields.io/npm/v/@tencent-connect/dsh-qqbot)](https://www.npmjs.com/package/@tencent-connect/dsh-qqbot)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/tencent-connect/dsh-qqbot)](https://github.com/tencent-connect/dsh-qqbot)
[![QQ Bot](https://img.shields.io/badge/QQ_Bot-API_v2-red)](https://bot.q.qq.com/wiki/)

<br/>

**[English](./README_EN.md) | 简体中文**

扫码加入 QQ 群 / 频道

<table>
<tr>
<td align="center" width="50%"><img src="./assets/docs/qqgroup.jpg" height="360" alt="QQ 群二维码" /><br /><b>QQ 开发者交流群</b><br /><sub>1群: 1032635674 · 2群: 1056948758</sub></td>
<td align="center" width="50%"><img src="./assets/docs/qqchannel.jpg" height="360" alt="QQ 频道二维码" /><br /><b>QQ 开发者社区频道</b><br /><sub>频道号: 20dnumts4z</sub></td>
</tr>
</table>

</div>

## 架构

```
QQ 用户 → QQ WebSocket → dsh-qqbot → ctx.agents → dsh agent loop → LLM
                                 ↑                           │
                                 └── session/event ──────────┘
                                       (assistant reply → QQ sendMarkdown)
```

## 安装

### 方式一：桌面版安装（推荐）

无需命令行，全程在应用内完成：

1. **安装**：左侧栏点击「插件」→「添加插件」→ 输入 `@tencent-connect/dsh-qqbot@latest` → 安装并立即启动

<img src="./assets/docs/install.png" alt="端内添加插件" width="560" />

2. **连接**：左下角头像 → 设置 →「QQ 机器人」→ 手机 QQ 扫码连接

<img src="./assets/docs/setting.png" alt="设置页扫码连接" width="560" />

扫码成功后凭据自动保存，后续启动无需再次扫码。

### 方式二：手动执行

```bash
# 安装到 profile
npx @deepseek-ai/dsh plugin --profile qqbot add @tencent-connect/dsh-qqbot

# 启动
npx @deepseek-ai/dsh --profile qqbot
```

首次启动时，插件检测到凭据未配置会自动进入扫码引导：终端输出二维码 → 手机 QQ 扫码绑定 → 凭据自动保存到 profile，后续启动无需再次扫码。

无端内绑定页的环境（如纯 CLI）可设置 `QQBOT_BIND_OPEN_BROWSER=1`，额外拉起系统浏览器扫码页作为降级通道。

<img src="./assets/docs/qrcode.png" alt="二维码扫码示意图" width="280" />

> **提示**：建议升级至 `0.4.0` 以上版本扫码，支持点击链接在浏览器打开，避免部分终端二维码渲染错位的问题。

### 方式三：本地路径安装

```bash
# 构建
cd /path/to/dsh-qqbot
pnpm install && pnpm build

# 安装到 profile（本地路径）
npx @deepseek-ai/dsh plugin --profile qqbot add /path/to/dsh-qqbot

# 启动
export QQBOT_APPID="你的AppID" QQBOT_SECRET="你的AppSecret"
npx @deepseek-ai/dsh --profile qqbot
```

### 方式四：--patch 开发模式

```bash
export QQBOT_APPID="你的AppID" QQBOT_SECRET="你的AppSecret"
npx @deepseek-ai/dsh web --patch /path/to/dsh-qqbot/cordis.dev.yml
```

## 配置项

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `appId` | string | **必填** | QQ Bot AppID（或通过 `QQBOT_APPID` 环境变量） |
| `appSecret` | string | **必填** | QQ Bot AppSecret（或通过 `QQBOT_SECRET` 环境变量） |
| `provider` | string | `deepseek-official` | LLM 提供商名称 |
| `model` | string | `deepseek-chat` | 模型名称 |
| `preset` | string | - | Agent preset id |
| `cwd` | string | `process.cwd()` | Agent 工作目录 |
| `requireMention` | boolean | `true` | 群聊是否需要 @bot 才触发 |
| `groupPrompt` | string | - | 群聊额外 system prompt |
| `directPrompt` | string | - | 私聊额外 system prompt |
| `textChunkLimit` | number | `4500` | 单条消息最大字符数 |
| `streaming` | boolean | `true` | 是否启用流式输出（群聊始终不启用） |
| `sessionIdleTimeout` | number | `1800000` | 会话闲置超时(ms)，默认 30 分钟；`<=0` 表示不回收 |
| `processingTimeoutMs` | number | `1800000` | 处理超时(ms)，超时中断当前 LLM 调用 |
| `maxQueue` | number | `20` | 并发队列最大长度 |
| `historyLimit` | number | `10` | 群历史缓冲条数 |
| `askTimeoutMs` | number | `300000` | 待答问题超时(ms)，默认 5 分钟（ask_user_question） |
| `showToolResults` | boolean | `false` | 是否展示工具调用成功结果（错误始终展示） |
| `debug` | boolean | `false` | 调试模式 |

### 访问控制（access）

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `access.c2cMode` | `open`/`allowlist`/`disabled` | `open` | 私聊访问模式 |
| `access.c2cAllow` | string[] | `[]` | 私聊白名单（user openid） |
| `access.groupMode` | `open`/`allowlist`/`disabled` | `open` | 群聊访问模式 |
| `access.groupAllow` | string[] | `[]` | 群聊白名单（group openid） |
| `access.commandMode` | `open`/`allowlist`/`disabled` | `open` | QQ 斜杠命令模式，白名单按发送者 OpenID 独立校验 |

QQ 斜杠命令在账号设置中与群聊、私聊使用相同的“所有人／白名单／关闭”模式，默认所有人可用。群和私聊分别受接入规则约束；进入获准对话后，命令再按发送者身份校验。所有人模式也开放模型切换、新建会话等命令；关闭模式对所有 QQ 用户生效。审批和提问按钮沿用各自鉴权。命令白名单按账号保存在独立身份文件，切换模式保留名单。私聊、群聊和命令名单均展示完整 OpenID，支持逐个复制以及分别导出 CSV。“复制全部”每行输出一个 `OpenID:昵称`，没有昵称时只输出 OpenID，可直接粘贴到批量添加。OpenID 不是 QQ 号或群号，不能直接按 QQ 号或群号添加；请使用当前机器人对应的 OpenID，没有 OpenID 时使用配对码添加。

账号设置保留群聊 @ 规则、流式回复、工具结果、模型、Agent 预设和群／私聊补充提示词。名单操作立即保存；模式及其他表单修改通过“保存”提交，并沿用插件重载生效流程。配置接口的 GET 返回 `config.accessRevision`，更新 `access` 时应一并提交该值；名单或模式已变化、版本缺失时返回 409，不覆盖现有授权。刷新配置会保留未保存的字段草稿，需确认后再次保存。

配对码有效期为 10 分钟，同一码可连续添加多人或多个群；每个码只对应一种名单。群白名单配对码只在群聊中使用，私聊白名单配对码只在私聊中使用，错误场景不影响有效码。有效码可用于尚未接入的群或联系人，群配对仍遵守 @ 规则；普通消息继续受接入规则限制。

添加成功后窗口保持打开，在“本次添加结果”中展示昵称、完整 OpenID 和状态；手动批量添加共用此结果列表，部分失败时保留失败项供重试。重复认领不重复计数。移除身份后，移除前已生成的同类配对码均不能将其重新加回，包括手动添加的身份；其他人仍可继续认领，重新授权需生成新码。重新生成使旧码失效；点击“完成”或关闭添加弹窗也会停止该码，已添加成员保留。配对批次与结果以私有文件保存到插件数据目录，账号间隔离，配置重载后仍可继续；过期码在后续查询或生成时清理。成功提示只依据服务端确认结果，不根据码消失推断成功。名单优先使用 QQ 提供的昵称或已保存备注，平台未提供名称时可在网页改名。

插件重载时，已进入旧路由但尚未提交的名单请求返回 503，需刷新后重试。身份查询和修改读取最新名单文件，旧实例不会通过改名或更新成员资料把已撤销的命令名单写回。已有身份目录中的命令成员和昵称只导入一次，明确保存的空名单也保持为空。原有 Session、模型和预设继续由上游 `PrefsStore` 管理，不迁移或改写会话与消息文件。

### 主动推送（proactiveDelivery）

QQ 入站触发的回合始终被动回复；定时任务等服务回合始终主动推送到 QQ。下表只控制「非 QQ 输入（如桌面续聊 QQ 会话）」的回合：

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `proactiveDelivery.externalTurns` | `off`/`c2c`/`all` | `c2c` | `off` 不推送；`c2c` 仅推送私聊；`all` 私聊和群聊都推送 |

### 回合来源与投递防重

QQ 提问继续通过原生 `followup` 进入 Inbox。同一群／联系人按到达顺序排队，不合并不同成员的提问。入站登记固定平台消息 ID、发送者、Session、回复目标和正文摘要；原生消息的身份、会话或正文不符时不能认领 QQ 回复。群聊 @、私聊流式、工具结果、附件发送及主动推送配置继续生效。

流式、工具结果、最终正文和文件发送共用来源与接入检查。QQ 回合中进入网页输入后，后续内容不再自动外发；已经发送的 QQ 流式文本无法撤回。纯网页回合仍遵循 `proactiveDelivery.externalTurns`，本项不更改其默认值。显式文件目标继续支持；调用仍受原有工具与路径权限约束，QQ 回合不能通过显式目标绕过来源校验。

插件数据目录下的账号独立 `delivery-*.jsonl` 只保存输入关联、摘要和发送操作状态，不保存聊天正文。提交前持久登记，重复事件、重载和重启不主动重发或重新入队。每个流式请求和文件上传后的发送都会复查权限。首个流式帧因回复目标过期而明确被拒时，沿用原有静态回复路径。提问卡片只有在平台明确拒绝时才改为纯文本，同一道题共用一个投递标识。结果未知时停止自动发送。接口接受只表示 QQ 平台接受请求。

该文件需与原插件数据目录一并保留，否则会丢失防重依据；它没有正文清理或消息查询功能，元数据随使用增长。同一数据目录仅供一个宿主进程写入。记录损坏或不完整时拒绝继续发送，不自动覆盖文件。已有绑定、Session、工作区回退与聊天记录设置不变。

### 富媒体理解（media）

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `media.enabled` | boolean | `true` | 是否启用富媒体理解（图片/视频下载 + 工具分析） |
| `media.maxMB` | number | `200` | 富媒体下载大小上限(MB) |
| `media.ttlHours` | number | `24` | 富媒体存活时长(小时)，0=永不过期 |

### 视觉理解（vision）

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `vision.enabled` | boolean | `false` | 是否启用视觉理解（qqbot_describe_image 工具） |
| `vision.provider` | string | - | 视觉模型 provider（如 pi-ai） |
| `vision.model` | string | - | 视觉模型 id（如 qwen-vl-max） |
| `vision.maxBytes` | number | `10MB` | 图片字节上限 |
| `vision.maxTokens` | number | `1024` | 输出 token 上限 |
| `vision.timeoutMs` | number | `120000` | 视觉调用超时(ms) |

### 附件发送（sendFile）

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `sendFile.restrictPaths` | boolean | `true` | 是否启用路径白名单（仅 media + cwd + extraRoots） |
| `sendFile.extraRoots` | string[] | `[]` | 额外允许访问的根目录 |

## 内置命令

| 命令 | 说明 |
|------|------|
| `/new`（别名 `/reset` `/clear`） | 开始新会话（清空上下文） |
| `/compact` | 压缩会话历史（摘要替换旧记录，保留上下文） |
| `/model` | 查看或切换模型 |
| `/preset` | 查看或切换 agent preset（新会话生效） |
| `/stop` | 中止当前生成 |
| `/bot-ping` | 网络延迟检测（返回传输与处理耗时） |
| `/bot-version` | 查看版本信息 |
| `/bot-status` | 查看当前会话状态 |
| `/bot-help` | 查看所有指令 |

## 核心模块

```
src/
├── index.ts                    # Cordis 插件入口（async apply）
├── config.ts                   # 配置 Schema
├── types.ts                    # 全局类型定义
├── setup/                      # 凭据绑定（扫码）
│   ├── index.ts                # 绑定编排（ensureCredentials）
│   ├── binding-service.ts      # 扫码状态机（宿主内唯一事实源）
│   ├── bind-routes.ts          # 端内绑定页路由（/qqbot/im-qqbot/bind）
│   ├── presenters.ts           # 呈现策略（终端/浏览器降级）
│   ├── qr-svg.ts               # 二维码 SVG 渲染（宿主侧）
│   └── persist.ts              # 凭据写入 cordis.patch.yml
├── client/                     # 浏览器半边（dsh.client Web Bundle）
│   ├── index.ts                # 侧栏 Tab 注册 + 待绑定自动引导
│   └── bind-page.ts             # 端内绑定页（二维码 + 状态轮询）
├── gateway/                    # 网关装配
│   ├── bootstrap.ts            # 启动装配（监听 session/event 等）
│   └── middleware-setup.ts     # 中间件链配置
├── transport/                  # 传输层
│   ├── inbound.ts              # QQ 入站消息 → agent.followup()
│   ├── outbound.ts             # session/event → QQ sendMarkdown
│   ├── outbound-buffer.ts      # 流式缓冲
│   ├── streaming-writer.ts     # 流式写入
│   ├── reply-target.ts         # 回复目标解析
│   ├── msgid-cache.ts          # 被动回复 msgid 缓存
│   ├── reply-limiter.ts        # 被动回复限流
│   ├── tool-presenter.ts       # 工具调用展示
│   └── chunker.ts              # Markdown 文本切分
├── session/                    # 会话管理层
│   ├── session-manager.ts      # QQ peer → Agent 映射
│   └── idle-evictor.ts         # 闲置回收
├── model/                      # 模型路由层
│   ├── model-resolver.ts       # 路由解析
│   ├── prefs-store.ts          # per-peer 偏好持久化
│   └── settings-reader.ts      # settings.yaml 只读
├── features/                   # 交互特性
│   ├── question-channel.ts     # ask_user_question 问答通道
│   ├── approval-channel.ts     # approval 审批确认通道
│   └── answer-parser.ts        # 答案解析
├── media/                      # 多媒体
│   ├── vision-tool.ts          # 图片视觉理解
│   ├── send-file-tool.ts       # 发送本地文件
│   └── media-cleaner.ts        # 媒体 TTL 清理
├── middleware/                 # 中间件
│   ├── question-answer.ts      # 问答答案处理
│   └── attachment.ts           # 附件处理
├── shared/                     # 共享工具
│   ├── utils.ts                # 通用函数
│   ├── scope.ts                # scope/peer 提取
│   └── send-helper.ts          # 分块发送
└── commands/                   # 斜杠命令
```

## 会话路由

sessionKey: `qqbot:${appId}:${scope}:${peerId}`，新会话铸造 UUID 会话 id 并持久化到 `model-prefs.json`，重启后按持久化 id 恢复；0.5.x 老会话按原派生 id 沿用。

解析策略：进程内复用 → 持久化恢复 → 全新创建。

QQ 群聊和私聊的补充提示词按当前 Agent 作用域加载，恢复会话时继续使用对应场景的配置。

## 设计原则

- **纯 Cordis 插件** — 遵循 dsh "Plugins, not loop changes" 原则
- **声明式依赖** — `inject = ['agents']`，不直接耦合其他插件
- **会话隔离** — 每个 QQ 私聊用户/群聊各一个独立 Agent
- **Preset 支持** — 可通过 `agent-presets` 服务挂载预设（工具集、prompt 等）
- **闲置回收** — 超时自动 dispose Agent，防止内存泄漏（回收后仍可按会话映射主动推送）
- **Markdown 输出** — 回复以 Markdown 格式发送，支持代码块/表格感知切分
- **图片理解** — 支持 `qqbot_describe_image` 视觉理解，可分析用户发送的图片
- **附件发送** — 支持 `qqbot_send_file` 将本地文件发送给用户（默认启用路径白名单）
- **问答互动** — 支持 `ask_user_question`，单选生成内联按钮（点一个其余变灰）、多选回复编号，逐题推进 + 问题级超时
- **操作确认** — 支持 `approval/request`，关键操作通过「允许/拒绝」按钮请求用户确认

## 本地开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 开发模式（watch）
pnpm dev

# 用 --patch 方式调试
export QQBOT_APPID="xxx" QQBOT_SECRET="xxx"
npx @deepseek-ai/dsh web --patch /path/to/dsh-qqbot/cordis.dev.yml
```

## License

[MIT](./LICENSE)
