# QQ 插件 Prompt 构造现状基线（重设计用）

> 只读调研，未改任何代码。基线日期：2026-11-01。
> 仓库根：`projects/agent-research/deepseek-harness-plugins/dsh-qqbot-upstream-compatible`
> 本文保留重构前的历史基线，源码行号、旧提示词上限与延迟生效行为不代表当前实现。当前补充提示词和人设每步读取最新值，群聊与私聊补充提示词各上限 80,000 个字符；使用方式见[默认配置与消息记录](../guides/settings-and-message-records.md)，实现入口见[提示词注册](../../src/prompt/install.ts)。

## 现状结构树

```
QQ 入站消息
 └─ gateway/bootstrap.ts:78 bot.on('message') → handleInbound
     └─ gateway/middleware-setup.ts 中间件链
         ├─ middleware: conversationGate / contentSanitizer / quoteRef / attachmentProcessor
         └─ envelopeFormatter (historyLimit=config.historyLimit)  → 写 ctx.state.envelope（未被插件消费，丢弃）
     └─ transport/inbound.ts handleInbound → executeInbound
         ├─ assembleAgentBody  (5 层拼装) → agentBody: string
         ├─ buildDynamicCtx   (媒体/ASR/引用附件元数据)
         └─ entry prefix + [群聊背景] + agentBody → ContentBlock[]
              (createUserMessage → enqueueQQ / followup)
============ 每轮 user message ============
[QQ 群聊|私聊 · <senderName>[ · @机器人]]         ← inbound.ts:149 prefix block
<dynamicContext>                                  ← inbound.ts:149 内嵌（媒体行/ASR/引用附件）
[群聊背景，仅作资料]\n<background.text>\n[当前消息] ← inbound.ts:149（有 background 时）
<agentBody>                                       ← inbound.ts:150
   ├─ buildQuotePart: [Quoted message begins]...[Quoted message ends][Current message]
   └─ buildUserContent: 正文 / [Voice message (Ns)] text / 附件类型标签 [图片][视频][文件]
   └─ buildAgentBody (仅群聊 & @ & 有 history 时):
        [Chat history begins]\n[name (id)] content\n...[Chat history ends]\n[Current message]
============ system prompt ============
session-manager.ts:143 registerScopePromptInjection
  on('system-prompt/assemble') → append section:
    { name: 'qqbot:scope-prompt', order: 90, text:
        "当前对话来自 QQ。根据当前消息和角色设定自然回复。工具以本轮实际提供的清单为准；没有可用工具时直接回答，不输出内部工具调用协议或模拟调用。只有用户明确要求处理文件或执行任务时才使用获准的相关工具。" 
        + "\n" + conversations.rolePrompt(sessionId) }
============ rolePrompt / 补充提示词 ============
conversation-service.ts:681 rolePrompt(sessionId)
  ├─ 沿 parentSession 链找 store.getBySessionId
  ├─ 命中 row.prompt !== undefined → 直接返回 row.prompt（Session 快照）
  └─ 否则 = [scope==group ? config.groupPrompt : config.directPrompt, describeRole(role)].join('\n')
describeRole (conversation-service.ts:696): [role.description, '语气：'+tone, '世界观：'+world, role.prompt].filter.join('\n')
projectSettings (conversation-service.ts:92 / index.ts:542): prompt = [群/私 config prompt, describeRole(policy.role)].join('\n')
  → 首次准入/新建 Session 时写入 settings.prompt 与 row.prompt（快照）
```

---

## 1. system prompt 注入（src/session/session-manager.ts:143-169）

**机制**：`registerScopePromptInjection()` 在构造函数末尾调用（:133），向 `ctx.on('system-prompt/assemble', ...)` 注册 waterfall 拦截器。每次 turn 构建 request 时触发。

**守卫条件**（:150-154）：
- `context.agent` 存在且 `this.agents.get(agent.id) === agent`（防止伪造/已替换 Agent）
- `this.conversations?.conversationForSession(agent.id)` 命中（通过持久对话目录识别原生恢复的 Agent，不依赖 QQ 输入后的管理器缓存）

**section 结构**（:156-163）：
```ts
const prompt = [
  '当前对话来自 QQ。根据当前消息和角色设定自然回复。工具以本轮实际提供的清单为准；没有可用工具时直接回答，不输出内部工具调用协议或模拟调用。只有用户明确要求处理文件或执行任务时才使用获准的相关工具。',
  this.conversations?.rolePrompt(agent.id)
].filter(Boolean).join('\n');
return { ...assembled,
  sections: [...(assembled.sections ?? []), { name: 'qqbot:scope-prompt', order: 90, text: prompt }] };
```

