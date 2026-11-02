# QQ Bot 设置界面与 DSH 原生组件一致性审查

日期：2026-10-31。范围：QQ 客户端全部设置表面及相关公开宿主控件；对照未修改的 DSH Host。

本审查为只读检查（实现与浏览器），未改动代码、配置、权限或绑定。以下整改项按结论落实。

## 总体结论

当前插件混用 DSH 公共组件、手写原生外观的配置控件、浏览器默认表单与自制弹层。应统一组件、显示名、焦点层及状态规则。仅给 select 修改背景色不能统一系统绘制的选项菜单。

账号、单对话和群权限分别属于不同设置范围，保留这些入口。重复的新建、工作区及备注操作应共用实现，避免同一数据在不同入口显示不一致。

## 选择框与页面盘点

生产客户端有 **10 个原生 HTML select 创建点**，不是运行时实例数。逐工具与分类控件会重复渲染。

| 页面 | 来源与数量 | 问题及建议 |
| --- | --- | --- |
| 侧栏工作区弹窗 | [qq-sidebar.ts:161](../../../src/client/qq-sidebar.ts#L161)，1处 | 系统 select；工作区标题未本地化。复用原生 Menu 组合与公共显示名 helper。 |
| 对话概览 | [conversation-panel.ts:138](../../../src/client/conversation-panel.ts#L138)，2处 | Agent 预设、工作区均为 select；与侧栏工作区操作有独立表单实现。 |
| 群策略 | [conversation-policy.ts:74](../../../src/client/conversation-policy.ts#L74)，7处 | 模板、复制配置、分类批量、逐工具权限、执行沙箱、默认权限、上下文模式。 |
| 全局模型与预设 | [config-selectors.ts:57](../../../src/client/config-selectors.ts#L57) | 已使用公共 Menu，具备 portal、selectedId、锚点宽度及独立列表类名，可作为插件统一选择器基础；触发按钮仍可进一步复用公共 Button。 |
| 绑定与全局配置 | [bind-page.ts:281](../../../src/client/bind-page.ts#L281)、[config-panel.ts:81](../../../src/client/config-panel.ts#L81) | 自写按钮、输入、开关与分段控件，尺寸和焦点样式与对话表单不同。解绑还有 window.confirm，不能跟随原生覆盖层。 |
| 所有者、历史、换新、群记录 | [conversation-panel.ts:46](../../../src/client/conversation-panel.ts#L46)、[conversation-settings.ts:13](../../../src/client/conversation-settings.ts#L13) | 原生按钮与手写数字、搜索、textarea、checkbox混用，应统一字段外观与状态。 |
| 抽屉与发送预览 | [conversation-panel.ts:62](../../../src/client/conversation-panel.ts#L62) | 自制 Dialog、焦点循环、Escape 和层级，与侧栏公共 Modal 并存。 |

`.imqc` 输入使用1px边框、7px/9px padding和bg-base；账号配置另写0.5px边框、34px高度与bg-layer-3。两套规格分别位于 [conversation-styles.ts:11](../../../src/client/conversation-styles.ts#L11) 和 [config-panel.ts:81](../../../src/client/config-panel.ts#L81)。不能把两者都使用语义颜色当作原生样式已经一致。

自定义树节点按钮属于导航行，可保留。需要删除的是重复控件外观与宽泛 CSS 覆盖，不是机械替换所有 button/textarea。

## 宿主公开接口与名称

核对宿主公开 `@deepseek-ai/dsh-client-ui-primitives` 根入口后确认：

- 选择框使用 Menu + Button。没有公共 Select 或 Combobox。
- Input 支持数字类型。Checkbox、Switch、SegmentedTabs、SegmentedControl 和 SettingsForm 已公开。
- 长文本仍可使用 textarea，沿用原生表单材质；InlineEditor 的 Enter/Escape保存语义不适合直接替换长配置字段。
- 普通弹窗使用 Modal。没有公共 Drawer，抽屉可保留布局并复用 useModalLayer。
- WorkspacePicker、ModelSelect 等 feature 实现不是外部插件可直接导入的公用控件。

工作区名称有公开 pure helper：

```ts
workspaceDisplayTitle(workspace.title, t('workspace.defaultName'))
```

导入路径为 `@deepseek-ai/dsh-api-workspace-controller/default-workspace`；`workspace.defaultName` 是宿主公共词汇。原生树与工作区选择器均使用这一显示规则。插件目前侧栏取 raw title，概览又独立取 item.title/path，因此显示 default-workspace。

格式化只影响标签。保留 workspaceId 作为选择值、key及RPC身份，不按本地化名称匹配工作区。

Menu 在抽屉中应使用 portal、锚点最小宽度和独立 listClassName，并保留 selected/disabled/不可用值。现有自制 Dialog 的 Tab trap 只查询自身 DOM，不理解 body-portaled Menu，也未复用共享 top-layer/IME规则。因此替换下拉时应同步接入 useModalLayer，避免新增键盘导航冲突；此冲突风险来自源码，尚未以故障场景运行验证。

## 需同时处理的表单语义问题

1. **权限确认文案错误。** [conversation-policy.ts:178](../../../src/client/conversation-policy.ts#L178) 将所有非read-only模式显示为“工作区可写”，而目录实际包含完全权限等选项。预览必须使用当前权限目录的显示名，不改变真实提交值。
2. **前后端约束不一致。** [UI字符上限:165](../../../src/client/conversation-policy.ts#L165) 为40,000，[服务端:95](../../../src/policy/validation.ts#L95) 为32,000。默认permission与执行sandbox分别在两个tab修改，服务端又[要求已知沙箱模式一致:98](../../../src/policy/validation.ts#L98)。表单需基于统一约束派生有效状态，避免用户保存时才被拒绝。
3. **所有者未就绪被显示成零值。** [conversation-panel.ts:53](../../../src/client/conversation-panel.ts#L53) 将尚无目录快照视为0个，并允许打开空编辑器及提交。读取中/失败应与真正空列表区分，禁止用未就绪草稿覆盖名单。该失效分支为静态发现，本轮未注入网络故障验证。
4. **保存中行为不统一。** 全局配置有fieldset disabled，策略表单大部分字段则仍可编辑。需要统一忙态，明确保存的草稿版本及失败后的保留行为。
5. **自制tabs缺少原生键盘契约。** 一级和二级tabs需使用公共SegmentedTabs或补齐方向键、roving tabindex、tabpanel关联，不能只有role与选中颜色。

## 建议实施边界

第一批将10处选择框、工作区显示名和弹层键盘规则一起收敛，并修权限确认文案。复用现有原生Menu模式，不引入新的UI框架、不改宿主。

第二批统一账号/绑定/策略的普通字段、按钮、开关、tabs和确认弹窗，移除重复材质CSS，保留QQ专属布局与信息。

第三批合并同一操作的表单实现，补齐加载、busy、未知值、冲突及前后端约束一致性。保留所有现有入口、服务端action、策略版本与投递语义。

样式修改的验收应覆盖明暗主题、窄容器、长名称、禁用/过期选项、Menu在Modal/抽屉中的裁切、Escape/Tab/方向键和中文输入法组合状态。表单语义修复需单独做行为回归，旧测试通过不替代此次验证。

## 证据边界

在3192实际打开并检查了工作区弹窗、原生工作区树、QQ概览、角色/工具/成员/模型上下文子页及账号模型菜单。工作区弹窗显示default-workspace，原生树显示默认工作区，已独立复核。当前工具目录下“工具与资源”实际渲染44个select；账号模型菜单为原生Menu，页面无select。

审查期间未修改任何字段或点击保存。扫码、手填、更换凭据、解绑、网络失败及发送确认的状态以源码审查为准，未为视觉检查逐一触发。


