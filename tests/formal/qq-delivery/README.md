# QQ 手动发送模型

这份 TLA+ 模型描述一次发送操作从预留标识，到发出 QQ 消息 POST，再到记录回执的过程。对应实现见 [manual-send.ts](../../../src/transport/manual-send.ts) 和 [delivery-ledger.ts](../../../src/transport/delivery-ledger.ts)。运行入口见[测试指南](../../../TESTING.md)。

```mermaid
stateDiagram-v2
    state "可提交" as Idle
    state "已预留" as Reserved
    state "已发出请求" as Posted
    state "接口已接受" as Accepted
    state "已拒绝" as Rejected
    state "结果未知" as Unknown
    state "保留原预留" as Retained
    state "账本丢失，阻止发送" as Missing
    [*] --> Idle
    Idle --> Reserved: 验权，持久化操作标识
    Reserved --> Posted: 复查权限，开始 POST
    Reserved --> Rejected: 复查发现权限已撤销
    Posted --> Accepted: 接受回执
    Posted --> Rejected: 明确拒绝
    Posted --> Unknown: 未取得回执
    Reserved --> Retained: 重启
    Posted --> Retained: 重启
    Retained --> Missing: 停机期间账本丢失
    Accepted --> Missing: 停机期间账本丢失
    Unknown --> Missing: 停机期间账本丢失
    Rejected --> Missing: 停机期间账本丢失
```

重复提交只读取现有账本。图中的“保留原预留”表示重启后不会继续先前的网络请求。初始化标记存在时，缺失或清空账本会阻止重新登记操作。

| 配置 | 检查什么 | 预期结果 |
| --- | --- | --- |
| `normal.cfg` | 启用权限复查和账本保护，允许撤权、重启、重提、丢回执和停机时丢失账本 | 通过下列四条不变量 |
| `no-post-check.cfg` | 人为关闭发 POST 前的权限复查 | `Reserve → Revoke → SubmitPost` 违反 `OnlyAuthorizedPost` |
| `ledger-loss.cfg` | 人为关闭账本保护 | 一次 POST 后失去账本，再次提交会违反 `OnePostPerOperation` |

模型检查的四条不变量：

- `OnlyAuthorizedPost`：开始 POST 时仍有发送权限。
- `OnePostPerOperation`：同一操作最多开始一次 POST。
- `AcceptedRequiresPost`：标记接口已接受之前必须开始 POST。
- `PostFollowsReservation`：开始 POST 时已有持久化的操作预留。

模型只取一个机器人、一个目标和一个操作，计数最多走到第二次 POST，足以暴露这个操作的重复发送。权限判断和请求开始合并为一个动作。模型不推断已发出的网络请求能被撤销，也不验证平台送达、跨机器人隔离、分段上传和磁盘原子性。

账本丢失回放使用独立 Node 进程重提同一个操作，并通过本地 HTTP 服务直接数 POST。账本缺失或清空时，重提都会被拦截。恢复原账本后仍只有最初的一次 POST。

旧版账本首次成功读取时会补写 `.initialized` 标记。备份时请将 `delivery-*.jsonl` 与对应标记一起保留。发现账本缺失或清空时，恢复完整账本并重启插件。模型假设标记仍然存在，完整数据目录丢失和回滚到较旧的有效账本均在检查范围之外。

优先通过 `src/transport/manual-send.test.ts` 验证实际代码中的撤权和防重。模型约束状态转换，代码回归核对实现，真实 QQ 收发另验。
