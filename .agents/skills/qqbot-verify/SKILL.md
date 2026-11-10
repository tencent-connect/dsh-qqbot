---
name: qqbot-verify
description: Verify dsh-qqbot changes with Vitest, QQ protocol fixtures, a TLA+ delivery model, isolated DSH Host, and optional Web UI. Use for changes to QQ access, Session routing, delivery, workbench UI, or release checks.
---

# 验证 dsh-qqbot

从仓库根目录执行。先读 [测试指南](../../../TESTING.md)，再选择本次改动需要的层级；不要把所有验证都变成真实 QQ 或模型调用。

## 选择验证范围

- 逻辑修复：运行受影响的 Vitest 测试。
- 手动发送、防重、撤权或账本：运行 `pnpm verify:formal` 和相关 Vitest 回归。重建后用 `pnpm verify:formal --ledger-loss` 检查新进程下缺失、清空和恢复三种路径。改变发送边界或恢复规则时同步修改[模型与负对照](../../../tests/formal/qq-delivery/README.md)。
- 配对码或名单撤销：运行 `pnpm verify:formal` 和 `pnpm test src/runtime/account-service.test.ts src/runtime/pairing-service.test.ts src/runtime/pairing-state.test.ts`。核对配对状态重载和只回滚配对文件的结果，见[配对模型](../../../tests/formal/qq-pairing/README.md)。
- Session 换绑或网关重载：运行 `pnpm verify:formal` 和 `pnpm test src/session/session-manager.test.ts src/gateway/bootstrap.test.ts`。用可控的宿主回调重放 `/new`、重载与保存失败，分别读取内存和落盘的绑定，见[Session 切换模型](../../../tests/formal/qq-session-switch/README.md)。
- 夹具或启动器：运行 `node scripts/verify-qqbot.mjs`，验证本地 QQ HTTP/WS 契约、配置约束与进程清理。
- 命令、配置或宿主接口变化：运行指南中的隔离 Host 测试；先检查模型目录中的实际 provider/model，默认名称存在不代表 provider 已注册。
- 生成路径：显式启用 `--allow-model-requests`。只有 primary 模型可生成，secondary 仅用于切换。报告实际 request/header 的模型及推理等级。运行中取消等不在矩阵内，按改动另验。
- 客户端变化：再做下述真实浏览器验证。协议夹具不能证明手机渲染或 QQ 平台权限。

## 隔离约束

启动器创建新的 `DSH_HOME`、`QQBOT_DATA_DIR`、profile、工作目录和回环端口，仅使用虚拟 QQ 凭据与固定测试目标。沿用这些边界，不改成日常 profile，不复制真实 QQ 绑定。

测试前确认 Node 版本、插件构建、DSH 源码版本与预设目录。启动器不构建插件或 DSH；若待构建文件正由另一个实例提供，先确认其归属与活动。不要在日常宿主使用的源码目录重建 DSH 产物。

模型 patch 只描述测试需要的 provider 和默认选择，密钥通过调用者环境提供。不要把凭据、启动 token、真实 openid、会话日志或本机验收数据加入 Git。

启动器只清理它创建的进程，保留私有 run 目录。不要按端口批量杀进程。真实扫码绑定或手机收发需要用户参与时，保留该验证实例；不要解绑来准备自动测试。

## 观察正确的状态

模型切换检查群聊与私聊各自的覆盖。改动若涉及活跃 Session 模型切换，再检查原 Session ID、历史前缀、当前预设和原生模型选择事件。仅比较 prefs 文件或成功文案不足以证明实际模型选路。

预设命令改变下一会话的预设，`/new` 才应用。检查私聊、群聊之间的覆盖隔离，以及失败不修改原偏好。

配置保存后先确认 SDK 重新连接，再检查绑定、偏好和 QQ 命令。改动若涉及冷恢复，再检查已运行 Session 恢复后能继续使用原会话，并区分只切换模型和真正发送推理请求。

## 浏览器补充验证

在测试实例打开 QQ 机器人设置，比较渲染值与独立的配置读取结果。检查账号按钮直接展示、宿主原生模型与预设菜单、保存后读回、草稿与撤销、加载失败处理，以及浅色和深色主题。

涉及工作台时，用相同 OpenID 在两个虚拟机器人下对照会话、设置和流水的隔离。发送前核对机器人、群或私聊及正文，发送后核对 SDK 请求与记录状态，区分接口接受和客户端送达。

使用无效或不可用选项作负对照；不要只凭截图断言配置已保存或机器人在线。界面验证不得更换真实凭据或解绑账号来制造失败。

## 报告与停止条件

首个失败时保留报告并定位，修复后只重跑受影响场景；不要靠重复生成获得偶然成功。区分 passed、failed、skipped。生成结束太快而未观察到 running 时，不能声称验证了运行中取消。

汇总源码版本、运行命令、已覆盖场景、真实模型路由、报告路径和清理结果。明确长历史压缩、断网重连、手机渲染、真实平台鉴权等未运行的项目。运行历史证据不随 skill 固化；新变更重新验证。
