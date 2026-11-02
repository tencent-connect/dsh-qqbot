# QQ 插件 Prompt 构造重构方案（最优解）

状态：设计已进入实现代码；本文保留重构前的问题和实施顺序，不代表运行验收完成。当前使用方式见[默认配置与消息记录](../guides/settings-and-message-records.md)。原始触发：QQ 会话里模型不主动用工具（提示词偏置）；群聊/私聊补充提示词不分、不即时生效；system prompt 注入方式非 DSH 正规路径。
原则：开发阶段无历史包袱，只取最优架构，不做向后兼容妥协。

## 一、调研结论（三份报告：dsh-prompt / qq-bridge / plugin-baseline）

1. **DSH system prompt 是会话历史节点，不是请求字段**（`packages/core/system-prompt`；docs/subsystems/system-prompt.md:44）。正规注入 = `ctx.systemPrompt.section({name,order,text:(ctx)=>...})`，可在 `agent.ctx` 里按 scope 注册；动态运行事实用 `systemPrompt.context()` → user 角色快照；每轮外部消息用 `createUserMessage` + `agent.followup/inject`。
2. **waterfall 是呈现层**：complete section 之后会被还原，listener 不能可靠增删某 scope 的 system。现状插件只依赖 waterfall（实测无任何 section()/context() 调用）→ 改为注册式。
3. **每个 prompt fact 一个 owner**：规则/人设/群私场景/补充词/每轮元信息各自独立来源，不交叉。
4. qq-bridge 精华：三层切分、preset fail-closed、role-card 按模式分节、at/ago 时间视图、初始背景仅 bootstrap 注入并按群/私分开。糟粕：单文件、JS 硬编码、双协议路径重复、人设每条全量注入。

## 二、目标架构

```
system 层（稳定，ctx.systemPrompt.section()，agent.ctx 内按 scope 注册）
  qqbot:rules      order 400  固定：防幻觉 + 鼓励用工具（删除"只有处理文件/任务才用"）
  qqbot:scope      order 420  群聊版 / 私聊版（按会话 scope 二选一，动态 text(context)）
  qqbot:persona    order 440  人设 role-card（markdown，〔群聊〕/〔私聊〕分节，剥标记后注入）
  qqbot:extra      order 460  补充提示词 promptGroup/promptDirect（每步现读 settings，即时生效）
context 层（每轮运行事实 → user 快照，systemPrompt.context()）
  qqbot:turn-meta  order 100  来源(群/私)、是否@、发送者、相对时间(at/ago)、未读水位
user 层（本轮消息本体，createUserMessage + followup）
  [来源] [引用] [背景(群聊非@历史,仅资料)] [用户正文]  ← 独立 block，集中模板常量
```

## 三、文件级改造清单

### 新增 src/prompt/
- `rules.ts`：固定规则文本（唯一 owner）。要点：你是通过 QQ 对话的助手；需要外部/实时/不确定信息时主动调用工具（搜索/抓网页/读文件等），不要凭记忆作答或编造；不要输出工具调用协议原文/模拟调用；工具以本轮清单为准。
- `scope.ts`：`GROUP_RULES` / `C2C_RULES` 两版；`scopeSection(scope)`。
- `persona.ts`：role-card 解析（`〔群聊〕/〔私聊〕` 标记识别、注入前剥离、`selectRoleText(card, scope)`、`roleSectionReport`）。
- `extra.ts`：`extraPrompt(settings, scope)`（promptGroup/promptDirect 现读）。
- `turn-meta.ts`：`turnMeta(context)` 生成每轮来源/@/发送者/相对时间/未读水位文本；`relTime(at, now)` → `at/ago`。
- `index.ts`：统一导出；集中所有文本常量与组装函数（inbound 不再散落硬编码）。

### src/session/session-manager.ts
- **删除** `registerScopePromptInjection` 的 waterfall append（:143-169）。
- 改为在 `guardAgent`/`agent/created` 时，对 `agent.ctx`：
  ```
  agentCtx.systemPrompt.section({ name:'qqbot:rules',   order:400, text:()=>RULES });
  agentCtx.systemPrompt.section({ name:'qqbot:scope',   order:420, text:(c)=>scopeText(entry.scope) });
  agentCtx.systemPrompt.section({ name:'qqbot:persona', order:440, text:()=>personaText(entry) });
  agentCtx.systemPrompt.section({ name:'qqbot:extra',   order:460, text:()=>extraText(entry) });
  agentCtx.systemPrompt.context({ name:'qqbot:turn-meta',order:100, text:(c)=>turnMetaText(entry, c) });
  ```
  用 disposer 随 agent 销毁清理。

### src/transport/inbound.ts
- 引入 src/prompt/；正文用集中模板常量（`[来源]/[引用]/[背景]/[你]` 独立 block）。
- 修死代码：`history: undefined`（:121）→ 真正传入或在 `buildAgentBody` 删除该分支。
- 来源/@/发送者/时间移入 `qqbot:turn-meta`（context），正文只留 [引用]/[背景]/[你]。
- 语音/附件去重（各注入一次）；前后端 prompt 上限统一。

### src/shared/agent-settings.ts + conversations/service
- `QQAgentSettings.prompt` → `promptGroup` + `promptDirect`（迁移旧 prompt）。
- 去掉 `row.prompt` 快照优先；补充词每步现读 settings（即时生效）。
- 人设：`role` 保留但 role-card 作为 persona 内容（决定 role-card 存放：见实现说明）。
- `config.groupPrompt/directPrompt` 并入"新对话默认值"（`config-form-state.ts` 允许编辑 groupPrompt/directPrompt，落到 defaults.promptGroup/promptDirect）。

### src/client/qq-peer-settings.ts / qq-defaults-settings.ts
- 会话设置：按 `entry.scope` 只显示「群聊补充提示词」或「私聊补充提示词」。
- 新对话默认值：群/私两个补充框都显示。

### 测试
- 新增 `src/prompt/*.test`；inbound 组装单测；改造 scope-prompt.test.ts（目前断言的旧 section 行为需重写为 section/context 注册断言）。

## 四、实施顺序（分批，每批 tsc+vitest+2392 预览验证）
1. `src/prompt/` 模块 + 单测（纯函数，无副作用，可先独立完成）。
2. session-manager 改 waterfall→section/context 注册。
3. inbound 重构用 prompt 模块 + 修死代码 + 去重。
4. agent-settings/config 数据层拆分 + 即时生效。
5. 客户端表单（群/私补充词）。
6. 全量回归 + 预览验证 + 提交。

## 五、验收
- QQ 会话「最近有什么新闻」**首次即触发** web_fetch/web_search（无需追问）。
- 群聊与私聊 system section 不同；补充词按 scope 分离、改设置即时生效。
- tool-meta 以 runtime context 快照出现，不混入用户正文。
- tsc(server+client) clean、vitest 全绿、离线 e2e 通过、3192 真机验证。
