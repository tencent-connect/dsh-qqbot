---
name: qqbot-verify
description: Verify dsh-qqbot command routing, persisted model and preset selection, isolated Host integration, and optional Web UI after plugin changes. Use for QQ bot integration or release checks; ordinary unit tests need no Host.
---

# 验证 dsh-qqbot

从仓库根目录执行。先读 [测试指南](../../../TESTING.md)，再选择本次改动需要的层级；不要把所有验证都变成真实 QQ 或模型调用。

## 选择验证范围

- 逻辑修复：运行受影响的 Vitest 测试。
- 夹具或启动器：运行 `node scripts/verify-qqbot.mjs`，验证本地 QQ HTTP/WS 契约、配置约束与进程清理。
- 命令、配置或宿主接口变化：运行指南中的隔离 Host 测试；先检查模型目录中的实际 provider/model，默认名称存在不代表 provider 已注册。
- 会话历史、生成或取消行为：显式启用 `--allow-model-requests`。只有 primary 模型可生成，secondary 仅用于切换。报告实际 request/header 的模型及推理等级。
- 客户端变化：再做下述真实浏览器验证。协议夹具不能证明手机渲染或 QQ 平台权限。

## 隔离约束

启动器创建新的 `DSH_HOME`、`QQBOT_DATA_DIR`、profile、工作目录和回环端口，仅使用虚拟 QQ 凭据与固定测试目标。沿用这些边界，不改成日常 profile，不复制真实 QQ 绑定。

测试前确认 Node 版本、插件构建、DSH 源码版本与预设目录。启动器不构建插件或 DSH；若待构建文件正由另一个实例提供，先确认其归属与活动。不要在日常宿主使用的源码目录重建 DSH 产物。

模型 patch 只描述测试需要的 provider 和默认选择，密钥通过调用者环境提供。不要把凭据、启动 token、真实 openid、会话日志或本机验收数据加入 Git。

启动器只清理它创建的进程，保留私有 run 目录。不要按端口批量杀进程。真实扫码绑定或手机收发需要用户参与时，保留该验证实例；不要解绑来准备自动测试。

## 观察正确的状态

模型切换必须同时满足：原 Session ID 与历史前缀保留、当前预设不变、追加 `model/selection`，并且 `modelSelection.next` 与反馈一致。不能只比较 prefs 文件或成功文案。

预设命令改变下一会话的预设，`/new` 才应用。模型 reset 取最新网页默认，网页未指定时继承 DSH 默认及推理等级。检查私聊、群聊之间的覆盖隔离，以及失败不修改原偏好。

冷恢复检查先确认 SDK 因 HMR 重新连接，再直接发送 `/model` 切换或 reset；恢复后仍应是同一会话，且没有额外推理请求。仅刷新字段或在热会话里重复命令不能代替此检查。

## 浏览器补充验证

在测试实例打开 QQ 机器人设置，比较渲染值与独立的配置读取结果。检查账号按钮直接展示、宿主原生模型与预设菜单、保存后读回、草稿与撤销、加载失败处理，以及浅色和深色主题。

使用无效或不可用选项作负对照；不要只凭截图断言配置已保存或机器人在线。界面验证不得更换真实凭据或解绑账号来制造失败。

## 报告与停止条件

首个失败时保留报告并定位，修复后只重跑受影响场景；不要靠重复生成获得偶然成功。区分 passed、failed、skipped。生成结束太快而未观察到 running 时，不能声称验证了运行中取消。

汇总源码版本、运行命令、已覆盖场景、真实模型路由、报告路径和清理结果。明确长历史压缩、断网重连、手机渲染、真实平台鉴权等未运行的项目。运行历史证据不随 skill 固化；新变更重新验证。
