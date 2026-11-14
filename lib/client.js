window.__ModuleLoader__.load({
	id: "@tencent-connect/dsh-qqbot",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region src/shared/bind-protocol.ts
		/**
		* 端内绑定协议 —— 宿主路由与客户端面板的共享契约
		*
		* 类型与路径常量的唯一事实源：宿主（setup/bind-routes.ts）与浏览器
		* （client/bind-page.ts）各自 import，杜绝两端协议漂移。
		* 本模块必须保持纯类型 + 纯常量（零 node 依赖、零副作用）：
		* 客户端 tsdown 构建会将其内联进 bundle。
		*/
		/** 状态查询（绑定页轮询） */
		const BIND_STATE_PATH = "/qqbot/im-qqbot/bind";
		/** 刷新二维码（绑定页按钮） */
		const BIND_REFRESH_PATH = "/qqbot/im-qqbot/bind/refresh";
		/** 手动填写/编辑凭据（绑定页表单） */
		const BIND_MANUAL_PATH = "/qqbot/im-qqbot/bind/manual";
		/** 解绑：移除已保存凭据，回到绑定流程 */
		const BIND_UNBIND_PATH = "/qqbot/im-qqbot/bind/unbind";
		/** 配置读写（设置面板表单） */
		const BIND_CONFIG_PATH = "/qqbot/im-qqbot/config";
		//#endregion
		//#region src/client/http.ts
		/** Same-origin JSON requests with bounded waiting and actionable HTTP errors. */
		var HttpError = class extends Error {
			status;
			constructor(status, message) {
				super(message);
				this.status = status;
			}
		};
		async function fetchJson(path, init = {}, timeoutMs = 1e4) {
			const controller = new AbortController();
			const callerSignal = init.signal;
			let timedOut = false;
			const onCancel = () => {
				controller.abort(callerSignal?.reason);
			};
			if (callerSignal?.aborted) onCancel();
			else callerSignal?.addEventListener("abort", onCancel, { once: true });
			const timer = setTimeout(() => {
				if (controller.signal.aborted) return;
				timedOut = true;
				controller.abort();
			}, timeoutMs);
			try {
				if (controller.signal.aborted) throw new DOMException("请求已取消", "AbortError");
				const response = await fetch(path, {
					...init,
					signal: controller.signal
				});
				if (!response.ok) {
					const body = await response.json().catch(() => null);
					throw new HttpError(response.status, body?.error ?? `请求失败（HTTP ${response.status}）`);
				}
				return await response.json();
			} catch (error) {
				if (controller.signal.aborted) {
					if (timedOut) throw new Error("请求超时，请重试");
					throw new DOMException("请求已取消", "AbortError");
				}
				throw error;
			} finally {
				clearTimeout(timer);
				callerSignal?.removeEventListener("abort", onCancel);
			}
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
		* 样式为注入式 CSS 类（imqb-* 命名空间，随面板挂载注入一次）：
		* hover/过渡/focus 样式无法用 inline style 表达，统一走类；
		* 颜色尽量取 DSW 主题变量（--dsw-alias-*），缺省值兜底。
		*
		* 同一组件复用于两种展示位（侧栏绑定页 / 设置页 QQ Bot 栏目）。
		* 运行时仅依赖 react（dsh 客户端平台种子表提供）；宿主通信走同源 fetch，
		* Desktop 下由壳的 IPC 桥自动附加 Host 认证转发。
		*/
		/** 轮询间隔（毫秒）：活跃轮询 / 失败退避 */
		const ACTIVE_POLL_MS = 2e3;
		const RETRY_POLL_MS = 3e3;
		/** 样式注入标记（幂等） */
		const STYLE_ID$2 = "im-qqbot-bind-panel-styles";
		/**
		* 注入面板样式（全局一次，幂等）。交互态（hover/active/focus）无法用 inline
		* style 表达，统一收敛到类；DSW 主题变量缺失时用中性值兜底。
		* 插件激活时即安装：插件详情按钮渲染在面板之外，需提前可见；
		* 安装后不再随挂载移除，避免多个展示位互相清掉样式。
		*/
		function installPanelStyles() {
			if (typeof document === "undefined") return;
			if (document.getElementById(STYLE_ID$2) !== null) return;
			const style = document.createElement("style");
			style.id = STYLE_ID$2;
			style.textContent = `
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
    `;
			style.textContent += `\n.imqb-danger { color: var(--dsw-alias-state-error-primary); }
.imqb-field > span { width: 100%; }
.imqb-cards { display: flex; flex-direction: column; gap: 20px; }
.imqb-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); padding: 4px 16px 16px; background: var(--dsw-alias-bg-layer-1); }
.imqb-cardTitle { margin: 14px 0 4px; font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.imqb-cardHint { margin: 0 0 8px; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); }`;
			document.head.appendChild(style);
		}
		function usePanelStyles() {
			(0, react.useEffect)(() => {
				installPanelStyles();
			}, []);
		}
		/**
		* 绑定状态轮询 hook。
		*
		* 404 语义分两种：从未拿到过路由 = 插件未启用（终态）；
		* 曾经拿到过 = HMR 重载窗口期（manual/unbind 保存后路由短暂消失），
		* 低频等待恢复而不是判定终态——否则保存成功提示会被
		* 「插件未启用」覆盖且无法自愈。
		*
		* bound 为稳定态：轮询大幅降频（30s）。因此解绑等本地动作后必须
		* 调用 recheck() 立即重置节拍——否则视图最长停留 30s+ 才收敛到
		* 新相位（如解绑后的 waiting 二维码）。
		*
		* @returns 轮询快照与 recheck：state 为宿主相位（null = 加载中），
		*          gone 表示插件未启用（从未注册过路由），recheck 废弃当前
		*          定时器并立即重新轮询（新轮询链取代旧链，不产生双计时器）。
		*/
		function useBindState(enabled = true) {
			const [state, setState] = (0, react.useState)(null);
			const [gone, setGone] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const recheckRef = (0, react.useRef)(() => {});
			(0, react.useEffect)(() => {
				if (!enabled) return;
				let stopped = false;
				const controller = new AbortController();
				let sawRoute = false;
				let generation = 0;
				let running = false;
				let restartAfterFlight = false;
				let urgentUntil = 0;
				let timer;
				const schedule = (ms) => {
					timer = setTimeout(() => {
						tick();
					}, ms);
				};
				const intervalFor = (phase) => {
					const base = phase === "saving" ? 500 : phase === "bound" ? 3e4 : ACTIVE_POLL_MS;
					return Date.now() < urgentUntil ? Math.min(base, ACTIVE_POLL_MS) : base;
				};
				const tick = async () => {
					if (stopped || running) return;
					running = true;
					const myGeneration = generation;
					const alive = () => myGeneration === generation && !stopped;
					try {
						const body = await fetchJson(BIND_STATE_PATH, {
							cache: "no-store",
							signal: controller.signal
						});
						sawRoute = true;
						if (!alive()) return;
						setGone(false);
						setError(null);
						setState(body);
						schedule(intervalFor(body.phase));
						return;
					} catch (cause) {
						if (alive()) {
							const message = cause instanceof Error ? cause.message : "无法获取绑定状态";
							setError(message);
							if (!sawRoute && message.includes("HTTP 404")) setGone(true);
						}
					} finally {
						running = false;
						if (restartAfterFlight && !stopped) {
							restartAfterFlight = false;
							tick();
						}
					}
					if (alive()) schedule(RETRY_POLL_MS);
				};
				recheckRef.current = () => {
					generation += 1;
					setGone(false);
					setError(null);
					urgentUntil = Date.now() + 15e3;
					if (timer !== void 0) clearTimeout(timer);
					if (running) {
						restartAfterFlight = true;
						return;
					}
					tick();
				};
				tick();
				return () => {
					stopped = true;
					controller.abort();
					if (timer !== void 0) clearTimeout(timer);
				};
			}, [enabled]);
			return {
				state,
				gone,
				error,
				recheck: (0, react.useCallback)(() => {
					recheckRef.current();
				}, [])
			};
		}
		/** 手动提交凭据（填写 / 更换共用） */
		async function submitManualCredentials(appId, appSecret) {
			try {
				const body = await fetchJson(BIND_MANUAL_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						appId,
						appSecret
					})
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
				fetchJson(BIND_UNBIND_PATH, { method: "POST" }).then((body) => {
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
				fetchJson(BIND_REFRESH_PATH, { method: "POST" }).then(() => {
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
				fetchJson(BIND_REFRESH_PATH, { method: "POST" }).then(() => {
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
		function BindPanelBody(props = {}) {
			usePanelStyles();
			const injected = props.state !== void 0;
			const internal = useBindState(!injected);
			const state = injected ? props.state ?? null : internal.state;
			const gone = injected ? props.gone ?? false : internal.gone;
			const recheck = injected ? props.recheck ?? (() => {}) : internal.recheck;
			const error = injected ? props.error : internal.error;
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
			"messageHandlingMode"
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
		/** Build the writable difference without submitting account or working-directory fields. */
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
					"directPrompt"
				]) if (fields[key] !== void 0 && typeof fields[key] !== "string") return false;
				for (const key of [
					"requireMention",
					"streaming",
					"showToolResults",
					"debug"
				]) if (fields[key] !== void 0 && typeof fields[key] !== "boolean") return false;
				if (fields.messageHandlingMode !== void 0 && !["queue", "interrupt"].includes(String(fields.messageHandlingMode))) return false;
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
				className: "imqc-cmdList",
				icon: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular),
				title: `支持的斜杠命令（${visible.length} 个）`,
				open,
				expandable: true,
				expandOnRowClick: true,
				previewChevron: false,
				onToggle: toggle
			}, (0, react.createElement)("div", { className: "imqc-cmdContent" }, visible.length === 0 ? (0, react.createElement)("p", { className: "imqc-hint" }, "暂无可用命令。") : null, ...["agent", "qqbot"].map((category) => {
				const items = visible.filter((command) => command.category === category);
				if (items.length === 0) return null;
				return (0, react.createElement)("div", {
					className: "imqc-cmdGroup",
					key: category
				}, (0, react.createElement)("strong", null, category === "agent" ? "通用能力" : "QQ 内置"), ...items.map((command) => (0, react.createElement)("div", {
					className: "imqc-cmdRow",
					key: command.name
				}, (0, react.createElement)("code", null, `/${command.name}`), command.aliases.length ? (0, react.createElement)("span", { className: "imqc-hint" }, `（别名 /${command.aliases.join("、/")}）`) : null, command.scope === "owner" ? (0, react.createElement)("span", { className: "imqc-hint" }, "仅命令白名单") : null, command.scope === "disabled" ? (0, react.createElement)("span", { className: "imqc-hint" }, "已关闭") : null, (0, react.createElement)("span", { className: "imqc-hint" }, command.description))));
			})));
		}
		//#endregion
		//#region src/shared/command-protocol.ts
		/** Command catalog endpoint retained for existing QQ settings clients. */
		const COMMANDS_PATH = "/qqbot/im-qqbot/conversations";
		//#endregion
		//#region src/client/qq-pairing-styles.ts
		const STYLE_ID$1 = "im-qqbot-pairing-styles";
		/** Keep pairing panels and portal dialogs independent of conversation-page styles. */
		function usePairingStyles() {
			(0, react.useEffect)(() => {
				const existing = document.getElementById(STYLE_ID$1);
				const style = existing ?? document.createElement("style");
				if (!existing) {
					style.id = STYLE_ID$1;
					style.textContent = `
.imqq-pair { min-width: 0; container-type: inline-size; display: grid; gap: 10px; margin: 4px 0 16px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); color: var(--dsw-alias-label-primary); }
.imqq-pairHeader, .imqq-pairToolbar, .imqq-pairMemberActions, .imqq-pairMemberEdit { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.imqq-pairHeader { gap: 12px; }
.imqq-pairTitle { display: flex; align-items: baseline; gap: 6px; min-width: 0; font-size: 13px; }
.imqq-pairCount, .imqq-pairHint, .imqq-pairMemberMeta { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.imqq-pairToolbar { margin-left: auto; }
.imqq-pairHint { margin: 0; overflow-wrap: anywhere; }
.imqq-pairHint[role="status"] { white-space: pre-line; }
.imqq-pairError { margin: 0; color: var(--dsw-alias-state-error-primary); }
.imqq-pairMembers { list-style: none; padding: 0; margin: 0; }
.imqq-pairMember { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 12px 0 2px; border-top: 1px solid var(--dsw-alias-border-l2); }
.imqq-pairMember + .imqq-pairMember { margin-top: 10px; }
.imqq-pairMemberMain { min-width: 0; display: grid; gap: 4px; }
.imqq-pairMemberName { font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }
.imqq-pairIdentity { display: flex; align-items: center; gap: 6px; min-width: 0; }
.imqq-pairMemberOpenId { min-width: 0; font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; user-select: text; }
.imqq-pairCopy { flex: none; }
.imqq-pairMemberEdit { justify-content: flex-end; max-width: 280px; }
.imqq-pairMemberEdit > :first-child { flex: 1 1 120px; min-width: 0; }
.imqq-pairDialog { display: grid; gap: 12px; color: var(--dsw-alias-label-primary); }
.imqq-pairSectionTitle { margin: 0; font-size: 13px; font-weight: 600; }
.imqq-pairSteps { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.8; color: var(--dsw-alias-label-secondary); }
.imqq-pairExample { margin: 0; padding: 8px 10px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); white-space: pre-wrap; font-size: 12px; }
.imqq-pairTextarea { box-sizing: border-box; width: 100%; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3); font: inherit; color: var(--dsw-alias-label-primary); line-height: 1.5; resize: vertical; }
.imqq-pairTextarea:focus-visible { outline: 2px solid var(--dsw-focus-ring-color); outline-offset: 2px; }
.imqq-pairModal { width: min(560px, calc(100vw - 32px)); max-height: 100%; overflow: auto; }
.imqq-pairManual { display: grid; gap: 10px; padding: 8px 0; }
.imqq-pairResults { display: grid; gap: 10px; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l2); }
.imqq-pairResultList { list-style: none; margin: 0; padding: 0; max-height: 240px; overflow-y: auto; }
.imqq-pairResult { display: grid; gap: 4px; padding: 10px 0; }
.imqq-pairResult + .imqq-pairResult { border-top: 1px solid var(--dsw-alias-border-l2); }
.imqq-pairResultTitle, .imqq-pairFooter { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.imqq-pairResultState { display: inline-flex; flex: none; align-items: center; gap: 4px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.imqq-pairFooter { flex-wrap: wrap; }
.imqq-pairCodeCard { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 12px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); }
.imqq-pairCodeMain, .imqq-pairCodeActions { display: flex; align-items: center; gap: 8px; }
.imqq-pairCodeValue { font-size: 24px; letter-spacing: 4px; font-weight: 600; }
.imqq-pairCodeMeta { font-size: 12px; color: var(--dsw-alias-label-secondary); }
@container (max-width: 480px) {
  .imqq-pairHeader { flex-direction: column; align-items: stretch; gap: 8px; }
  .imqq-pairToolbar { margin-left: 0; }
  .imqq-pairMember { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .imqq-pairMemberActions, .imqq-pairMemberEdit { justify-content: flex-end; margin-left: auto; }
}
`;
					document.head.appendChild(style);
				}
				style.dataset.users = String(Number(style.dataset.users ?? 0) + 1);
				return () => {
					const remaining = Number(style.dataset.users) - 1;
					if (remaining === 0) style.remove();
					else style.dataset.users = String(remaining);
				};
			}, []);
		}
		//#endregion
		//#region src/shared/pairing-protocol.ts
		/**
		* 配对码认领协议 —— Web 与 QQ 两端共享的契约。
		*
		* 背景：官方 QQ 机器人 API 只给 openid（AppID 维度、匿名、群/私两套），用户看不到也拿不到。
		* Web 生成限时配对码，允许多人或多群连续认领同一用途的白名单：
		*   Web 生成码 → 用户在 QQ 直接发送该码 → 机器人把该消息的 openid 记为目标身份。
		*
		* 本模块只含类型 + 常量 + 纯函数（码生成/校验格式），零 node 依赖，
		* 客户端 bundle 会内联。运行期状态（谁生成了哪个码、TTL、是否已用）由配对服务持有。
		*/
		/** Web 生成配对码 */
		const PAIR_ISSUE_PATH = "/qqbot/im-qqbot/pair/issue";
		/** Web 关闭添加窗口或替换配对码时停止该批次。 */
		const PAIR_END_PATH = "/qqbot/im-qqbot/pair/end";
		/** Web 查询认领状态（进行中的码 + 已认领成员） */
		const PAIR_STATUS_PATH = "/qqbot/im-qqbot/pair/status";
		/** Web 撤销/移除一个已认领成员 */
		const PAIR_REVOKE_PATH = "/qqbot/im-qqbot/pair/revoke";
		/** Web 手动按 openID 直接添加成员（用户自行输入 openid） */
		const PAIR_MANUAL_PATH = "/qqbot/im-qqbot/pair/manual";
		/** Web 修改成员昵称 */
		const PAIR_RENAME_PATH = "/qqbot/im-qqbot/pair/rename";
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
		/** 配对状态轮询间隔（进行中的码需要实时反映"已认领"）。 */
		const POLL_MS = 2e3;
		function usePairStatus(active) {
			const [status, setStatus] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [tick, setTick] = (0, react.useState)(0);
			const reload = (0, react.useCallback)(() => setTick((n) => n + 1), []);
			(0, react.useEffect)(() => {
				if (!active) return;
				let stopped = false;
				const load = () => {
					fetchJson(PAIR_STATUS_PATH, { cache: "no-store" }).then((s) => {
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
				const timer = setInterval(load, POLL_MS);
				return () => {
					stopped = true;
					clearInterval(timer);
				};
			}, [active, tick]);
			return {
				status,
				error,
				reload
			};
		}
		/** 单个用途的认领面板：生成码 / 展示进行中的码 / 已认领成员列表（可撤销）。 */
		function PairClaimPanel({ purpose, title, description, hint, enabled = true, onChange }) {
			usePairingStyles();
			const { status, error, reload } = usePairStatus(enabled);
			const members = status === null ? [] : purpose === "owner" ? status.owners : purpose === "allow-group" ? status.allowGroup : status.allowC2c;
			const [code, setCode] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [msg, setMsg] = (0, react.useState)(null);
			const [manualOpenid, setManualOpenid] = (0, react.useState)("");
			const [addOpen, setAddOpen] = (0, react.useState)(false);
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
			if (!enabled) return (0, react.createElement)("div", { className: "imqq-pair" }, (0, react.createElement)("div", { className: "imqq-pairHeader" }, (0, react.createElement)("div", { className: "imqq-pairTitle" }, (0, react.createElement)("strong", null, title))), (0, react.createElement)("p", { className: "imqq-pairHint" }, "先完成 QQ 机器人绑定，才能配置认领。"));
			const issue = () => {
				if (busy) return;
				setBusy(true);
				setMsg(null);
				fetchJson(PAIR_ISSUE_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						purpose,
						previousCode: code?.code
					})
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
				fetchJson(PAIR_REVOKE_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						purpose,
						openid
					})
				}).then(() => {
					reload();
					onChange?.();
				}).catch((c) => setMsg(c instanceof Error ? c.message : "移除失败")).finally(() => setBusy(false));
			};
			const saveRename = (openid, nickname) => {
				if (busy) return;
				setBusy(true);
				setMsg(null);
				fetchJson(PAIR_RENAME_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						openid,
						nickname
					})
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
				fetchJson(PAIR_MANUAL_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						purpose,
						openid: manualOpenid
					})
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
				fetchJson(PAIR_END_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						purpose,
						code: code.code
					})
				}).then(() => {
					setAddOpen(false);
					setCode(null);
					codeSeen.current = false;
					reload();
					onChange?.();
				}).catch((error) => setMsg(error instanceof Error ? error.message : "结束配对失败，请重试")).finally(() => setBusy(false));
			};
			return (0, react.createElement)("div", { className: "imqq-pair" }, (0, react.createElement)("div", { className: "imqq-pairHeader" }, (0, react.createElement)("div", { className: "imqq-pairTitle" }, (0, react.createElement)("strong", null, title), status ? (0, react.createElement)("span", { className: "imqq-pairCount" }, `(${members.length})`) : null), (0, react.createElement)("div", { className: "imqq-pairToolbar" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
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
			}, "导出 CSV"))), description ? (0, react.createElement)("p", { className: "imqq-pairHint" }, description) : null, hint ? (0, react.createElement)("p", { className: "imqq-pairHint" }, hint) : null, msg ? (0, react.createElement)("p", {
				className: "imqq-pairHint",
				role: "status"
			}, msg) : null, error ? (0, react.createElement)("p", {
				className: "imqq-pairError",
				role: "alert"
			}, error) : null, members.length === 0 ? (0, react.createElement)("p", { className: "imqq-pairHint" }, "尚未添加任何成员。") : (0, react.createElement)("ul", { className: "imqq-pairMembers" }, ...members.map((m) => {
				const isEditing = editing?.openid === m.openid;
				return (0, react.createElement)("li", {
					className: "imqq-pairMember",
					key: `${m.openid}:${m.scene}`
				}, (0, react.createElement)("div", { className: "imqq-pairMemberMain" }, (0, react.createElement)("span", { className: "imqq-pairMemberName" }, m.nickname || "（未命名）"), purpose === "owner" ? (0, react.createElement)("span", { className: "imqq-pairMemberMeta" }, m.scene === "group" ? `群成员${m.sceneName ? ` · ${m.sceneName}` : ""}` : "私聊用户") : null, (0, react.createElement)("div", { className: "imqq-pairIdentity" }, (0, react.createElement)("code", { className: "imqq-pairMemberOpenId" }, m.openid), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					className: "imqq-pairCopy",
					disabled: busy,
					"aria-label": `复制 ${m.nickname || m.openid} 的 OpenID`,
					title: "复制 OpenID",
					onClick: () => {
						copyOpenIds(m.openid);
					}
				}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconCopyOutlineRegular, { size: 14 })))), isEditing ? (0, react.createElement)("div", { className: "imqq-pairMemberEdit" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
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
				}, "取消")) : (0, react.createElement)("div", { className: "imqq-pairMemberActions" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
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
				className: "imqq-pairModal",
				footer: (0, react.createElement)("div", { className: "imqq-pairFooter" }, (0, react.createElement)("span", { className: "imqq-pairHint" }, "完成后配对码失效，已添加的成员保留。"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "primary",
					size: "sm",
					disabled: busy,
					onClick: finish
				}, "完成")),
				children: (0, react.createElement)("div", { className: "imqq-pairDialog" }, (0, react.createElement)("p", { className: "imqq-pairHint" }, purpose === "allow-group" ? "在需要添加的群里 @机器人后发送此码，有效期内可连续添加多个群。" : "让需要添加的用户在私聊里发送此码，有效期内可连续添加多人。"), code ? (0, react.createElement)("div", { className: "imqq-pairCodeCard" }, (0, react.createElement)("div", { className: "imqq-pairCodeMain" }, (0, react.createElement)("code", { className: "imqq-pairCodeValue" }, code.code), (0, react.createElement)("span", { className: "imqq-pairCodeMeta" }, codeEnded || secs === 0 ? "已结束，请重新生成" : `剩余 ${Math.floor(secs / 60).toString().padStart(2, "0")}:${(secs % 60).toString().padStart(2, "0")}`)), (0, react.createElement)("div", { className: "imqq-pairCodeActions" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
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
				}, (0, react.createElement)("div", { className: "imqq-pairManual" }, (0, react.createElement)("p", { className: "imqq-pairHint" }, "用户 OpenID 不是 QQ 号，群 OpenID 也不是群号，不能直接填写 QQ 号或群号。请使用当前机器人对应的 OpenID；没有 OpenID 时，请使用上方配对码添加。"), (0, react.createElement)("p", { className: "imqq-pairHint" }, "每行一个 OpenID 或 OpenID:昵称。简单条目也可用逗号分隔；昵称含逗号时用双引号包住。"), (0, react.createElement)("pre", { className: "imqq-pairExample" }, "ABCD1234EFGH:小明\nWXYZ5678:Alice Zhang"), (0, react.createElement)("textarea", {
					className: "imqq-pairTextarea",
					rows: 4,
					value: manualOpenid,
					disabled: busy,
					"aria-label": `${title} openID 列表`,
					placeholder: "OpenID 或 OpenID:昵称，每行一个；不能填写 QQ 号或群号",
					onChange: (e) => setManualOpenid(e.currentTarget.value)
				}), (0, react.createElement)("div", { className: "imqq-pairToolbar" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					disabled: busy || manualOpenid.trim() === "",
					onClick: () => {
						addManual();
					}
				}, "添加"), (0, react.createElement)("span", { className: "imqq-pairHint" }, "添加后可继续填写，配对码保持有效。")))), (0, react.createElement)("section", {
					className: "imqq-pairResults",
					"aria-label": "本次添加结果"
				}, (0, react.createElement)("h4", { className: "imqq-pairSectionTitle" }, `本次添加结果（${results.filter((result) => result.state === "added").length} 项新增）`), results.length === 0 ? (0, react.createElement)("p", { className: "imqq-pairHint" }, "等待认领，成功结果会显示在这里。") : null, (0, react.createElement)("ul", {
					className: "imqq-pairResultList",
					"aria-live": "polite"
				}, ...results.map((result) => (0, react.createElement)("li", {
					className: "imqq-pairResult",
					key: `${result.scene}:${result.openid}`
				}, (0, react.createElement)("div", { className: "imqq-pairResultTitle" }, (0, react.createElement)("span", { className: "imqq-pairMemberName" }, result.nickname || (result.scene === "group" ? "未命名群聊" : "未命名用户")), (0, react.createElement)("span", { className: "imqq-pairResultState" }, result.state !== "revoked" ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, { size: 14 }) : null, result.state === "added" ? "已添加" : result.state === "existing" ? "已在名单中" : "已移除")), (0, react.createElement)("div", { className: "imqq-pairIdentity" }, (0, react.createElement)("code", { className: "imqq-pairMemberOpenId" }, result.openid), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "ghost",
					size: "sm",
					className: "imqq-pairCopy",
					"aria-label": `复制 ${result.nickname || result.openid} 的 OpenID`,
					onClick: () => {
						copyOpenIds(result.openid);
					}
				}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconCopyOutlineRegular, { size: 14 }))))))), msg ? (0, react.createElement)("p", {
					className: "imqq-pairHint",
					role: "status"
				}, msg) : null, error ? (0, react.createElement)("p", {
					className: "imqq-pairError",
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
		/** 样式注入标记（幂等） */
		const STYLE_ID = "im-qqbot-config-panel-styles";
		/** QQ settings layout; control appearance belongs to the public host primitives. */
		function useConfigPanelStyles() {
			(0, react.useEffect)(() => {
				if (typeof document === "undefined") return;
				const existing = document.getElementById(STYLE_ID);
				const retain = (element) => {
					element.dataset.users = String(Number(element.dataset.users ?? 0) + 1);
					return () => {
						const users = Number(element.dataset.users ?? 1) - 1;
						if (users === 0) element.remove();
						else element.dataset.users = String(users);
					};
				};
				if (existing !== null) return retain(existing);
				const style = document.createElement("style");
				style.id = STYLE_ID;
				style.textContent = `
.imqb2-form { display: flex; flex-direction: column; width: 100%; min-width: 0; color: var(--dsw-alias-label-primary); }
.imqb2-fields { border: 0; padding: 0; margin: 0; min-width: 0; }
.imqb2-group-title {
  padding: 14px 0 2px; font-size: 12px; font-weight: 600; line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.imqb2-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.imqb2-field + .imqb2-field { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.imqb2-head { display: flex; align-items: center; gap: 8px; min-height: 28px; }
.imqb2-label {
  flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.imqb2-help { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.imqb2-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.imqb2-textarea { box-sizing: border-box; width: 100%; min-height: 68px; padding: 8px 12px; resize: vertical; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3); font: inherit; color: var(--dsw-alias-label-primary); line-height: 1.5; }
.imqb2-textarea:focus-visible { outline: 2px solid var(--dsw-alias-label-secondary); outline-offset: 2px; }
.imqb2-select { box-sizing: border-box; width: 100%; min-height: 34px; padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3); font: inherit; color: var(--dsw-alias-label-primary); line-height: 1.5; cursor: pointer; }
.imqb2-select:focus-visible { outline: 2px solid var(--dsw-alias-label-secondary); outline-offset: 2px; }
/* Preserve the QQ settings draft and readback feedback in the sticky footer. */
.imqb2-footer {
  position: sticky; bottom: 0; z-index: 1; display: flex; align-items: center;
  flex-wrap: wrap; gap: 8px; margin-top: 16px; padding: 12px 0;
  border-top: 0.5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1);
}
.imqb2-footer-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.imqb2-feedback { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
.imqb2-feedback p { flex: 1; min-width: 0; }
.imqb2-form .imqc-inline { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.imqb2-form .imqc-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.imqb2-form .imqc-error { color: var(--dsw-alias-state-error-primary); }
.imqb2-form .imqc-cmdList { margin: 12px 0; }
.imqb2-form .imqc-cmdContent { padding: 4px 0 4px 22px; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.imqb2-form .imqc-cmdGroup + .imqc-cmdGroup { margin-top: 16px; }
.imqb2-form .imqc-cmdGroup > strong { font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.imqb2-form .imqc-cmdRow { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; margin-top: 8px; overflow-wrap: anywhere; }
.imqb2-form .imqc-cmdRow code { padding: 1px 6px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-size: 12px; }
.imqb2-details { margin-top: 12px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.imqb2-summary { padding: 16px 0; font-size: 13px; font-weight: 500; cursor: pointer; }
.imqb2-summary::marker { color: var(--dsw-alias-label-tertiary); }
.imqb2-summary:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color); outline-offset: 2px; border-radius: var(--dsw-radius-sm); }
.imqb2-directory-feedback { display: flex; align-items: flex-start; gap: 8px; }
.imqb2-directory-feedback p { flex: 1; min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 480px) {
  .imqb2-head:has([role=tablist]) { align-items: stretch; flex-direction: column; }
  .imqb2-selector-head { align-items: stretch; flex-direction: column; }
  .imqb2-note { flex-basis: 100%; }
}
.imqb2-note { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.imqb2-note--error { color: var(--dsw-alias-state-error-primary); }
.imqb2-note--ok { color: var(--dsw-alias-label-secondary); }
/* cwd 只读行 */
.imqb2-readonly { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--dsw-alias-label-secondary); word-break: break-all; margin: 0; }
    `;
				document.head.appendChild(style);
				return retain(style);
			}, []);
		}
		/** 访问模式分段选择行 */
		function SegmentedRow({ label, help, value, options, onChange, disabled = false }) {
			return (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("div", { className: "imqb2-head" }, (0, react.createElement)("span", { className: "imqb2-label" }, label), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.SegmentedControl, {
				id: `imqq-access-${label}`,
				value,
				options,
				onChange,
				label,
				disabled
			})), help === void 0 ? null : (0, react.createElement)("p", { className: "imqb2-hint" }, help));
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
		/** 会话忙时新消息的处理方式（默认值由 ConfigSchema 与表单共同兜底为 queue） */
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
					const { config } = await fetchJson(BIND_CONFIG_PATH, {
						cache: "no-store",
						signal
					}, Math.min(1e3, remaining));
					if (matchesSavedConfig(config, expected)) return config;
				} catch (_error) {}
				if (!signal.aborted) await waitForReadback(signal, Math.min(400, Math.max(0, deadline - Date.now())));
			}
		}
		/** Settings editor with recoverable requests and a draft protected from binding refreshes. */
		function ConfigPanel({ bindPhase } = {}) {
			useConfigPanelStyles();
			const [commands, setCommands] = (0, react.useState)([]);
			const [commandsError, setCommandsError] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				if (bindPhase !== "bound") return;
				fetchJson(COMMANDS_PATH, { signal: controller.signal }).then((result) => {
					setCommands(result.commands);
					setCommandsError(null);
				}).catch((error) => {
					if (!controller.signal.aborted) setCommandsError(error instanceof Error ? error.message : String(error));
				});
				return () => controller.abort();
			}, [bindPhase]);
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
				setLoading(true);
				setLoadError(null);
				fetchJson(BIND_CONFIG_PATH, {
					cache: "no-store",
					signal: controller.signal
				}).then(({ config }) => {
					if (stopped || saveController.current !== null) return;
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
					if (!stopped) setLoading(false);
				});
				return () => {
					stopped = true;
					controller.abort();
				};
			}, [
				bindPhase,
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
				fetchJson(BIND_CONFIG_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...changed,
						...changed.access === void 0 ? {} : { accessRevision: current.baseline.accessRevision }
					}),
					signal: controller.signal
				}).then(async (body) => {
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
						message: error instanceof HttpError && error.status === 409 ? `${error.message}草稿已保留，请先刷新配置。` : `保存结果未确认：${error instanceof Error ? error.message : String(error)}。草稿已保留，可重试或刷新配置核对。`
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
				className: "imqb2-feedback",
				role: "alert"
			}, (0, react.createElement)("p", { className: "imqb2-note imqb2-note--error" }, `配置加载失败：${loadError}`), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "ghost",
				size: "sm",
				onClick: retry,
				disabled: loading || busy
			}, loading ? "重试中…" : "重试"));
			if (draft === null) return (0, react.createElement)("div", { "aria-busy": loading }, loadFeedback, loading ? (0, react.createElement)("p", {
				className: "imqb2-hint",
				role: "status",
				style: { padding: "12px 0" }
			}, "正在加载配置…") : null);
			const { baseline, form } = draft;
			const dirty = isConfigDirty(baseline, form);
			const access = form.access ?? DEFAULT_ACCESS;
			const message = busy ? "正在保存配置…" : result?.message ?? (dirty ? draftNotice ?? "有未保存修改。保存会重载插件，并中断正在运行的 QQ 任务。" : "没有未保存的修改。");
			return (0, react.createElement)("form", {
				className: "imqb2-form",
				onSubmit: submit,
				"aria-busy": busy
			}, loadFeedback, (0, react.createElement)("fieldset", {
				className: "imqb2-fields",
				disabled: busy
			}, (0, react.createElement)("div", { className: "imqb2-group-title" }, "服务范围"), (0, react.createElement)(SegmentedRow, {
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
				className: "imqc-error",
				role: "alert"
			}, `命令清单加载失败：${commandsError}`) : null, (0, react.createElement)(SlashCommandList, { commands }), (0, react.createElement)("div", { className: "imqb2-group-title" }, "基础设置"), (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("label", {
				className: "imqb2-label",
				htmlFor: "imqq-messageHandlingMode"
			}, "消息处理方式"), (0, react.createElement)("select", {
				id: "imqq-messageHandlingMode",
				className: "imqb2-select",
				value: form.messageHandlingMode ?? "queue",
				onChange: (event) => patch("messageHandlingMode", event.target.value)
			}, MESSAGE_HANDLING_OPTIONS.map(({ value, label }) => (0, react.createElement)("option", {
				key: value,
				value
			}, label))), (0, react.createElement)("p", { className: "imqb2-hint" }, "排队：当前任务结束后再处理新消息（默认）；插话：新消息立即补充到当前任务。")), ...[
				["requireMention", "群聊仅回复 @机器人的消息"],
				["streaming", "流式输出"],
				["showToolResults", "显示工具调用结果"]
			].map(([key, label]) => (0, react.createElement)("div", {
				className: "imqb2-field",
				key
			}, (0, react.createElement)("div", { className: "imqb2-head" }, (0, react.createElement)("span", { className: "imqb2-label" }, label), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
				label,
				checked: form[key] ?? key !== "showToolResults",
				onChange: (value) => patch(key, value)
			})))), (0, react.createElement)("div", { className: "imqb2-group-title" }, "模型与提示词"), ...[
				["provider", "模型提供方"],
				["model", "模型"],
				["preset", "Agent 预设"]
			].map(([key, label]) => (0, react.createElement)("div", {
				className: "imqb2-field",
				key
			}, (0, react.createElement)("label", {
				className: "imqb2-label",
				htmlFor: `imqq-${key}`
			}, label), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				id: `imqq-${key}`,
				value: form[key] ?? "",
				placeholder: "留空继承 DSH 默认",
				onChange: (event) => patch(key, event.target.value)
			}))), ...[["groupPrompt", "群聊补充提示词"], ["directPrompt", "私聊补充提示词"]].map(([key, label]) => (0, react.createElement)("div", {
				className: "imqb2-field",
				key
			}, (0, react.createElement)("label", {
				className: "imqb2-label",
				htmlFor: `imqq-${key}`
			}, label), (0, react.createElement)("textarea", {
				id: `imqq-${key}`,
				className: "imqb2-textarea",
				value: form[key] ?? "",
				rows: 3,
				onChange: (event) => patch(key, event.target.value)
			}))), form.cwd === void 0 ? null : (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("span", { className: "imqb2-label" }, "Agent 工作目录（只读）"), (0, react.createElement)("p", { className: "imqb2-readonly" }, form.cwd))), (0, react.createElement)("div", { className: "imqb2-footer" }, (0, react.createElement)("p", {
				className: `imqb2-note${result === null ? "" : result.kind === "failed" ? " imqb2-note--error" : " imqb2-note--ok"}`,
				role: result?.kind === "failed" ? "alert" : "status",
				"aria-live": "polite"
			}, message), (0, react.createElement)("div", { className: "imqb2-footer-actions" }, pendingConfirmation.current !== null || result?.kind === "failed" ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
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
		//#region src/client/index.ts
		const name = "im-qqbot-client";
		const inject = [
			"slots",
			"sidebarRight",
			"sidebarRightTabs"
		];
		/** 侧栏 Tab 类型（ui-sidebar-right 契约的局部投影） */
		const TAB_KIND = "qqbot-bind";
		/** 席位注册 key（Tab 类型 id，席位按其分发；只需全局唯一，与包名解耦） */
		const TAB_ID = "im-qqbot/bind";
		/** 本插件包名（插件详情页按其匹配来源包，只在对应详情页渲染操作按钮） */
		const PACKAGE_NAME = "@tencent-connect/dsh-qqbot";
		/** 主面板 id（layout.selectPanel 导航目标；keyed main 席位按其分发） */
		const IM_MAIN_PANEL_ID = "im-qqbot";
		/** 绑定入口图标（QQ 机器人，跟随主题图标色变量） */
		function BindGuideIcon() {
			return (0, react.createElement)("svg", {
				width: 24,
				height: 24,
				viewBox: "0 0 24 24",
				fill: "none",
				"aria-hidden": true
			}, (0, react.createElement)("path", {
				d: "M9.50039 11.1504C9.96983 11.1504 10.3504 11.5309 10.3504 12.0004V14.0004C10.3504 14.4698 9.96983 14.8504 9.50039 14.8504C9.03095 14.8504 8.65039 14.4698 8.65039 14.0004V12.0004C8.65039 11.5309 9.03095 11.1504 9.50039 11.1504Z",
				fill: "var(------icon_primary, #1A1A1A)"
			}), (0, react.createElement)("path", {
				d: "M14.5004 11.1504C14.9698 11.1504 15.3504 11.5309 15.3504 12.0004V14.0004C15.3504 14.4698 14.9698 14.8504 14.5004 14.8504C14.0309 14.8504 13.6504 14.4698 13.6504 14.0004V12.0004C13.6504 11.5309 14.0309 11.1504 14.5004 11.1504Z",
				fill: "var(------icon_primary, #1A1A1A)"
			}), (0, react.createElement)("path", {
				fillRule: "evenodd",
				clipRule: "evenodd",
				d: "M12.8504 5.3109C13.5299 4.99138 14.0004 4.30063 14.0004 3.5C14.0004 2.39543 13.1049 1.5 12.0004 1.5C10.8958 1.5 10.0004 2.39543 10.0004 3.5C10.0004 4.30065 10.4708 4.99141 11.1504 5.31092V6.18851C6.38487 6.61795 2.65039 10.6231 2.65039 15.5004V17.0004C2.65039 19.679 4.82181 21.8504 7.50039 21.8504H16.5004C19.179 21.8504 21.3504 19.679 21.3504 17.0004V15.5004C21.3504 10.6231 17.6159 6.61795 12.8504 6.18851V5.3109ZM12.0004 7.85039C7.77541 7.85039 4.35039 11.2754 4.35039 15.5004V17.0004C4.35039 18.7401 5.76069 20.1504 7.50039 20.1504H16.5004C18.2401 20.1504 19.6504 18.7401 19.6504 17.0004V15.5004C19.6504 11.2754 16.2254 7.85039 12.0004 7.85039Z",
				fill: "var(------icon_primary, #1A1A1A)"
			}));
		}
		/** 设置页栏目：共享一份绑定状态轮询，驱动绑定面板与配置刷新 */
		function QQBotSettingsSection() {
			const { state, gone, recheck } = useBindState();
			return (0, react.createElement)("div", null, (0, react.createElement)(BindPanelBody, {
				state,
				gone,
				recheck
			}), (0, react.createElement)(ConfigPanel, { bindPhase: state?.phase }));
		}
		/** 主面板页面：与设置栏目同一内容，包一层滚动留白容器（plugins.detail.actions 的跳转目标） */
		function QQBotPage() {
			return (0, react.createElement)("div", { className: "imqb-pluginPage" }, (0, react.createElement)("div", { className: "imqb-pluginPageContent" }, (0, react.createElement)(QQBotSettingsSection)));
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
		/** 插件详情「设置」按钮：仅在本包的 bundle / 组件行详情页渲染，其他插件不显示 */
		function OpenQqBotAction({ subject, packageName, onOpen }) {
			if (subject?.kind !== "bundle" && subject?.kind !== "row") return null;
			if (subject.pkg?.name !== packageName) return null;
			if (subject.kind === "row" && subject.row?.moduleName !== packageName) return null;
			return (0, react.createElement)("button", {
				type: "button",
				className: "imqb-pluginOpen",
				onClick: onOpen
			}, "设置");
		}
		function apply(ctx) {
			installPanelStyles();
			const tabs = ctx.sidebarRightTabs;
			const right = ctx.sidebarRight;
			const slots = ctx.slots;
			const disposers = [];
			if (slots !== void 0) disposers.push(slots.inject("settings.section", () => slots.register({
				name: "settings.section",
				id: "qqbot",
				order: 7,
				label: "QQ 机器人"
			}, QQBotSettingsSection)));
			if (tabs !== void 0 && slots !== void 0) {
				disposers.push(tabs.register({
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
				disposers.push(slots.inject("sidebar.right.pane.tab", () => slots.register({
					name: "sidebar.right.pane.tab",
					key: TAB_ID
				}, BindPanelBody)));
				disposers.push(watchAndPrompt(right));
			}
			const ctxInject = ctx.inject;
			if (typeof ctxInject === "function") ctxInject.call(ctx, ["layout"], (pageCtx) => {
				const pageSlots = pageCtx.slots;
				const layout = pageCtx.layout;
				if (pageSlots === void 0 || layout === void 0) return void 0;
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
			ctx.effect(() => () => {
				for (const dispose of disposers.reverse()) dispose();
			}, "im-qqbot-client.binding");
		}
		/**
		* 轮询绑定状态：待绑定时自动打开绑定页。
		*
		* - 页面隐藏时降频轮询（可见时立即恢复节拍）
		* - 404（已绑定/未安装）时退避到 30s，保持低成本常驻探测
		* - 每次页面加载至多打开一次（用户手动关闭后不打扰）；
		*   打开失败（如启动早期 Session surface 尚未挂载）不消费机会，
		*   由下一轮轮询（3s）自动重试
		*/
		function watchAndPrompt(right) {
			let stopped = false;
			let opened = right === void 0;
			let timer;
			const schedule = (ms) => {
				timer = setTimeout(() => {
					tick();
				}, ms);
			};
			const tick = async () => {
				if (stopped) return;
				if (typeof document !== "undefined" && document.visibilityState === "hidden") {
					schedule(5e3);
					return;
				}
				try {
					const res = await fetch(BIND_STATE_PATH, { cache: "no-store" });
					if (res.ok) {
						if ((await res.json()).phase === "waiting" && !opened && right !== void 0) try {
							right.openTab(TAB_KIND);
							opened = true;
						} catch (err) {
							console.error("[im-qqbot] 打开绑定页失败，稍后重试", err);
						}
						schedule(3e3);
						return;
					}
					schedule(3e4);
					return;
				} catch {}
				schedule(1e4);
			};
			tick();
			return () => {
				stopped = true;
				if (timer !== void 0) clearTimeout(timer);
			};
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map