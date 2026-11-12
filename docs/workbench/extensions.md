# QQ 工作台扩展

QQ 机器人包包含主组件和「QQ 消息记录」组件。在 DSH 的「插件 → QQ 机器人 → 包含的组件」中启用「QQ 消息记录」，选中的 QQ 会话就会显示「查看 QQ 记录」。关闭组件后，主组件继续收发消息和保存记录。

从同一源码构建两份安装包：

```sh
npm run build
npm pack
npm pack ./plugins/workbench-history
```

将两个包安装到同一个 DSH profile，仅在 `dsh.profile.bundles` 中选用 `@tencent-connect/dsh-qqbot`。其组合配置声明两行组件，记录组件要求 QQBot 核心 0.5.6 或兼容的 0.5.x 版本。

## 注册工作台界面

扩展包在 `dsh.client.inject` 中声明 `@tencent-connect/dsh-qqbot`，让浏览器加载器先加载 QQBot。客户端入口声明 `inject = ['qqbotWorkbench']`，并通过 `ctx.effect` 托管注册函数返回的注销回调。导入类型的路径为 `@tencent-connect/dsh-qqbot/workbench-extension`。

| 注册入口 | 用途 |
| --- | --- |
| `ctx.qqbotWorkbench.registerView({ id, title, component })` | 给第三列增加一个按需展开的视图。组件接收机器人、当前 QQ 对话和打开原生 Session 的入口。 |
| `ctx.qqbotWorkbench.registerSettingsSection({ id, title, component })` | 给第四列增加可折叠分组。组件接收当前对话的 `{ appId, scope, openId }` 和已绑定扩展 ID 的 `read`、`save`。 |

每个扩展应使用唯一的 ID。同一个设置分组在客户端和服务端使用相同的 ID。扩展组件负责配置表单、加载和错误反馈，工作台负责布局、当前对话和展开状态。

## 注册和读取设置

服务端入口依赖 `qqbot`。通过 `ctx.effect(() => ctx.qqbot.registerSettings(definition))` 注册扩展的默认值和 `parseOverrides`。解析函数接收当前层的部分字段，应保留字段缺省语义，并拒绝非法值。配置使用 JSON 值。

| 范围 | 标识 |
| --- | --- |
| 当前 DSH profile 下的 QQBot 全局 | `{ kind: 'global' }` |
| 指定机器人 | `{ kind: 'robot', appId }` |
| 指定群聊或私聊 | `{ kind: 'conversation', appId, scope, openId }` |

`ctx.qqbot.getSettings(id, scope)` 返回本层的 `overrides` 和 `revision`，以及按字段合成的 `effective` 和 `sources`。字段依次采用会话、机器人、全局的显式配置，最后取插件默认值。合并以顶层字段为单位。保存会替换当前层的覆盖对象，省略字段就恢复继承，`false` 是显式值。保存使用读取到的当前层 revision，遇到 HTTP 409 时重新读取再提交。停用扩展会注销读写入口，重装后可继续读取已保存的数据。

服务端处理器应按实际处理的目标调用 `getSettings`。收到新消息或处理新请求时读取有效配置，即可使用最新值。插件代码仍负责何时应用配置，以及相关工具和消息操作的权限。浏览器配置读写走 DSH owner 认证的 QQBot 路由。设置文件面向界面配置，凭据应使用各插件原有的凭据存储。