- **section name**：`qqbot:scope-prompt`
- **order**：`90`（硬编码常量）
- **text**：固定前言（硬编码中文，约 100 字） + `\n` + rolePrompt
- **群/私是否共用**：共用同一段固定前言；差异只来自 `rolePrompt` 内部对 `scope` 的判定（group→groupPrompt / c2c→directPrompt）
- **rolePrompt 如何拼接**：`rolePrompt()` 是唯一入口，返回值直接 append 为 90 号 section 的第二行
- **位置**：追加在 assembled.sections 末尾，order 90 决定最终排序

---

## 2. 每轮 user 消息构造（src/transport/inbound.ts）

### 2.1 入口与调用链
- `handleInbound`（:88）：经 conversation-service 队列串行后调用 `executeInbound`（:106）
- `executeInbound` 组装三层：
  1. `assembleAgentBody`（:121，注意传入 `history: undefined`，**主动禁用 history 分支**）
  2. `buildDynamicCtx`（:148）
  3. prefix block（:149）+ 可选 background block（:149）+ agentBody（:150）→ `ContentBlock[]`
- `createUserMessage({ content, source })`（:152）→ `service.enqueueQQ`（:158）或 `record.agent.followup`（:160）

### 2.2 前缀块（inbound.ts:149）— 最外层
```
[QQ {群聊|私聊} · {senderName}{群聊且被@时追加 ' · @机器人'}]
{dynamicContext （有则下一行）}
```
- 私聊：`[QQ 私聊 · {senderName}]`，**永不出现 @机器人**
- senderName 计算（:145）：`msg.senderName || (c2c ? entry.alias||entry.name : undefined) || shortSenderId(senderId)`，缩为 openid 前 8 位（:432）

### 2.3 群聊背景块（inbound.ts:149，条件性）
```
[群聊背景，仅作资料]
{background.text}
[当前消息]
```
- **群聊、私聊都会拼**（只要 `service.background(record, cutoff,...)` 有 text；实际 c2c 一般无 background）
- background.text 来自 `conversations/index.ts:340 snapshotBackground`，每行格式：
  `[来源消息: {id}][{senderName} ({senderId})] {text}`（:358），按 policy.context.maxMessages/maxChars/maxAgeMinutes 过滤

### 2.4 Layer 1 — buildUserContent（:212-235）
按顺序 join('\n')：
1. `msg.content.trim()` 正文
2. 语音：`[Voice message (Ns)] {text}`（:224，来自 processedAttachments 的 STT/ASR 或 attachments.asr_refer_text）
3. 附件类型标签：`[图片] [视频] [文件]`（:229 buildAttachmentTags，去重，voice 跳过）

### 2.5 Layer 2 — buildQuotePart（:240-246）
```
[Quoted message begins]
{quoteText | entry.content | 'Original content unavailable'}
[Quoted message ends]
[Current message]
```
- 引用文本优先 `quote.text`，回退 `quote.entry.content`

### 2.6 Layer 4 — buildDynamicCtx（:251-298）
输出形如每行 `- {renderMediaLine}`：
- 当前消息媒体（image/video/file）：`- Image: {localPath|url|filename}` / `- Video: ...` / `- File: {path|filename (size)}`（renderMediaLine :304）
- 语音：有 ASR → `- ASR: {texts.join(' | ')}`；无 ASR → `- Voice: {urls}`
- 引用附件：`[Reference attachments]` 标题下 `  - Voice: {asrText}` / `  - Image/Video/File: ...`
- 结尾 `+ '\n\n'`

### 2.7 Layer 5 — buildAgentBody（:330-353）
- **仅当 `isGroup && wasMentioned && history.length>0` 才展开 history**（:336）
- 但 `executeInbound` 传入的 history 恒为 `undefined`（:121 `{ ...mwState, history: undefined }`）→ **该分支实际永不触发**
- 若触发，格式：`[Chat history begins]\n[{name} ({senderId})] {content}...\n\n[Chat history ends]\n[Current message]\n{base}`

### 2.8 群聊 vs 私聊差异汇总
| 维度 | 群聊 | 私聊 |
|---|---|---|
| prefix 标签 | `[QQ 群聊 · name · @机器人]` | `[QQ 私聊 · name]`（无 @）|
| 空消息但被 @ | 视为有效（:205）| 空即丢弃 |
| senderName 兜底 | 仅 senderName/openid | 额外用 alias/name |
| Chat history 段 | 条件触发（实际死代码）| 永不 |
| system prompt 差 | groupPrompt | directPrompt |

