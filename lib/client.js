window.__ModuleLoader__.load({
	id: "@tencent-connect/dsh-qqbot",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region src/client/host.ts
		/** layout 读取出口：仅限 ctx.inject(['layout'], cb) 子 fiber 内调用。 */
		function hostLayout(ctx) {
			return ctx.layout;
		}
		/**
		* 席位注册的防御包装：旧宿主上席位名未知时注册抛错，仅损失该席位。
		*/
		function trySeat(register) {
			try {
				return register();
			} catch {
				return;
			}
		}
		function chain() {
			const disposers = [];
			let done = false;
			return {
				add(dispose) {
					if (dispose !== void 0) disposers.push(dispose);
				},
				run() {
					if (done) return;
					done = true;
					for (const dispose of disposers.reverse()) dispose();
				}
			};
		}
		//#endregion
		//#region src/client/styles.ts
		/**
		* 插件全部注入样式的唯一出口 —— 单一 imqb- 根命名空间 + 单一引用计数策略。
		*
		* 子命名空间按视图域划分（避免类名冲突，如 bind 的 .imqb-form 与配置表单
		* 的 .imqb-cfg-form 样式语义不同）：
		* - imqb-       绑定面板与页面容器
		* - imqb-cfg-   设置表单
		* - imqb-pair-  配对码面板
		* - imqb-cmd-   斜杠命令清单（设置表单的后代类）
		*
		* 安装策略统一为引用计数 <style> 节点：多个展示位共享同一节点，最后一个
		* 使用者移除；installBindPanelStyles 供 apply() 在面板外（插件详情按钮）
		* 渲染前安装。交互态（hover/active/focus）无法用 inline style 表达，统一
		* 收敛到类；颜色取 DSW 主题变量（--dsw-alias-*），缺省值兜底。
		*/
		/** 安装（或复用）一个引用计数的 <style> 节点；Node 测试环境为 no-op。 */
		function installStyles(id, css) {
			if (typeof document === "undefined") return () => void 0;
			const existing = document.getElementById(id);
			const style = existing ?? document.createElement("style");
			if (existing === null) {
				style.id = id;
				style.textContent = css;
				document.head.appendChild(style);
			}
			style.dataset.users = String(Number(style.dataset.users ?? 0) + 1);
			return () => {
				const remaining = Number(style.dataset.users ?? 1) - 1;
				if (remaining <= 0) style.remove();
				else style.dataset.users = String(remaining);
			};
		}
		const BIND_PANEL_CSS = `
.imqb-panel {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 24px 16px; text-align: center; font-size: 13px;
  color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family);
}
.imqb-title { margin: 0; font-size: 16px; font-weight: 600; }
.imqb-hint { margin: 0; color: var(--dsw-alias-label-secondary); line-height: 1.6; }
.imqb-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.imqb-link { font-size: 12px; color: var(--dsw-alias-label-secondary); text-decoration: underline; text-underline-offset: 3px; }
.imqb-link:hover { text-decoration: underline; }
.imqb-icon { font-size: 32px; line-height: 1; }
.imqb-qr { box-sizing: content-box; border-radius: var(--dsw-radius-md); padding: 8px; max-width: calc(100% - 16px); height: auto; }
.imqb-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
/* 主面板页面容器（layout.selectPanel 目标）：滚动 + 留白 */
.imqb-pluginPage {
  height: 100%; min-height: 0; overflow: auto; box-sizing: border-box;
  padding: 24px clamp(16px, 4vw, 48px) 32px;
  color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family);
}
.imqb-pluginPageContent { max-width: 680px; margin: 0 auto; }
.imqb-pageTitle { margin: 0 0 12px; font-size: 20px; line-height: 1.5; font-weight: 600; }
.imqb-pageDescription { margin: 0 0 16px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.imqb-form { display: flex; flex-direction: column; gap: 12px; width: min(320px, 100%); box-sizing: border-box; }
.imqb-credentialsModal { width: min(440px, 100%); max-height: 100%; overflow-y: auto; }
.imqb-form--credentials { width: 100%; gap: 16px; }
.imqb-form--credentials .imqb-field { gap: 6px; line-height: 1.5; }
.imqb-form--credentials .imqb-field > span { box-sizing: border-box; }
.imqb-field { display: flex; flex-direction: column; gap: 5px; text-align: left; font-size: 13px; }
.imqb-error { margin: 0; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; color: var(--dsw-alias-state-error-primary); }
/* 紧凑状态视图（已绑定 / 过渡态）：设置行风格，无居中大卡留白 */
.imqb-status { display: flex; flex-direction: column; text-align: left; font-size: 13px; color: var(--dsw-alias-label-primary); }
.imqb-status-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
.imqb-status-icon { font-size: 24px; line-height: 1; flex: none; }
.imqb-qqicon {
  flex: none; display: block; border-radius: 8px; /* 透明底，QQ 蓝徽标在明暗主题下均清晰 */
}
.imqb-status-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.imqb-status-title { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.5; }
.imqb-status-sub { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
.imqb-status-actions { display: flex; align-items: center; gap: 8px; padding: 4px 0 12px; }
.imqb-account {
  display: flex; align-items: center; flex-wrap: wrap; column-gap: 24px;
  border-bottom: .5px solid var(--dsw-alias-border-l2); padding-bottom: 12px;
}
.imqb-account > .imqb-status-row { flex: 1 1 240px; min-width: 0; }
.imqb-account > .imqb-status-actions { padding: 12px 0; flex-wrap: wrap; }
/* 扫码成功后的连接过渡：二维码模糊变暗 + 覆盖层 */
.imqb-scanned { position: relative; display: inline-block; }
.imqb-scanned-qr {
  display: block; border-radius: var(--dsw-radius-md); padding: 8px;
  filter: blur(6px) saturate(0.6); opacity: 0.55;
}
.imqb-scanned-veil {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px; text-align: center;
}
.imqb-scanned-title { margin: 0; font-size: 15px; font-weight: 600; }
.imqb-scanned-sub { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.6; }
.imqb-danger { color: var(--dsw-alias-state-error-primary); }
.imqb-field > span { width: 100%; }
.imqb-cards { display: flex; flex-direction: column; gap: 20px; }
.imqb-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); padding: 4px 16px 16px; background: var(--dsw-alias-bg-layer-1); }
.imqb-cardTitle { margin: 14px 0 4px; font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.imqb-cardHint { margin: 0 0 8px; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); }
`;
		const CONFIG_PANEL_CSS = `
.imqb-cfg-form { display: flex; flex-direction: column; width: 100%; min-width: 0; color: var(--dsw-alias-label-primary); }
.imqb-cfg-fields { border: 0; padding: 0; margin: 0; min-width: 0; }
.imqb-cfg-group-title {
  padding: 14px 0 2px; font-size: 12px; font-weight: 600; line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.imqb-cfg-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.imqb-cfg-field + .imqb-cfg-field { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.imqb-cfg-head { display: flex; align-items: center; gap: 8px; min-height: 28px; }
.imqb-cfg-label {
  flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.imqb-cfg-help { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.imqb-cfg-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.imqb-cfg-textarea { box-sizing: border-box; width: 100%; min-height: 68px; padding: 8px 12px; resize: vertical; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3); font: inherit; color: var(--dsw-alias-label-primary); line-height: 1.5; }
.imqb-cfg-textarea:focus-visible { outline: 2px solid var(--dsw-alias-label-secondary); outline-offset: 2px; }
/* Preserve the QQ settings draft and readback feedback in the sticky footer. */
.imqb-cfg-footer {
  position: sticky; bottom: 0; z-index: 1; display: flex; align-items: center;
  flex-wrap: wrap; gap: 8px; margin-top: 16px; padding: 12px 0;
  border-top: 0.5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1);
}
.imqb-cfg-footer-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.imqb-cfg-feedback { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
.imqb-cfg-feedback p { flex: 1; min-width: 0; }
.imqb-cfg-form .imqb-cmd-inline { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.imqb-cfg-form .imqb-cmd-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.imqb-cfg-form .imqb-cmd-error { color: var(--dsw-alias-state-error-primary); }
.imqb-cfg-form .imqb-cmd-cmdList { margin: 12px 0; }
.imqb-cfg-form .imqb-cmd-cmdContent { padding: 4px 0 4px 22px; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.imqb-cfg-form .imqb-cmd-cmdGroup + .imqb-cmd-cmdGroup { margin-top: 16px; }
.imqb-cfg-form .imqb-cmd-cmdGroup > strong { font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.imqb-cfg-form .imqb-cmd-cmdRow { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; margin-top: 8px; overflow-wrap: anywhere; }
.imqb-cfg-form .imqb-cmd-cmdRow code { padding: 1px 6px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-size: 12px; }
.imqb-cfg-details { margin-top: 12px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.imqb-cfg-summary { padding: 16px 0; font-size: 13px; font-weight: 500; cursor: pointer; }
.imqb-cfg-summary::marker { color: var(--dsw-alias-label-tertiary); }
.imqb-cfg-summary:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color); outline-offset: 2px; border-radius: var(--dsw-radius-sm); }
.imqb-cfg-directory-feedback { display: flex; align-items: flex-start; gap: 8px; }
.imqb-cfg-directory-feedback p { flex: 1; min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 480px) {
  .imqb-cfg-head:has([role=tablist]) { align-items: stretch; flex-direction: column; }
  .imqb-cfg-selector-head { align-items: stretch; flex-direction: column; }
  .imqb-cfg-note { flex-basis: 100%; }
}
.imqb-cfg-note { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.imqb-cfg-note--error { color: var(--dsw-alias-state-error-primary); }
.imqb-cfg-note--ok { color: var(--dsw-alias-label-secondary); }
/* cwd 只读行 */
.imqb-cfg-readonly { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--dsw-alias-label-secondary); word-break: break-all; margin: 0; }
`;
		const PAIRING_CSS = `
.imqb-pair { min-width: 0; container-type: inline-size; display: grid; gap: 10px; margin: 4px 0 16px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); color: var(--dsw-alias-label-primary); }
.imqb-pairHeader, .imqb-pairToolbar, .imqb-pairMemberActions, .imqb-pairMemberEdit { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.imqb-pairHeader { gap: 12px; }
.imqb-pairTitle { display: flex; align-items: baseline; gap: 6px; min-width: 0; font-size: 13px; }
.imqb-pairCount, .imqb-pairHint, .imqb-pairMemberMeta { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.imqb-pairToolbar { margin-left: auto; }
.imqb-pairHint { margin: 0; overflow-wrap: anywhere; }
.imqb-pairHint[role="status"] { white-space: pre-line; }
.imqb-pairError { margin: 0; color: var(--dsw-alias-state-error-primary); }
.imqb-pairMembers { list-style: none; padding: 0; margin: 0; }
.imqb-pairMember { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 12px 0 2px; border-top: 1px solid var(--dsw-alias-border-l2); }
.imqb-pairMember + .imqb-pairMember { margin-top: 10px; }
.imqb-pairMemberMain { min-width: 0; display: grid; gap: 4px; }
.imqb-pairMemberName { font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }
.imqb-pairIdentity { display: flex; align-items: center; gap: 6px; min-width: 0; }
.imqb-pairMemberOpenId { min-width: 0; font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; user-select: text; }
.imqb-pairCopy { flex: none; }
.imqb-pairMemberEdit { justify-content: flex-end; max-width: 280px; }
.imqb-pairMemberEdit > :first-child { flex: 1 1 120px; min-width: 0; }
.imqb-pairDialog { display: grid; gap: 12px; color: var(--dsw-alias-label-primary); }
.imqb-pairSectionTitle { margin: 0; font-size: 13px; font-weight: 600; }
.imqb-pairSteps { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.8; color: var(--dsw-alias-label-secondary); }
.imqb-pairExample { margin: 0; padding: 8px 10px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); white-space: pre-wrap; font-size: 12px; }
.imqb-pairTextarea { box-sizing: border-box; width: 100%; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3); font: inherit; color: var(--dsw-alias-label-primary); line-height: 1.5; resize: vertical; }
.imqb-pairTextarea:focus-visible { outline: 2px solid var(--dsw-focus-ring-color); outline-offset: 2px; }
.imqb-pairModal { width: min(560px, calc(100vw - 32px)); max-height: 100%; overflow: auto; }
.imqb-pairManual { display: grid; gap: 10px; padding: 8px 0; }
.imqb-pairResults { display: grid; gap: 10px; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l2); }
.imqb-pairResultList { list-style: none; margin: 0; padding: 0; max-height: 240px; overflow-y: auto; }
.imqb-pairResult { display: grid; gap: 4px; padding: 10px 0; }
.imqb-pairResult + .imqb-pairResult { border-top: 1px solid var(--dsw-alias-border-l2); }
.imqb-pairResultTitle, .imqb-pairFooter { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.imqb-pairResultState { display: inline-flex; flex: none; align-items: center; gap: 4px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.imqb-pairFooter { flex-wrap: wrap; }
.imqb-pairCodeCard { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 12px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); }
.imqb-pairCodeMain, .imqb-pairCodeActions { display: flex; align-items: center; gap: 8px; }
.imqb-pairCodeValue { font-size: 24px; letter-spacing: 4px; font-weight: 600; }
.imqb-pairCodeMeta { font-size: 12px; color: var(--dsw-alias-label-secondary); }
@container (max-width: 480px) {
  .imqb-pairHeader { flex-direction: column; align-items: stretch; gap: 8px; }
  .imqb-pairToolbar { margin-left: 0; }
  .imqb-pairMember { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .imqb-pairMemberActions, .imqb-pairMemberEdit { justify-content: flex-end; margin-left: auto; }
}
`;
		/**
		* 面板样式全局安装（apply 时调用一次）：插件详情按钮等面板外渲染的元素
		* 也需要可见；引用计数，插件卸载时随 effect 清理。
		*/
		function installBindPanelStyles() {
			return installStyles("im-qqbot-bind-panel-styles", BIND_PANEL_CSS);
		}
		function useBindPanelStyles() {
			(0, react.useEffect)(() => installBindPanelStyles(), []);
		}
		function useConfigPanelStyles() {
			(0, react.useEffect)(() => installStyles("im-qqbot-config-panel-styles", CONFIG_PANEL_CSS), []);
		}
		function usePairingStyles() {
			(0, react.useEffect)(() => installStyles("im-qqbot-pairing-styles", PAIRING_CSS), []);
		}
		//#endregion
		//#region src/shared/rpc-protocol.ts
		/**
		* 端内 RPC 协议 —— 宿主 Connection 通道上的共享契约。
		*
		* 浏览器可写面不再注册裸 webServer 路由，而是挂宿主 `/api` 共享通道
		* （ctx.connection.fetch）：来源围栏（Host/Origin trust）与浏览器认证由
		* 宿主在 handler 之前施加，插件只做授权后的业务校验。
		*
		* 通道模型：一个端点 = 一条 connection fetch 路由（POST + 信封协议），
		* 端点内以 method 字段分发。本模块必须保持纯常量（零 node 依赖）：
		* 客户端 bundle 会内联。
		*/
		/** 共享 Fetch 通道（宿主 connection 固定值） */
		const RPC_CHANNEL = "/api";
		/** 绑定/配置端点（fetch 路由 path = `/api/dsh-qqbot/bind`） */
		const BIND_RPC_ENDPOINT = "dsh-qqbot/bind";
		/** 命令清单与配对端点（fetch 路由 path = `/api/dsh-qqbot/account`） */
		const ACCOUNT_RPC_ENDPOINT = "dsh-qqbot/account";
		/** 绑定端点的方法名 */
		const BIND_METHODS = {
			state: "bind.state",
			refresh: "bind.refresh",
			manual: "bind.manual",
			unbind: "bind.unbind",
			configGet: "config.get",
			configSet: "config.set"
		};
		/** 账号端点的方法名 */
		const ACCOUNT_METHODS = {
			commands: "commands.list",
			pairStatus: "pair.status",
			pairIssue: "pair.issue",
			pairEnd: "pair.end",
			pairManual: "pair.manual",
			pairRename: "pair.rename",
			pairRevoke: "pair.revoke"
		};
		/** 错误码（客户端按 code 区分冲突/重载/传输失败等语义） */
		const RPC_ERROR_CODES = {
			/** 配置保存与他人写入冲突（旧 HTTP 409） */
			configConflict: "config/conflict",
			/** 配置草稿所属账号已变化，禁止跨账号写入。 */
			accountChanged: "config/account-changed",
			/** 插件正在重载，动作未生效（旧 HTTP 503） */
			pluginReloading: "plugin/reloading",
			/** 传输层 404：端点未注册（插件未启用/已卸载） */
			routeMissing: "transport/404",
			/** 未知方法名（客户端 bug，非用户可见状态） */
			unknownMethod: "qqbot/unknown-method"
		};
		//#endregion
		//#region src/client/rpc.ts
		/**
		* 客户端 RPC 层 —— 经宿主浏览器 Connection 服务调用插件端点。
		*
		* 所有端内数据/动作走宿主 `/api` 共享通道（来源围栏与认证由宿主施加，
		* Desktop 下由壳的 IPC 桥透明转发）：connection.rpc.call 组装
		* client-request 信封 POST 到 `/api/<endpoint>`，本模块负责结果解包、
		* 错误归类（RpcError.code）与传输 404 的 gone 语义（插件未启用）。
		* 超时/取消语义沿用旧 fetchJson：默认 10s，调用方 signal 传播。
		*/
		/** RPC 调用错误：code 区分语义（冲突/重载/传输失败），gone 表示端点未注册 */
		var RpcError = class extends Error {
			code;
			gone;
			constructor(code, message, gone = false) {
				super(message);
				this.code = code;
				this.gone = gone;
			}
		};
		let connection;
		/** apply 时注入宿主连接服务（HMR 重载会以新 handle 重设） */
		function setClientConnection(handle) {
			connection = handle;
		}
		/**
		* 调用一个插件 RPC 方法。
		*
		* @param endpoint - 端点 id（shared/rpc-protocol.ts）
		* @param method - 方法名
		* @param payload - 调用参数
		* @param timeoutMs - 超时（默认 10s）
		* @param signal - 调用方取消信号
		* @throws RpcError code = 结果错误码 / 'transport/404'（端点未注册，gone）/
		*         'transport/timeout' / 'transport/network' / 'client/no-connection'
		*/
		async function rpcCall(endpoint, method, payload = {}, timeoutMs = 1e4, signal) {
			const client = connection;
			if (client === void 0) throw new RpcError("client/no-connection", "宿主连接服务不可用，请刷新页面。");
			const controller = new AbortController();
			let timedOut = false;
			const onCancel = () => {
				controller.abort(signal?.reason);
			};
			if (signal?.aborted) onCancel();
			else signal?.addEventListener("abort", onCancel, { once: true });
			const timer = setTimeout(() => {
				if (controller.signal.aborted) return;
				timedOut = true;
				controller.abort();
			}, timeoutMs);
			try {
				if (controller.signal.aborted) throw new DOMException("请求已取消", "AbortError");
				const result = await client.rpc.call(RPC_CHANNEL, endpoint, {
					method,
					payload
				}, controller.signal);
				if (!result.ok) throw new RpcError(result.error?.code ?? "qqbot/internal", result.error?.message ?? "请求失败");
				return result.value;
			} catch (cause) {
				if (cause instanceof RpcError) throw cause;
				if (controller.signal.aborted) {
					if (timedOut) throw new RpcError("transport/timeout", "请求超时，请重试");
					throw new DOMException("请求已取消", "AbortError");
				}
				const message = cause instanceof Error ? cause.message : String(cause);
				if (message.includes("HTTP 404")) throw new RpcError(RPC_ERROR_CODES.routeMissing, "插件未启用或当前版本不支持端内配置", true);
				throw new RpcError("transport/network", message || "网络不可用");
			} finally {
				clearTimeout(timer);
				signal?.removeEventListener("abort", onCancel);
			}
		}
		//#endregion
		//#region src/client/store.ts
		/**
		* 绑定状态存储 —— 全插件唯一的绑定轮询器（引用计数）。
		*
		* 旧行为：useBindState 以 hook 形态被复制到每个展示位（设置栏目 / 主面板 /
		* 侧栏），最坏同时跑 2-3 份轮询器，且 HMR 窗口期各表面相位可能互相矛盾。
		* 现在：轮询器是模块级单例，首个订阅者启动、最后一个退订停止并清空缓存；
		* 全部表面经同一快照渲染，重挂载从加载态重新读取，不复用旧账号或二维码。
		*
		* 状态机语义自 useBindState 原样平移（404 双语义 / sawRoute / recheck
		* 快速收敛窗口 / 相位节拍），修改须对照 store.test.ts 的行为锚点。
		* 本模块不依赖 react：组件经 useSyncExternalStore 订阅（见 bind-page.ts）。
		*/
		/** 活跃轮询间隔（毫秒） / 失败退避 / saving 快轮询 / bound 稳定态降频 */
		const ACTIVE_POLL_MS = 2e3;
		const RETRY_POLL_MS = 3e3;
		const SAVING_POLL_MS = 500;
		const BOUND_POLL_MS = 3e4;
		/** recheck 后的快速收敛窗口：解绑等动作改变的是服务端状态（经 HMR
		* 异步生效），窗口期内强制快轮询直到相位真正变化 */
		const URGENT_WINDOW_MS = 15e3;
		const listeners = /* @__PURE__ */ new Set();
		let snapshot = {
			state: null,
			gone: false,
			error: null
		};
		let running = false;
		let restartAfterFlight = false;
		let sawRoute = false;
		let urgentUntil = 0;
		let generation = 0;
		let timer;
		/** 在途请求的取消器：最后退订 / recheck 废弃请求时 abort，请求落地后清空 */
		let controller;
		/** 语义相等（wire 各相位字段少，直接逐字段；相等时保留旧引用以稳定快照） */
		function sameWire(a, b) {
			if (a === b) return true;
			if (a === null || b === null) return false;
			if (a.phase !== b.phase) return false;
			switch (a.phase) {
				case "waiting": {
					const other = b;
					return a.url === other.url && a.qrSvg === other.qrSvg && a.issuedAt === other.issuedAt;
				}
				case "failed": {
					const other = b;
					return a.reason === other.reason;
				}
				case "bound": {
					const other = b;
					return a.appId === other.appId;
				}
				default: return true;
			}
		}
		function publish(next, gone, error) {
			const state = sameWire(snapshot.state, next) ? snapshot.state : next;
			if (state === snapshot.state && gone === snapshot.gone && error === snapshot.error) return;
			snapshot = {
				state,
				gone,
				error
			};
			for (const listener of listeners) listener();
		}
		function intervalFor(phase) {
			const base = phase === "saving" ? SAVING_POLL_MS : phase === "bound" ? BOUND_POLL_MS : ACTIVE_POLL_MS;
			return Date.now() < urgentUntil ? Math.min(base, ACTIVE_POLL_MS) : base;
		}
		function schedule(ms) {
			if (timer !== void 0) clearTimeout(timer);
			timer = setTimeout(() => {
				tick();
			}, ms);
		}
		function pageVisible() {
			return typeof document === "undefined" || !document.hidden;
		}
		async function tick() {
			if (running || listeners.size === 0) return;
			running = true;
			const myGeneration = generation;
			const alive = () => myGeneration === generation && listeners.size > 0;
			try {
				if (!pageVisible()) {
					schedule(Math.max(intervalFor(snapshot.state?.phase), ACTIVE_POLL_MS));
					return;
				}
				const request = new AbortController();
				controller = request;
				const body = await rpcCall(BIND_RPC_ENDPOINT, BIND_METHODS.state, {}, 1e4, request.signal);
				if (!alive()) return;
				sawRoute = true;
				publish(body, false, null);
				schedule(intervalFor(body.phase));
				return;
			} catch (cause) {
				if (alive()) {
					const message = cause instanceof Error ? cause.message : "无法获取绑定状态";
					const routeMissing = cause instanceof RpcError && cause.gone;
					publish(snapshot.state, snapshot.gone || !sawRoute && routeMissing, message);
				}
			} finally {
				controller = void 0;
				running = false;
				if (restartAfterFlight && listeners.size > 0) {
					restartAfterFlight = false;
					tick();
					return;
				}
			}
			if (alive()) schedule(RETRY_POLL_MS);
		}
		function startPoller() {
			sawRoute = false;
			urgentUntil = 0;
			restartAfterFlight = false;
			if (running) {
				restartAfterFlight = true;
				return;
			}
			tick();
		}
		function stopPoller() {
			generation += 1;
			if (timer !== void 0) {
				clearTimeout(timer);
				timer = void 0;
			}
			controller?.abort();
			restartAfterFlight = false;
			sawRoute = false;
			urgentUntil = 0;
			publish(null, false, null);
		}
		/** 订阅绑定状态：首个订阅启动轮询器，最后一个退订停止。 */
		function subscribeBindStore(listener) {
			listeners.add(listener);
			if (listeners.size === 1) startPoller();
			return () => {
				listeners.delete(listener);
				if (listeners.size === 0) stopPoller();
			};
		}
		/** 当前快照（引用稳定，直到下一次 publish）。 */
		function getBindSnapshot() {
			return snapshot;
		}
		/**
		* 立即重置轮询节拍：废弃当前计时器，在飞请求作废，进入快速收敛窗口。
		* 解绑/保存凭据等动作后调用，让新相位尽快可见（bound 30s 降频下尤其关键）。
		*/
		function recheckBindState() {
			if (listeners.size === 0) return;
			generation += 1;
			urgentUntil = Date.now() + URGENT_WINDOW_MS;
			publish(snapshot.state, false, null);
			if (running) {
				controller?.abort();
				restartAfterFlight = true;
				return;
			}
			if (timer !== void 0) {
				clearTimeout(timer);
				timer = void 0;
			}
			tick();
		}
		//#endregion
		//#region src/client/bind-page.ts
		/**
		* 端内绑定面板 — 扫码 / 手动填写 / 已绑定编辑
		*
		* 宿主插件注册 /qqbot/im-qqbot/bind 路由（待绑定与已绑定 fiber 均常驻）：
		* - 未绑定：waiting（二维码）/ starting / saving / failed 相位 + manual 提交
		* - 已绑定：bound 相位（回显脱敏 appId，secret 不回传）+ manual 更换 + 解绑
		* 扫码成功或手动保存均写入 profile patch 并经 HMR 重载生效。
		*
		* 状态来自共享 store（store.ts，全插件单一轮询器）；样式为引用计数注入的
		* imqb-* 类（styles.ts）。同一组件复用于全部展示位（侧栏绑定页 / 设置页 /
		* 主面板）。运行时仅依赖 react（dsh 客户端平台种子表提供）；宿主通信走
		* 同源 fetch，Desktop 下由壳的 IPC 桥自动附加 Host 认证转发。
		*/
		/**
		* 绑定状态订阅：全部展示位共享 store 的单一轮询器（引用计数，首个订阅
		* 启动、最后一个退订停止）。404 双语义 / recheck 快速收敛窗口等行为契约
		* 见 store.ts 与 store.test.ts。
		*/
		function useBindState() {
			return (0, react.useSyncExternalStore)(subscribeBindStore, getBindSnapshot);
		}
		/** 手动提交凭据（填写 / 更换共用） */
		async function submitManualCredentials(appId, appSecret) {
			try {
				const body = await rpcCall(BIND_RPC_ENDPOINT, BIND_METHODS.manual, {
					appId,
					appSecret
				});
				return body.ok ? {
					ok: true,
					message: body.message
				} : {
					ok: false,
					error: body.error ?? "保存失败，请重试"
				};
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : String(err)
				};
			}
		}
		/**
		* 手动凭据表单（填写 / 更换共用）。
		*
		* appSecret 永不回显（占位符提示），提交成功后展示保存结果；
		* 宿主写入 profile patch 并经 HMR 重载，状态轮询随后收敛为 bound。
		*/
		function ManualForm({ initialAppId, recheck, onCancel }) {
			const formId = (0, react.useId)();
			const [appId, setAppId] = (0, react.useState)(initialAppId ?? "");
			const [appSecret, setAppSecret] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [result, setResult] = (0, react.useState)(null);
			const submit = (0, react.useCallback)((event) => {
				event.preventDefault();
				if (busy) return;
				const trimmedId = appId.trim();
				const trimmedSecret = appSecret.trim();
				if (trimmedId.length === 0 || trimmedSecret.length === 0) {
					setResult({
						ok: false,
						error: "请填写 AppID 和 AppSecret。"
					});
					return;
				}
				setBusy(true);
				setResult(null);
				submitManualCredentials(trimmedId, trimmedSecret).then((outcome) => {
					setResult(outcome);
					if (outcome.ok) {
						setAppSecret("");
						recheck();
					}
					setBusy(false);
				});
			}, [
				appId,
				appSecret,
				busy,
				recheck
			]);
			const saveButton = (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				key: "save",
				variant: "primary",
				size: "sm",
				type: "submit",
				form: formId,
				disabled: busy || !appId.trim() || !appSecret.trim()
			}, busy ? "正在保存…" : onCancel ? "保存凭据" : "保存");
			const content = result !== null && result.ok ? (0, react.createElement)("div", {
				className: "imqb-status",
				role: "status"
			}, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-icon" }, "✅"), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, result.message ?? "凭据已保存"), (0, react.createElement)("p", { className: "imqb-status-sub" }, "插件将自动重载，连接结果可在左侧 QQ 导航底部查看")), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				variant: "ghost",
				size: "sm",
				onClick: recheck
			}, "刷新状态"))) : (0, react.createElement)("form", {
				id: formId,
				className: `imqb-form${onCancel ? " imqb-form--credentials" : ""}`,
				onSubmit: submit,
				"aria-busy": busy
			}, (0, react.createElement)("label", { className: "imqb-field" }, "AppID", (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				value: appId,
				placeholder: "QQ 机器人 AppID",
				disabled: busy,
				onChange: (event) => {
					setAppId(event.currentTarget.value);
				},
				autoComplete: "off",
				spellCheck: false,
				required: true
			})), (0, react.createElement)("label", { className: "imqb-field" }, "AppSecret", (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				type: "password",
				value: appSecret,
				disabled: busy,
				placeholder: initialAppId === void 0 ? "QQ 机器人 AppSecret" : "输入新的 AppSecret",
				onChange: (event) => {
					setAppSecret(event.currentTarget.value);
				},
				autoComplete: "new-password",
				required: true,
				...onCancel ? { "data-modal-autofocus": true } : {}
			})), result !== null && !result.ok ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, result.error) : null, onCancel ? null : saveButton);
			if (!onCancel) return content;
			return (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				title: "更换凭据",
				closeLabel: "关闭更换凭据",
				className: "imqb-credentialsModal",
				description: "填写 QQ 机器人凭据，保存后将重新连接。已有 AppSecret 不会回显。",
				onClose: () => {
					if (!busy) onCancel();
				},
				children: content,
				footer: result?.ok ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					type: "button",
					variant: "primary",
					size: "sm",
					onClick: onCancel
				}, "完成") : [(0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					key: "cancel",
					type: "button",
					variant: "outline",
					size: "sm",
					disabled: busy,
					onClick: onCancel
				}, "取消"), saveButton]
			});
		}
		/** QQ 机器人 logo 路径（assets/icons/qqbot_logo.svg，内嵌以保持 bundle 自包含） */
		const QQ_BOT_LOGO_PATH = "M19.3862 15.5001C19.3861 11.4203 16.0789 8.11296 11.999 8.11292C7.91915 8.11292 4.61203 11.4203 4.61182 15.5001V17.0001C4.61182 18.5949 5.90429 19.8873 7.49902 19.8873H16.499C18.0937 19.8873 19.3862 18.5949 19.3862 17.0001V15.5001ZM10.6118 14.0001C10.6118 14.6145 10.1129 15.1134 9.49853 15.1134C8.8843 15.1132 8.38672 14.6144 8.38672 14.0001V12.0006C8.38672 11.3863 8.8843 10.8875 9.49853 10.8873C10.1129 10.8873 10.6118 11.3862 10.6118 12.0006V14.0001ZM15.6113 14.0001C15.6113 14.6143 15.1136 15.1131 14.4995 15.1134C13.8851 15.1134 13.3862 14.6145 13.3862 14.0001V12.0006C13.3862 11.3862 13.8851 10.8873 14.4995 10.8873C15.1136 10.8876 15.6113 11.3864 15.6113 12.0006V14.0001ZM14.2607 3.04895C14.2607 3.89351 13.7957 4.62474 13.1108 5.0133V5.95374C17.8958 6.50514 21.6112 10.5676 21.6113 15.5001V17.0001C21.6113 19.8237 19.3225 22.1124 16.499 22.1124H7.49902C4.67546 22.1124 2.38672 19.8237 2.38672 17.0001V15.5001C2.38691 10.568 6.10139 6.50571 10.8857 5.95374V5.01185C10.2017 4.62305 9.73583 3.89286 9.73583 3.04895C9.73609 1.79961 10.7496 0.787231 11.999 0.787231C13.2484 0.787297 14.2605 1.79966 14.2607 3.04895Z";
		/** QQ 机器人图标（logo 矢量渲染，透明底，随 size 缩放） */
		function QqBotIcon({ size = 28 }) {
			return (0, react.createElement)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": true,
				className: "imqb-qqicon"
			}, (0, react.createElement)("path", {
				d: QQ_BOT_LOGO_PATH,
				fill: "currentColor"
			}));
		}
		/** 已绑定视图：回显 appId + 更换凭据 / 解绑入口 */
		function BoundView({ appId, recheck }) {
			const [editing, setEditing] = (0, react.useState)(false);
			const [confirmUnbind, setConfirmUnbind] = (0, react.useState)(false);
			const [unbindResult, setUnbindResult] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const unbind = (0, react.useCallback)(() => {
				if (busy) return;
				setConfirmUnbind(false);
				setBusy(true);
				setUnbindResult(null);
				rpcCall(BIND_RPC_ENDPOINT, BIND_METHODS.unbind).then((body) => {
					if (body.ok === true) {
						setUnbindResult({
							ok: true,
							message: body.message ?? "已解绑，插件将重载并重新进入绑定流程"
						});
						recheck();
						return;
					}
					setUnbindResult({
						ok: false,
						message: body.error ?? "解绑失败，请重试"
					});
				}).catch((err) => {
					setUnbindResult({
						ok: false,
						message: err instanceof Error ? err.message : String(err)
					});
				}).finally(() => {
					setBusy(false);
				});
			}, [recheck, busy]);
			if (unbindResult?.ok === true) return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-icon" }, "👋"), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, unbindResult.message)), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				variant: "ghost",
				size: "sm",
				onClick: recheck
			}, "刷新状态")));
			return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-account" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)(QqBotIcon, { size: 28 }), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, "凭据已保存"), (0, react.createElement)("p", { className: "imqb-status-sub imqb-mono" }, `AppID ${appId}`))), (0, react.createElement)("div", { className: "imqb-status-actions" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				variant: "outline",
				size: "sm",
				disabled: busy,
				onClick: () => {
					setEditing(true);
				}
			}, "更换凭据"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				variant: "outline",
				size: "sm",
				className: "imqb-danger",
				disabled: busy,
				onClick: () => setConfirmUnbind(true)
			}, busy ? "正在解绑…" : "解绑"))), unbindResult !== null && !unbindResult.ok ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, unbindResult.message) : null, editing ? (0, react.createElement)(ManualForm, {
				initialAppId: appId,
				recheck,
				onCancel: () => setEditing(false)
			}) : null, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: confirmUnbind,
				onClose: () => setConfirmUnbind(false),
				title: "解绑 QQ 机器人",
				closeLabel: "关闭",
				description: "清除本机保存的 QQ 凭据并重载连接，随后进入扫码绑定。会话历史保留；此操作不会移出 QQ 群或删除平台侧关系。",
				footer: (0, react.createElement)("div", { className: "imqb-row" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					onClick: () => setConfirmUnbind(false)
				}, "取消"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					size: "sm",
					disabled: busy,
					onClick: unbind
				}, "确认解绑"))
			}));
		}
		/** 未绑定视图：扫码 / 手动填写切换 */
		function UnboundView({ state, recheck }) {
			const [mode, setMode] = (0, react.useState)("qr");
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const refresh = (0, react.useCallback)(() => {
				if (busy) return;
				setBusy(true);
				setError(null);
				rpcCall(BIND_RPC_ENDPOINT, BIND_METHODS.refresh).then(() => {
					recheck();
				}).catch((cause) => {
					setError(cause instanceof Error ? cause.message : "刷新失败，请重试");
				}).finally(() => {
					setBusy(false);
				});
			}, [busy, recheck]);
			if (mode === "manual") return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("p", { className: "imqb-title" }, "手动填写凭据"), (0, react.createElement)(ManualForm, { recheck }), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				onClick: () => {
					setMode("qr");
				}
			}, "改用扫码绑定"));
			return (0, react.createElement)("div", { className: "imqb-panel" }, state.qrSvg === void 0 ? null : (0, react.createElement)("img", {
				src: state.qrSvg,
				alt: "QQ 扫码二维码",
				width: 220,
				height: 220,
				className: "imqb-qr"
			}), (0, react.createElement)("p", { className: "imqb-title" }, "扫码绑定 QQ 机器人"), (0, react.createElement)("p", { className: "imqb-hint" }, "使用手机 QQ 扫描二维码完成绑定"), (0, react.createElement)("a", {
				href: state.url,
				target: "_blank",
				rel: "noreferrer noopener",
				className: "imqb-link"
			}, "二维码显示异常？在浏览器中打开"), (0, react.createElement)("div", { className: "imqb-row" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				disabled: busy,
				onClick: refresh
			}, busy ? "正在刷新…" : "刷新二维码"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				onClick: () => {
					setMode("manual");
				}
			}, "手动填写")), error ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, error) : null);
		}
		function FailedView({ reason, recheck }) {
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const retry = () => {
				if (busy) return;
				setBusy(true);
				setError(null);
				rpcCall(BIND_RPC_ENDPOINT, BIND_METHODS.refresh).then(() => {
					recheck();
				}).catch((cause) => {
					setError(cause instanceof Error ? cause.message : "刷新失败，请重试");
				}).finally(() => {
					setBusy(false);
				});
			};
			return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("p", { className: "imqb-title" }, "绑定失败"), (0, react.createElement)("p", { className: "imqb-hint" }, reason), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				variant: "primary",
				size: "sm",
				disabled: busy,
				onClick: retry
			}, busy ? "正在刷新…" : "重新获取二维码"), error ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, error) : null);
		}
		/** 依据宿主相位渲染面板主体（状态来自共享 store，全插件单一轮询器） */
		function BindPanelBody() {
			useBindPanelStyles();
			const { state, gone, error } = useBindState();
			const recheck = recheckBindState;
			const [lastQr, setLastQr] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (state === null) return;
				if (state.phase === "waiting") {
					if (state.qrSvg !== void 0) setLastQr(state.qrSvg);
				} else if (state.phase === "bound") setLastQr(null);
			}, [state]);
			if (gone) return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("div", { className: "imqb-icon" }, "❔"), (0, react.createElement)("p", { className: "imqb-hint" }, "插件未启用，或当前版本不支持端内配置"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				onClick: recheck
			}, "重新读取绑定状态"));
			if (state === null || state.phase === "starting") return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("p", {
				className: error ? "imqb-error" : "imqb-hint",
				role: "status"
			}, error ?? "正在获取绑定状态…"), error ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				onClick: recheck
			}, "重试读取绑定状态") : null);
			if (state.phase === "saving") {
				if (lastQr !== null) return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("div", { className: "imqb-scanned" }, (0, react.createElement)("img", {
					src: lastQr,
					alt: "QQ 扫码二维码",
					width: 220,
					height: 220,
					className: "imqb-scanned-qr"
				}), (0, react.createElement)("div", { className: "imqb-scanned-veil" }, (0, react.createElement)("p", { className: "imqb-scanned-title" }, "✅ 扫码成功"), (0, react.createElement)("p", { className: "imqb-scanned-sub" }, "正在保存凭据…"))));
				return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-icon" }, "🎉"), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, "扫码成功"), (0, react.createElement)("p", { className: "imqb-status-sub" }, "凭据已保存，正在重新加载连接"))));
			}
			if (state.phase === "failed") return (0, react.createElement)(FailedView, {
				reason: state.reason,
				recheck
			});
			if (state.phase === "bound") return (0, react.createElement)(BoundView, {
				key: state.appId,
				appId: state.appId,
				recheck
			});
			return (0, react.createElement)(UnboundView, {
				state,
				recheck
			});
		}
		//#endregion
		//#region src/shared/message-handling-mode.ts
		/**
		* 枚举值单一来源：config schema、服务端 configSet 校验、client 草稿校验
		* 共用这一份，新增取值时三处同步生效。
		*/
		const MESSAGE_HANDLING_MODES = ["queue", "interrupt"];
		//#endregion
		//#region src/client/config-form-state.ts
		const EDITABLE_KEYS = [
			"access",
			"requireMention",
			"streaming",
			"showToolResults",
			"debug",
			"provider",
			"model",
			"preset",
			"groupPrompt",
			"directPrompt",
			"messageHandlingMode",
			"cwd"
		];
		const ACCESS_KEYS = [
			"c2cMode",
			"c2cAllow",
			"groupMode",
			"groupAllow",
			"commandMode"
		];
		const DEFAULT_ACCESS = {
			c2cMode: "open",
			c2cAllow: [],
			groupMode: "open",
			groupAllow: [],
			commandMode: "open"
		};
		function equal(a, b) {
			return JSON.stringify(a) === JSON.stringify(b);
		}
		/** Preserve raw textarea lines while editing; normalize only the submitted snapshot. */
		function normalizeConfig(form) {
			if (form.access === void 0) return { ...form };
			const lines = (values) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
			return {
				...form,
				access: {
					...form.access,
					c2cAllow: lines(form.access.c2cAllow),
					groupAllow: lines(form.access.groupAllow)
				}
			};
		}
		/** 构建可写差异：凭据等只读字段与未知响应字段不会进入。 */
		function configPatch(baseline, form) {
			const changed = {};
			for (const key of EDITABLE_KEYS) if (!equal(form[key], baseline[key])) Object.assign(changed, { [key]: form[key] });
			return changed;
		}
		function isConfigDirty(baseline, form) {
			return Object.keys(configPatch(baseline, form)).length > 0;
		}
		/** Refresh untouched fields while preserving local edits, including individual access fields. */
		function rebaseConfig(baseline, form, incoming) {
			const rebased = { ...incoming };
			for (const key of EDITABLE_KEYS) if (key !== "access" && !equal(form[key], baseline[key])) Object.assign(rebased, { [key]: form[key] });
			if (form.access !== void 0 && !equal(form.access, baseline.access)) {
				const access = { ...incoming.access ?? DEFAULT_ACCESS };
				for (const key of ACCESS_KEYS) if (!equal(form.access[key], baseline.access?.[key])) Object.assign(access, { [key]: form.access[key] });
				rebased.access = access;
			}
			return rebased;
		}
		/** Pick the supported fields so stored browser drafts cannot retain a future secret response field. */
		function configDraft(baseline, form) {
			const pick = (source) => {
				const value = {};
				if (source.appId !== void 0) value.appId = source.appId;
				if (source.accessRevision !== void 0) value.accessRevision = source.accessRevision;
				for (const key of EDITABLE_KEYS) if (source[key] !== void 0) Object.assign(value, { [key]: source[key] });
				return value;
			};
			return {
				baseline: pick(baseline),
				form: pick(form)
			};
		}
		/** Ignore malformed tab storage instead of rendering unchecked field values. */
		function parseConfigDraft(value) {
			const validConfig = (candidate) => {
				if (candidate === null || typeof candidate !== "object") return false;
				const fields = candidate;
				for (const key of [
					"appId",
					"accessRevision",
					"provider",
					"model",
					"preset",
					"groupPrompt",
					"directPrompt",
					"cwd"
				]) if (fields[key] !== void 0 && typeof fields[key] !== "string") return false;
				for (const key of [
					"requireMention",
					"streaming",
					"showToolResults",
					"debug"
				]) if (fields[key] !== void 0 && typeof fields[key] !== "boolean") return false;
				if (fields.messageHandlingMode !== void 0 && !MESSAGE_HANDLING_MODES.includes(String(fields.messageHandlingMode))) return false;
				if (fields.access !== void 0) {
					if (fields.access === null || typeof fields.access !== "object") return false;
					const access = fields.access;
					for (const key of ["c2cMode", "groupMode"]) if (![
						"open",
						"allowlist",
						"disabled"
					].includes(String(access[key]))) return false;
					if (access.commandMode !== void 0 && (typeof access.commandMode !== "string" || ![
						"open",
						"allowlist",
						"disabled"
					].includes(access.commandMode))) return false;
					for (const key of ["c2cAllow", "groupAllow"]) if (!Array.isArray(access[key]) || !access[key].every((entry) => typeof entry === "string")) return false;
				}
				return true;
			};
			if (value === null || typeof value !== "object") return void 0;
			const stored = value;
			return validConfig(stored.baseline) && validConfig(stored.form) ? configDraft(stored.baseline, stored.form) : void 0;
		}
		//#endregion
		//#region src/client/slash-command-list.ts
		/** 命令访问面板中的命令清单，内容来自服务端注册表。 */
		function SlashCommandList({ commands }) {
			const [open, setOpen] = (0, react.useState)(false);
			const toggle = (0, react.useCallback)(() => setOpen((value) => !value), []);
			const visible = commands.filter((command) => command.hidden !== true);
			return (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
				className: "imqb-cmd-cmdList",
				icon: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular),
				title: `支持的斜杠命令（${visible.length} 个）`,
				open,
				expandable: true,
				expandOnRowClick: true,
				previewChevron: false,
				onToggle: toggle
			}, (0, react.createElement)("div", { className: "imqb-cmd-cmdContent" }, visible.length === 0 ? (0, react.createElement)("p", { className: "imqb-cmd-hint" }, "暂无可用命令。") : null, ...["agent", "qqbot"].map((category) => {
				const items = visible.filter((command) => command.category === category);
				if (items.length === 0) return null;
				return (0, react.createElement)("div", {
					className: "imqb-cmd-cmdGroup",
					key: category
				}, (0, react.createElement)("strong", null, category === "agent" ? "通用能力" : "QQ 内置"), ...items.map((command) => (0, react.createElement)("div", {
					className: "imqb-cmd-cmdRow",
					key: command.name
				}, (0, react.createElement)("code", null, `/${command.name}`), command.aliases.length ? (0, react.createElement)("span", { className: "imqb-cmd-hint" }, `（别名 /${command.aliases.join("、/")}）`) : null, command.scope === "owner" ? (0, react.createElement)("span", { className: "imqb-cmd-hint" }, "仅命令白名单") : null, command.scope === "disabled" ? (0, react.createElement)("span", { className: "imqb-cmd-hint" }, "已关闭") : null, (0, react.createElement)("span", { className: "imqb-cmd-hint" }, command.description))));
			})));
		}
		//#endregion
		//#region src/shared/pairing-protocol.ts
		const PAIR_PURPOSE_LABEL = {
			owner: "斜杠命令白名单",
			"allow-c2c": "私聊白名单",
			"allow-group": "群白名单"
		};
		function formatWhitelistEntry(openid, nickname) {
			const name = nickname.trim();
			if (!name) return openid;
			return openid + ":" + (/[,，;；"\r\n]/.test(name) ? JSON.stringify(name) : name);
		}
		//#endregion
		//#region src/client/whitelist-export.ts
		function whitelistEntries(members) {
			const entries = /* @__PURE__ */ new Map();
			for (const { openid, nickname } of members) {
				if (entries.has(openid)) continue;
				entries.set(openid, formatWhitelistEntry(openid, nickname));
			}
			return [...entries.values()].join("\n");
		}
		/** Quote CSV fields and neutralize spreadsheet formulas in editable display names. */
		function whitelistCsv(members, purpose) {
			const field = (value) => {
				return `"${(/^[\s]*[=+@-]|^[\t\r\n]/.test(value) ? `'${value}` : value).replace(/"/g, "\"\"")}"`;
			};
			return "﻿" + [[
				"昵称",
				"OpenID",
				"名单类型"
			], ...members.map((member) => [
				member.nickname,
				member.openid,
				PAIR_PURPOSE_LABEL[purpose]
			])].map((row) => row.map(field).join(",")).join("\r\n") + "\r\n";
		}
		function downloadWhitelist(members, purpose) {
			const url = URL.createObjectURL(new Blob([whitelistCsv(members, purpose)], { type: "text/csv;charset=utf-8" }));
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `qq-${purpose}-whitelist.csv`;
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			setTimeout(() => URL.revokeObjectURL(url), 1e3);
		}
		//#endregion
		//#region src/client/pairing-results.ts
		/** Keep the window's order and avoid counting repeated claims as new additions. */
		function mergePairResults(previous, incoming) {
			const results = new Map(previous.map((result) => [result.openid, result]));
			for (const result of incoming) {
				const key = result.openid;
				const prior = results.get(key);
				results.set(key, {
					...result,
					state: prior?.state === "added" && result.state === "existing" ? "added" : result.state
				});
			}
			return [...results.values()];
		}
		//#endregion
		//#region src/client/qq-pairing.ts
		/**
		* 配对码认领 UI —— 有效期内连续添加，在窗口内展示本次结果。
		*
		* 流程：Web 生成码 → 用户在 QQ 直接发送该码 → 机器人识别并写名单。
		* 本组件只负责 Web 端的码展示与已认领列表；真正的 openid 绑定在服务端完成。
		*/
		/** 配对状态轮询间隔：进行中的配对码需要实时反映「已认领」。 */
		const POLL_MS = 2e3;
		function usePairStatus(active, live) {
			const [status, setStatus] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [tick, setTick] = (0, react.useState)(0);
			const reload = (0, react.useCallback)(() => setTick((n) => n + 1), []);
			(0, react.useEffect)(() => {
				if (!active) return;
				let stopped = false;
				const load = () => {
					rpcCall(ACCOUNT_RPC_ENDPOINT, ACCOUNT_METHODS.pairStatus).then((s) => {
						if (!stopped) {
							setStatus(s);
							setError(null);
						}
					}).catch((c) => {
						if (stopped) return;
						const msg = c instanceof Error ? c.message : "";
						setError(msg || "读取认领状态失败");
					});
				};
				load();
				if (!live) return () => {
					stopped = true;
				};
				const timer = setInterval(() => {
					if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
					load();
				}, POLL_MS);
				return () => {
					stopped = true;
					clearInterval(timer);
				};
			}, [
				active,
				live,
				tick
			]);
			return {
				status,
				error,
				reload
			};
		}
		/** 单个用途的认领面板：生成码 / 展示进行中的码 / 已认领成员列表（可撤销）。 */
		function PairClaimPanel({ purpose, title, description, hint, enabled = true, onChange }) {
			usePairingStyles();
			const [code, setCode] = (0, react.useState)(null);
			const [addOpen, setAddOpen] = (0, react.useState)(false);
			const { status, error, reload } = usePairStatus(enabled, addOpen && code !== null);
			const members = status === null ? [] : purpose === "owner" ? status.owners : purpose === "allow-group" ? status.allowGroup : status.allowC2c;
			const [busy, setBusy] = (0, react.useState)(false);
			const [msg, setMsg] = (0, react.useState)(null);
			const [manualOpenid, setManualOpenid] = (0, react.useState)("");
			const [manualOpen, setManualOpen] = (0, react.useState)(false);
			const [results, setResults] = (0, react.useState)([]);
			const [windowCodes, setWindowCodes] = (0, react.useState)([]);
			const [codeEnded, setCodeEnded] = (0, react.useState)(false);
			const [editing, setEditing] = (0, react.useState)(null);
			const [copied, setCopied] = (0, react.useState)(false);
			const copyPairCode = (0, react.useCallback)(async (value) => {
				try {
					await (globalThis.navigator?.clipboard?.writeText?.(value) ?? Promise.reject(/* @__PURE__ */ new Error("no clipboard")));
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				} catch {}
			}, []);
			const copyOpenIds = async (value, message = "OpenID 已复制。") => {
				try {
					if (!globalThis.navigator?.clipboard?.writeText) throw new Error("剪贴板不可用，请选择 OpenID 手动复制。");
					await globalThis.navigator.clipboard.writeText(value);
					setMsg(message);
				} catch (error) {
					setMsg(error instanceof Error ? error.message : "复制失败，请选择 OpenID 手动复制。");
				}
			};
			const codeSeen = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				if (code === null || status === null) {
					codeSeen.current = false;
					return;
				}
				const incoming = status.challenges.filter((challenge) => windowCodes.includes(challenge.code)).flatMap((challenge) => challenge.claims);
				if (incoming.length) setResults((previous) => mergePairResults(previous, incoming));
				if (status.challenges.some((c) => c.code === code.code)) {
					codeSeen.current = true;
					return;
				}
				if (codeSeen.current) {
					codeSeen.current = false;
					const expired = Date.now() > code.expiresAt;
					setCodeEnded(true);
					if (expired) setMsg("配对码已过期，请重新生成");
					else {
						setMsg("配对码已结束，请核对名单；未加入时请重新生成。");
						onChange?.();
					}
				}
			}, [
				status,
				code,
				windowCodes,
				onChange
			]);
			if (!enabled) return (0, react.createElement)("div", { className: "imqb-pair" }, (0, react.createElement)("div", { className: "imqb-pairHeader" }, (0, react.createElement)("div", { className: "imqb-pairTitle" }, (0, react.createElement)("strong", null, title))), (0, react.createElement)("p", { className: "imqb-pairHint" }, "先完成 QQ 机器人绑定，才能配置认领。"));
			const issue = () => {
				if (busy) return;
				setBusy(true);
				setMsg(null);
				rpcCall(ACCOUNT_RPC_ENDPOINT, ACCOUNT_METHODS.pairIssue, {
					purpose,
					previousCode: code?.code
				}).then((r) => {
					setResults((previous) => mergePairResults(previous, r.previousClaims));
					setCode({
						code: r.code,
						expiresAt: r.expiresAt
					});
					setCodeEnded(false);
					codeSeen.current = false;
					setWindowCodes((previous) => [...previous, r.code]);
					reload();
				}).catch((c) => setMsg(c instanceof Error ? c.message : "生成配对码失败")).finally(() => setBusy(false));
			};
			const revoke = (openid) => {
				if (busy) return;
				setBusy(true);
				setMsg(null);
				rpcCall(ACCOUNT_RPC_ENDPOINT, ACCOUNT_METHODS.pairRevoke, {
					purpose,
					openid
				}).then(() => {
					reload();
					onChange?.();
				}).catch((c) => setMsg(c instanceof Error ? c.message : "移除失败")).finally(() => setBusy(false));
			};
			const saveRename = (openid, nickname) => {
				if (busy) return;
				setBusy(true);
				setMsg(null);
				rpcCall(ACCOUNT_RPC_ENDPOINT, ACCOUNT_METHODS.pairRename, {
					openid,
					nickname
				}).then(() => {
					setEditing(null);
					reload();
					onChange?.();
				}).catch((c) => setMsg(c instanceof Error ? c.message : "修改失败")).finally(() => setBusy(false));
			};
			const addManual = () => {
				if (busy || !manualOpenid.trim()) return;
				setBusy(true);
				setMsg(null);
				rpcCall(ACCOUNT_RPC_ENDPOINT, ACCOUNT_METHODS.pairManual, {
					purpose,
					openid: manualOpenid
				}).then((r) => {
					setManualOpenid(r.errors.map((error) => error.input).join("\n"));
					setResults((previous) => mergePairResults(previous, r.results));
					setMsg(r.errors.length ? r.errors.map((error) => `${error.input}：${error.message}`).join("\n") : null);
					reload();
					onChange?.();
				}).catch((c) => setMsg(c instanceof Error ? c.message : "添加失败")).finally(() => setBusy(false));
			};
			const secs = code ? Math.max(0, Math.round((code.expiresAt - Date.now()) / 1e3)) : 0;
			const openAdd = () => {
				setAddOpen(true);
				setMsg(null);
				setResults([]);
				setWindowCodes([]);
				setManualOpenid("");
				setManualOpen(false);
				issue();
			};
			const finish = () => {
				if (busy) return;
				if (code === null) {
					setAddOpen(false);
					return;
				}
				setBusy(true);
				setMsg(null);
				rpcCall(ACCOUNT_RPC_ENDPOINT, ACCOUNT_METHODS.pairEnd, {
					purpose,
					code: code.code
				}).then(() => {
					setAddOpen(false);
					setCode(null);
					codeSeen.current = false;
					reload();
					onChange?.();
				}).catch((error) => setMsg(error instanceof Error ? error.message : "结束配对失败，请重试")).finally(() => setBusy(false));
			};
			return (0, react.createElement)("div", { className: "imqb-pair" }, (0, react.createElement)("div", { className: "imqb-pairHeader" }, (0, react.createElement)("div", { className: "imqb-pairTitle" }, (0, react.createElement)("strong", null, title), status ? (0, react.createElement)("span", { className: "imqb-pairCount" }, `(${members.length})`) : null), (0, react.createElement)("div", { className: "imqb-pairToolbar" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				icon: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 14 }),
				disabled: busy,
				onClick: openAdd
			}, "添加"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				icon: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconCopyOutlineRegular, { size: 14 }),
				"aria-label": `复制${title}全部 OpenID 和昵称`,
				title: "每行一个 OpenID:昵称，可直接粘贴到批量添加",
				disabled: members.length === 0 || status === null || error !== null,
				onClick: () => {
					copyOpenIds(whitelistEntries(members), "名单已复制（OpenID:昵称，每行一个）。");
				}
			}, "复制全部"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				icon: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconDownloadOutlineRegular, { size: 14 }),
				disabled: members.length === 0 || status === null || error !== null,
				onClick: () => {
					try {
						downloadWhitelist(members, purpose);
					} catch (error) {
						setMsg(error instanceof Error ? error.message : "导出失败");
					}
				}
			}, "导出 CSV"))), description ? (0, react.createElement)("p", { className: "imqb-pairHint" }, description) : null, hint ? (0, react.createElement)("p", { className: "imqb-pairHint" }, hint) : null, msg ? (0, react.createElement)("p", {
				className: "imqb-pairHint",
				role: "status"
			}, msg) : null, error ? (0, react.createElement)("p", {
				className: "imqb-pairError",
				role: "alert"
			}, error) : null, members.length === 0 ? (0, react.createElement)("p", { className: "imqb-pairHint" }, "尚未添加任何成员。") : (0, react.createElement)("ul", { className: "imqb-pairMembers" }, ...members.map((m) => {
				const isEditing = editing?.openid === m.openid;
				return (0, react.createElement)("li", {
					className: "imqb-pairMember",
					key: `${m.openid}:${m.scene}`
				}, (0, react.createElement)("div", { className: "imqb-pairMemberMain" }, (0, react.createElement)("span", { className: "imqb-pairMemberName" }, m.nickname || "（未命名）"), purpose === "owner" ? (0, react.createElement)("span", { className: "imqb-pairMemberMeta" }, m.scene === "group" ? `群成员${m.sceneName ? ` · ${m.sceneName}` : ""}` : "私聊用户") : null, (0, react.createElement)("div", { className: "imqb-pairIdentity" }, (0, react.createElement)("code", { className: "imqb-pairMemberOpenId" }, m.openid), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					className: "imqb-pairCopy",
					disabled: busy,
					"aria-label": `复制 ${m.nickname || m.openid} 的 OpenID`,
					title: "复制 OpenID",
					onClick: () => {
						copyOpenIds(m.openid);
					}
				}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconCopyOutlineRegular, { size: 14 })))), isEditing ? (0, react.createElement)("div", { className: "imqb-pairMemberEdit" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
					value: editing.nickname,
					disabled: busy,
					placeholder: "昵称",
					"aria-label": "修改昵称",
					onChange: (e) => setEditing({
						openid: m.openid,
						nickname: e.currentTarget.value
					})
				}), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					size: "sm",
					disabled: busy,
					onClick: () => saveRename(m.openid, editing.nickname)
				}, "保存"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					disabled: busy,
					onClick: () => setEditing(null)
				}, "取消")) : (0, react.createElement)("div", { className: "imqb-pairMemberActions" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					disabled: busy,
					onClick: () => setEditing({
						openid: m.openid,
						nickname: m.nickname
					})
				}, "改名"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					disabled: busy,
					onClick: () => revoke(m.openid)
				}, "移除")));
			})), addOpen ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				title: `添加${title}`,
				closeLabel: "关闭并停止配对",
				onClose: finish,
				className: "imqb-pairModal",
				footer: (0, react.createElement)("div", { className: "imqb-pairFooter" }, (0, react.createElement)("span", { className: "imqb-pairHint" }, "完成后配对码失效，已添加的成员保留。"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					size: "sm",
					disabled: busy,
					onClick: finish
				}, "完成")),
				children: (0, react.createElement)("div", { className: "imqb-pairDialog" }, (0, react.createElement)("p", { className: "imqb-pairHint" }, purpose === "allow-group" ? "在需要添加的群里 @机器人后发送此码，有效期内可连续添加多个群。" : "让需要添加的用户在私聊里发送此码，有效期内可连续添加多人。"), code ? (0, react.createElement)("div", { className: "imqb-pairCodeCard" }, (0, react.createElement)("div", { className: "imqb-pairCodeMain" }, (0, react.createElement)("code", { className: "imqb-pairCodeValue" }, code.code), (0, react.createElement)("span", { className: "imqb-pairCodeMeta" }, codeEnded || secs === 0 ? "已结束，请重新生成" : `剩余 ${Math.floor(secs / 60).toString().padStart(2, "0")}:${(secs % 60).toString().padStart(2, "0")}`)), (0, react.createElement)("div", { className: "imqb-pairCodeActions" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					disabled: busy || codeEnded || secs === 0,
					onClick: () => {
						copyPairCode(code.code);
					}
				}, copied ? "已复制" : "复制配对码"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					size: "sm",
					disabled: busy,
					onClick: issue
				}, busy ? "生成中…" : "重新生成"))) : (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					disabled: busy,
					onClick: issue
				}, busy ? "生成中…" : "生成配对码"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
					title: `通过 OpenID 批量添加（非${purpose === "allow-group" ? "群号" : " QQ 号"}）`,
					icon: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular),
					open: manualOpen,
					expandable: true,
					expandOnRowClick: true,
					previewChevron: false,
					onToggle: () => setManualOpen((value) => !value)
				}, (0, react.createElement)("div", { className: "imqb-pairManual" }, (0, react.createElement)("p", { className: "imqb-pairHint" }, "用户 OpenID 不是 QQ 号，群 OpenID 也不是群号，不能直接填写 QQ 号或群号。请使用当前机器人对应的 OpenID；没有 OpenID 时，请使用上方配对码添加。"), (0, react.createElement)("p", { className: "imqb-pairHint" }, "每行一个 OpenID 或 OpenID:昵称。简单条目也可用逗号分隔；昵称含逗号时用双引号包住。"), (0, react.createElement)("pre", { className: "imqb-pairExample" }, "ABCD1234EFGH:小明\nWXYZ5678:Alice Zhang"), (0, react.createElement)("textarea", {
					className: "imqb-pairTextarea",
					rows: 4,
					value: manualOpenid,
					disabled: busy,
					"aria-label": `${title} openID 列表`,
					placeholder: "OpenID 或 OpenID:昵称，每行一个；不能填写 QQ 号或群号",
					onChange: (e) => setManualOpenid(e.currentTarget.value)
				}), (0, react.createElement)("div", { className: "imqb-pairToolbar" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					disabled: busy || manualOpenid.trim() === "",
					onClick: () => {
						addManual();
					}
				}, "添加"), (0, react.createElement)("span", { className: "imqb-pairHint" }, "添加后可继续填写，配对码保持有效。")))), (0, react.createElement)("section", {
					className: "imqb-pairResults",
					"aria-label": "本次添加结果"
				}, (0, react.createElement)("h4", { className: "imqb-pairSectionTitle" }, `本次添加结果（${results.filter((result) => result.state === "added").length} 项新增）`), results.length === 0 ? (0, react.createElement)("p", { className: "imqb-pairHint" }, "等待认领，成功结果会显示在这里。") : null, (0, react.createElement)("ul", {
					className: "imqb-pairResultList",
					"aria-live": "polite"
				}, ...results.map((result) => (0, react.createElement)("li", {
					className: "imqb-pairResult",
					key: `${result.scene}:${result.openid}`
				}, (0, react.createElement)("div", { className: "imqb-pairResultTitle" }, (0, react.createElement)("span", { className: "imqb-pairMemberName" }, result.nickname || (result.scene === "group" ? "未命名群聊" : "未命名用户")), (0, react.createElement)("span", { className: "imqb-pairResultState" }, result.state !== "revoked" ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, { size: 14 }) : null, result.state === "added" ? "已添加" : result.state === "existing" ? "已在名单中" : "已移除")), (0, react.createElement)("div", { className: "imqb-pairIdentity" }, (0, react.createElement)("code", { className: "imqb-pairMemberOpenId" }, result.openid), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					className: "imqb-pairCopy",
					"aria-label": `复制 ${result.nickname || result.openid} 的 OpenID`,
					onClick: () => {
						copyOpenIds(result.openid);
					}
				}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconCopyOutlineRegular, { size: 14 }))))))), msg ? (0, react.createElement)("p", {
					className: "imqb-pairHint",
					role: "status"
				}, msg) : null, error ? (0, react.createElement)("p", {
					className: "imqb-pairError",
					role: "alert"
				}, error) : null)
			}) : null);
		}
		//#endregion
		//#region src/client/config-panel.ts
		/**
		* QQ 机器人配置面板 — 必要配置的 UI 编辑
		*
		* 使用宿主公共 Switch、SegmentedControl、Button 与目录菜单；多行草稿保留普通 textarea。
		*
		* 数据流：GET /qqbot/im-qqbot/config 回显当前生效配置（appSecret
		* 已由宿主剔除）→ 表单编辑 → dirty diff → POST 仅提交变更键 →
		* 宿主白名单 + Schema 校验 → 最小写入 profile patch → HMR 重载生效。
		*
		* 保留上游的回复、模型与提示词设置，并管理账号访问范围。
		*/
		/** 访问模式分段选择行 */
		function SegmentedRow({ label, help, value, options, onChange, disabled = false }) {
			return (0, react.createElement)("div", { className: "imqb-cfg-field" }, (0, react.createElement)("div", { className: "imqb-cfg-head" }, (0, react.createElement)("span", { className: "imqb-cfg-label" }, label), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.SegmentedControl, {
				id: `imqq-access-${label}`,
				value,
				options,
				onChange,
				label,
				disabled
			})), help === void 0 ? null : (0, react.createElement)("p", { className: "imqb-cfg-hint" }, help));
		}
		const MODE_OPTIONS = [
			{
				value: "open",
				label: "所有人"
			},
			{
				value: "allowlist",
				label: "白名单"
			},
			{
				value: "disabled",
				label: "关闭"
			}
		];
		/** 会话忙时新消息的处理方式（默认由 ConfigSchema 与表单共同兜底为 queue） */
		const MESSAGE_HANDLING_OPTIONS = [{
			value: "queue",
			label: "排队"
		}, {
			value: "interrupt",
			label: "插话"
		}];
		const DRAFT_STORAGE_KEY = "im-qqbot/config-draft/v1";
		function storedDraft() {
			try {
				const text = sessionStorage.getItem(DRAFT_STORAGE_KEY);
				return text === null ? void 0 : parseConfigDraft(JSON.parse(text));
			} catch (_error) {
				return;
			}
		}
		/** Keep an edited form through a client reload without storing credential fields. */
		function storeDraft(draft) {
			try {
				if (isConfigDirty(draft.baseline, draft.form)) sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(configDraft(draft.baseline, draft.form)));
				else sessionStorage.removeItem(DRAFT_STORAGE_KEY);
			} catch (_error) {}
		}
		function matchesSavedConfig(config, expected) {
			return config.appId === expected.appId && !isConfigDirty(config, {
				...config,
				...expected.changed
			});
		}
		function waitForReadback(signal, delay) {
			return new Promise((resolve) => {
				const finish = () => {
					clearTimeout(timer);
					signal.removeEventListener("abort", finish);
					resolve();
				};
				const timer = setTimeout(finish, delay);
				signal.addEventListener("abort", finish, { once: true });
				if (signal.aborted) finish();
			});
		}
		/** HMR can briefly serve the old plugin fiber after its profile patch was written. */
		async function confirmSavedConfig(expected, signal) {
			const deadline = Date.now() + 5e3;
			for (let attempt = 0; attempt < 6 && !signal.aborted; attempt += 1) {
				const remaining = deadline - Date.now();
				if (remaining <= 0) break;
				try {
					const { config } = await rpcCall(BIND_RPC_ENDPOINT, BIND_METHODS.configGet, {}, Math.min(1e3, remaining), signal);
					if (matchesSavedConfig(config, expected)) return config;
				} catch (_error) {}
				if (!signal.aborted) await waitForReadback(signal, Math.min(400, Math.max(0, deadline - Date.now())));
			}
		}
		/** Settings editor with recoverable requests and a draft protected from binding refreshes. */
		function ConfigPanel({ bindPhase, appId } = {}) {
			useConfigPanelStyles();
			const [commands, setCommands] = (0, react.useState)([]);
			const [commandsError, setCommandsError] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				if (bindPhase !== "bound") return;
				rpcCall(ACCOUNT_RPC_ENDPOINT, ACCOUNT_METHODS.commands, {}, 1e4, controller.signal).then((result) => {
					if (controller.signal.aborted) return;
					setCommands(result.commands);
					setCommandsError(null);
				}).catch((error) => {
					if (!controller.signal.aborted) setCommandsError(error instanceof Error ? error.message : String(error));
				});
				return () => controller.abort();
			}, [bindPhase, appId]);
			const [draft, setDraft] = (0, react.useState)(null);
			const draftRef = (0, react.useRef)(null);
			const mounted = (0, react.useRef)(true);
			const saveController = (0, react.useRef)(null);
			const pendingConfirmation = (0, react.useRef)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [loading, setLoading] = (0, react.useState)(true);
			const [reload, setReload] = (0, react.useState)(0);
			const [result, setResult] = (0, react.useState)(null);
			const [loadError, setLoadError] = (0, react.useState)(null);
			const [draftNotice, setDraftNotice] = (0, react.useState)(null);
			const replaceDraft = (0, react.useCallback)((next) => {
				draftRef.current = next;
				storeDraft(next);
				setDraft(next);
			}, []);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
					saveController.current?.abort();
				};
			}, []);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				let stopped = false;
				let waitingForBinding = false;
				setLoading(true);
				setLoadError(null);
				rpcCall(BIND_RPC_ENDPOINT, BIND_METHODS.configGet, {}, 1e4, controller.signal).then(({ config }) => {
					if (stopped || saveController.current !== null) return;
					if (appId !== void 0 && appId !== (config.appId || null)) {
						if (appId === null && bindPhase !== "bound") {
							waitingForBinding = true;
							return;
						}
						throw new RpcError(RPC_ERROR_CODES.accountChanged, "QQ 账号已变化，请等待绑定状态更新后刷新配置。");
					}
					const expected = pendingConfirmation.current;
					const confirmed = expected !== null && matchesSavedConfig(config, expected);
					if (confirmed || expected?.appId !== config.appId) pendingConfirmation.current = null;
					const current = draftRef.current ?? storedDraft();
					const sameAccount = current?.baseline.appId === config.appId;
					const hadDraft = current !== void 0 && current !== null && sameAccount && isConfigDirty(current.baseline, current.form);
					const form = hadDraft ? rebaseConfig(current.baseline, current.form, config) : config;
					const dirty = isConfigDirty(config, form);
					replaceDraft({
						baseline: config,
						form
					});
					setDraftNotice(hadDraft && dirty ? "已保留未保存的修改，其余配置已更新。" : null);
					setLoadError(null);
					if (dirty) setResult(null);
					else if (confirmed) setResult({
						kind: "confirmed",
						message: "配置已保存，插件重载完成后生效。"
					});
					else if (pendingConfirmation.current !== null) setResult({
						kind: "unconfirmed",
						message: "已读取当前配置，内容与上次保存的值不同。"
					});
					else setResult(null);
				}).catch((error) => {
					if (!stopped) setLoadError(error instanceof Error ? error.message : String(error));
				}).finally(() => {
					if (!stopped && !waitingForBinding) setLoading(false);
				});
				return () => {
					stopped = true;
					controller.abort();
				};
			}, [
				bindPhase,
				appId,
				reload,
				replaceDraft
			]);
			const patch = (0, react.useCallback)((key, value) => {
				const current = draftRef.current;
				if (current === null) return;
				replaceDraft({
					...current,
					form: {
						...current.form,
						[key]: value
					}
				});
				setResult(null);
			}, [replaceDraft]);
			const submit = (0, react.useCallback)((event) => {
				event.preventDefault();
				const current = draftRef.current;
				if (busy || current === null) return;
				const submitted = normalizeConfig(current.form);
				const changed = configPatch(current.baseline, submitted);
				if (Object.keys(changed).length === 0) {
					replaceDraft({
						baseline: current.baseline,
						form: submitted
					});
					return;
				}
				replaceDraft({
					baseline: current.baseline,
					form: submitted
				});
				const controller = new AbortController();
				saveController.current = controller;
				setBusy(true);
				setResult(null);
				rpcCall(BIND_RPC_ENDPOINT, BIND_METHODS.configSet, {
					...changed,
					expectedAppId: current.baseline.appId ?? null,
					...changed.access === void 0 ? {} : { accessRevision: current.baseline.accessRevision }
				}, 1e4, controller.signal).then(async (body) => {
					if (!body.ok) throw new Error(body.error ?? "保存失败，请重试。");
					if (!mounted.current || controller.signal.aborted) return;
					const expected = {
						appId: submitted.appId,
						changed
					};
					pendingConfirmation.current = expected;
					replaceDraft({
						baseline: submitted,
						form: submitted
					});
					setDraftNotice(null);
					const config = await confirmSavedConfig(expected, controller.signal);
					if (!mounted.current || controller.signal.aborted) return;
					if (config !== void 0) {
						pendingConfirmation.current = null;
						replaceDraft({
							baseline: config,
							form: config
						});
						setResult({
							kind: "confirmed",
							message: "配置已保存，插件重载完成后生效。"
						});
					} else setResult({
						kind: "unconfirmed",
						message: "配置已保存，刷新配置核对生效结果。"
					});
				}).catch((error) => {
					if (mounted.current && !controller.signal.aborted) setResult({
						kind: "failed",
						message: error instanceof RpcError && (error.code === RPC_ERROR_CODES.configConflict || error.code === RPC_ERROR_CODES.accountChanged) ? `${error.message}草稿已保留，请先刷新配置。` : `保存结果未确认：${error instanceof Error ? error.message : String(error)}。草稿已保留，可重试或刷新配置核对。`
					});
				}).finally(() => {
					if (saveController.current === controller) {
						saveController.current = null;
						if (mounted.current) setBusy(false);
					}
				});
			}, [busy, replaceDraft]);
			const retry = () => {
				setReload((value) => value + 1);
			};
			const loadFeedback = loadError === null ? null : (0, react.createElement)("div", {
				className: "imqb-cfg-feedback",
				role: "alert"
			}, (0, react.createElement)("p", { className: "imqb-cfg-note imqb-cfg-note--error" }, `配置加载失败：${loadError}`), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				onClick: retry,
				disabled: loading || busy
			}, loading ? "重试中…" : "重试"));
			if (draft === null) return (0, react.createElement)("div", { "aria-busy": loading }, loadFeedback, loading ? (0, react.createElement)("p", {
				className: "imqb-cfg-hint",
				role: "status",
				style: { padding: "12px 0" }
			}, "正在加载配置…") : null);
			const { baseline, form } = draft;
			const dirty = isConfigDirty(baseline, form);
			const access = form.access ?? DEFAULT_ACCESS;
			const message = busy ? "正在保存配置…" : result?.message ?? (dirty ? draftNotice ?? "有未保存修改。保存会重载插件，并中断正在运行的 QQ 任务。" : "没有未保存的修改。");
			return (0, react.createElement)("form", {
				className: "imqb-cfg-form",
				onSubmit: submit,
				"aria-busy": busy
			}, loadFeedback, (0, react.createElement)("fieldset", {
				className: "imqb-cfg-fields",
				disabled: busy
			}, (0, react.createElement)("div", { className: "imqb-cfg-group-title" }, "服务范围"), (0, react.createElement)(SegmentedRow, {
				disabled: busy,
				label: "私聊",
				value: access.c2cMode,
				options: MODE_OPTIONS,
				onChange: (value) => {
					patch("access", {
						...access,
						c2cMode: value
					});
				}
			}), access.c2cMode === "allowlist" ? (0, react.createElement)(PairClaimPanel, {
				purpose: "allow-c2c",
				title: "私聊白名单",
				enabled: bindPhase === "bound",
				onChange: retry,
				hint: "生成配对码，让对方在私聊里直接给机器人发送这个码，即加入私聊白名单。"
			}) : null, (0, react.createElement)(SegmentedRow, {
				disabled: busy,
				label: "群聊",
				value: access.groupMode,
				options: MODE_OPTIONS,
				onChange: (value) => {
					patch("access", {
						...access,
						groupMode: value
					});
				}
			}), access.groupMode === "allowlist" ? (0, react.createElement)(PairClaimPanel, {
				purpose: "allow-group",
				title: "群白名单",
				enabled: bindPhase === "bound",
				onChange: retry,
				hint: "生成配对码，让群成员在群里 @ 机器人后直接发送这个码，即把该群加入白名单。"
			}) : null, (0, react.createElement)(SegmentedRow, {
				disabled: busy,
				label: "斜杠命令",
				value: access.commandMode ?? "open",
				options: MODE_OPTIONS,
				help: "仅在获准接入的对话中生效。所有人模式允许成员切换模型、开始新会话等，影响该群的共享会话。审批和提问按钮按各自权限处理。",
				onChange: (value) => {
					patch("access", {
						...access,
						commandMode: value
					});
				}
			}), (access.commandMode ?? "open") === "allowlist" ? (0, react.createElement)(PairClaimPanel, {
				purpose: "owner",
				title: "命令白名单",
				enabled: bindPhase === "bound",
				onChange: retry,
				hint: "名单按发送者 OpenID 校验，适用于获准接入的群聊和私聊。保存模式与管理名单分别生效。"
			}) : null, commandsError ? (0, react.createElement)("p", {
				className: "imqb-cmd-error",
				role: "alert"
			}, `命令清单加载失败：${commandsError}`) : null, (0, react.createElement)(SlashCommandList, { commands }), (0, react.createElement)("div", { className: "imqb-cfg-group-title" }, "基础设置"), ...[
				["requireMention", "群聊仅回复 @机器人的消息"],
				["streaming", "流式输出"],
				["showToolResults", "显示工具调用结果"]
			].map(([key, label]) => (0, react.createElement)("div", {
				className: "imqb-cfg-field",
				key
			}, (0, react.createElement)("div", { className: "imqb-cfg-head" }, (0, react.createElement)("span", { className: "imqb-cfg-label" }, label), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
				label,
				checked: form[key] ?? key !== "showToolResults",
				onChange: (value) => patch(key, value)
			})))), (0, react.createElement)("div", { className: "imqb-cfg-field" }, (0, react.createElement)("div", { className: "imqb-cfg-head" }, (0, react.createElement)("span", { className: "imqb-cfg-label" }, "消息处理方式"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.SegmentedControl, {
				id: "imqq-message-handling",
				value: form.messageHandlingMode ?? "queue",
				options: MESSAGE_HANDLING_OPTIONS,
				onChange: (value) => patch("messageHandlingMode", value),
				label: "消息处理方式",
				disabled: busy
			})), (0, react.createElement)("p", { className: "imqb-cfg-hint" }, "任务进行中新消息的处理方式：排队在当前任务结束后处理，插话立即补充到当前任务。切换需保存并重载插件，会中断进行中的任务。")), (0, react.createElement)("div", { className: "imqb-cfg-group-title" }, "模型与提示词"), ...[
				["provider", "模型提供方"],
				["model", "模型"],
				["preset", "Agent 预设"]
			].map(([key, label]) => (0, react.createElement)("div", {
				className: "imqb-cfg-field",
				key
			}, (0, react.createElement)("label", {
				className: "imqb-cfg-label",
				htmlFor: `imqq-${key}`
			}, label), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				id: `imqq-${key}`,
				value: form[key] ?? "",
				placeholder: "留空继承 DSH 默认",
				onChange: (event) => patch(key, event.target.value)
			}))), ...[["groupPrompt", "群聊补充提示词"], ["directPrompt", "私聊补充提示词"]].map(([key, label]) => (0, react.createElement)("div", {
				className: "imqb-cfg-field",
				key
			}, (0, react.createElement)("label", {
				className: "imqb-cfg-label",
				htmlFor: `imqq-${key}`
			}, label), (0, react.createElement)("textarea", {
				id: `imqq-${key}`,
				className: "imqb-cfg-textarea",
				value: form[key] ?? "",
				rows: 3,
				onChange: (event) => patch(key, event.target.value)
			}))), (0, react.createElement)("div", { className: "imqb-cfg-field" }, (0, react.createElement)("label", {
				className: "imqb-cfg-label",
				htmlFor: "imqq-cwd"
			}, "Agent 工作目录"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				id: "imqq-cwd",
				value: form.cwd ?? "",
				placeholder: "留空用默认 ~/.dsh-qqbot/workspace，支持 ~ 或绝对路径",
				onChange: (event) => patch("cwd", event.target.value)
			}))), (0, react.createElement)("div", { className: "imqb-cfg-footer" }, (0, react.createElement)("p", {
				className: `imqb-cfg-note${result === null ? "" : result.kind === "failed" ? " imqb-cfg-note--error" : " imqb-cfg-note--ok"}`,
				role: result?.kind === "failed" ? "alert" : "status",
				"aria-live": "polite"
			}, message), (0, react.createElement)("div", { className: "imqb-cfg-footer-actions" }, pendingConfirmation.current !== null || result?.kind === "failed" ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				disabled: busy || loading,
				onClick: retry
			}, loading ? "刷新中…" : "刷新配置") : null, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				disabled: busy || !dirty,
				onClick: () => {
					replaceDraft({
						baseline,
						form: baseline
					});
					setResult(null);
					setDraftNotice(null);
				}
			}, "撤销修改"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "primary",
				size: "sm",
				type: "submit",
				disabled: busy || !dirty
			}, busy ? "保存中…" : "保存"))));
		}
		//#endregion
		//#region src/client/views.ts
		/**
		* 视图层 —— 全部展示位共用的组合视图与图标。
		*
		* 组合根（QQBotView / QQBotPage / BindPanelBody）经 store 订阅状态；
		* 其余组件保持纯 props + 回调（可脱离宿主/网络测试）。席位 adapter
		* （seats.ts）只回答「挂在哪、用哪个视图」，内容演进只改本文件。
		*/
		/**
		* 设置栏目与主面板的完整视图：绑定面板 + 配置面板，共享同一 store 轮询。
		* 配置面板按绑定相位刷新（bound 态才拉取命令清单等 bound-only 数据）。
		*/
		function QQBotView() {
			const { state } = useBindState();
			const appId = state?.phase === "bound" ? state.appId : null;
			return (0, react.createElement)("div", null, (0, react.createElement)(BindPanelBody), (0, react.createElement)(ConfigPanel, {
				key: appId === null ? "unbound" : `bound:${appId}`,
				appId,
				bindPhase: state?.phase
			}));
		}
		/** 主面板页面：完整视图包一层滚动留白容器（plugins.detail.actions 的跳转目标） */
		function QQBotPage() {
			return (0, react.createElement)("div", { className: "imqb-pluginPage" }, (0, react.createElement)("div", { className: "imqb-pluginPageContent" }, (0, react.createElement)(QQBotView)));
		}
		/** 左侧栏入口图标（宿主传入 size：展开 18 / 收起 16；currentColor 跟随侧栏配色与选中态） */
		function QqBotSidebarIcon({ size = 16 }) {
			return (0, react.createElement)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": true
			}, (0, react.createElement)("path", {
				d: QQ_BOT_LOGO_PATH,
				fill: "currentColor"
			}));
		}
		/** 侧栏 Start 页引导图标（currentColor 跟随宿主容器配色，明暗主题自适应） */
		function BindGuideIcon() {
			return (0, react.createElement)("svg", {
				width: 24,
				height: 24,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": true
			}, (0, react.createElement)("path", {
				d: "M9.50039 11.1504C9.96983 11.1504 10.3504 11.5309 10.3504 12.0004V14.0004C10.3504 14.4698 9.96983 14.8504 9.50039 14.8504C9.03095 14.8504 8.65039 14.4698 8.65039 14.0004V12.0004C8.65039 11.5309 9.03095 11.1504 9.50039 11.1504Z",
				fill: "currentColor"
			}), (0, react.createElement)("path", {
				d: "M14.5004 11.1504C14.9698 11.1504 15.3504 11.5309 15.3504 12.0004V14.0004C15.3504 14.4698 14.9698 14.8504 14.5004 14.8504C14.0309 14.8504 13.6504 14.4698 13.6504 14.0004V12.0004C13.6504 11.5309 14.0309 11.1504 14.5004 11.1504Z",
				fill: "currentColor"
			}), (0, react.createElement)("path", {
				fillRule: "evenodd",
				clipRule: "evenodd",
				d: "M12.8504 5.3109C13.5299 4.99138 14.0004 4.30063 14.0004 3.5C14.0004 2.39543 13.1049 1.5 12.0004 1.5C10.8958 1.5 10.0004 2.39543 10.0004 3.5C10.0004 4.30065 10.4708 4.99141 11.1504 5.31092V6.18851C6.38487 6.61795 2.65039 10.6231 2.65039 15.5004V17.0004C2.65039 19.679 4.82181 21.8504 7.50039 21.8504H16.5004C19.179 21.8504 21.3504 19.679 21.3504 17.0004V15.5004C21.3504 10.6231 17.6159 6.61795 12.8504 6.18851V5.3109ZM12.0004 7.85039C7.77541 7.85039 4.35039 11.2754 4.35039 15.5004V17.0004C4.35039 18.7401 5.76069 20.1504 7.50039 20.1504H16.5004C18.2401 20.1504 19.6504 18.7401 19.6504 17.0004V15.5004C19.6504 11.2754 16.2254 7.85039 12.0004 7.85039Z",
				fill: "currentColor"
			}));
		}
		/** 插件详情「设置」按钮：仅在本包的 bundle / 组件行详情页渲染，其他插件不显示。
		*  样式走宿主统一 Button 原语（与详情页自身的更新/卸载按钮同规格）。 */
		function OpenQqBotAction({ subject, packageName, onOpen }) {
			if (subject?.kind !== "bundle" && subject?.kind !== "row") return null;
			if (subject.pkg?.name !== packageName) return null;
			if (subject.kind === "row" && subject.row?.moduleName !== packageName) return null;
			return (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				onClick: onOpen
			}, "设置");
		}
		//#endregion
		//#region src/client/seats.ts
		/** 侧栏 Tab 类型（ui-sidebar-right 契约的局部投影） */
		const TAB_KIND = "qqbot-bind";
		/** 席位注册 key（Tab 类型 id，席位按其分发；只需全局唯一，与包名解耦） */
		const TAB_ID = "im-qqbot/bind";
		/** 本插件包名（插件详情页按其匹配来源包，只在对应详情页渲染操作按钮） */
		const PACKAGE_NAME = "@tencent-connect/dsh-qqbot";
		/** 主面板 id（layout.selectPanel 导航目标；keyed main 席位按其分发） */
		const IM_MAIN_PANEL_ID = "im-qqbot";
		/**
		* 装配全部席位。幂等性由调用方保证（apply 每次调用恰好一次）。
		*
		* @param ctx - 插件上下文（slots / sidebarRightTabs 已由 inject 声明在场）
		* @param dispose - 席位清理链（layout 子 fiber 自清理，不入链）
		*/
		function wireSeats(ctx, dispose) {
			const { slots } = ctx;
			const { sidebarRightTabs: tabs } = ctx;
			dispose.add(slots.inject("settings.section", () => slots.register({
				name: "settings.section",
				id: "qqbot",
				order: 7,
				label: "QQ 机器人"
			}, QQBotView)));
			dispose.add(trySeat(() => slots.inject("settings.section.icon", () => slots.register({
				name: "settings.section.icon",
				id: "qqbot"
			}, QqBotSidebarIcon))));
			dispose.add(tabs.register({
				id: TAB_ID,
				kind: TAB_KIND,
				title: () => "QQ 机器人绑定",
				guide: [{
					id: "bind",
					order: 90,
					title: () => "QQ 机器人绑定",
					description: () => "扫码或手动填写，绑定 QQ 机器人",
					icon: BindGuideIcon
				}]
			}));
			dispose.add(slots.inject("sidebar.right.pane.tab", () => slots.register({
				name: "sidebar.right.pane.tab",
				key: TAB_ID
			}, BindPanelBody)));
			ctx.inject(["layout"], (pageCtx) => {
				const pageSlots = pageCtx.slots;
				const layout = hostLayout(pageCtx);
				const stopMain = pageSlots.inject("main", () => pageSlots.register({
					name: "main",
					key: IM_MAIN_PANEL_ID
				}, QQBotPage));
				const stopActions = pageSlots.inject("plugins.detail.actions", () => pageSlots.register({
					name: "plugins.detail.actions",
					id: "im-qqbot-open",
					order: 20,
					inject: () => ({
						packageName: PACKAGE_NAME,
						onOpen: () => layout.selectPanel(IM_MAIN_PANEL_ID)
					})
				}, OpenQqBotAction));
				const stopSidebar = pageSlots.inject("sidebar.panellist", () => pageSlots.register({
					name: "sidebar.panellist",
					id: IM_MAIN_PANEL_ID,
					order: 10,
					label: "QQ 机器人"
				}, QqBotSidebarIcon));
				return () => {
					stopActions();
					stopSidebar();
					stopMain();
				};
			});
		}
		//#endregion
		//#region src/client/index.ts
		const name = "im-qqbot-client";
		const inject = [
			"slots",
			"sidebarRightTabs",
			"connection"
		];
		function apply(ctx) {
			setClientConnection(ctx.connection);
			const dispose = chain();
			ctx.effect(() => {
				const retainStyles = installBindPanelStyles();
				wireSeats(ctx, dispose);
				return () => {
					retainStyles();
					dispose.run();
				};
			}, "im-qqbot-client.seats");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map