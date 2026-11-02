# QQ 机器人测试

测试代码与夹具在 `tests/e2e/`，入口为 `scripts/verify-qqbot.mjs`。Agent 指引在 [qqbot-verify](.agents/skills/qqbot-verify/SKILL.md)；`.codex/skills` 和 `.claude/skills` 都以相对符号链接指向 `.agents/skills`，只维护一份内容。

## 日常检查

先完成 [README 本地开发](./README.md#本地开发)中的 stock Host 准备、依赖链接与安装，再运行受影响的单元测试、类型检查和构建：

```bash
pnpm test
pnpm typecheck:client
pnpm build
```

这些命令不证明插件能在真实 Host 中加载。构建前先确认产物是否正在被其他实例使用；宿主集成启动器本身不会重建插件或 DSH。

## 本地协议夹具

验证入口要求 Node `^22.19.0 || >=24.0.0`（不支持 Node 23）及 Python 3.10+；当前验收使用 Node 24。请先确认当前终端使用的版本。

```bash
node scripts/verify-qqbot.mjs
node scripts/verify-qqbot.mjs --help
```

默认模式只验证本地 QQ HTTP/WebSocket 夹具与启动器边界，不启动 DSH，不调用模型，也不连接真实 QQ。虚拟凭据、固定测试用户和群组仅供回环测试；成功响应表示本地协议契约成立，不能据此判断真实 QQ 账号权限。

## 隔离 Host

另外需要已安装依赖、公开构建产物齐备的未修改 stock DSH 源码目录；准备步骤与已验收基线见 [README 本地开发](./README.md#本地开发)。宿主 RPC 与 profile 契约目前按 DSH `0.2.2-alpha.2` 编写。

使用已验证可用的 provider 与模型。准备一个仓库外的 YAML patch，只包含测试需要的 `llm-pi-ai` provider 配置和 `agent-default-model` 配置；两者的 provider/model 必须与 `--primary` 一致。配置中的 `apiKeyEnv` 引用环境变量，密钥从调用者环境提供，不把密钥写入 patch。提供方的首个模型作为 primary，另一个可用模型作为 secondary。

```bash
node scripts/verify-qqbot.mjs --mode host \
  --dsh-source /absolute/path/to/deepseek-harness \
  --model-patch /absolute/path/to/test-model.patch.yml \
  --primary example-provider/primary-model \
  --secondary example-provider/secondary-model \
  --reasoning high
```

未加 `--allow-model-requests` 时，只运行不需要生成的命令与配置场景，报告将历史、实际选路与生成中取消等场景标记为 skipped。它不会用绿色总结果暗示这些能力已经验收。

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

## 复用已有隔离环境

[upstream-host.mjs](./tests/e2e/upstream-host.mjs) 可复用已安装的隔离 Home、`qqbot-commands` profile 和构建产物，启动 stock Host 与本地 QQ 夹具。它不安装依赖、不创建 Home、不改写配置，也不重建插件或 Host。Host 与夹具分别使用端口 3194、3195。

用 `QQBOT_TEST_HOME` 指定已有隔离 Home 的绝对规范路径；启动时 `--home` 必须传入同一路径。未设置该变量时，默认位置为当前用户的 `~/.local/share/dsh-qqbot-command-test`。具体启动参数见帮助：

```bash
export QQBOT_TEST_HOME="/absolute/path/to/isolated-qqbot-home"
node tests/e2e/upstream-host.mjs --help
python3 tests/e2e/upstream_api.py --help
python3 tests/e2e/upstream_acceptance.py --help
```

运行 [upstream_api.py](./tests/e2e/upstream_api.py)、[upstream_acceptance.py](./tests/e2e/upstream_acceptance.py) 及其他导入该 API 的辅助脚本时，保留同一个 `QQBOT_TEST_HOME`；通过 `--config` 指向启动器输出的私有 `run.json`。该 Home 必须与日常 `DSH_HOME`、`~/.dsh` 和用户主目录隔离；插件数据与证据分别保留在此 Home 的数据目录与 `evidence/` 中。

启动器从标准输入接收 `{"action":"status"}`、`{"action":"restart"}` 或 `{"action":"stop"}`，关闭标准输入也会停止本次创建的进程。默认不调用模型；模型场景仍需显式 `--allow-model-requests`。

## 证据与覆盖边界

Host 模式的报告位于启动器打印的私有目录；默认离线模式的测试结果输出到终端。日志可能包含宿主认证 URL；不要整份提交或粘贴日志。提交测试代码，不提交本机 run 目录、绑定资料、真实 openid、请求内容或历史验收快照。

完整模式重点检查：

- 手机覆盖、网页默认、DSH 默认的优先级，以及私聊和群聊之间的隔离。
- `/model` 与 reset 保留 Session ID、历史前缀和当前预设，同时追加持久化选择事件。
- `/preset` 改变下一会话的预设，`/new`、`/reset`、`/clear` 保留偏好并按新预设创建会话。
- HMR 后不先发送普通消息，直接切模型、reset，并在再次 HMR 后重放选择。
- 实际 request/header 的模型与推理等级、回复内容及工作目录。
- 运行中的 `/stop`；若生成过快而未捕获 running，报告为 skipped，不盲目重试。

`/compact` 只覆盖短历史调用路径；长上下文摘要质量、断网故障、真实平台鉴权和手机渲染需要另行验证。前端变化还应在浏览器中检查原生选择器、保存读回、错误状态、草稿以及浅色和深色主题，见 [Agent 验证指引](.agents/skills/qqbot-verify/SKILL.md)。

新场景应加入矩阵和对应本地回归，而不是把一次成功结果写死进 skill。新增开发测试文件需保持在 npm 发布包之外。