### 2.9 @/引用/历史/媒体/语音进入方式
- **@**：仅体现在 prefix 标签文字 ` · @机器人`（wasMentioned 来自 conversation-gate.ts:34），不注入 @ 原文
- **引用**：buildQuotePart 文本块 + buildDynamicCtx 的 `[Reference attachments]`
- **历史**：两条互斥路径——(a) 插件自己的 `[群聊背景]`（走 background store，实际生效）；(b) SDK envelopeFormatter 的 `<history>`（写 state.envelope，**未被消费**）；(c) buildAgentBody 的 `[Chat history]`（死代码）
- **媒体**：类型标签在 Layer1，真实本地路径在 buildDynamicCtx
- **语音**：Layer1 `[Voice message]` + buildDynamicCtx `- ASR:`（两处都进，可能重复）

---

## 3. 补充提示词（settings.prompt / config.groupPrompt / config.directPrompt）

### 3.1 三处来源与注入位置
1. **config.groupPrompt / config.directPrompt**（src/config.ts:71,73；Schema :118-119）
   - 来源：profile 配置（部署级），非 per-peer
   - 注入位置：`rolePrompt()` 计算兜底行；`projectSettings()`（conversation-service.ts:92）在**首次准入/新建 Session**时写入 `settings.prompt` 与 `row.prompt` 快照
   - 是否分群私：**分**——group→groupPrompt，c2c→directPrompt

2. **settings.prompt（per-peer 补充提示词，UI「补充提示词」）**
   - 来源：`QQAgentSettings.prompt`（shared/agent-settings.ts:13，max 80000）
   - 注入位置：作为 `row.prompt` 快照（conversations/index.ts:164 bindSession、:561 migrateSettings）→ `rolePrompt()` 命中 `row.prompt` 时**优先返回它**（conversation-service.ts:689）
   - 是否分群私：字段本身不分；由 scope 决定到底是哪个 entry 的 settings
   - **改动是否即时生效**：**否**。saveSettings（conversation-service.ts:449）只写 settings，rolePrompt 读的是 `row.prompt` 快照；:494 返回提示「提示词/工作目录/预设将在新会话生效」。需新建 Session 才生效（docs/settings-and-message-records.md:19 同义）

3. **rolePrompt 兜底（无快照时）**：`[scope 对应 config prompt, describeRole(role)].join('\n')`（:690）
   - describeRole 拼 role.description / 语气:tone / 世界观:world / role.prompt（:696）

### 3.2 关键优先级链（rolePrompt :681-695）
```
row.prompt（Session 快照，含 config+role 或 UI settings.prompt）
  > 否则 config.groupPrompt/directPrompt + describeRole(role)
逐级沿 parentSession 往上找，visited 防环
```
注意：一旦写入了 `settings.prompt`（含 UI 清空为 ''），快照优先，**config.groupPrompt 不再参与**（因 projectSettings 已把 config prompt 烘进 settings.prompt；但若 UI 手改后保存，config 部分丢失）。

### 3.3 UI 是否可编辑
- **config 层（groupPrompt/directPrompt）**：
  - 服务端可写：setup/bind-routes.ts:97,110-111 列入 EDITABLE_CONFIG_KEYS/Schema
  - **前端不可编辑**：client/config-form-state.ts:25 `EDITABLE_KEYS = ['access']` —— 只有 access 可经 UI 提交；groupPrompt/directPrompt 仅在 ConfigWire 类型/解析白名单出现（:19-20,:99），`configPatch` 只取 EDITABLE_KEYS
- **per-peer settings.prompt**：可编辑，client/qq-agent-settings-form.ts:190 textarea「补充提示词」（maxLength 20000，注意后端上限 80000）

### 3.4 快照与默认值机制
- 首次准入复制 defaults（conversations/index.ts:138），之后改全局 defaults 不改已有 entry（agent-settings.test.ts:30-35 验证）
- updatePolicy 改 role 时同步刷新 settings.prompt（index.ts:191-196 changedRole 分支）
- bindSession 新建 row 时写 `prompt: entry.settings.prompt` 快照（index.ts:164,561-563）

---

## 4. 相关测试与文档

### 4.1 测试（src/**/*.test.*）
| 文件 | 覆盖点 |
|---|---|
| src/session/scope-prompt.test.ts | **核心**：system-prompt/assemble 注入；group/direct 隔离；role 快照；parentSession 沿链；伪造/替换/无关 Agent 不注入；GROUP_EXTRA/DIRECT_EXTRA 区分 |
| src/runtime/agent-settings.test.ts:47-62 | prompt 延迟到新 Session（`rolePrompt('next')==='next prompt'`）|
| src/conversations/agent-settings.test.ts:17-57 | 默认值首准入复制；Session prompt 快照保留 |
| src/runtime/default-inheritance.test.ts | 清空 legacy default 后 prompt 为 ''；预设继承 host |
| src/client/config-form-state.test.ts:27-40 | groupPrompt/directPrompt 仅草稿层面，rebase 不提交（印证前端不可编辑）|

