# QQ 机器人形式化验证

[手动发送](qq-delivery/README.md)覆盖发送前撤权、回执丢失、重启防重和账本丢失。[配对码认领与撤权](qq-pairing/README.md)覆盖成员与回执分步写入、旧码失效以及重启后的撤销记录。[Session 切换](qq-session-switch/README.md)覆盖 Web 新建、QQ `/new`、入站恢复和重载。运行方式见[测试指南](../../TESTING.md#形式化检查)。

下列顺序按失败影响和能否用小模型复现来排。每个模型单独划定存储、进程和外部系统的边界。

| 顺序 | 场景 | 要守住的规则 | 最小复现 |
| --- | --- | --- | --- |
| 1 | 自动回复的流式与静态切换 | 回包始终归属原机器人、原对话和原输入回合。撤权后不开始新的上传或发包。流式提交结果未知时，静态回退不重复发送该回复。 | 一个输入、两个流式尝试、一个静态候选。交换超时、晚到回执、输入重复投递和运行实例更换的顺序。参见 [delivery-context.ts](../../src/transport/delivery-context.ts)、[streaming-writer.ts](../../src/transport/streaming-writer.ts) 和 [turn-tracker.ts](../../src/transport/turn-tracker.ts)。 |
| 2 | 审批和提问按钮 | 过期、取消或来自旧 Session 的按钮不能完成新请求。同一请求最多完成一次。 | 旧请求和新请求各一个，交错提交 QQ 回调、超时、取消和换 Session。参见 [approval-channel.ts](../../src/features/approval-channel.ts) 与 [question-channel.ts](../../src/features/question-channel.ts)。 |

跨机器人身份、QQ API 响应和界面展示继续由协议和宿主集成测试检查。
