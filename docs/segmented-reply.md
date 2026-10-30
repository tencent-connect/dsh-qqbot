# 分条发送（多气泡）

把一段助手回复拆成多条独立 QQ 消息发出，模拟真人连着发几条短消息的节奏。
策略沿用 AstrBot `segmented_reply` 在 QQ 上的线上取值（2026-10），并按 QQ 官方
机器人的被动回复限额重新校准。

## 1. 为什么需要它

官方 QQ Bot 通道一条回复只会落在**一个气泡**里：

| 现状 | 原因 |
| --- | --- |
| 一行一句也只有一个气泡 | `chunker.ts` 只负责绕开单条 5000 字符上限，短回复根本不会切 |
| 改 `textChunkLimit` 无效 | 它只在文本超限时才切，普通多行回复仍然整条 |
| 流式更像一条消息被改写 | `openStream/update/complete` 是全量替换同一个 msgId |

所以「多气泡」必须新写一条发送路径，而不是调参数。

## 2. 决策流程

```
模型回复 ──► 可见字数 ≤ wordsCountThreshold ? ──否──► 整条发送（平台切块兜底）
                     │是
                     ▼
            按 splitMode 切分（regex / words / line）
                     ▼
        切分点落在代码块 / GFM 表格内部？ → 推到块末（结构不碎）
                     ▼
            每段按 contentCleanupRule 收尾（默认剥掉句尾「。」）
                     ▼
            超过 maxBubbles → 尾巴并进最后一条
                     ▼
        每段超过 textChunkLimit → chunkMarkdownText 兜底
                     ▼
        串行发送，条间 sleep(interval)，单条失败不中断
```

只对**模型回复**生效（`onlyLlmResult=true`）：工具结果、轮次异常提示、系统消息
一律整条发，避免把日志 / 表格切碎。

## 3. 参数表

| 参数 | 默认 | 管什么 | 取值建议 |
| --- | --- | --- | --- |
| `enable` | `false` | 分条总开关 | 唯一的开关；关闭即退化为「一次回复一条」 |
| `onlyLlmResult` | `true` | 哪些内容参与分条 | 保持 `true`；改 `false` 会切到工具输出 |
| `splitMode` | `regex` | 切分方式 | `regex` 同时认标点与换行；`line` 只看换行；`words` 只认词表 |
| `regex` | `.*?(?:[。！？!?~…]+\|\n+)|.+$` | 切分点 | 必须保留 `\n+` 分支，否则「一句一行」失效 |
| `splitWords` | `["。","？","！","~","…"]` | words 模式词表 | 仅 `splitMode=words` 生效 |
| `contentCleanupRule` | `[。]+$` | 每段收尾清理 | 只锚定结尾；写成 `[。]+` 会把句中句号也删掉 |
| `wordsCountThreshold` | `150` | 分条上限 | 提高 → 更少分条；降低 → 长回复也切 |
| `forwardThreshold` | `1500` | 不分条上限 | QQ 无合并转发，超此值直接整条发送 |
| `intervalMethod` | `random` | 间隔算法 | `random` 固定区间均匀；`log` 短句快长句慢 |
| `intervalMin` | `2.5` | 条间下限（秒） | 风控敏感参数，不建议低于 2.5 |
| `intervalMax` | `5` | 条间上限（秒） | 太高会像客户端卡死 |
| `logBase` | `2.6` | log 模式底数 | 仅 `intervalMethod=log` 生效；越大越平缓 |
| `logJitter` | `0.5` | log 抖动上限（秒） | 仅 log 模式 |
| `maxBubbles` | `3` | 单轮最多气泡 | QQ 被动回复限额 4 次，建议 ≤3 |

## 4. 参数间的硬约束

1. **`wordsCountThreshold` < `forwardThreshold`**（150 < 1500）。区间内（151~1500 字）
   整段一条发；超过 1500 同样整条发，只是日志里原因不同。
2. **`intervalMin` ≥ 2.5 秒**：AstrBot 侧 10-26 被踢下线后定的安全线；下调前先看
   当日拆条量（>300 条/日算高风险）。
3. **`regex` 必须保留 `\n+`**：删掉后只能靠标点切，「一句一行」的人格约定失效。
4. **`contentCleanupRule` 只锚定结尾**：`[。]+$` ✔，`[。]+` ✘。
5. **分条与流式互斥**：`enable=true` 时该会话强制关闭流式输出（流式是全量重写
   同一条消息，两条路径不能同时生效）。
6. **`maxBubbles` 与被动回复额度**：QQ 对同一条来源消息只允许 4 次被动回复
   （`reply-limiter.ts`），超出后 `resolveReplyTarget` 会降级为主动推送
   （用户仍收到，但不再是「回复」语义）。所以默认留 1 条余量。

## 5. 配置方式

### 设置页（推荐，即时生效需等 HMR 重载）

「设置 → QQ 机器人 → 基础设置 → 分条发送」，可改：总开关、仅模型回复、
条间间隔上下限、单轮最多气泡数、分条字数上限。

### profile patch（高级参数）

```yaml
- id: im-qqbot
  config:
    segmentedReply:
      enable: true
      onlyLlmResult: true
      splitMode: regex
      regex: '.*?(?:[。！？!?~…]+|\n+)|.+$'
      contentCleanupRule: '[。]+$'
      wordsCountThreshold: 150
      forwardThreshold: 1500
      intervalMethod: random
      intervalMin: 2.5
      intervalMax: 5
      maxBubbles: 3
```

嵌套对象按「顶层键整体替换」写入（与 `access` 一致），改一个字段也要带全其余字段。

## 6. 验收与排障

| 现象 | 查什么 |
| --- | --- |
| 启动日志有「分条发送已启用 …」 | 配置确实进了运行时（等价 AstrBot 的 `Segmented-reply interval: [2.5, 5.0]`） |
| 每条回复后有「分条 N 条，间隔 [..]s」 | 真的切了，且间隔符合配置 |
| 回复仍是一条 | 可见字数超过 `wordsCountThreshold`；或 `enable=false`；或不是模型回复 |
| 只切到 1 段 | 文本本身没有标点/换行；或 `maxBubbles=1` |
| 代码块 / 表格被切断 | 检查 `splitMode` 与 `regex`；保护逻辑只覆盖围栏代码块与 GFM 表格 |
| 第 4 条之后变成主动推送 | `maxBubbles` 设太大，超出被动回复限额 4 次 |

离线预演（不碰 QQ，不重启 DSH）：

```bash
node scripts/preview-segmentation.mjs --config <profile>/cordis.patch.yml --text "在呢。吃了吗？睡吧"
```

脚本会读 profile patch → 过一遍真实 `ConfigSchema`（补默认值）→ 打印每个气泡与
各自的间隔，用来在重启前确认参数。

## 7. 风险与回退

- **风控**：间隔是唯一敏感参数；连续大量拆条可能触发平台限制。先按默认
  `[2.5, 5]` 跑一天，确认无异常再考虑下调。
- **长文**：`wordsCountThreshold` 防的是「分析被切成刷屏」，不是平台长度限制；
  单条仍然受 `textChunkLimit` 约束。
- **回退**：`segmentedReply.enable: false`（设置页关掉即可），流式与单条行为
  立即恢复旧版，无需改代码。
