# QQ 机器人测试

端到端夹具在 `tests/e2e/`，形式化模型和待建模场景见[模型索引](tests/formal/README.md)。Agent 指引在 [qqbot-verify](.agents/skills/qqbot-verify/SKILL.md)，`.codex/skills` 和 `.claude/skills` 都以相对符号链接指向 `.agents/skills`。

## 日常检查

安装仓库依赖后，运行受影响的单元测试、类型检查和构建：

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck:client
pnpm build
```

这些命令不证明插件能在真实 Host 中加载。构建前先确认产物是否正在被其他实例使用；宿主集成启动器本身不会重建插件或 DSH。

## 形式化检查

安装 Java 11 或更高版本，下载 [TLC 1.7.4](https://github.com/tlaplus/tlaplus/releases/tag/v1.7.4) 的 `tla2tools.jar` 到仓库外。运行器验证 JAR 的 SHA-256。Java 不在 PATH 时可设置 `JAVA` 为可执行文件路径。

```bash
TLA2TOOLS=/absolute/path/to/tla2tools.jar pnpm verify:formal
pnpm test src/transport/manual-send.test.ts src/transport/delivery-safety.test.ts
pnpm test src/runtime/account-service.test.ts src/runtime/pairing-service.test.ts src/runtime/pairing-state.test.ts
pnpm test src/session/session-manager.test.ts src/gateway/bootstrap.test.ts
```

第一条运行手动发送、配对撤权和 Session 切换的模型及负对照。后续命令在插件代码中回放账本丢失、撤销记录回滚、入站恢复遇到 `/new` 或重载以及换绑失败。全部使用本地夹具，无需 DSH 或 QQ 连接。当前仓库未接入此 CI 步骤。

添加 `--ledger-loss` 后，通过 `lib/` 中的生产发送器和 QQ SDK 向本地 HTTP 服务重放。它验证重启后账本缺失、清空和恢复时，同一操作总共只发一次 POST。修改发送源码后先重建，再运行回放。

```bash
TLA2TOOLS=/absolute/path/to/tla2tools.jar pnpm verify:formal --ledger-loss
```

回放和模型都通过时返回 0，环境或结果有问题时返回 2。运行范围与账本恢复说明见[手动发送模型](tests/formal/qq-delivery/README.md)。

## 本地协议夹具

验证入口要求 Node 22.19+ 或 Node 24+（不支持 Node 23）及 Python 3.10+。请先确认当前终端使用的版本。

```bash
node scripts/verify-qqbot.mjs
node scripts/verify-qqbot.mjs --help
```

默认模式只验证本地 QQ HTTP/WebSocket 夹具与启动器边界，不启动 DSH，不调用模型，也不连接真实 QQ。虚拟凭据、固定测试用户和群组仅供回环测试；成功响应表示本地协议契约成立，不能据此判断真实 QQ 账号权限。

## 隔离 Host

另外需要已安装依赖的 DSH 源码目录。宿主 RPC 与 profile 契约目前按 DSH `0.2.2-alpha.2` 编写。插件必须包含 QQ 工作台的机器人状态接口；这个入口使用当前插件已有的构建产物。

使用已验证可用的 provider 与模型。准备一个仓库外的 YAML patch，只包含测试需要的 `llm-pi-ai` provider 配置和 `agent-default-model` 配置；两者的 provider/model 必须与 `--primary` 一致。配置中的 `apiKeyEnv` 引用环境变量，密钥从调用者环境提供，不把密钥写入 patch。提供方的首个模型作为 primary，另一个可用模型作为 secondary。

```bash
node scripts/verify-qqbot.mjs --mode host \
  --dsh-source /absolute/path/to/deepseek-harness \
  --model-patch /absolute/path/to/test-model.patch.yml \
  --primary example-provider/primary-model \
  --secondary example-provider/secondary-model \
  --reasoning high
```

未加 `--allow-model-requests` 时，只运行不需要生成的命令与配置场景，模型收发检查标记为 skipped。

需要完整模型验证时，显式添加：

```text
--allow-model-requests
```

此时固定测试消息只发往 primary；secondary 仅选择而不生成。若 primary 不支持指定推理等级，应选择它实际支持的等级或省略 `--reasoning`。额外的宿主标题请求可能使用该服务自己的推理等级，报告应与主请求分开说明。

可用 `--preset-primary`、`--preset-secondary` 选择已安装的预设，默认 `standard`、`minimal`；`--host-port`、`--fixture-port` 可指定空闲端口，默认自动分配。`--output` 指定本次新建的私有输出目录，已存在目录会被拒绝。

启动器会：

1. 新建 `DSH_HOME`、profile、`QQBOT_DATA_DIR` 和工作目录，使用 CLI 的本地 `link:` 安装路径。
2. 把显式提供的模型 patch 写入该 profile，并设置虚拟 QQ 账号与本地端点。
3. 检查真实模型目录、默认路由与预设。默认名称存在但 provider 列表为空时直接失败。
4. 通过真实 QQ SDK 协议、配置 HTTP 接口和 Session RPC 运行矩阵，保存报告。
5. 成功或失败后都停止本次创建的 Host 和夹具，保留输出目录便于诊断。

它不会自动读取日常凭据文件、复用已绑定 QQ 的 profile、重建 DSH、按端口终止其他进程，或自动推送代码。

## 证据与覆盖边界

Host 模式的报告位于启动器打印的私有目录；默认离线模式的测试结果输出到终端。日志可能包含宿主认证 URL；不要整份提交或粘贴日志。提交测试代码，不提交本机 run 目录、绑定资料、真实 openid、请求内容或历史验收快照。

命令模式重点检查：

- 私聊、群聊的 QQ SDK 收发及模型覆盖隔离。
- `/preset` 保存对话偏好，拒绝未知预设并支持重置。
- `/new`、`/reset`、`/clear` 更换当前绑定，保留偏好和其他对话的绑定。
- 保存插件配置后观察 SDK 重新连接，再读回配置、会话绑定和命令回复。

启用模型后，额外检查一轮私聊生成，核对实际 `request/header` 的模型及推理等级、回复标记和工作目录。运行中取消、压缩、已运行 Session 的冷恢复和真实 QQ 鉴权需要另行验证。前端变化还应在浏览器中检查原生选择器、保存读回、错误状态、草稿以及浅色和深色主题，见 [Agent 验证指引](.agents/skills/qqbot-verify/SKILL.md)。

新场景应加入矩阵和对应本地回归，而不是把一次成功结果写死进 skill。新增开发测试文件需保持在 npm 发布包之外。