**缺口**：无 `inbound.test.ts`；assembleAgentBody/buildQuotePart/buildDynamicCtx/buildAgentBody 无直接单测。

### 4.2 文档
- docs/settings-and-message-records.md:7,19 —— 说明 prompt/预设/目录「新 Session 生效」
- docs/native-sessions.md:54 / .en.md:41 —— per-peer 快照、额外提示词编辑
- docs/decisions/functional-review.md（原 51,57 行）—— 明示「角色在新 Session 生效」；私聊用「此对话/补充指令」，仅群聊显示群能力提示
- 默认值重构验收（结论）—— 明确「清空提示词后不会暗中注入旧 QQ 提示词」
- README.md:58,60,142-143 —— 配置表与生效规则

---

## 5. 当前实现的问题 / 硬编码 / 耦合点清单

### A. 死代码 / 未消费
1. **buildAgentBody 的 Chat history 分支永不触发**：executeInbound 恒传 `history: undefined`（inbound.ts:121），导致 :336-352 整段为死代码，且与 background 机制重复。
2. **envelopeFormatter 白跑**：middleware-setup.ts:121 注册 envelopeFormatter 写 `ctx.state.envelope`，但全仓无任何 `.envelope` 读取（已 grep 确认）。它还依赖 `ctx.state.history`——但 **historyBuffer(historyBuffer middleware 未注册)**；historyLimit 配置因此实际无效。
3. 未注册 historyBuffer → SDK envelope 的 `<history>` 永远为空。

### B. 硬编码
4. **固定前言硬编码中文 100 字**（session-manager.ts:156），不可配置、不可分群私。
5. **section 常量**：name `'qqbot:scope-prompt'`、order `90`（session-manager.ts:162）硬编码。
6. **文本标签硬编码**（inbound.ts）：`[QQ 群聊/私聊 · … · @机器人]`(:149)、`[群聊背景，仅作资料]`(:149)、`[Quoted message begins/ends][Current message]`(:245)、`[Chat history begins/ends]`(:346-349)、`[Voice message]`(:224)、`[Reference attachments]`、`ASR:`。
7. `shortSenderId` 截 8 位（:432 SENDER_SHORT_ID_LEN）。
8. 前后端 prompt 长度不一致：后端 80000（agent-settings.ts:66），前端 textarea maxLength 20000（qq-agent-settings-form.ts:190）。

### C. 耦合 / 语义重叠
9. **三层提示词来源交叉**：config.groupPrompt/directPrompt → projectSettings 烘进 settings.prompt → row.prompt 快照 → rolePrompt。任一层 UI 手改都会切断 config 层，语义「config 兜底」实际在写入快照后失效。
10. **角色描述 describeRole 与 UI「补充提示词」共用同一 settings.prompt 字段**：无法区分「角色设定」与「用户自由补充」；改 role 会覆盖整个 prompt（index.ts:195）。
11. `rolePrompt` 同时承担 system section 文本与 message 快照两个语义来源，职责混合。
12. 语音信息**双重注入**：Layer1 `[Voice message] {text}`（:224）+ buildDynamicCtx `- ASR:`（:273），同一条语音转录可能出现两次。
13. 附件同样双重提示：Layer1 类型标签 `[图片]`（:229）+ Layer4 路径 `- Image: …`（:266）。

### D. 生效 / 一致性
14. **补充提示词不即时生效**，必须新建 Session（:494 与 docs 一致，但 UI 未就地提示草稿何时生效，仅在保存后返回消息）。
15. 快照机制使 config.groupPrompt/directPrompt 只在**首次准入**或**新建 Session**时被固化；后续修改 profile 配置对存量对话无效（与 docs 一致，但易误解为全局生效）。

### E. 私聊/群聊不对称
16. 群聊能力提示（如「仅群聊显示群平台能力提示」functional-review:57）在代码中未找到显式实现，可能缺失或散落；需重设计时确认。
17. 私聊无 history/background 的显式区分文案，与群聊共用前缀结构。

### F. 测试与可维护性
18. inbound 组装层无单测，死代码分支难以发现。
19. 「群聊背景」与「Chat history」两套历史语义并存（一套活、一套死），易在重设计时误接。

---

## 重设计可参考的关键文件锚点
- 注入点：src/session/session-manager.ts:143-169
- 拼装点：src/transport/inbound.ts:121,145-151,212-353
- 提示词源：src/runtime/conversation-service.ts:89,92,681-696,449-496；src/conversations/index.ts:164,191-196,542-567
- 配置：src/config.ts:71,73,118-119；src/setup/bind-routes.ts:94-113
- UI：src/client/config-form-state.ts:25,99；src/client/qq-agent-settings-form.ts:190
