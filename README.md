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

## Summary

dsh-qqbot 是一个 DeepSeek Harness（dsh）**bundle 插件**：把 dsh Agent 接入 QQ 私聊与群聊。安装后它在指定 profile 里插入一行插件，复用原生 Session、Inbox、工作区和客户端扩展接口，不改动宿主源码。你可以：用网页或手机扫码绑定机器人凭据；在 QQ 里 @ 机器人获得原生 Agent 回答（含模型、工具、权限、审批）；用一个按群聊／私聊分组的独立左栏管理会话、历史与每对话配置；查看带 Markdown 与图片/视频/文件的消息记录。主要成本：QQ 被动回复窗口短（群 5 分钟）、结果只能确认"平台受理"而非送达，且 QQ 只能发送最终正文、不流式。

## Table of Contents

- [架构](#架构)
- [安装](#安装)
- [会话管理与每群配置](#会话管理与每群配置)
- [配置项](#配置项)
- [内置命令](#内置命令)
- [核心模块](#核心模块)
- [会话路由](#会话路由)
- [设计原则](#设计原则)
- [Known Limitations](#known-limitations)
- [Dev Note](#dev-note)
- [本地开发](#本地开发)

## 架构

> 原生会话开发版仅使用未修改 DSH 的公开接口，不需要宿主补丁。QQ 使用独立左侧导航，按群聊／私聊管理会话，右侧复用主聊天页和原生输入框。使用、迁移及限制见[完整说明](./docs/guides/native-sessions.md)。此版本尚未发布。

```
QQ 用户 → QQ WebSocket → dsh-qqbot → ctx.agents → dsh agent loop → LLM
                                 ↑                           │
                                 └── session/event ──────────┘
                                       (assistant reply → QQ sendMarkdown)
```

## 安装

方式一、二安装 npm 上已发布的预构建包，不需要 Host 源码 checkout。本页的原生会话开发版尚未发布；使用当前源码请先完成[本地开发](#本地开发)，再按方式三或方式四加载。

### 方式一：桌面版安装（推荐）

无需命令行，全程在应用内完成：

1. **安装**：左侧栏点击「插件」→「添加插件」→ 输入 `@tencent-connect/dsh-qqbot@latest` → 安装并立即启动

<img src="./assets/docs/install.png" alt="端内添加插件" width="560" />

2. **连接**：左下角头像 → 设置 →「QQ 机器人」→ 手机 QQ 扫码连接

<img src="./assets/docs/setting.png" alt="设置页扫码连接" width="560" />

扫码成功后凭据自动保存，后续启动无需再次扫码。

点击「QQ 机器人」进入独立 QQ 左栏，按群聊、私聊分组，支持搜索名称、备注和会话标题。左栏显示实际连接状态；凭据保存成功不代表已经连接 QQ。会话目录在重启后保留。

点击「设置」可管理账号、访问范围和新对话默认配置。「更换凭据」与「解绑」直接显示。新对话默认配置包含 Agent 预设、执行权限、模型、额外提示词、工作目录和斜杠命令开关。全局修改只影响之后首次接入的群和联系人，不更改已有对话。

每个对话保留自己的配置。模型与权限在空闲时应用；预设、工作目录和补充提示词在之后新建的 QQ Session 生效。QQ 中 `/preset` 仍会开始新会话，保留旧历史与工作区。所选预设不可用时保留原会话并显示原因。

未保存草稿保留在当前浏览器标签页中，不包含 AppSecret。界面跟随 DSH 的浅色／深色主题。模型与权限使用 DSH 原生控件；账号与每群设置通过插件公开扩展入口提供。

多实例或隔离测试时，为每个实例设置独立的绝对路径 `QQBOT_DATA_DIR`，隔离会话目录、群策略、消息记录、投递结果、模型／预设偏好和媒体目录；未设置时继续使用已有的 `~/.dsh-qqbot` 数据。

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

先按[本地开发](#本地开发)完成源码构建，再安装到 profile：

```bash
# 安装到 profile（本地路径）
npx @deepseek-ai/dsh plugin --profile qqbot add /path/to/dsh-qqbot

# 启动
export QQBOT_APPID="你的AppID" QQBOT_SECRET="你的AppSecret"
npx @deepseek-ai/dsh --profile qqbot
```

### 方式四：--patch 开发模式

先完成[本地开发](#本地开发)中的 Host 准备与插件构建；隔离调试方式见[测试指南](./TESTING.md#隔离-host)。

```bash
export QQBOT_APPID="你的AppID" QQBOT_SECRET="你的AppSecret"
npx @deepseek-ai/dsh web --patch /path/to/dsh-qqbot/cordis.dev.yml
```

## 会话管理与每群配置

每个 QQ 群共享一个当前原生 Session，私聊按联系人独立。点击「QQ 机器人」将左栏切换为独立的群聊／私聊导航，联系人行打开当前会话，展开后默认显示最近 5 条历史，再按需查看更多。每个 Session 展示自己的标题和工作区；标题与 QQ 备注分别管理。返回工作区可恢复普通会话树。`/new` 开始新的上下文并保留历史。

底层复用原生 Session，因此 QQ Session 在普通工作区列表中仍可能重复出现。当前宿主没有公开过滤接口，本版保留此限制。

网页和 QQ 使用同一当前 Session 与原生 Inbox。网页输入只在网页回复，内容参与后续共享上下文。QQ 只自动发送经原生日志确认的未修改纯 QQ 成功轮次的最终正文。网页 Steer、编辑排队输入、混合来源或无法证明来源时不自动外发。当前 QQ Session 内符合条件的已完成回答可通过“发送到 QQ”预览后显式发送；旧 Session 不提供该动作。结果显示 QQ 接口接受的分段数，不能据此判断已送达或已读；失败和未知均不自动重发。私密分析请另建普通 Session；旧版独立分析 Session 保留。


### 每个群或联系人独立配置

原生聊天的「QQ 机器人会话设置」只包含会话设置和消息记录。会话设置编辑接收开关、备注与 Agent 配置；消息记录默认全部保留，可在面板里手动清空。历史 Session 在左侧各个群或联系人的子树中查看。操作说明见[默认配置与消息记录](./docs/guides/settings-and-message-records.md)。

原生执行模式使用所选 Agent 的实际工具、沙箱和审批规则。自定义工具模式提供搜索和多选，只保留选中的工具，并继续受基础原生权限限制。已有群的旧版审批、目录与其他约束保留，明确确认替换后才切换到新规则。原生只读不表示只能读取工作目录。

网页管理沿用 DSH 身份验证。机器人所有者可以使用斜杠命令，即使该对话关闭了普通成员的命令入口，但不能绕过对话的工具和资源范围。群控制者只能切换已获准的选项，QQ 群管理员身份不会自动获得机器人管理权。

### 消息保存与模型背景

保存、模型取用和自动回复分别控制。QQ 收发正文默认全部保留、不自动清理；需要时在会话设置的「消息记录」里点「清空消息记录」手动清除，清空只清记录正文、保留消息标识用于去重，不改变 QQ 会话历史、不改变 Agent 工具权限。近期背景默认同时限制最近 10 条、10 分钟和 4,000 字符，互动模式只取用明确提问与已有 Agent 上下文。模型查询记录仍需单独授权 `qqbot_group_history`，网页查询不启动模型。

新发现群默认仅 @ 时回复。原生会话默认满七天或累计 1,000 条 QQ 消息后，在无运行或排队输入的安全边界自动换新并保留历史（这是原生会话轮换，与消息记录保留是两件事），`/new` 不复制旧背景。QQ 流水跨 Session 连续，原生 Session 历史独立保留。

未授权或停用对话只发现身份，不保存新正文。[QQ 全量群消息事件](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html)需要 QQ 侧开通，本地开关不能替代平台权限，也不能恢复机器人未收到的历史。

## 配置项

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `appId` | string | **必填** | QQ Bot AppID（或通过 `QQBOT_APPID` 环境变量） |
| `appSecret` | string | **必填** | QQ Bot AppSecret（或通过 `QQBOT_SECRET` 环境变量） |
| `provider` | string | 继承 DSH 默认 | LLM 提供商名称，与 model 一起指定 |
| `model` | string | 继承 DSH 默认 | 模型名称 |
| `preset` | string | 继承 DSH 默认 | 新会话使用的 Agent preset id |
| `cwd` | string | `QQBOT_DATA_DIR/workspace` | Agent 工作目录；未指定数据目录时为 `~/.dsh-qqbot/workspace` |
| `requireMention` | boolean | `true` | 新发现群的初始 @bot 回复规则；已有群在对话设置修改 |
| `groupPrompt` | string | - | 群聊额外 system prompt |
| `directPrompt` | string | - | 私聊额外 system prompt |
| `textChunkLimit` | number | `4500` | 单条消息最大字符数 |
| `streaming` | boolean | 兼容旧配置 | 本版 QQ 只发送最终正文；流式展示保留在 DSH |
| `sessionIdleTimeout` | number | `1800000` | 执行实例闲置回收时间(ms)，不删除 Session 历史 |
| `processingTimeoutMs` | number | `1800000` | SDK 入站处理超时(ms)，不是原生 Agent 整轮生成上限 |
| `maxQueue` | number | `20` | 并发队列最大长度 |
| `historyLimit` | number | `10` | 群历史缓冲条数 |
| `askTimeoutMs` | number | `300000` | 待答问题超时(ms)，默认 5 分钟（ask_user_question） |
| `showToolResults` | boolean | 兼容旧配置 | 工具过程仅在 DSH 展示，不自动发送 QQ |
| `debug` | boolean | `false` | 调试模式 |

### 访问控制（access）

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `access.c2cMode` | `open`/`allowlist`/`disabled` | `allowlist` | 私聊访问模式；空白名单拒绝所有人 |
| `access.c2cAllow` | string[] | `[]` | 私聊白名单（user openid） |
| `access.groupMode` | `open`/`allowlist`/`disabled` | `open` | 群聊访问模式 |
| `access.groupAllow` | string[] | `[]` | 群聊白名单（group openid） |

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

### 附件发送旧配置（sendFile）

本版不注册 Agent 文件发送工具，也不自动投递工具生成的文件。下列字段仅为旧配置兼容保留。

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `sendFile.restrictPaths` | boolean | `true` | 是否启用路径白名单（仅 media + cwd + extraRoots） |
| `sendFile.extraRoots` | string[] | `[]` | 额外允许访问的根目录 |

## 内置命令

| 命令 | 说明 |
|------|------|
| `/new`（别名 `/reset` `/clear`） | 开始新会话，保留手机设置的模型／预设覆盖 |
| `/compact` | 压缩会话历史（摘要替换旧记录，保留上下文） |
| `/model` | 查看当前模型及网页默认；`/model provider/model` 切换当前私聊／群聊模型并保留上下文；`/model reset` 或 `/model default` 清除覆盖 |
| `/preset` | 查看当前与新会话预设；`/preset id` 更换预设并开始新会话；`/preset reset` 或 `/preset default` 清除覆盖并开始新会话 |
| `/permission` | 查看当前权限及该对话允许的模式；`/permission read-only` 或 `/permission workspace-write` 切换获准模式 |
| `/stop` | 中止当前生成 |
| `/bot-ping` | 网络延迟检测（返回传输与处理耗时） |
| `/bot-version` | 查看版本信息 |
| `/bot-status` | 查看当前会话状态 |
| `/bot-help` | 查看所有指令 |

模型和新会话预设的优先级：**手机命令的会话覆盖 → QQ 网页默认 → DSH 当前默认**。手机命令不会修改宿主默认，也不影响其他私聊或群聊。网页保存配置后会重载机器人；已保存的会话覆盖仍保留。`/model` 使用 DSH 原生模型选择，保留当前会话 ID、历史和预设，切换预设会创建新的当前 Session，保留工作区与旧历史；验证或切换失败时保留原会话与配置。

群里使用 `@机器人 /命令`，私聊直接发送 `/命令`。查询配置对获准成员开放；换模型、预设、权限和重置／压缩群会话仅所有者或该群控制者可用，并受该群允许范围约束。当前任务发起者、控制者或所有者可 `/stop`。生成期间其他修改会提示忙碌，未知命令返回帮助，不作为普通聊天交给模型。

<details>
<summary>实现细节（核心模块、会话路由、设计原则）</summary>

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
├── conversations/              # 会话目录、群背景、群记录与投递结果
├── policy/                     # 每群工具和资源范围校验
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

## 设计原则

- **纯 Cordis 插件** — 遵循 dsh "Plugins, not loop changes" 原则
- **声明式依赖** — `inject = ['agents']`，不直接耦合其他插件
- **会话隔离** — 每个 QQ 私聊用户/群聊各一个独立 Agent
- **Preset 支持** — 可通过 `agent-presets` 服务挂载预设（工具集、prompt 等）
- **闲置回收** — 超时自动 dispose Agent，防止内存泄漏
- **Markdown 输出** — 回复以 Markdown 格式发送，支持代码块/表格感知切分
- **图片理解** — 支持 `qqbot_describe_image` 视觉理解，可分析用户发送的图片
- **显式发送** — 网页回答预览后可发送到 QQ；Agent 文件工具与自动文件投递未启用
- **问答互动** — 支持 `ask_user_question`，单选生成内联按钮（点一个其余变灰）、多选回复编号，逐题推进 + 问题级超时
- **操作确认** — 支持 `approval/request`，关键操作通过「允许/拒绝」按钮请求用户确认

</details>

## Known Limitations

- **发送结果只能确认"平台受理"**：QQ 接口返回后记录为 `accepted`，代表平台受理而非用户已送达或已读；失败(failed)与结果未知(unknown)都不自动重发，需人工核对或重新发起。
- **被动回复窗口很短**：群聊被动回复窗口 5 分钟、私聊 30 分钟；同一条消息被动回复有次数上限（默认 4 次，留 1 次余量）。窗口过期或超限后主动发送可能被平台拒绝。
- **只发送最终正文、不流式**：QQ 侧只收到该轮最终回答文本，流式内容仅在 DSH 展示；`streaming` 配置为旧版兼容、本版忽略。
- **不发送工具过程与文件**：工具调用过程与结果只在 DSH 展示；本版不注册 Agent 文件发送工具（`qqbot_send_file` 运行时不可用），也不自动投递工具生成的文件；`showToolResults`、`sendFile.sendPresentedFiles` 为旧配置兼容、本版忽略。
- **群聊默认只响应 @**：新发现群 `requireMention=true`，未 @ 的群消息只可能作为背景、不触发回复；非 @ 消息能否收到还取决于 QQ 平台是否开通全量群消息事件。
- **原生会话轮换 ≠ 记录保留**：原生会话默认满 7 天或 1,000 条 QQ 消息后在安全边界自动换新（保留历史）；而消息记录默认全部保留、不自动淘汰，仅在手动「清空消息记录」时清正文（保留消息标识用于去重）。
- **工具能力受宿主限制**：MCP/网络工具不支持按域名限制；memory_*、subagent/委派类工具不可用；native 模式下执行工具不能临时提升沙箱范围之外。当前原生权限若不在对话允许范围，工具会被受限。
- **媒体依赖本地临时文件**：下载的媒体存于 `QQBOT_DATA_DIR/media`（默认 `~/.dsh-qqbot/media`），按 `media.ttlHours`（默认 24 小时）定期清理；长期依赖旧本地路径会失效。下载仅 HTTPS 且做 SSRF/大小/超时防护。
- **QQ Session 可能在工作区列表重复出现**：底层复用原生 Session，当前宿主无公开过滤接口，本版保留该限制。
- **访问控制 fail-closed**：私聊默认 `allowlist` 且空名单=拒绝所有私聊；群聊默认 `open`。
- **客户端文案部分为中文硬编码**：locale 命名空间 `qqbot` 仅覆盖部分字符串，其余中文硬编码在组件内，暂未全量 i18n。

## Dev Note

<details>

- 插件为 bundle 型（`dsh.bundle.patch → cordis.patch.yml`），安装只在 profile 组合层插入一行插件，不修改宿主源码；凭据/配置写入 profile 的 `cordis.patch.yml` 并靠 HMR 生效。
- 源码直载（`--patch cordis.dev.yml`）时跨不过 `node_modules` 边界，`getProfileDir()` 为空，凭据只能走环境变量。
- 待核：`vision.timeoutMs` 是否实际生效（`callVision` 用 exec.signal）；`ensureVisionInputModal` 会改宿主 `settings.yaml` 为视觉模型补 image 输入；SSRF 仅 resolve4、未阻断 IPv6。
- 设计决策与审查记录见 `docs/decisions/`。

</details>

## 本地开发

插件的 Node.js 范围为 `^22.19.0 || >=24.0.0`（不支持 Node 23）；当前验收使用 Node 24。构建 Host 时还需满足该 checkout 自己的 Node.js 与 pnpm 要求。

源码开发需要已准备好的未修改 stock DSH Host。已验收基线为 `0.2.2-alpha.2`，commit `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`。建议使用独立源码 checkout，不在日常运行的 Host 中安装依赖或构建。先在该 Host checkout 中安装依赖并生成公开构建产物（`pnpm install`、`pnpm run build:artifacts`）；插件安装不会生成 Host 产物，也不需要宿主补丁。

[package.json](./package.json) 中的 Host 开发依赖使用 `link:../../deepseek-harness/...`，默认布局如下：

```text
parent/
├── deepseek-harness/                 # 已准备的 stock Host
└── deepseek-harness-plugins/
    └── dsh-qqbot/                    # 本插件 checkout
```

Host 在其他位置时，先从插件根目录运行[链接脚本](./scripts/link-stock-host.mjs)，再安装插件依赖。脚本只更新本插件的开发依赖路径，不修改 Host：

```bash
cd /path/to/dsh-qqbot

# 非默认 Host 位置先执行；默认布局可跳过
node scripts/link-stock-host.mjs --host /absolute/stock/checkout

# 安装插件依赖
pnpm install

# 构建插件
pnpm build

# 开发模式（watch）
pnpm dev

# 用 --patch 方式调试
export QQBOT_APPID="xxx" QQBOT_SECRET="xxx"
npx @deepseek-ai/dsh web --patch /path/to/dsh-qqbot/cordis.dev.yml
```

测试入口、隔离 Host 用法与覆盖边界见 [测试指南](./TESTING.md)；Agent 可使用 [qqbot-verify](./.agents/skills/qqbot-verify/SKILL.md)。

## License

[MIT](./LICENSE)
