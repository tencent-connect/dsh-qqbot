# QQ 机器人形式化验证

[手动发送](qq-delivery/README.md)已覆盖发送前撤权、回执丢失、重启防重和账本丢失。用[测试指南](../../TESTING.md#手动发送的形式化检查)中的命令运行 TLC 和真实 SDK 的本地回放。

下列顺序按失败影响和能否用小模型复现来排。每个模型单独划定存储、进程和外部系统的边界。

| 顺序 | 场景 | 要守住的规则 | 最小复现 |
| --- | --- | --- | --- |
| 1 | 配对码认领与撤权 | 成功结果对应已落盘成员。撤销后，撤销前签发的码不能重新授权同一身份。刷新、结束与到期的旧码不能继续使用。 | 两个码、一个成员。把「写成员」与「记录认领结果」、「写撤销记录」与「删除成员」拆开，在中间插入写入失败、重启或旧码重提。参见 [account-service.ts](../../src/runtime/account-service.ts) 与 [pairing-service.ts](../../src/runtime/pairing-service.ts)。 |
| 2 | 新建及切换 Session | 同一 QQ 对话只有一个当前绑定。旧请求、旧连接和过期配置不能抢回绑定。创建失败保留原绑定。 | 一个 QQ 对话、两个候选 Session，交错执行 Web 新建、QQ `/new`、入站恢复和配置重载。分别注入宿主创建成功但绑定落盘失败，以及绑定成功但旧会话清理失败。参见 [robot-runtimes.ts](../../src/runtime/robot-runtimes.ts) 与 [session-manager.ts](../../src/session/session-manager.ts)。 |
| 3 | 自动回复的流式与静态切换 | 回包始终归属原机器人、原对话和原输入回合。撤权后不开始新的上传或发包。流式提交结果未知时，静态回退不重复发送该回复。 | 一个输入、两个流式尝试、一个静态候选。交换超时、晚到回执、输入重复投递和运行实例更换的顺序。参见 [delivery-context.ts](../../src/transport/delivery-context.ts)、[streaming-writer.ts](../../src/transport/streaming-writer.ts) 和 [turn-tracker.ts](../../src/transport/turn-tracker.ts)。 |
| 4 | 审批和提问按钮 | 过期、取消或来自旧 Session 的按钮不能完成新请求。同一请求最多完成一次。 | 旧请求和新请求各一个，交错提交 QQ 回调、超时、取消和换 Session。参见 [approval-channel.ts](../../src/features/approval-channel.ts) 与 [question-channel.ts](../../src/features/question-channel.ts)。 |

下一份模型从配对和撤权开始。先限定两枚码、一个成员、一个机器人和一种用途。成员用第一枚码认领，第二枚码在撤权前签发但尚未认领。负对照移除持久化的撤销记录，要求 TLC 找出「撤权成功 → 重启 → 用第二枚旧码重新加白」的路径。再用实际配对服务和临时数据目录回放同一顺序。跨机器人身份、QQ API 响应和界面展示继续由协议和宿主集成测试检查。
