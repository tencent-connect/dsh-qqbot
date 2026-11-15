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
		* 机器人工作台复用扫码、新增和更换凭据的视图。
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
.imqb-form { display: flex; flex-direction: column; gap: 12px; width: min(320px, 100%); box-sizing: border-box; }
.imqb-credentialsModal { width: min(440px, 100%); max-height: 100%; overflow-y: auto; }
.imqb-form--credentials { width: 100%; gap: 16px; }
.imqb-form--credentials .imqb-field { gap: 6px; line-height: 1.5; }
.imqb-form--credentials .imqb-field > span { box-sizing: border-box; }
.imqb-field { display: flex; flex-direction: column; gap: 5px; text-align: left; font-size: 13px; }
.imqb-answer { display: grid; gap: 12px; min-width: 0; }
.imqb-answer dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 16px; margin: 0; }
.imqb-answer :is(dt, small) { color: var(--dsw-alias-label-secondary); }
.imqb-answer dd { margin: 0; overflow-wrap: anywhere; }
.imqb-answer dd small { display: block; }
.imqb-answer-text { max-height: min(42vh, 320px); overflow: auto; padding: 12px; border: 1px solid var(--dsw-alias-border-1); border-radius: 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
.imqb-answer p { margin: 0; }
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
		function useBindState(enabled) {
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
		function ManualForm({ initialAppId, fixedAppId = false, recheck, onCancel, save = submitManualCredentials }) {
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
				save(trimmedId, trimmedSecret).then((outcome) => {
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
				recheck,
				save
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
			}, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-icon" }, "✅"), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, result.message ?? "凭据已保存"), save === submitManualCredentials ? (0, react.createElement)("p", { className: "imqb-status-sub" }, "插件将自动重载，连接结果可在左侧 QQ 导航底部查看") : null), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
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
				readOnly: fixedAppId,
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
		function BoundView({ appId, recheck, actions }) {
			const [editing, setEditing] = (0, react.useState)(false);
			return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-account" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)(QqBotIcon, { size: 28 }), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, "凭据已保存"), (0, react.createElement)("p", { className: "imqb-status-sub imqb-mono" }, `AppID ${appId}`))), (0, react.createElement)("div", { className: "imqb-status-actions" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				variant: "outline",
				size: "sm",
				disabled: actions.disabled,
				onClick: () => {
					setEditing(true);
				}
			}, "更换凭据"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				variant: "outline",
				size: "sm",
				className: "imqb-danger",
				disabled: actions.disabled,
				onClick: actions.unbind
			}, "解绑"))), editing ? (0, react.createElement)(ManualForm, {
				initialAppId: appId,
				fixedAppId: true,
				recheck,
				save: actions.replace,
				onCancel: () => setEditing(false)
			}) : null);
		}
		/** 未绑定视图：扫码 / 手动填写切换 */
		function UnboundView({ state, recheck, actions }) {
			const [manual, setManual] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const refresh = (0, react.useCallback)(() => {
				if (busy) return;
				if (actions) {
					actions.refresh();
					return;
				}
				setBusy(true);
				setError(null);
				fetchJson(BIND_REFRESH_PATH, { method: "POST" }).then(() => {
					recheck();
				}).catch((cause) => {
					setError(cause instanceof Error ? cause.message : "刷新失败，请重试");
				}).finally(() => {
					setBusy(false);
				});
			}, [
				actions,
				busy,
				recheck
			]);
			return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("p", { className: "imqb-title" }, "扫码绑定 QQ 机器人"), state.phase === "waiting" ? [
				state.qrSvg ? (0, react.createElement)("img", {
					key: "qr",
					src: state.qrSvg,
					alt: "QQ 扫码二维码",
					width: 220,
					height: 220,
					className: "imqb-qr"
				}) : null,
				(0, react.createElement)("p", {
					key: "hint",
					className: "imqb-hint"
				}, "使用手机 QQ 扫描二维码完成绑定"),
				(0, react.createElement)("a", {
					key: "link",
					href: state.url,
					target: "_blank",
					rel: "noreferrer noopener",
					className: "imqb-link"
				}, "在浏览器中打开绑定页")
			] : (0, react.createElement)("p", {
				className: state.phase === "failed" ? "imqb-error" : "imqb-hint",
				role: "status"
			}, state.phase === "failed" ? state.reason : "正在获取二维码…"), (0, react.createElement)("div", { className: "imqb-row" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				disabled: busy || state.phase === "starting",
				onClick: refresh
			}, busy ? "正在刷新…" : "刷新二维码"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				"aria-expanded": manual,
				onClick: () => setManual(!manual)
			}, "手动填写")), manual ? (0, react.createElement)(ManualForm, {
				recheck,
				save: actions?.submit
			}) : null, error ? (0, react.createElement)("p", {
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
			const gone = !injected && internal.gone;
			const recheck = injected ? props.recheck ?? (() => {}) : internal.recheck;
			const error = !injected ? internal.error : null;
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
			if ((state === null || state.phase === "starting") && !props.actions) return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("p", {
				className: error ? "imqb-error" : "imqb-hint",
				role: "status"
			}, error ?? "正在获取绑定状态…"), error ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				onClick: recheck
			}, "重试读取绑定状态") : null);
			if (state?.phase === "saving") {
				if (lastQr !== null) return (0, react.createElement)("div", { className: "imqb-panel" }, (0, react.createElement)("div", { className: "imqb-scanned" }, (0, react.createElement)("img", {
					src: lastQr,
					alt: "QQ 扫码二维码",
					width: 220,
					height: 220,
					className: "imqb-scanned-qr"
				}), (0, react.createElement)("div", { className: "imqb-scanned-veil" }, (0, react.createElement)("p", { className: "imqb-scanned-title" }, "✅ 扫码成功"), (0, react.createElement)("p", { className: "imqb-scanned-sub" }, "正在保存凭据…"))));
				return (0, react.createElement)("div", { className: "imqb-status" }, (0, react.createElement)("div", { className: "imqb-status-row" }, (0, react.createElement)("div", { className: "imqb-status-icon" }, "🎉"), (0, react.createElement)("div", { className: "imqb-status-meta" }, (0, react.createElement)("p", { className: "imqb-status-title" }, "扫码成功"), (0, react.createElement)("p", { className: "imqb-status-sub" }, "凭据已保存，正在重新加载连接"))));
			}
			if (state?.phase === "failed" && !props.actions) return (0, react.createElement)(FailedView, {
				reason: state.reason,
				recheck
			});
			if (state?.phase === "bound") return props.boundActions ? (0, react.createElement)(BoundView, {
				key: state.appId,
				appId: state.appId,
				recheck,
				actions: props.boundActions
			}) : (0, react.createElement)("p", {
				className: "imqb-hint",
				role: "status"
			}, "凭据已保存，正在读取机器人…");
			return (0, react.createElement)(UnboundView, {
				state: state ?? { phase: "starting" },
				recheck,
				actions: props.actions
			});
		}
		//#endregion
		//#region src/shared/workbench-conversation-protocol.ts
		const WORKBENCH_CONVERSATIONS_PATH = "/api/qqbot/workbench/conversations";
		const WORKBENCH_NEW_SESSION_PATH = "/api/qqbot/workbench/conversations/new-session";
		//#endregion
		//#region src/shared/workbench-protocol.ts
		const WORKBENCH_ROBOTS_PATH = "/api/qqbot/workbench/robots";
		const WORKBENCH_ROBOT_REMOVE_PATH = "/api/qqbot/workbench/robots/remove";
		const WORKBENCH_ROBOT_BIND_PATH = "/api/qqbot/workbench/robots/bind";
		const WORKBENCH_GROUP_GUIDE_IMAGES = {
			"message-scope.png": "/api/qqbot/workbench/group-permissions/message-scope.png",
			"proactive.png": "/api/qqbot/workbench/group-permissions/proactive.png"
		};
		//#endregion
		//#region src/client/config-form-state.ts
		const EDITABLE_KEYS = [
			"alias",
			"access",
			"requireMention"
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
			const value = { ...form };
			if (value.alias !== void 0) value.alias = value.alias.trim();
			if (value.access === void 0) return value;
			const lines = (values) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
			return {
				...value,
				access: {
					...value.access,
					c2cAllow: lines(value.access.c2cAllow),
					groupAllow: lines(value.access.groupAllow)
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
				if (source.robotRevision !== void 0) value.robotRevision = source.robotRevision;
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
					"alias",
					"accessRevision"
				]) if (fields[key] !== void 0 && typeof fields[key] !== "string") return false;
				if (fields.robotRevision !== void 0 && (!Number.isSafeInteger(fields.robotRevision) || Number(fields.robotRevision) < 0)) return false;
				if (fields.requireMention !== void 0 && typeof fields.requireMention !== "boolean") return false;
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
			return (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
				className: "imqc-cmdList",
				icon: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular),
				title: `支持的斜杠命令（${commands.length} 个）`,
				open,
				expandable: true,
				expandOnRowClick: true,
				previewChevron: false,
				onToggle: toggle
			}, (0, react.createElement)("div", { className: "imqc-cmdContent" }, commands.length === 0 ? (0, react.createElement)("p", { className: "imqc-hint" }, "暂无可用命令。") : null, ...["agent", "qqbot"].map((category) => {
				const items = commands.filter((command) => command.category === category);
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
		function usePairStatus(active, path) {
			const [status, setStatus] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [tick, setTick] = (0, react.useState)(0);
			const sequence = (0, react.useRef)(0);
			const reload = (0, react.useCallback)(() => setTick((n) => n + 1), []);
			const applyStatus = (snapshot) => {
				sequence.current++;
				setStatus(snapshot);
				setError(null);
			};
			(0, react.useEffect)(() => {
				if (!active) return;
				let stopped = false;
				const load = () => {
					const request = ++sequence.current;
					const current = () => !stopped && request === sequence.current;
					fetchJson(path, { cache: "no-store" }).then((snapshot) => {
						if (!current()) return;
						setStatus(snapshot);
						setError(null);
					}).catch((cause) => {
						if (!current()) return;
						setError(cause instanceof Error ? cause.message : "读取认领状态失败");
					});
				};
				load();
				const timer = setInterval(load, POLL_MS);
				return () => {
					stopped = true;
					clearInterval(timer);
				};
			}, [
				active,
				path,
				tick
			]);
			return {
				status,
				error,
				reload,
				applyStatus
			};
		}
		/** 单个用途的认领面板：生成码 / 展示进行中的码 / 已认领成员列表（可撤销）。 */
		function PairClaimPanel({ purpose, title, description, hint, enabled = true, canPair = true, appId, onChange }) {
			usePairingStyles();
			const endpoint = (path) => appId === void 0 ? path : `${path}?appId=${encodeURIComponent(appId)}`;
			const { status, error, reload, applyStatus } = usePairStatus(enabled, endpoint(PAIR_STATUS_PATH));
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
				if (busy || !canPair) return;
				setBusy(true);
				setMsg(null);
				fetchJson(endpoint(PAIR_ISSUE_PATH), {
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
				fetchJson(endpoint(PAIR_REVOKE_PATH), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						purpose,
						openid
					})
				}).then((snapshot) => {
					applyStatus(snapshot);
					setMsg(`已从${title}移除。`);
					onChange?.();
				}).catch((c) => setMsg(c instanceof Error ? c.message : "移除失败")).finally(() => setBusy(false));
			};
			const saveRename = (openid, nickname) => {
				if (busy) return;
				setBusy(true);
				setMsg(null);
				fetchJson(endpoint(PAIR_RENAME_PATH), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						openid,
						nickname
					})
				}).then((snapshot) => {
					applyStatus(snapshot);
					setEditing(null);
					setMsg("昵称已更新。");
					onChange?.();
				}).catch((c) => setMsg(c instanceof Error ? c.message : "修改失败")).finally(() => setBusy(false));
			};
			const addManual = () => {
				if (busy || !manualOpenid.trim()) return;
				setBusy(true);
				setMsg(null);
				fetchJson(endpoint(PAIR_MANUAL_PATH), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						purpose,
						openid: manualOpenid
					})
				}).then((r) => {
					applyStatus(r);
					setManualOpenid(r.errors.map((error) => error.input).join("\n"));
					setResults((previous) => mergePairResults(previous, r.results));
					setMsg(r.errors.length ? [r.message, ...r.errors.map((error) => `${error.input}：${error.message}`)].join("\n") : r.message);
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
				setManualOpen(!canPair);
				if (canPair) issue();
			};
			const finish = () => {
				if (busy) return;
				if (code === null) {
					setAddOpen(false);
					return;
				}
				setBusy(true);
				setMsg(null);
				fetchJson(endpoint(PAIR_END_PATH), {
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
			}, "导出 CSV"))), description ? (0, react.createElement)("p", { className: "imqq-pairHint" }, description) : null, hint ? (0, react.createElement)("p", { className: "imqq-pairHint" }, hint) : null, (0, react.createElement)("p", { className: "imqq-pairHint" }, "名单修改即时保存。"), msg ? (0, react.createElement)("p", {
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
					disabled: busy || !canPair,
					onClick: issue
				}, busy ? "生成中…" : "重新生成"))) : canPair ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					disabled: busy,
					onClick: issue
				}, busy ? "生成中…" : "生成配对码") : (0, react.createElement)("p", { className: "imqq-pairHint" }, "启用机器人后可生成配对码。"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
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
		/** 主机器人的账号与权限，以及两个账号类型共用的准入设置。 */
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
.imqb2-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
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
@media (max-width: 480px) {
  .imqb2-head:has([role=tablist]) { align-items: stretch; flex-direction: column; }
  .imqb2-note { flex-basis: 100%; }
}
.imqb2-note { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.imqb2-note--error { color: var(--dsw-alias-state-error-primary); }
.imqb2-note--ok { color: var(--dsw-alias-label-secondary); }
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
		function AccessSettings({ access, busy, bound = true, enabled = true, appId, onMode, onMembershipChange }) {
			useConfigPanelStyles();
			const [commands, setCommands] = (0, react.useState)([]);
			const [commandsError, setCommandsError] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				if (!bound || !enabled) return;
				fetchJson(appId === void 0 ? COMMANDS_PATH : `${COMMANDS_PATH}?appId=${encodeURIComponent(appId)}`, { signal: controller.signal }).then((result) => {
					if (!controller.signal.aborted) {
						setCommands(result.commands);
						setCommandsError(null);
					}
				}).catch((error) => {
					if (!controller.signal.aborted) setCommandsError(error instanceof Error ? error.message : String(error));
				});
				return () => controller.abort();
			}, [
				appId,
				bound,
				enabled,
				access.commandMode
			]);
			return (0, react.createElement)("div", { className: "imqb2-form" }, (0, react.createElement)("div", { className: "imqb2-group-title" }, "服务范围"), (0, react.createElement)(SegmentedRow, {
				disabled: busy,
				label: "私聊",
				value: access.c2cMode,
				options: MODE_OPTIONS,
				onChange: (value) => onMode("c2cMode", value)
			}), access.c2cMode === "allowlist" ? (0, react.createElement)(PairClaimPanel, {
				purpose: "allow-c2c",
				title: "私聊白名单",
				enabled: bound,
				canPair: enabled,
				appId,
				onChange: onMembershipChange,
				hint: "生成配对码，让对方在私聊里直接给机器人发送这个码，即加入私聊白名单。"
			}) : null, (0, react.createElement)(SegmentedRow, {
				disabled: busy,
				label: "群聊",
				value: access.groupMode,
				options: MODE_OPTIONS,
				onChange: (value) => onMode("groupMode", value)
			}), access.groupMode === "allowlist" ? (0, react.createElement)(PairClaimPanel, {
				purpose: "allow-group",
				title: "群白名单",
				enabled: bound,
				canPair: enabled,
				appId,
				onChange: onMembershipChange,
				hint: "生成配对码，让群成员在群里 @ 机器人后直接发送这个码，即把该群加入白名单。"
			}) : null, (0, react.createElement)(SegmentedRow, {
				disabled: busy,
				label: "斜杠命令",
				value: access.commandMode ?? "open",
				options: MODE_OPTIONS,
				help: "仅在获准接入的对话中生效。所有人模式允许成员切换模型、开始新会话等，影响该群的共享会话。审批和提问按钮按各自权限处理。",
				onChange: (value) => onMode("commandMode", value)
			}), (access.commandMode ?? "open") === "allowlist" ? (0, react.createElement)(PairClaimPanel, {
				purpose: "owner",
				title: "命令白名单",
				enabled: bound,
				canPair: enabled,
				appId,
				onChange: onMembershipChange,
				hint: "名单按发送者 OpenID 校验，适用于获准接入的群聊和私聊。保存模式与管理名单分别生效。"
			}) : null, commandsError && bound && enabled ? (0, react.createElement)("p", {
				className: "imqc-error",
				role: "alert"
			}, `命令清单加载失败：${commandsError}`) : null, commands.length ? (0, react.createElement)(SlashCommandList, { commands }) : null);
		}
		const DRAFT_STORAGE_KEY = "im-qqbot/config-draft/v1";
		function storedDraft(key) {
			try {
				const text = sessionStorage.getItem(key);
				return text === null ? void 0 : parseConfigDraft(JSON.parse(text));
			} catch (_error) {
				return;
			}
		}
		/** Keep an edited form through a client reload without storing credential fields. */
		function storeDraft(key, draft) {
			try {
				if (isConfigDirty(draft.baseline, draft.form)) sessionStorage.setItem(key, JSON.stringify(configDraft(draft.baseline, draft.form)));
				else sessionStorage.removeItem(key);
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
		function PrimaryAccountSettings({ appId, revision, enabled, formId, controls, credentials, onAliasSaved }) {
			useConfigPanelStyles();
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
			const storageKey = `${DRAFT_STORAGE_KEY}:${appId}`;
			const replaceDraft = (0, react.useCallback)((next) => {
				draftRef.current = next;
				storeDraft(storageKey, next);
				setDraft(next);
			}, [storageKey]);
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
				}).then(async ({ config }) => {
					const { robots } = await fetchJson(WORKBENCH_ROBOTS_PATH, {
						cache: "no-store",
						signal: controller.signal
					});
					const robot = robots.find((robot) => robot.appId === appId && robot.primary);
					if (!robot || config.appId !== appId) throw new Error("主机器人绑定已更新，请重新打开设置。");
					config = {
						...config,
						alias: robot.alias,
						robotRevision: robot.revision
					};
					if (stopped || saveController.current !== null) return;
					const expected = pendingConfirmation.current;
					const confirmed = expected !== null && matchesSavedConfig(config, expected);
					if (confirmed || expected?.appId !== config.appId) pendingConfirmation.current = null;
					const current = draftRef.current ?? storedDraft(storageKey);
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
				appId,
				reload,
				replaceDraft,
				revision
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
				if (saveController.current !== null || busy || current === null) return;
				let submitted = normalizeConfig(current.form);
				const { alias, ...changed } = configPatch(current.baseline, submitted);
				const configChanged = Object.keys(changed).length > 0;
				if (alias === void 0 && !configChanged) {
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
				let aliasSaved = false;
				(async () => {
					if (alias !== void 0) {
						const { robot } = await fetchJson(WORKBENCH_ROBOTS_PATH, {
							method: "POST",
							headers: { "content-type": "application/json" },
							signal: controller.signal,
							body: JSON.stringify({
								appId,
								revision: current.baseline.robotRevision,
								alias
							})
						});
						if (!mounted.current || controller.signal.aborted) return;
						aliasSaved = true;
						const identity = {
							alias: robot.alias,
							robotRevision: robot.revision
						};
						submitted = {
							...submitted,
							...identity
						};
						replaceDraft({
							baseline: {
								...current.baseline,
								...identity
							},
							form: submitted
						});
						onAliasSaved(robot);
					}
					if (!configChanged) {
						setResult({
							kind: "confirmed",
							message: "配置已保存。"
						});
						return;
					}
					const body = await fetchJson(BIND_CONFIG_PATH, {
						method: "POST",
						headers: { "content-type": "application/json" },
						signal: controller.signal,
						body: JSON.stringify({
							...changed,
							expectedAppId: appId,
							...changed.access === void 0 ? {} : { accessRevision: current.baseline.accessRevision }
						})
					});
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
						const baseline = {
							...config,
							alias: submitted.alias,
							robotRevision: submitted.robotRevision
						};
						replaceDraft({
							baseline,
							form: baseline
						});
						setResult({
							kind: "confirmed",
							message: "配置已保存，插件重载完成后生效。"
						});
					} else setResult({
						kind: "unconfirmed",
						message: "配置已保存，刷新配置核对生效结果。"
					});
				})().catch((error) => {
					if (!mounted.current || controller.signal.aborted) return;
					const detail = error instanceof HttpError && error.status === 409 ? `${error.message}草稿已保留，请先刷新配置。` : `保存结果未确认：${error instanceof Error ? error.message : String(error)}。草稿已保留，可重试或刷新配置核对。`;
					setResult({
						kind: "failed",
						message: aliasSaved ? `机器人名称已保存。${detail}` : detail
					});
				}).finally(() => {
					if (saveController.current === controller) {
						saveController.current = null;
						if (mounted.current) setBusy(false);
					}
				});
			}, [
				onAliasSaved,
				appId,
				busy,
				replaceDraft
			]);
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
			const accountFields = (0, react.createElement)(react.Fragment, null, controls, draft && (0, react.createElement)("label", { className: "imqb-field imqr-field" }, "机器人名称", (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				form: formId,
				value: draft.form.alias ?? "",
				disabled: busy || loading,
				placeholder: "可选，便于区分机器人",
				autoComplete: "off",
				maxLength: 120,
				onChange: (event) => patch("alias", event.target.value)
			})), credentials);
			if (draft === null) return (0, react.createElement)("div", { "aria-busy": loading }, accountFields, loadFeedback, loading ? (0, react.createElement)("p", {
				className: "imqb2-hint",
				role: "status",
				style: { padding: "12px 0" }
			}, "正在加载配置…") : null);
			const { baseline, form } = draft;
			const dirty = isConfigDirty(baseline, form);
			const access = form.access ?? DEFAULT_ACCESS;
			const message = busy ? "正在保存配置…" : result?.message ?? (dirty ? draftNotice ?? "有未保存修改。保存会重载插件，并中断正在运行的 QQ 任务。" : "没有未保存的修改。");
			const settingsForm = (0, react.createElement)("form", {
				id: formId,
				className: "imqb2-form",
				onSubmit: submit,
				"aria-busy": busy
			}, loadFeedback, (0, react.createElement)("fieldset", {
				className: "imqb2-fields",
				disabled: busy
			}, (0, react.createElement)(AccessSettings, {
				access,
				busy,
				appId,
				enabled,
				onMembershipChange: retry,
				onMode: (key, value) => patch("access", {
					...access,
					[key]: value
				})
			}), (0, react.createElement)("div", { className: "imqb2-group-title" }, "基础设置"), (0, react.createElement)("div", { className: "imqb2-field" }, (0, react.createElement)("div", { className: "imqb2-head" }, (0, react.createElement)("span", { className: "imqb2-label" }, "群聊仅回复 @机器人的消息"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
				label: "群聊仅回复 @机器人的消息",
				checked: form.requireMention ?? true,
				onChange: (value) => patch("requireMention", value)
			})))), (0, react.createElement)("div", { className: "imqb2-footer" }, (0, react.createElement)("p", {
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
			return (0, react.createElement)(react.Fragment, null, accountFields, settingsForm);
		}
		//#endregion
		//#region src/client/robot-accounts.ts
		const ROBOT_STATE_LABELS = {
			connecting: "连接中",
			connected: "已连接",
			reconnecting: "重连中",
			failed: "连接失败",
			disabled: "已停用"
		};
		const MODE_KEYS = [
			"c2cMode",
			"groupMode",
			"commandMode"
		];
		const accountDrafts = /* @__PURE__ */ new Map();
		function robotBindingKey(robot) {
			return JSON.stringify([robot.appId, robot.bindingRevision]);
		}
		function accountName(robot) {
			return robot.alias || (robot.primary ? "主机器人" : `机器人 ${robot.appId}`);
		}
		function editRobot(robot) {
			return {
				kind: "edit",
				baseline: robot,
				draft: {
					alias: robot.alias,
					c2cMode: robot.access.c2cMode,
					groupMode: robot.access.groupMode,
					commandMode: robot.access.commandMode ?? "open"
				}
			};
		}
		function makePatch({ draft, baseline }) {
			const patch = {
				appId: baseline.appId,
				revision: baseline.revision
			};
			const alias = draft.alias.trim();
			if (alias !== baseline.alias) patch.alias = alias;
			if (!baseline.primary) {
				const access = {};
				for (const key of MODE_KEYS) if (draft[key] !== (baseline.access[key] ?? "open")) access[key] = draft[key];
				if (Object.keys(access).length > 0) patch.access = access;
			}
			return patch;
		}
		function rememberEdit(editor) {
			const key = robotBindingKey(editor.baseline);
			if (Object.keys(makePatch(editor)).length > 2) accountDrafts.set(key, editor);
			else accountDrafts.delete(key);
		}
		function rebase(editor, latest) {
			const next = editRobot(latest);
			const patch = makePatch(editor);
			if (patch.alias !== void 0) next.draft.alias = patch.alias;
			for (const key of MODE_KEYS) {
				const mode = patch.access?.[key];
				if (mode !== void 0) next.draft[key] = mode;
			}
			return next;
		}
		function replaceRobot(robots, robot) {
			const list = robots ?? [];
			return list.some((item) => item.appId === robot.appId) ? list.map((item) => item.appId === robot.appId ? robot : item) : [...list, robot];
		}
		function RobotAccounts({ selectedAppId, onSelect, workbench }) {
			const [robots, setRobots] = (0, react.useState)(null);
			const [unavailable, setUnavailable] = (0, react.useState)(false);
			const [loadError, setLoadError] = (0, react.useState)("");
			const [actionError, setActionError] = (0, react.useState)("");
			const [removing, setRemoving] = (0, react.useState)();
			const [removeMode, setRemoveMode] = (0, react.useState)();
			const [removeError, setRemoveError] = (0, react.useState)("");
			const [editor, setEditor] = (0, react.useState)(null);
			const [editError, setEditError] = (0, react.useState)("");
			const [rebased, setRebased] = (0, react.useState)(false);
			const [busy, setBusy] = (0, react.useState)(false);
			const [binding, setBinding] = (0, react.useState)();
			const [reload, setReload] = (0, react.useState)(0);
			const mutation = (0, react.useRef)(null);
			const generation = (0, react.useRef)(0);
			const sawUnboundPrimary = (0, react.useRef)(false);
			const formId = (0, react.useId)();
			const bindId = editor?.kind === "add" ? editor.id : void 0;
			const bindState = binding?.id === bindId ? binding?.state : void 0;
			const bindingBusy = busy || bindState?.phase === "saving" || bindState?.phase === "bound";
			const activeRobot = robots?.find((robot) => robot.appId === selectedAppId) ?? robots?.find((robot) => robot.primary) ?? robots?.[0];
			const setEdit = (next) => {
				rememberEdit(next);
				setEditor(next);
			};
			(0, react.useEffect)(() => () => {
				mutation.current?.abort();
				mutation.current = null;
			}, []);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				let timer;
				const refresh = async () => {
					const current = generation.current;
					try {
						const response = await fetchJson(WORKBENCH_ROBOTS_PATH, {
							cache: "no-store",
							signal: controller.signal
						});
						if (controller.signal.aborted || generation.current !== current || mutation.current) return;
						setRobots(response.robots);
						setLoadError("");
						setUnavailable(false);
					} catch (error) {
						if (controller.signal.aborted || generation.current !== current || mutation.current) return;
						if (error instanceof HttpError && error.status === 404) {
							setUnavailable(true);
							setLoadError("");
						} else setLoadError(error instanceof Error ? error.message : "无法读取机器人列表");
					} finally {
						if (!controller.signal.aborted) timer = setTimeout(() => {
							refresh();
						}, 4e3);
					}
				};
				refresh();
				return () => {
					controller.abort();
					if (timer !== void 0) clearTimeout(timer);
				};
			}, [reload]);
			(0, react.useEffect)(() => {
				if (!removing || !removeError || busy || !robots) return;
				const latest = robots.find((robot) => robot.appId === removing.appId);
				if (!latest) {
					if (removeMode === "clear") return;
					accountDrafts.delete(robotBindingKey(removing));
					setRemoving(void 0);
					setEditor((current) => current?.kind === "edit" && current.baseline.appId === removing.appId ? null : current);
					if (selectedAppId === removing.appId && robots[0]) onSelect(robots[0].appId);
				} else if (latest.revision !== removing.revision) {
					setRemoving(latest);
					setRemoveError("机器人配置已更新，请确认当前机器人后再解绑。");
				}
			}, [
				busy,
				removing,
				removeError,
				removeMode,
				robots,
				selectedAppId,
				onSelect
			]);
			(0, react.useEffect)(() => {
				if (!bindId) return;
				const controller = new AbortController();
				let timer;
				const update = (state) => {
					if (controller.signal.aborted) return;
					setBinding((current) => current?.id === bindId && current.state.phase === "bound" ? current : {
						id: bindId,
						state
					});
				};
				const poll = async () => {
					try {
						const state = await fetchJson(`${WORKBENCH_ROBOT_BIND_PATH}?id=${bindId}`, { signal: controller.signal });
						if (!mutation.current) update(state);
						if (state.phase === "bound" && !mutation.current) return;
					} catch (error) {
						if (error instanceof HttpError && error.status === 404) {
							update({
								phase: "failed",
								reason: error.message
							});
							return;
						}
						update({
							phase: "failed",
							reason: "无法读取绑定状态，请刷新二维码。"
						});
					}
					if (!controller.signal.aborted) timer = setTimeout(() => {
						poll();
					}, 1500);
				};
				const start = fetchJson(WORKBENCH_ROBOT_BIND_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						action: "start",
						id: bindId
					})
				}).then((state) => {
					update(state);
					if (!controller.signal.aborted) poll();
				}, (error) => {
					update({
						phase: "failed",
						reason: error instanceof Error ? error.message : "无法开始绑定，请重试。"
					});
				});
				return () => {
					controller.abort();
					if (timer !== void 0) clearTimeout(timer);
					start.then(() => fetchJson(WORKBENCH_ROBOT_BIND_PATH, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							action: "cancel",
							id: bindId
						})
					})).catch(() => {});
				};
			}, [bindId]);
			(0, react.useEffect)(() => {
				if (bindState?.phase === "bound") {
					generation.current++;
					setRobots((current) => replaceRobot(current, bindState.robot));
					setEditor(editRobot(bindState.robot));
					workbench.onOpenSettings(bindState.robot.appId);
					return;
				}
				const primary = robots?.find((robot) => robot.primary);
				if (!primary) sawUnboundPrimary.current = robots?.length === 0 || !!workbench.primaryBinding;
				if (sawUnboundPrimary.current && primary) {
					sawUnboundPrimary.current = false;
					setEditor(editRobot(primary));
					workbench.onOpenSettings(primary.appId);
				}
			}, [
				bindState,
				robots,
				workbench
			]);
			const submitBinding = async (appId, appSecret) => {
				if (!bindId || mutation.current) return {
					ok: false,
					error: "请等待当前绑定完成。"
				};
				const controller = new AbortController();
				mutation.current = controller;
				generation.current++;
				setBusy(true);
				try {
					const state = await fetchJson(WORKBENCH_ROBOT_BIND_PATH, {
						method: "POST",
						headers: { "content-type": "application/json" },
						signal: controller.signal,
						body: JSON.stringify({
							action: "manual",
							id: bindId,
							appId,
							appSecret
						})
					});
					if (controller.signal.aborted) return {
						ok: false,
						error: "绑定已取消。"
					};
					if (state.phase === "bound") {
						setBinding({
							id: bindId,
							state
						});
						return { ok: true };
					}
					return {
						ok: false,
						error: state.phase === "failed" ? state.reason : "绑定未完成，请重试。"
					};
				} catch (error) {
					return {
						ok: false,
						error: error instanceof Error ? error.message : "绑定失败，请重试。"
					};
				} finally {
					if (mutation.current === controller) {
						generation.current++;
						mutation.current = null;
						setBusy(false);
					}
				}
			};
			const save = async (patch, editing) => {
				if (mutation.current) return {
					ok: false,
					error: "请等待当前操作完成。"
				};
				const controller = new AbortController();
				mutation.current = controller;
				generation.current++;
				setBusy(true);
				setActionError("");
				setEditError("");
				setRebased(false);
				try {
					const { robot } = await fetchJson(WORKBENCH_ROBOTS_PATH, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(patch),
						signal: controller.signal
					});
					if (controller.signal.aborted) return {
						ok: false,
						error: "操作已取消。"
					};
					setRobots((current) => replaceRobot(current, robot));
					if (editing) setEdit(editRobot(robot));
					else if (editor?.kind === "edit" && editor.baseline.appId === robot.appId && editor.baseline.revision === patch.revision) setEdit(rebase(editor, robot));
					return { ok: true };
				} catch (error) {
					if (controller.signal.aborted) return {
						ok: false,
						error: "操作已取消。"
					};
					const conflict = error instanceof HttpError && error.status === 409;
					const message = conflict && patch.revision !== null ? "机器人配置已更新，请读取最新配置后再保存。" : error instanceof Error ? error.message : "无法保存机器人配置";
					if (editing) setEditError(message);
					else setActionError(message);
					if (conflict) setReload((value) => value + 1);
					return {
						ok: false,
						error: message
					};
				} finally {
					if (mutation.current === controller) {
						generation.current++;
						mutation.current = null;
						setBusy(false);
					}
				}
			};
			const openRemove = (robot) => {
				setRemoveError("");
				setRemoveMode(void 0);
				setRemoving(robot);
			};
			const remove = async (robot, mode) => {
				if (mutation.current) return;
				const controller = new AbortController();
				mutation.current = controller;
				generation.current++;
				setBusy(true);
				setRemoveError("");
				setRemoveMode(mode);
				try {
					await fetchJson(WORKBENCH_ROBOT_REMOVE_PATH, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							appId: robot.appId,
							revision: robot.revision,
							bindingRevision: robot.bindingRevision,
							mode
						}),
						signal: controller.signal
					});
					if (controller.signal.aborted) return;
					setRobots((current) => current?.filter((item) => item.appId !== robot.appId) ?? null);
					accountDrafts.delete(robotBindingKey(robot));
					setEditor((current) => current?.kind === "edit" && current.baseline.appId === robot.appId ? null : current);
					setRemoving(void 0);
					if (activeRobot?.appId === robot.appId) {
						const next = robots?.find((item) => item.appId !== robot.appId);
						if (next) onSelect(next.appId);
					}
				} catch (error) {
					if (!controller.signal.aborted) setRemoveError(error instanceof HttpError && (error.status === 409 || error.status === 503) ? error.message : "暂未确认解绑结果。若刷新后仍显示此机器人，可以重试。");
				} finally {
					if (mutation.current === controller) {
						generation.current++;
						mutation.current = null;
						setBusy(false);
						setReload((value) => value + 1);
					}
				}
			};
			const startEdit = (next) => {
				setEditor(next);
				setEditError("");
				setRebased(false);
			};
			const setField = (key, value) => {
				if (editor?.kind !== "edit") return;
				const latest = accountDrafts.get(robotBindingKey(editor.baseline)) ?? editor;
				setEdit({
					...latest,
					draft: {
						...latest.draft,
						[key]: value
					}
				});
			};
			const current = editor?.kind === "edit" ? robots?.find((robot) => robot.appId === editor.baseline.appId) : void 0;
			const stale = editor?.kind === "edit" && current !== void 0 && current.revision !== editor.baseline.revision;
			(0, react.useEffect)(() => {
				if (!stale || !current || editor?.kind !== "edit" || busy) return;
				const baseline = editor.baseline;
				if (robotBindingKey(baseline) !== robotBindingKey(current)) {
					accountDrafts.delete(robotBindingKey(baseline));
					setEditor(editRobot(current));
					return;
				}
				const modesUnchanged = MODE_KEYS.every((key) => current.access[key] === baseline.access[key]);
				if (Object.keys(makePatch(editor)).length === 2 || current.alias === baseline.alias && current.enabled === baseline.enabled && modesUnchanged) setEdit(rebase(editor, current));
			}, [
				busy,
				current,
				editor,
				stale
			]);
			const patch = editor?.kind === "edit" ? makePatch(editor) : void 0;
			const adding = editor?.kind === "add";
			const canSave = !busy && !stale && patch !== void 0 && Object.keys(patch).length > 2;
			const cancelAdd = () => {
				if (bindingBusy) return;
				setEditor(null);
				workbench.onCancelAdd();
			};
			const openSettings = (robot) => {
				const key = robotBindingKey(robot);
				if (editor?.kind !== "edit" || robotBindingKey(editor.baseline) !== key) startEdit(accountDrafts.get(key) ?? editRobot(robot));
				workbench.onOpenSettings(robot.appId);
			};
			const bindPrimary = () => {
				setEditor(null);
				setEditError("");
				setRebased(false);
				sawUnboundPrimary.current = true;
				workbench.onBindPrimary?.();
			};
			(0, react.useEffect)(() => {
				if (!workbench.settingsRequest || !robots || unavailable || bindingBusy) return;
				if (activeRobot) openSettings(activeRobot);
				else bindPrimary();
				workbench.settingsRequest();
			}, [
				workbench,
				robots,
				unavailable,
				bindingBusy,
				activeRobot
			]);
			const footer = (0, react.createElement)("div", { className: "imqw-actions imqw-savebar imqr-footer" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				size: "sm",
				variant: "ghost",
				type: "button",
				disabled: busy || !stale && !canSave,
				onClick: () => {
					if (editor?.kind === "edit") {
						accountDrafts.delete(robotBindingKey(editor.baseline));
						startEdit(editRobot(current ?? editor.baseline));
					}
				}
			}, "撤销修改"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				size: "sm",
				variant: "primary",
				type: "submit",
				form: formId,
				disabled: !canSave
			}, busy ? "保存中…" : "保存"));
			const form = editor?.kind !== "edit" ? null : (0, react.createElement)("form", {
				id: formId,
				className: "imqr-form",
				onSubmit: (event) => {
					event.preventDefault();
					if (canSave) save(patch, true);
				}
			}, (0, react.createElement)("label", { className: "imqb-field imqr-field" }, "机器人名称", (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				value: editor.draft.alias,
				disabled: busy,
				placeholder: "可选，便于区分机器人",
				autoComplete: "off",
				maxLength: 120,
				onChange: (event) => setField("alias", event.currentTarget.value)
			})), stale ? (0, react.createElement)("div", { className: "imqr-header" }, (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, "配置已变化，草稿仍保留。"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				size: "sm",
				variant: "outline",
				type: "button",
				disabled: busy,
				onClick: () => {
					if (editor.kind !== "edit" || !current) return;
					setEdit(rebase(editor, current));
					setEditError("");
					setRebased(true);
				}
			}, "合并到最新配置")) : null, editError && !stale ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, editError) : null, rebased && !stale ? (0, react.createElement)("p", {
				className: "imqb-status-sub",
				role: "status"
			}, "草稿已合并，请核对后保存。") : null);
			const startBinding = () => startEdit({
				kind: "add",
				id: crypto.randomUUID()
			});
			const enabled = current?.enabled ?? (editor?.kind === "edit" && editor.baseline.enabled);
			const accountControls = editor?.kind === "edit" ? (0, react.createElement)(react.Fragment, null, (0, react.createElement)("h3", null, "账号信息"), (0, react.createElement)("div", { className: "imqr-inline-state" }, (0, react.createElement)("span", null, "启用机器人"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
				checked: enabled,
				label: "启用机器人",
				disabled: busy,
				onChange: (enabled) => {
					const robot = current ?? editor.baseline;
					save({
						appId: robot.appId,
						revision: robot.revision,
						enabled
					}, false);
				}
			}))) : null;
			const credentials = editor?.kind === "edit" ? (0, react.createElement)(BindPanelBody, {
				key: editor.baseline.appId,
				state: {
					phase: "bound",
					appId: editor.baseline.appId
				},
				recheck: () => setReload((value) => value + 1),
				boundActions: {
					disabled: busy || stale,
					...editor.baseline.primary ? {} : { replace: (appId, appSecret) => save({
						appId,
						appSecret,
						revision: editor.baseline.revision
					}, false) },
					unbind: () => openRemove(current ?? editor.baseline)
				}
			}) : null;
			const accountSettings = editor?.kind === "add" ? (0, react.createElement)(BindPanelBody, {
				key: bindId,
				state: bindState?.phase === "bound" ? { phase: "saving" } : bindState ?? null,
				actions: {
					refresh: startBinding,
					submit: submitBinding
				}
			}) : editor && (0, react.createElement)("section", { className: "imqr-inline" }, editor.baseline.primary ? (0, react.createElement)(PrimaryAccountSettings, {
				key: robotBindingKey(editor.baseline),
				appId: editor.baseline.appId,
				revision: current?.revision ?? editor.baseline.revision,
				enabled,
				formId,
				controls: accountControls,
				credentials: (0, react.createElement)("section", {
					className: "imqw-primary-settings",
					"aria-label": "凭据与访问"
				}, (0, react.createElement)("h3", null, "凭据与访问"), credentials),
				onAliasSaved: (robot) => setRobots((current) => replaceRobot(current, robot))
			}) : (0, react.createElement)(react.Fragment, null, accountControls, form, credentials, (0, react.createElement)(AccessSettings, {
				key: `access-${editor.baseline.appId}`,
				appId: editor.baseline.appId,
				access: editor.draft,
				busy,
				enabled,
				onMode: setField,
				onMembershipChange: () => setReload((value) => value + 1)
			}), footer));
			if (unavailable || robots === null && !loadError) return workbench.render({
				robots,
				unavailable,
				rail: null,
				accountSettings: null,
				cancelAdd,
				busy: bindingBusy
			});
			const retryClear = removing !== void 0 && removeMode === "clear" && removeError !== "" && robots?.some((robot) => robot.appId === removing.appId) === false;
			const rail = (0, react.createElement)("section", {
				className: "imqr-rail",
				"aria-label": "机器人账号"
			}, (0, react.createElement)("style", null, STYLES), (0, react.createElement)("div", { className: "imqr-header" }, workbench.collapsed ? null : (0, react.createElement)("h2", { className: "imqb-status-title" }, "机器人"), (0, react.createElement)("div", { className: "imqr-actions" }, robots?.length === 0 ? null : (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				size: "sm",
				variant: "ghost",
				type: "button",
				title: "添加机器人",
				"aria-label": "添加机器人",
				disabled: busy || adding || robots === null,
				onClick: () => {
					startBinding();
					workbench.onAdd();
				}
			}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 16 })), !workbench.compact ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				size: "sm",
				variant: "ghost",
				type: "button",
				title: workbench.collapsed ? "展开机器人栏" : "收起机器人栏",
				"aria-label": workbench.collapsed ? "展开机器人栏" : "收起机器人栏",
				onClick: workbench.onToggleCollapse
			}, workbench.collapsed ? "›" : "‹") : null)), loadError ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, loadError) : null, actionError ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, actionError) : null, robots?.length && !robots.some((robot) => robot.primary) ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "outline",
				disabled: bindingBusy,
				"aria-label": "绑定主机器人",
				title: "绑定主机器人",
				onClick: bindPrimary
			}, workbench.collapsed ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutlineRegular, { size: 16 }) : "绑定主机器人") : null, robots?.length === 0 ? (0, react.createElement)("p", { className: "imqb-status-sub" }, "还没有机器人") : null, robots?.map((robot) => {
				const name = accountName(robot);
				const selected = activeRobot?.appId === robot.appId;
				const avatar = (0, react.createElement)("span", {
					className: "imqr-avatar",
					"data-state": robot.state,
					"aria-hidden": true
				}, robot.alias ? [...robot.alias][0] : (0, react.createElement)("svg", {
					width: 18,
					height: 18,
					viewBox: "0 0 24 24",
					fill: "currentColor"
				}, (0, react.createElement)("path", { d: QQ_BOT_LOGO_PATH })));
				const label = workbench.collapsed ? null : (0, react.createElement)("span", { className: "imqb-status-meta" }, (0, react.createElement)("span", { className: "imqb-status-title imqr-name" }, name), (0, react.createElement)("span", { className: "imqb-status-sub" }, ROBOT_STATE_LABELS[robot.state]));
				return (0, react.createElement)("div", {
					className: "imqr-row",
					key: robot.appId,
					"data-selected": selected || void 0
				}, (0, react.createElement)("button", {
					className: "imqr-select",
					type: "button",
					disabled: adding && bindingBusy,
					"aria-pressed": selected,
					onClick: () => {
						if (adding) cancelAdd();
						onSelect(robot.appId);
					},
					"aria-label": name,
					title: `${name} · ${ROBOT_STATE_LABELS[robot.state]}`
				}, avatar, label), workbench.collapsed ? null : (0, react.createElement)("div", { className: "imqr-row-actions" }, (0, react.createElement)("div", { className: "imqr-row-buttons" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					size: "sm",
					variant: "ghost",
					type: "button",
					disabled: bindingBusy,
					onClick: () => openSettings(robot),
					"aria-label": `设置${name}`,
					title: `设置${name}`
				}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconSettingsOutlineRegular, { size: 16 })), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					size: "sm",
					variant: "ghost",
					type: "button",
					className: "imqr-remove",
					disabled: bindingBusy,
					onClick: () => openRemove(robot),
					"aria-label": `解绑${name}`,
					title: `解绑${name}`
				}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutlineRegular, { size: 16 }))), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
					checked: robot.enabled,
					label: `启用${name}`,
					disabled: bindingBusy,
					onChange: (enabled) => {
						save({
							appId: robot.appId,
							revision: robot.revision,
							enabled
						}, false);
					}
				})));
			}), workbench.collapsed && activeRobot ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				size: "sm",
				variant: "ghost",
				type: "button",
				title: "当前机器人设置",
				"aria-label": "当前机器人设置",
				disabled: bindingBusy,
				onClick: () => openSettings(activeRobot)
			}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconSettingsOutlineRegular, { size: 16 })) : null, removing ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				title: `解绑「${accountName(removing)}」？`,
				closeLabel: "关闭",
				description: retryClear ? "这台机器人已解绑。重试将继续清除本机 QQ 消息记录和 Session 关联。" : "「仅解绑」会保留本机 QQ 消息记录和 Session 关联。「解绑并清除记录」还会删除这台机器人在本机的 QQ 消息记录，并解除它的 QQ 会话与 DSH Session 的关联。清除无法撤销，原 Session 可在 DSH 工作区打开。",
				onClose: () => {
					if (!mutation.current) setRemoving(void 0);
				},
				footer: (0, react.createElement)(react.Fragment, null, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					type: "button",
					variant: "ghost",
					size: "sm",
					disabled: busy,
					onClick: () => setRemoving(void 0)
				}, "取消"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					type: "button",
					variant: "outline",
					size: "sm",
					disabled: busy || retryClear,
					onClick: () => {
						remove(removing, "retain");
					}
				}, busy && removeMode === "retain" ? "正在解绑…" : "仅解绑"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					type: "button",
					variant: "outline",
					size: "sm",
					className: "imqb-danger imqr-clear",
					disabled: busy,
					onClick: () => {
						remove(removing, "clear");
					}
				}, busy && removeMode === "clear" ? "正在清除…" : retryClear ? "重试清除记录" : "解绑并清除记录"))
			}, removeError ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, removeError) : null) : null);
			return workbench.render({
				robots,
				unavailable,
				rail,
				accountSettings,
				cancelAdd,
				busy: bindingBusy
			});
		}
		const STYLES = `
.imqr-header { display: flex; align-items: center; justify-content: space-between; gap: 8px 12px; flex-wrap: wrap; min-width: 0; }
.imqr-name { overflow-wrap: anywhere; }
.imqr-select { font: inherit; color: inherit; background: none; border: 0; padding: 4px; text-align: left; cursor: pointer; display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; border-radius: 8px; }
.imqr-avatar { display: grid; place-items: center; position: relative; flex: 0 0 28px; width: 28px; height: 28px; border-radius: 8px; background: var(--dsw-alias-bg-layer-3); }
.imqr-avatar::after { content: ''; position: absolute; inset: auto 0 0 auto; width: 7px; height: 7px; background: var(--dsw-alias-label-tertiary); border-radius: 100%; }
.imqr-avatar[data-state='connected']::after { background: var(--dsw-alias-text-green, #29966e); }
.imqr-avatar[data-state='failed']::after { background: var(--dsw-alias-text-red, #ce5260); }
.imqr-inline { display: flex; flex-direction: column; gap: 14px; }
.imqr-inline-state { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.imqr-rail { display: grid; align-content: start; gap: 8px; min-width: 0; }
.imqr-row {
  display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; padding: 6px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}
.imqr-row[data-selected] {
  background: var(--dsw-alias-bg-module-platform);
  border-color: var(--dsw-alias-border-l4);
}
.imqr-row-actions, .imqr-row-buttons { display: flex; align-items: center; gap: 2px; }
.imqr-row-actions { justify-content: space-between; }
.imqr-row-buttons > button { padding-inline: 4px; }
.imqr-remove:hover, .imqr-remove:focus-visible { color: var(--dsw-alias-state-error-primary); }
.imqr-clear:not(:disabled) { color: var(--dsw-alias-state-error-primary); border-color: currentColor; }
.imqr-actions, .imqr-footer { display: flex; align-items: center; gap: 8px; }
.imqr-footer { justify-content: flex-end; }
.imqr-form { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.imqr-select:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color); outline-offset: 2px; }
`;
		//#endregion
		//#region src/shared/workbench-extension.ts
		const QQ_HISTORY_VIEW_ID = "qq-history";
		const WORKBENCH_EXTENSION_SETTINGS_PATH = "/api/qqbot/workbench/extension-settings";
		//#endregion
		//#region src/client/workbench-extensions.ts
		var WorkbenchExtensions = class {
			views = [];
			sections = [];
			listeners = /* @__PURE__ */ new Set();
			subscribe = (listener) => {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			};
			getViews = () => this.views;
			registerView(view) {
				if (this.views.some((item) => item.id === view.id)) throw new Error(`Duplicate QQ workbench view: ${view.id}`);
				this.views = [...this.views, view];
				this.notify();
				return () => {
					if (!this.views.includes(view)) return;
					this.views = this.views.filter((item) => item !== view);
					this.notify();
				};
			}
			getSettingsSections = () => this.sections;
			registerSettingsSection(section) {
				if (this.sections.some((item) => item.id === section.id)) throw new Error(`Duplicate QQ workbench settings: ${section.id}`);
				this.sections = [...this.sections, section];
				this.notify();
				return () => {
					if (!this.sections.includes(section)) return;
					this.sections = this.sections.filter((item) => item !== section);
					this.notify();
				};
			}
			notify() {
				for (const listener of this.listeners) listener();
			}
		};
		function extensionSettingsProps(id, target) {
			return {
				target,
				read: (scope, signal) => {
					const params = new URLSearchParams({
						id,
						...scope
					});
					return fetchJson(`${WORKBENCH_EXTENSION_SETTINGS_PATH}?${params}`, { signal });
				},
				save: (scope, revision, overrides, signal) => fetchJson(WORKBENCH_EXTENSION_SETTINGS_PATH, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						id,
						scope,
						revision,
						overrides
					}),
					signal
				})
			};
		}
		//#endregion
		//#region src/client/workbench-layout.ts
		const storageKey$1 = "dsh-qqbot.workbench.widths.v1";
		const defaults = {
			robots: 192,
			tree: 236,
			settings: 356
		};
		const minimum = {
			robots: 140,
			tree: 164,
			settings: 256
		};
		const maximum = {
			robots: 288,
			tree: 420,
			settings: 576
		};
		const columns = [
			"robots",
			"tree",
			"settings"
		];
		const avatarWidth = 60;
		const dividerWidth = 6;
		const minimumMessageWidth = 224;
		const compactWidth = 920;
		const singlePageWidth = 720;
		function clampWidth(column, value) {
			return Math.max(minimum[column], Math.min(maximum[column], Math.round(value)));
		}
		function readWidths() {
			try {
				const saved = JSON.parse(localStorage.getItem(storageKey$1) ?? "null");
				const widths = { ...defaults };
				for (const column of columns) {
					const value = saved?.[column];
					if (typeof value === "number" && Number.isFinite(value)) widths[column] = clampWidth(column, value);
				}
				return widths;
			} catch {
				return defaults;
			}
		}
		const columnLabels = {
			robots: "调整机器人栏宽度",
			tree: "调整会话列表宽度",
			settings: "调整会话设置宽度"
		};
		function Divider({ column, width, max, onResize }) {
			const drag = (0, react.useRef)();
			const direction = column === "settings" ? -1 : 1;
			return (0, react.createElement)("div", {
				className: "imqw-divider",
				role: "separator",
				tabIndex: 0,
				"aria-orientation": "vertical",
				"aria-label": columnLabels[column],
				"aria-valuemin": minimum[column],
				"aria-valuemax": max,
				"aria-valuenow": width,
				onPointerDown: (event) => {
					if (event.button !== 0 || drag.current) return;
					event.currentTarget.focus();
					event.currentTarget.setPointerCapture(event.pointerId);
					drag.current = {
						x: event.clientX,
						width,
						pointer: event.pointerId,
						resize: onResize
					};
					event.preventDefault();
				},
				onPointerMove: (event) => {
					const start = drag.current;
					if (start?.pointer === event.pointerId) start.resize(start.width + (event.clientX - start.x) * direction, false);
				},
				onPointerUp: (event) => {
					const start = drag.current;
					if (start?.pointer !== event.pointerId) return;
					drag.current = void 0;
					start.resize(start.width + (event.clientX - start.x) * direction, true);
				},
				onLostPointerCapture: () => {
					const start = drag.current;
					if (!start) return;
					drag.current = void 0;
					start.resize(start.width, false);
				},
				onKeyDown: (event) => {
					const step = event.shiftKey ? 32 : 8;
					const delta = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
					if (!delta) return;
					event.preventDefault();
					onResize(width + delta * direction, true);
				}
			});
		}
		function useWorkbenchLayout(collapsed, treeVisible, settingsVisible) {
			const root = (0, react.useRef)(null);
			const [width, setWidth] = (0, react.useState)(1200);
			const [preferred, setPreferred] = (0, react.useState)(readWidths);
			const compact = width <= compactWidth;
			const singlePage = width <= singlePageWidth;
			(0, react.useLayoutEffect)(() => {
				const node = root.current;
				if (!node) return;
				const measure = () => setWidth(node.clientWidth);
				measure();
				const observer = new ResizeObserver(measure);
				observer.observe(node);
				return () => observer.disconnect();
			}, []);
			const iconsOnly = collapsed || compact;
			const active = columns.filter((column) => {
				if (column === "robots") return !iconsOnly;
				return treeVisible && !singlePage && (column === "tree" || settingsVisible);
			});
			const budget = width - (iconsOnly ? avatarWidth : 0) - active.length * dividerWidth - minimumMessageWidth - 2;
			const sum = (widths) => active.reduce((total, column) => total + widths[column], 0);
			const extras = sum(preferred) - sum(minimum);
			const scale = extras > 0 ? Math.max(0, Math.min(1, (budget - sum(minimum)) / extras)) : 1;
			const fitted = { ...preferred };
			for (const column of active) fitted[column] = minimum[column] + Math.floor((preferred[column] - minimum[column]) * scale);
			return {
				root,
				compact,
				singlePage,
				iconsOnly,
				railWidth: iconsOnly ? avatarWidth : fitted.robots,
				treeWidth: fitted.tree,
				settingsWidth: fitted.settings,
				divider(column) {
					if (!active.includes(column)) return null;
					const max = Math.max(minimum[column], Math.min(maximum[column], budget - sum(fitted) + fitted[column]));
					return (0, react.createElement)(Divider, {
						column,
						width: fitted[column],
						max,
						onResize: (nextWidth, done) => {
							const next = Math.max(minimum[column], Math.min(max, Math.round(nextWidth)));
							const widths = { ...preferred };
							if (next !== fitted[column]) {
								for (const visible of active) widths[visible] = fitted[visible];
								widths[column] = next;
							}
							setPreferred(widths);
							if (done && next !== fitted[column]) try {
								localStorage.setItem(storageKey$1, JSON.stringify(widths));
							} catch {}
						}
					});
				}
			};
		}
		//#endregion
		//#region src/client/workbench-styles.ts
		const WORKBENCH_STYLES = `
.imqw-root {
  container: imqq-workbench / inline-size;
  min-width: 0;
  height: 100%;
  min-height: 0;
  color: var(--dsw-alias-label-primary);
}
.imqw-layout {
  display: grid;
  grid-template-columns: var(--imqw-rail) 6px minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.imqw-layout[data-collapsed='true'] { grid-template-columns: var(--imqw-rail) minmax(0, 1fr); }
.imqw-content, .imqw-conversation-grid {
  height: 100%;
  min-width: 0;
  min-height: 0;
}
.imqw-content { overflow: hidden; }
.imqw-conversation-grid {
  display: grid;
  grid-template-columns: var(--imqw-tree) 6px minmax(0, 1fr);
}
.imqw-conversation-grid[data-settings='true'] {
  grid-template-columns: var(--imqw-tree) 6px minmax(0, 1fr) 6px var(--imqw-settings);
}
.imqw-conversation-grid[hidden] { display: none; }
.imqw-robots, .imqw-conversation-grid > :is(aside, section), .imqw-empty, .imqw-robot-settings {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 16px;
}
.imqw-robots, .imqw-settings { background: var(--dsw-alias-bg-layer-2); }
.imqw-layout[data-collapsed='true'] .imqw-robots { border-right: 1px solid var(--dsw-alias-border-l2); }
.imqw-divider {
  position: relative;
  cursor: col-resize;
  touch-action: none;
  user-select: none;
  z-index: 1;
}
.imqw-divider::before {
  content: '';
  position: absolute;
  inset: 0 2px;
  border-left: 1px solid var(--dsw-alias-border-l2);
}
.imqw-divider::after {
  content: '';
  position: absolute;
  inset: 0 -3px;
}
.imqw-divider:hover::before, .imqw-divider:active::before, .imqw-divider:focus-visible::before {
  border-left: 2px solid var(--dsw-focus-ring-color);
}
.imqw-divider:focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color);
  outline-offset: -2px;
}
.imqw-robot-settings { height: 100%; box-sizing: border-box; padding: 24px clamp(16px, 4%, 48px); }
.imqw-robot-settings-inner { width: 100%; max-width: 740px; margin-inline: auto; }
.imqw-robot-settings-head { margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.imqw-robot-settings-head button { flex: none; }
.imqw-layout .imqw-robot-settings-head h2 { font-size: 20px; margin-bottom: 4px; }
.imqw-primary-settings {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.imqw-robot-tab { margin-top: 16px; }
.imqw-primary-settings .imqb2-group-title { padding-top: 20px; font-size: 13px; }
.imqw-peer[data-selected] > .imqw-peer-row {
  background: var(--dsw-alias-bg-layer-3);
}
.imqw-robots .imqr-actions { flex-wrap: wrap; gap: 4px; }
.imqw-robots .imqb-status-meta > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.imqw-robots .imqr-rail > .imqr-header { margin-bottom: 6px; }
.imqw-layout[data-collapsed='true'] .imqw-robots { padding-inline: 7px; }
.imqw-layout[data-collapsed='true'] .imqr-header .imqr-actions { flex-direction: column; margin-inline: auto; }
.imqw-layout[data-collapsed='true'] .imqr-select { justify-content: center; }
.imqw-layout[data-collapsed='true'] .imqr-row { padding: 3px; }
.imqw-layout h2, .imqw-layout h3, .imqw-layout p { margin: 0; }
.imqw-layout h2 { font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; }
.imqw-layout h3 { font-size: 13px; line-height: 1.5; }
.imqw-column-head, .imqw-receiving {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.imqw-column-head > *, .imqw-receiving > * { min-width: 0; }
.imqw-main-head {
  flex-wrap: wrap; flex: none; padding-bottom: 9px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.imqw-main-head .imqw-actions { margin-inline-start: auto; align-items: center; max-width: 100%; }
.imqw-column-head .imqw-icon-action { flex: none; width: 28px; padding-inline: 0; }
.imqw-main-title { flex: 1 1 10ch; }
.imqw-main-title h2 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.imqw-conversation-grid > .imqw-conversation {
  container: imqq-messages / inline-size;
  display: flex; flex-direction: column; overflow: hidden;
}
@container imqq-messages (max-width: 360px) {
  .imqw-main-title { flex-basis: 100%; }
  .imqw-main-head .imqw-actions { margin-inline-start: 0; }
}
.imqw-settings > .imqw-column-head { margin-bottom: 3px; }
.imqw-settings .imqw-column-head { align-items: flex-start; padding-bottom: 12px; }
.imqw-settings .imqw-column-head p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.imqw-settings .imqw-column-head .imqw-actions { flex: none; }
.imqw-settings-trigger[aria-expanded='true'] { background: var(--dsw-alias-bg-layer-3); }
.imqw-timeline { position: relative; min-height: 0; flex: 1; display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.imqw-timeline-notice { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; }
.imqw-timeline-notice button { margin-inline-start: auto; flex: none; }
.imqw-timeline-scroll { min-height: 0; flex: 1; overflow: auto; overflow-anchor: none; padding: 2px 4px 8px; }
.imqw-timeline-list { display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 0; list-style: none; }
.imqw-message-day, .imqw-timeline-empty { align-self: center; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 11px; padding: 6px; }
.imqw-timeline-row { display: flex; align-items: flex-start; gap: 8px; align-self: flex-start; max-width: min(88%, 700px); min-width: 0; }
.imqw-timeline-row[data-direction='outbound'] { align-self: flex-end; flex-direction: row-reverse; }
.imqw-timeline-row[data-compact='true'] { margin-top: -6px; }
.imqw-message-avatar { display: grid; place-items: center; flex: 0 0 28px; height: 28px; border-radius: 50%; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); font-size: 12px; }
.imqw-timeline-row[data-compact='true'] .imqw-message-avatar { visibility: hidden; }
.imqw-message-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; align-items: flex-start; }
.imqw-timeline-row[data-direction='outbound'] .imqw-message-body { align-items: flex-end; }
.imqw-message-line { display: flex; align-items: center; gap: 3px; min-width: 0; max-width: 100%; }
.imqw-message-line > span { flex: none; }
.imqw-timeline-row[data-direction='outbound'] .imqw-message-line { flex-direction: row-reverse; }
.imqw-timeline-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; color: var(--dsw-alias-label-tertiary); font-size: 11px; min-width: 0; }
.imqw-timeline-meta strong { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.imqw-timeline-meta:empty { display: none; }
.imqw-timeline-meta [data-status='rejected'] { color: var(--dsw-alias-text-red, #ce5260); }
.imqw-response-detail { max-width: 100%; color: var(--dsw-alias-label-secondary); font-size: 12px; overflow-wrap: anywhere; }
.imqw-response-detail p { margin: 4px 0; }
.imqw-timeline-bubble { padding: 7px 10px; border-radius: 4px 12px 12px; background: var(--dsw-alias-bg-module-platform); box-sizing: border-box; min-width: 0; max-width: 100%; }
.imqw-timeline-row[data-direction='outbound'] .imqw-timeline-bubble { border-radius: 12px 4px 12px 12px; background: color-mix(in srgb, var(--dsw-alias-button-info-fill) 15%, var(--dsw-alias-bg-layer-2)); }
.imqw-timeline-bubble blockquote { border-inline-start: 2px solid var(--dsw-alias-border-l2); margin: 0 0 5px; padding: 2px 6px; color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; }
.imqw-timeline-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.5; }
.imqw-message-images { display: flex; flex-wrap: wrap; gap: 6px; margin-block: 4px; }
.imqw-message-image { display: block; width: min(200px, 100%); aspect-ratio: 4 / 3; overflow: hidden; border-radius: 8px; }
.imqw-message-image img { display: block; width: 100%; height: 100%; object-fit: contain; background: var(--dsw-alias-bg-layer-2); }
.imqw-timeline-older { display: flex; justify-content: center; padding-bottom: 8px; }
.imqw-message-line button.imqw-message-action { padding: 0; width: 26px; color: var(--dsw-alias-label-secondary); }
@media (hover: hover) {
  .imqw-message-line button.imqw-message-action { opacity: .6; }
  .imqw-message-line:is(:hover, :focus-within) button.imqw-message-action,
  .imqw-message-line button.imqw-message-action[aria-expanded='true'] { opacity: 1; }
}
.imqw-message-jump { display: flex; justify-content: center; }
.imqw-composer {
  flex: none; display: grid; gap: 5px; padding: 7px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
}
.imqw-composer:has(textarea:focus) { border-color: var(--dsw-focus-ring-color); }
.imqw-composer > textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 44px;
  max-height: 160px;
  field-sizing: content;
  resize: none;
  background: transparent;
  color: inherit;
  border: 0;
  outline: none;
  padding: 3px 5px;
  font: inherit;
  line-height: 20px;
}
.imqw-composer-toolbar, .imqw-composer-feedback:not([hidden]) {
  display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px;
}
.imqw-composer-toolbar button { flex: none; white-space: nowrap; }
.imqw-compose-as { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.imqw-compose-shortcut { white-space: nowrap; }
.imqw-composer-toolbar button.imqw-send {
  min-height: 32px;
  background: var(--dsw-alias-button-info-fill);
  color: light-dark(#fff, #15171a);
}
@media (hover: hover) {
  .imqw-composer-toolbar button.imqw-send:hover:not(:disabled) {
    background: color-mix(in srgb, var(--dsw-alias-button-info-fill) 93%, black);
  }
}
.imqw-composer-attachment {
  display: flex; align-items: center; gap: 6px; min-width: 0; padding-inline: 7px 2px;
  border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-secondary); font-size: 12px;
}
.imqw-composer-quote { border-inline-start: 2px solid var(--dsw-alias-button-info-fill); }
.imqw-composer-attachment button { margin-inline-start: auto; flex: none; }
.imqw-composer-attachment span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.imqw-composer-feedback { flex-wrap: wrap; }
@container imqq-messages (max-width: 420px) {
  .imqw-compose-shortcut { display: none; }
}
.imqw-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.imqw-muted {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.imqw-layout .imqw-tree-caption { margin-bottom: 10px; }
.imqw-tree input[type='search'], .imqw-tree > :has(> input[type='search']) {
  box-sizing: border-box;
  width: 100%;
}
.imqw-tree > * + * { margin-top: 8px; }
.imqw-group { margin-top: 16px; }
.imqw-group > h3 {
  display: flex;
  justify-content: space-between;
  margin-bottom: 5px;
  padding-inline: 6px;
  font-size: 12px;
}
.imqw-peer-row {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-block: 3px;
  border-radius: 8px;
}
.imqw-peer-row > .imqw-chevron { flex: none; width: 26px; padding-inline: 0; justify-content: center; }
.imqw-chevron[aria-expanded='false'] svg { transform: rotate(-90deg); }
.imqw-peer-select, .imqw-session {
  appearance: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 6px 5px;
  border: 0;
  border-radius: 7px;
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: pointer;
  background: transparent;
}
.imqw-peer-select { flex: 1; }
.imqw-peer-select strong, .imqw-session-title {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.imqw-session:hover, .imqw-peer-select:hover, .imqw-robots .imqr-select:hover {
  background: var(--dsw-alias-bg-layer-3);
}
.imqw-session:disabled { cursor: default; opacity: .65; }
.imqw-session:focus-visible, .imqw-peer-select:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);
  outline-offset: -2px;
}
.imqw-sessions {
  margin: 0 0 8px 15px;
  padding-left: 11px;
  border-left: 1px solid var(--dsw-alias-border-l2);
  list-style: none;
}
.imqw-session { width: 100%; }
.imqw-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.imqw-settings .imqw-form { min-height: 100%; gap: 0; }
.imqw-settings:has(> .imqw-extension-settings) .imqw-form { min-height: 0; }
.imqw-settings-group { border-top: 1px solid var(--dsw-alias-border-l2); }
.imqw-settings-group > summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-block: 12px;
  font-size: 13px;
  cursor: pointer;
  list-style: none;
}
.imqw-settings-group > summary::-webkit-details-marker { display: none; }
.imqw-settings-group > summary > svg { flex: none; }
.imqw-settings-group:not([open]) > summary > svg { transform: rotate(-90deg); }
.imqw-settings-group > summary > .imqw-muted { margin-inline-start: auto; text-align: end; }
.imqw-settings-group-body { display: grid; gap: 12px; min-width: 0; padding-bottom: 12px; }
.imqw-group-guide-heading { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.imqw-group-guide-heading button { flex: none; }
.imqw-group-guide-dialog { max-height: 100%; }
.imqw-group-guide-scroll { min-height: 0; overflow-y: auto; }
.imqw-group-guide-image { display: block; width: 100%; height: auto; border-radius: 6px; }
.imqw-settings-meta > summary { color: var(--dsw-alias-label-tertiary); font-size: 12px; cursor: pointer; }
.imqw-settings-meta[open] > summary { margin-bottom: 8px; }
.imqw-settings summary:focus-visible { outline: 2px solid var(--dsw-focus-ring-color); outline-offset: 2px; }
.imqw-defaults-form { max-width: 620px; }
.imqw-details {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 6px 12px;
  margin: 0;
  font-size: 12px;
}
.imqw-details dt { color: var(--dsw-alias-label-tertiary); }
.imqw-details dd { margin: 0; overflow-wrap: anywhere; }
.imqw-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.imqw-field input { width: 100%; min-width: 0; }
.imqw-receiving { font-size: 13px; }
.imqw-form > footer { justify-content: flex-end; }
.imqw-savebar {
  position: sticky;
  bottom: 0;
  padding-block: 10px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}
.imqw-settings .imqw-savebar { margin-top: auto; background: var(--dsw-alias-bg-layer-2); }
.imqw-agent-fields, .imqw-model-fields { display: grid; gap: 12px; min-width: 0; }
.imqw-prompt-editor {
  display: grid; gap: 8px; min-width: 0; padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
  font-size: 13px;
}
.imqw-prompt-fields { display: grid; gap: 8px; min-width: 0; }
.imqw-prompt-toolbar, .imqw-prompt-status {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;
}
.imqw-prompt-path { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.imqw-prompt-path input { flex: 1 1 180px; min-width: 0; }
.imqw-prompt-path button { flex: none; }
.imqw-prompt-surface {
  box-sizing: border-box; height: 128px; min-height: 106px; max-height: 340px;
  overflow: hidden; resize: vertical;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-3);
}
.imqw-prompt-surface > [role='tabpanel'] { height: 100%; }
.imqw-prompt-surface :is(textarea, .imqw-prompt-preview) {
  display: block; box-sizing: border-box; width: 100%; height: 100%; margin: 0;
  padding: 9px 10px; overflow: auto; border: 0; background: transparent; color: inherit;
  font: inherit; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; resize: none;
}
.imqw-prompt-surface:has(:focus-visible) {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);
  outline-offset: 1px;
}
.imqw-prompt-surface :is(textarea, .imqw-prompt-preview):focus-visible { outline: none; }
.imqw-prompt-editor p { margin: 0; }
.imqw-current-session {
  display: grid; justify-items: start; gap: 6px; min-width: 0;
  padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md); font-size: 13px;
}
.imqw-agent-default-heading { font-size: 13px; }
.imqw-current-session p, .imqw-agent-default-heading p, .imqw-receiving p { margin: 0; }
.imqw-tools-modal { width: min(720px, 100%); max-height: 100%; }
.imqw-tools-content { min-height: 0; overflow: auto; }
.imqw-tools-editor, .imqw-tools-templates { display: grid; gap: 8px; min-width: 0; }
.imqw-tools-editor { gap: 10px; }
.imqw-tools-editor p { margin: 0; }
.imqw-tools-templates { padding-block: 10px; border-block: 1px solid var(--dsw-alias-border-l2); }
.imqw-tools-templates .imqw-actions { align-items: center; }
.imqw-tools-combinations { display: grid; gap: 6px; }
.imqw-tools-section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; }
.imqw-combination-list { max-height: 106px; overflow: auto; }
.imqw-tools-templates button[aria-pressed='true'] { background: var(--dsw-alias-bg-layer-3); }
.imqw-tools-combination {
  display: flex; min-width: 0; max-width: 100%;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm);
}
.imqw-tools-combination > button:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.imqw-tools-combination-input, .imqw-tools-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.imqw-tools-combination-input input, .imqw-tools-filters input[type='search'] { min-width: 120px; flex: 1; }
.imqw-tools-combination-hint { flex-basis: 100%; }
.imqw-tools-selected {
  display: grid; gap: 6px; min-width: 0; padding: 6px 10px 8px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
}
.imqw-selected-list {
  display: flex; flex-wrap: wrap; gap: 6px; max-height: 104px; overflow: auto; margin: 0; padding: 0; list-style: none;
}
.imqw-selected-list li {
  display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%;
  padding-inline-start: 7px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-3); font-size: 12px;
}
.imqw-selected-list code, .imqw-tool-changes code { overflow-wrap: anywhere; }
.imqw-selected-list button { flex: none; padding-inline: 6px; height: 24px; }
.imqw-tool-changes {
  display: grid; gap: 3px; max-height: 100px; overflow: auto; padding-top: 6px;
  border-top: 1px solid var(--dsw-alias-border-l2); font-size: 12px;
}
.imqw-tools-categories, .imqw-tools-bulk { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.imqw-tool-list {
  max-height: min(36vh, 320px); overflow: auto;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
}
.imqw-tool-group + .imqw-tool-group { border-top: 1px solid var(--dsw-alias-border-l2); }
.imqw-tool-group-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 8px 2px 12px;
  position: sticky; z-index: 1; top: 0; background: var(--dsw-alias-bg-layer-3); font-size: 12px;
}
.imqw-tool-check { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; font-size: 13px; }
.imqw-tool-check input { flex: none; margin: 2px 0 0; accent-color: var(--dsw-focus-ring-color); }
.imqw-tool-list .imqw-tool-check { padding: 8px 12px; overflow-wrap: anywhere; }
.imqw-tool-list .imqw-tool-check:is(:hover, :focus-within) { background: var(--dsw-alias-bg-layer-3); }
.imqw-tool-list .imqw-tool-check span { min-width: 0; }
.imqw-tool-list small { display: block; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.imqw-tools-footer { width: 100%; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
:is(.imqw-agent-fields, .imqw-tools-editor) .imqq-selectAnchor { min-width: 0; }
:is(.imqw-agent-fields, .imqw-tools-editor) .imqq-select {
  width: 100%;
  min-height: 30px;
  height: auto;
  justify-content: space-between;
  padding-block: 5px;
  text-align: left;
}
:is(.imqw-agent-fields, .imqw-tools-editor) .imqq-selectValue { min-width: 0; white-space: normal; overflow-wrap: anywhere; }
:is(.imqw-agent-fields, .imqw-tools-editor) .imqq-select svg { flex: none; }
.imqq-selectChoice { display: grid; gap: 2px; overflow-wrap: anywhere; }
.imqq-selectDescription { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.imqw-conflict { display: flex; flex-wrap: wrap; gap: 8px; }
.imqw-small-nav { display: none; }
@container imqq-workbench (max-width: 920px) {
  .imqw-conversation-grid > :is(aside, section) { padding: 12px; }
  .imqw-layout .imqr-rail > .imqr-header { justify-content: center; }
  .imqw-layout .imqr-rail > .imqr-header h2, .imqw-layout .imqr-rail .imqb-status-meta { display: none; }
  .imqw-layout .imqr-header .imqr-actions { justify-content: center; }
  .imqw-layout .imqr-select { justify-content: center; }
}
.imqw-layout[data-single-page='true'] .imqw-conversation-grid {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) auto;
}
.imqw-layout[data-single-page='true'] .imqw-conversation-grid > :is(.imqw-tree, .imqw-conversation, .imqw-settings) {
  display: none;
  grid-area: 1 / 1;
}
.imqw-layout[data-single-page='true'] [data-page='list'] > .imqw-tree,
.imqw-layout[data-single-page='true'] [data-page='settings'] > .imqw-settings { display: block; }
.imqw-layout[data-single-page='true'] [data-page='conversation'] > .imqw-conversation { display: flex; }
.imqw-layout .imqw-conversation-grid > .imqw-settings[hidden] { display: none; }
.imqw-layout[data-single-page='true'] .imqw-small-nav {
  display: flex;
  grid-row: 2;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 8px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
@container imqq-workbench (max-width: 540px) {
  .imqw-robot-settings { padding: 16px 12px; }
  .imqw-robot-settings .imqb2-head:has([role='tablist']) {
    align-items: stretch;
    flex-direction: column;
  }
}
`;
		//#endregion
		//#region src/shared/workbench-agent-settings.ts
		const WORKBENCH_DEFAULTS_PATH = "/api/qqbot/workbench/defaults";
		const WORKBENCH_TOOLS_PATH = "/api/qqbot/workbench/tools";
		const WORKBENCH_PROMPT_PREVIEW_PATH = "/api/qqbot/workbench/prompt-preview";
		const WORKBENCH_PROMPT_PATH_LIMIT = 4096;
		const WORKBENCH_BASE_PERMISSIONS = [
			"read-only",
			"workspace-write",
			"danger-full-access"
		];
		//#endregion
		//#region src/client/host-selectors.ts
		/** Validate the Host catalog once; no UI-only permission ids are introduced. */
		function parsePermissionCatalog(response, localize) {
			const value = remoteValue(response);
			if (!Array.isArray(value.options)) throw new Error("权限目录返回格式无效。");
			const options = [];
			const seen = /* @__PURE__ */ new Set();
			for (const candidate of value.options) {
				const option = record(candidate);
				const id = text(option?.value);
				if (option === void 0 || id === void 0 || seen.has(id)) throw new Error("权限目录含无效或重复的条目。");
				seen.add(id);
				const name = text(option.name) ?? id;
				options.push({
					value: id,
					name: localize?.(id, name) ?? name,
					description: text(option.description)
				});
			}
			return {
				options,
				defaultPreset: text(value.defaultPreset)
			};
		}
		function record(value) {
			return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
		}
		function text(value) {
			return typeof value === "string" && value.trim() !== "" ? value : void 0;
		}
		/** Unwrap the host RemoteResult before projecting the fields used by the menu. */
		function remoteValue(response) {
			const result = record(response);
			if (result?.ok === false) throw new Error(text(record(result.error)?.message) ?? "宿主目录读取失败。");
			const value = result?.ok === true ? record(result.value) : void 0;
			if (value === void 0) throw new Error("宿主目录返回格式无效。");
			return value;
		}
		function parseModelCatalog(response) {
			const value = remoteValue(response);
			if (!Array.isArray(value.groups) || !Array.isArray(value.failures)) throw new Error("模型目录返回格式无效。");
			const groups = [];
			const failures = [];
			const seenProviders = /* @__PURE__ */ new Set();
			for (const candidate of value.groups) {
				const group = record(candidate);
				const id = text(group?.id);
				if (group === void 0 || id === void 0 || !Array.isArray(group.models) || seenProviders.has(id)) {
					failures.push("有提供方条目格式无效或重复");
					continue;
				}
				seenProviders.add(id);
				const models = [];
				const seenModels = /* @__PURE__ */ new Set();
				for (const candidateModel of group.models) {
					const model = record(candidateModel);
					const modelId = text(model?.id);
					if (model === void 0 || modelId === void 0 || seenModels.has(modelId)) {
						failures.push(`${text(group.name) ?? id} 有模型条目格式无效或重复`);
						continue;
					}
					seenModels.add(modelId);
					const reasoning = record(model.reasoning);
					const efforts = Array.isArray(reasoning?.efforts) ? reasoning.efforts.flatMap((candidateEffort) => {
						const effort = record(candidateEffort);
						const effortId = text(effort?.id);
						if (effort === void 0 || effortId === void 0) return [];
						return [{
							id: effortId,
							name: text(effort.name) ?? effortId,
							...text(effort.description) === void 0 ? {} : { description: text(effort.description) }
						}];
					}) : [];
					models.push({
						provider: id,
						model: modelId,
						name: text(model.name) ?? modelId,
						description: text(model.description),
						efforts,
						defaultEffort: text(reasoning?.defaultEffort)
					});
				}
				groups.push({
					id,
					name: text(group.name) ?? id,
					models
				});
			}
			for (const candidate of value.failures) {
				const failure = record(candidate);
				failures.push(`${text(failure?.name) ?? text(failure?.id) ?? "未知提供方"}：${text(failure?.message) ?? "目录加载失败"}`);
			}
			const defaultValue = record(value.default);
			const provider = text(defaultValue?.provider);
			const model = text(defaultValue?.model);
			return {
				groups,
				failures: [...new Set(failures)],
				defaultModel: provider === void 0 || model === void 0 ? void 0 : {
					provider,
					model
				}
			};
		}
		function parseAgentPresets(response, localize) {
			const value = remoteValue(response);
			if (!Array.isArray(value.presets)) throw new Error("Agent 预设目录返回格式无效。");
			const presets = [];
			const seen = /* @__PURE__ */ new Set();
			for (const candidate of value.presets) {
				const preset = record(candidate);
				const id = text(preset?.id);
				if (preset === void 0 || id === void 0 || seen.has(id)) throw new Error("Agent 预设目录含无效或重复的条目。");
				if (preset.broken !== void 0 && typeof preset.broken !== "string") throw new Error("Agent 预设状态格式无效。");
				seen.add(id);
				presets.push({
					id,
					name: text(preset.name) ?? localize?.(id) ?? id,
					description: text(preset.description),
					broken: typeof preset.broken === "string" ? preset.broken : void 0,
					isDefault: preset.isDefault === true
				});
			}
			return presets;
		}
		function modelChoiceId(selection) {
			return `model:${JSON.stringify([selection.provider, selection.model])}`;
		}
		function findModel(directory, selection) {
			return directory?.groups.find((group) => group.id === selection.provider)?.models.find((model) => model.model === selection.model);
		}
		/** Read the same next selection and catalog fallback as the native input box. */
		function sessionModelLabel(projection, directory) {
			const next = record(projection)?.next;
			const selection = next === null ? directory?.defaultModel : record(next);
			const provider = text(selection?.provider);
			const id = text(selection?.model);
			if (!provider || !id) return void 0;
			const model = findModel(directory, {
				provider,
				model: id
			});
			const effort = text(record(next)?.reasoningEffort) ?? model?.defaultEffort;
			return [model?.name ?? id, model?.efforts.find((option) => option.id === effort)?.name ?? effort].filter(Boolean).join(" · ");
		}
		/** Resolve a model route to a human label without an inherit fallback. */
		function routeLabel(directory, selection) {
			const model = findModel(directory, selection);
			const fallback = `${selection.provider || "未指定提供方"} / ${selection.model || "未指定模型"}`;
			return model === void 0 ? `${fallback}${directory === null ? "" : "（不可用）"}` : `${directory?.groups.find((group) => group.id === selection.provider)?.name ?? selection.provider} / ${model.name}`;
		}
		/** Label for "inherit": show the host's actual default route when it is known. */
		function defaultModelLabel(directory) {
			return directory?.defaultModel ? `DSH 默认：${routeLabel(directory, directory.defaultModel)}` : "DSH 默认";
		}
		/** Label for "inherit" preset: show the host's actual default preset when it is known. */
		function defaultPresetLabel(presets) {
			const preset = presets?.find((candidate) => candidate.isDefault);
			return preset ? `DSH 默认：${preset.name}` : "DSH 默认";
		}
		//#endregion
		//#region src/client/qq-select.ts
		/** Public host menu and button semantics, shared by all QQ settings selectors. */
		function QQSelect({ label, value, onChange, options, placeholder = "请选择", disabled = false, onOpen }) {
			const [open, setOpen] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (disabled) setOpen(false);
			}, [disabled]);
			const selected = options.find((option) => option.value === value);
			const missing = value !== "" && selected === void 0;
			const visible = selected?.label ?? (missing ? `${value}（当前值不可用）` : placeholder);
			const choices = missing ? [{
				value,
				label: visible,
				disabled: true
			}, ...options] : options;
			return (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
				open: open && !disabled,
				onClose: () => setOpen(false),
				portal: true,
				autoFocus: true,
				minWidthFromAnchor: true,
				className: "imqq-selectAnchor",
				listClassName: "imqq-selectMenu",
				selectedId: `option:${value}`,
				items: choices.length ? choices.map((option) => ({
					id: `option:${option.value}`,
					disabled: option.disabled,
					label: (0, react.createElement)("span", { className: "imqq-selectChoice" }, (0, react.createElement)("span", null, option.label), option.description ? (0, react.createElement)("span", { className: "imqq-selectDescription" }, option.description) : null)
				})) : [{
					id: "empty",
					label: "暂无可选项",
					disabled: true
				}],
				onSelect: (id) => {
					const option = options.find((item) => `option:${item.value}` === id);
					if (disabled || option === void 0 || option.disabled) return;
					onChange(option.value);
					setOpen(false);
				},
				anchor: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					className: "imqq-select",
					disabled,
					"aria-label": `${label}：${visible}`,
					"aria-haspopup": "menu",
					"aria-expanded": open && !disabled,
					title: visible,
					onClick: () => {
						if (!open) onOpen?.();
						setOpen((current) => !current);
					}
				}, (0, react.createElement)("span", { className: "imqq-selectValue" }, visible), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 14 }))
			});
		}
		//#endregion
		//#region src/prompt/extra.ts
		const EXTRA_MAX_CHARS = 8e4;
		//#endregion
		//#region src/client/prompt-editor.ts
		function PromptEditor({ label, value, hint, disabled, onChange }) {
			const id = (0, react.useId)();
			const [page, setPage] = (0, react.useState)("edit");
			const [job, setJob] = (0, react.useState)();
			const [result, setResult] = (0, react.useState)();
			const alternate = (0, react.useRef)({
				text: "",
				path: ""
			});
			const path = typeof value === "string" ? void 0 : value.path;
			const activeJob = path === job?.path ? job : void 0;
			const preview = activeJob && result?.job === activeJob ? result : void 0;
			const reading = activeJob !== void 0 && preview === void 0;
			(0, react.useEffect)(() => {
				if (!activeJob) return;
				const controller = new AbortController();
				fetchJson(WORKBENCH_PROMPT_PREVIEW_PATH, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ path: activeJob.path }),
					signal: controller.signal
				}).then((response) => {
					if (!controller.signal.aborted) setResult({
						job: activeJob,
						kind: "ready",
						text: response.text
					});
				}, (error) => {
					if (!controller.signal.aborted) setResult({
						job: activeJob,
						kind: "error",
						message: error instanceof Error ? error.message : "无法预览补充提示词。"
					});
				});
				return () => controller.abort();
			}, [activeJob]);
			const changeSource = (mode) => {
				if (mode === "file" && typeof value === "string") {
					alternate.current.text = value;
					onChange({
						kind: "file",
						path: alternate.current.path
					});
				} else if (mode === "text" && typeof value !== "string") {
					alternate.current.path = value.path;
					onChange(alternate.current.text);
				}
				setJob(void 0);
			};
			const read = () => {
				if (path?.trim() && !disabled && !reading) setJob({ path });
			};
			const text = typeof value === "string" ? value : preview?.kind === "ready" ? preview.text : void 0;
			const brace = text?.indexOf("{{") ?? -1;
			const hasVariables = text !== void 0 && brace >= 0 && text.indexOf("}}", brace + 2) >= 0;
			return (0, react.createElement)("div", { className: "imqw-prompt-fields" }, (0, react.createElement)("div", { className: "imqw-prompt-toolbar" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.SegmentedControl, {
				id: `${id}-source`,
				label: `${label}来源`,
				value: path === void 0 ? "text" : "file",
				onChange: changeSource,
				disabled,
				options: [{
					value: "text",
					label: "直接输入"
				}, {
					value: "file",
					label: "文件路径"
				}]
			}), path === void 0 ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.SegmentedControl, {
				id,
				label: `${label}视图`,
				value: page,
				onChange: setPage,
				options: [{
					value: "edit",
					label: "编辑"
				}, {
					value: "preview",
					label: "预览"
				}]
			}) : null), typeof value === "string" ? (0, react.createElement)("div", { className: "imqw-prompt-surface" }, (0, react.createElement)("div", {
				role: "tabpanel",
				id: `${id}-edit-panel`,
				"aria-labelledby": `${id}-edit`,
				hidden: page !== "edit"
			}, (0, react.createElement)("textarea", {
				value,
				maxLength: EXTRA_MAX_CHARS,
				disabled,
				"aria-label": label,
				placeholder: `输入${label}`,
				onChange: (event) => onChange(event.currentTarget.value)
			})), (0, react.createElement)("div", {
				role: "tabpanel",
				id: `${id}-preview-panel`,
				"aria-labelledby": `${id}-preview`,
				hidden: page !== "preview"
			}, (0, react.createElement)("pre", {
				className: "imqw-prompt-preview",
				"aria-label": `${label}预览`,
				tabIndex: 0
			}, value || "暂无补充提示词。"))) : (0, react.createElement)(react.Fragment, null, (0, react.createElement)("div", { className: "imqw-prompt-path" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				"aria-label": `${label}文件路径`,
				placeholder: "输入 DSH 宿主上的绝对文件路径",
				value: value.path,
				maxLength: WORKBENCH_PROMPT_PATH_LIMIT,
				disabled,
				onChange: (event) => {
					setJob(void 0);
					onChange({
						kind: "file",
						path: event.currentTarget.value
					});
				},
				onKeyDown: (event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						read();
					}
				}
			}), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "outline",
				disabled: disabled || reading || !value.path.trim(),
				"aria-label": `预览${label}文件`,
				onClick: read
			}, reading ? "正在读取…" : preview?.kind === "ready" ? "刷新预览" : "预览文件")), reading ? (0, react.createElement)("p", {
				className: "imqw-muted",
				role: "status"
			}, "正在读取提示词文件…") : null, preview?.kind === "ready" ? (0, react.createElement)("div", { className: "imqw-prompt-surface" }, (0, react.createElement)("pre", {
				className: "imqw-prompt-preview",
				"aria-label": `${label}预览`,
				tabIndex: 0
			}, preview.text || "文件内容为空。")) : null, preview?.kind === "error" ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, preview.message) : null), (0, react.createElement)("div", { className: "imqw-prompt-status imqw-muted" }, (0, react.createElement)("span", null, path === void 0 ? hint : "支持 MD、TXT、DOCX。保存路径后，每次组装请求都会读取文件。"), text !== void 0 ? (0, react.createElement)("span", null, `${text.length.toLocaleString("zh-CN")} / ${EXTRA_MAX_CHARS.toLocaleString("zh-CN")}`) : null), hasVariables ? (0, react.createElement)("p", { className: "imqw-muted" }, "含 {{…}}，DSH 会在组装提示词时解析变量。") : null);
		}
		//#endregion
		//#region src/client/workbench-tool-combinations.ts
		const fileAndSearchTools = [
			"skill",
			"read",
			"read_image",
			"grep",
			"glob",
			"qqbot_group_history"
		];
		const BUILT_IN_TOOL_COMBINATIONS = [{
			id: "read-files",
			label: "只读：文件与搜索",
			tools: fileAndSearchTools
		}, {
			id: "read-web",
			label: "只读 + 网页",
			tools: [
				...fileAndSearchTools,
				"web_search",
				"web_fetch"
			]
		}];
		const storageKey = "im-qqbot/tool-presets/v1";
		function readToolCombinations(storage) {
			try {
				const raw = JSON.parse(storage.getItem(storageKey) ?? "null");
				if (!Array.isArray(raw)) return [];
				const combinations = /* @__PURE__ */ new Map();
				for (const item of raw) {
					if (!item || typeof item !== "object" || !("id" in item) || !("label" in item) || !("tools" in item)) continue;
					const { id, label, tools } = item;
					if (typeof id !== "string" || typeof label !== "string" || !Array.isArray(tools) || combinations.has(id)) continue;
					combinations.set(id, {
						id,
						label,
						tools: tools.filter((tool) => typeof tool === "string")
					});
				}
				return [...combinations.values()];
			} catch {
				return [];
			}
		}
		function writeToolCombinations(storage, combinations) {
			storage.setItem(storageKey, JSON.stringify(combinations));
		}
		function applyToolCombination(names, available, current) {
			const unique = [...new Set(names)].sort();
			const tools = unique.filter((name) => available.has(name));
			const next = new Set(tools);
			return {
				tools,
				added: tools.filter((name) => !current.has(name)),
				removed: [...current].filter((name) => !next.has(name)).sort(),
				skipped: unique.filter((name) => !available.has(name))
			};
		}
		//#endregion
		//#region src/client/workbench-tool-picker.ts
		const categories = [
			{
				id: "file",
				label: "文件",
				names: [
					"read",
					"read_image",
					"write",
					"edit"
				]
			},
			{
				id: "search",
				label: "搜索",
				names: [
					"grep",
					"glob",
					"qqbot_group_history"
				]
			},
			{
				id: "network",
				label: "联网",
				names: [
					"web_search",
					"web_fetch",
					"fetch",
					"search"
				]
			},
			{
				id: "execution",
				label: "命令与代码",
				names: [
					"bash",
					"run_code",
					"python",
					"exec_command"
				]
			},
			{
				id: "mcp",
				label: "MCP",
				names: []
			},
			{
				id: "attachment",
				label: "附件与交付",
				names: ["qqbot_send_file", "present"]
			},
			{
				id: "other",
				label: "其他",
				names: []
			},
			{
				id: "unavailable",
				label: "当前不可用",
				names: []
			}
		];
		function categoryOf(name) {
			return name.startsWith("mcp__") ? "mcp" : categories.find((category) => category.names.includes(name))?.id ?? "other";
		}
		function browserCombinations() {
			try {
				return readToolCombinations(window.localStorage);
			} catch {
				return [];
			}
		}
		function WorkbenchToolPicker({ initialPermission, initialTools, permissions, preset, disabled, onCancel, onConfirm }) {
			const [permission, setPermission] = (0, react.useState)(initialPermission);
			const [tools, setTools] = (0, react.useState)(() => [...initialTools]);
			const [catalog, setCatalog] = (0, react.useState)();
			const [query, setQuery] = (0, react.useState)("");
			const [category, setCategory] = (0, react.useState)("");
			const [onlySelected, setOnlySelected] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)("");
			const [attempt, setAttempt] = (0, react.useState)(0);
			const [combinations, setCombinations] = (0, react.useState)(browserCombinations);
			const [creating, setCreating] = (0, react.useState)(false);
			const nameInput = (0, react.useRef)(null);
			const [combinationName, setCombinationName] = (0, react.useState)("");
			const [combinationError, setCombinationError] = (0, react.useState)("");
			const [applied, setApplied] = (0, react.useState)();
			(0, react.useEffect)(() => {
				if (creating) nameInput.current?.focus();
			}, [creating]);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				setCatalog(void 0);
				setError("");
				fetchJson(`${WORKBENCH_TOOLS_PATH}?${new URLSearchParams({ preset })}`, {
					cache: "no-store",
					signal: controller.signal
				}).then((result) => {
					if (!controller.signal.aborted) setCatalog(result.tools);
				}, (cause) => {
					if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "无法读取工具目录。");
				});
				return () => controller.abort();
			}, [preset, attempt]);
			const selected = new Set(tools);
			const available = new Set(catalog?.map((tool) => tool.name));
			const choices = catalog ? [...catalog.map((tool) => ({
				...tool,
				category: categoryOf(tool.name)
			})), ...tools.filter((name) => !available.has(name)).map((name) => ({
				name,
				description: "当前 Agent 预设未提供",
				category: "unavailable"
			}))] : [];
			const term = query.trim().toLocaleLowerCase();
			const matching = choices.filter((tool) => (!category || tool.category === category) && (!onlySelected || selected.has(tool.name)) && `${tool.name} ${tool.description ?? ""}`.toLocaleLowerCase().includes(term));
			const visibleNames = matching.map((tool) => tool.name);
			const ready = !disabled && catalog !== void 0;
			const exceedsLimit = tools.length > 512;
			const updateSelection = (names, checked) => {
				setApplied(void 0);
				setTools((previous) => {
					if (checked) return [.../* @__PURE__ */ new Set([...previous, ...names.filter((name) => available.has(name))])].sort();
					const removed = new Set(names);
					return previous.filter((name) => !removed.has(name));
				});
			};
			const bulk = (names, selectLabel, removeLabel) => {
				const allSelected = names.every((name) => selected.has(name));
				return (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					type: "button",
					size: "sm",
					variant: "ghost",
					disabled: !ready || names.length === 0,
					onClick: () => updateSelection(names, !allSelected)
				}, allSelected && names.length ? removeLabel : selectLabel);
			};
			const combinationButton = (combination, origin) => {
				const key = `${origin}:${combination.id}`;
				return (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					key,
					type: "button",
					size: "sm",
					variant: "outline",
					disabled: !ready,
					title: `${combination.label} · ${combination.tools.length} 项`,
					"aria-pressed": applied?.key === key,
					onClick: () => {
						const { tools, added, removed, skipped } = applyToolCombination(combination.tools, available, selected);
						setTools(tools);
						setApplied({
							key,
							label: combination.label,
							added,
							removed,
							skipped
						});
					}
				}, combination.label);
			};
			const updateCombinations = (change) => {
				try {
					const storage = window.localStorage;
					const next = change(readToolCombinations(storage));
					writeToolCombinations(storage, next);
					setCombinations(next);
					setCombinationError("");
					return true;
				} catch {
					setCombinationError("本浏览器无法保存工具组合。");
					return false;
				}
			};
			const closeCreate = () => {
				setCreating(false);
				setCombinationName("");
				setCombinationError("");
			};
			const saveCombination = () => {
				const label = combinationName.trim();
				if (!ready || !tools.length || exceedsLimit || !label) return;
				if (combinations.some((combination) => combination.label === label)) {
					setCombinationError("已有同名组合。");
					return;
				}
				const id = globalThis.crypto.randomUUID?.() ?? `u${Date.now()}-${Math.random().toString(36).slice(2)}`;
				if (updateCombinations((previous) => [...previous, {
					id,
					label,
					tools
				}])) closeCreate();
			};
			return (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				title: "自定义工具",
				closeLabel: "关闭工具选择",
				onClose: onCancel,
				className: "imqw-tools-modal",
				contentClassName: "imqw-tools-content",
				footer: (0, react.createElement)("div", { className: "imqw-tools-footer" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					type: "button",
					size: "sm",
					variant: "ghost",
					onClick: onCancel
				}, "取消"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					type: "button",
					size: "sm",
					variant: "primary",
					disabled: !ready || exceedsLimit || !permissions.some((option) => option.value === permission),
					onClick: () => onConfirm(permission, tools)
				}, "确认选择"))
			}, (0, react.createElement)("div", { className: "imqw-tools-editor" }, (0, react.createElement)("div", { className: "imqw-field" }, (0, react.createElement)("span", null, "权限上限"), (0, react.createElement)(QQSelect, {
				label: "权限上限",
				value: permission,
				options: permissions,
				disabled,
				onChange: setPermission
			}), (0, react.createElement)("p", { className: "imqw-muted" }, "当前 Session 的原生权限高于上限时，所选工具会暂停使用。")), (0, react.createElement)("div", { className: "imqw-tools-templates" }, (0, react.createElement)("div", { className: "imqw-actions" }, (0, react.createElement)("span", { className: "imqw-muted" }, "内置模板"), ...BUILT_IN_TOOL_COMBINATIONS.map((combination) => combinationButton(combination, "built-in"))), (0, react.createElement)("section", {
				className: "imqw-tools-combinations",
				"aria-label": "我的组合"
			}, (0, react.createElement)("div", { className: "imqw-tools-section-head" }, (0, react.createElement)("strong", null, "我的组合"), !creating ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "outline",
				disabled,
				onClick: () => {
					setCombinationError("");
					setCreating(true);
				}
			}, "新建组合") : null), combinations.length ? (0, react.createElement)("div", { className: "imqw-actions imqw-combination-list" }, ...combinations.map((combination) => (0, react.createElement)("div", {
				className: "imqw-tools-combination",
				key: combination.id
			}, combinationButton(combination, "personal"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "ghost",
				disabled,
				"aria-label": `删除组合 ${combination.label}`,
				onClick: () => {
					if (updateCombinations((previous) => previous.filter((item) => item.id !== combination.id)) && applied?.key === `personal:${combination.id}`) setApplied(void 0);
				}
			}, "×")))) : null, creating ? (0, react.createElement)("div", { className: "imqw-tools-combination-input" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				ref: nameInput,
				value: combinationName,
				maxLength: 64,
				placeholder: "输入组合名称",
				"aria-label": "组合名称",
				disabled,
				onChange: (event) => {
					setCombinationName(event.currentTarget.value);
					setCombinationError("");
				},
				onKeyDown: (event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						saveCombination();
					}
				}
			}), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "ghost",
				onClick: closeCreate
			}, "取消新建"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "primary",
				disabled: !ready || !tools.length || exceedsLimit || !combinationName.trim(),
				onClick: saveCombination
			}, "保存组合"), (0, react.createElement)("span", { className: "imqw-muted imqw-tools-combination-hint" }, tools.length ? `保存下方已选的 ${tools.length} 项工具。` : "在下方勾选要保存的工具。")) : null, combinationError ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, combinationError) : null)), (0, react.createElement)("section", {
				className: "imqw-tools-selected",
				"aria-label": "已选工具"
			}, (0, react.createElement)("div", { className: "imqw-tools-section-head" }, (0, react.createElement)("strong", null, `已选工具（${tools.length}）`), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "ghost",
				disabled: !ready || !tools.length,
				onClick: () => updateSelection(tools, false)
			}, "清空选择")), tools.length ? (0, react.createElement)("ul", { className: "imqw-selected-list" }, ...tools.map((name) => (0, react.createElement)("li", { key: name }, (0, react.createElement)("code", null, name), catalog && !available.has(name) ? (0, react.createElement)("small", { className: "imqw-muted" }, "不可用") : null, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "ghost",
				disabled: !ready,
				"aria-label": `移除已选工具 ${name}`,
				onClick: () => updateSelection([name], false)
			}, "×")))) : (0, react.createElement)("p", { className: "imqw-muted" }, "尚未选择工具。"), applied ? (0, react.createElement)("div", {
				className: "imqw-tool-changes",
				role: "status",
				"aria-label": "组合变更"
			}, (0, react.createElement)("p", null, `已套用「${applied.label}」`), ...[
				{
					label: "新增",
					names: applied.added
				},
				{
					label: "移除",
					names: applied.removed
				},
				{
					label: "跳过（当前不可用）",
					names: applied.skipped
				}
			].filter((change) => change.names.length).map((change) => (0, react.createElement)("p", {
				key: change.label,
				className: "imqw-muted"
			}, (0, react.createElement)("span", null, `${change.label} ${change.names.length} 项 `), (0, react.createElement)("code", null, change.names.join("、"))))) : null), (0, react.createElement)("div", { className: "imqw-tools-filters" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				type: "search",
				value: query,
				placeholder: "搜索工具名称或描述",
				"aria-label": "搜索工具",
				"data-modal-autofocus": true,
				disabled,
				onChange: (event) => setQuery(event.currentTarget.value)
			}), (0, react.createElement)("label", { className: "imqw-tool-check" }, (0, react.createElement)("input", {
				type: "checkbox",
				checked: onlySelected,
				disabled,
				onChange: (event) => setOnlySelected(event.currentTarget.checked)
			}), "仅看已选")), catalog ? (0, react.createElement)("div", {
				className: "imqw-tools-categories",
				role: "group",
				"aria-label": "工具分类"
			}, ...[{
				id: "",
				label: "全部"
			}, ...categories.filter((group) => choices.some((tool) => tool.category === group.id))].map((group) => (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				key: group.id,
				type: "button",
				size: "sm",
				variant: group.id === category ? "outline" : "ghost",
				"aria-pressed": group.id === category,
				disabled,
				onClick: () => setCategory(group.id)
			}, group.label))) : null, catalog ? (0, react.createElement)("div", { className: "imqw-tools-bulk" }, bulk(visibleNames, "全选当前筛选", "取消当前筛选的勾选")) : null, error ? (0, react.createElement)("div", { className: "imqw-actions" }, (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, error), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "outline",
				disabled,
				onClick: () => setAttempt((value) => value + 1)
			}, "重试")) : null, !catalog && !error ? (0, react.createElement)("p", {
				className: "imqw-muted",
				role: "status"
			}, "正在读取工具…") : null, catalog && !matching.length ? (0, react.createElement)("p", { className: "imqw-muted" }, "没有匹配的工具。") : null, matching.length ? (0, react.createElement)("div", {
				className: "imqw-tool-list",
				role: "region",
				"aria-label": "工具列表"
			}, ...categories.map((group) => {
				const entries = matching.filter((tool) => tool.category === group.id);
				if (!entries.length) return null;
				const names = entries.map((tool) => tool.name);
				return (0, react.createElement)("section", {
					key: group.id,
					"aria-label": group.label,
					className: "imqw-tool-group"
				}, (0, react.createElement)("div", { className: "imqw-tool-group-head" }, (0, react.createElement)("strong", null, group.label), bulk(names, "全选本组", "取消本组勾选")), ...entries.map(({ name, description }) => (0, react.createElement)("label", {
					key: name,
					title: description,
					className: "imqw-tool-check"
				}, (0, react.createElement)("input", {
					type: "checkbox",
					checked: selected.has(name),
					disabled: !ready,
					"aria-label": name,
					onChange: (event) => updateSelection([name], event.currentTarget.checked)
				}), (0, react.createElement)("span", null, name, description ? (0, react.createElement)("small", null, description) : null))));
			})) : null, exceedsLimit ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, `最多可选 512 项工具。`) : null, (0, react.createElement)("p", { className: "imqw-muted" }, tools.length ? "回到设置页保存后生效。" : "保存空名单后，Session 无法调用工具。")));
		}
		//#endregion
		//#region src/client/workbench-agent-form.ts
		const noModelSubscription = () => () => {};
		const empty = {
			models: null,
			presets: [],
			permissions: { options: [] },
			errors: [],
			loading: true
		};
		function useCatalog(source, placementOnly) {
			const [catalog, setCatalog] = (0, react.useState)(empty);
			const [attempt, setAttempt] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				let active = true;
				const timeout = setTimeout(() => {
					active = false;
					setCatalog((current) => ({
						...current,
						loading: false,
						errors: ["DSH 目录加载超时。"]
					}));
				}, 1e4);
				setCatalog((current) => ({
					...current,
					loading: true,
					errors: []
				}));
				const read = async (method) => {
					if (!method) throw new Error("此宿主的目录暂不可用。");
					return method();
				};
				Promise.allSettled([
					placementOnly ? Promise.resolve(null) : read(source?.modelCatalog).then(parseModelCatalog),
					read(source?.listAgentPresets).then((response) => parseAgentPresets(response, source?.localizePreset)),
					placementOnly ? Promise.resolve(empty.permissions) : read(source?.permissionCatalog).then((response) => parsePermissionCatalog(response, source?.localizePermission))
				]).then(([models, presets, permissions]) => {
					if (!active) return;
					clearTimeout(timeout);
					setCatalog((current) => ({
						loading: false,
						models: models.status === "fulfilled" ? models.value : current.models,
						presets: presets.status === "fulfilled" ? presets.value : current.presets,
						permissions: permissions.status === "fulfilled" ? permissions.value : current.permissions,
						errors: [
							...models.status === "fulfilled" ? models.value?.failures ?? [] : ["模型目录不可用"],
							...presets.status === "fulfilled" ? [] : ["Agent 预设目录不可用"],
							...permissions.status === "fulfilled" ? [] : ["权限目录不可用"]
						]
					}));
				});
				return () => {
					active = false;
					clearTimeout(timeout);
				};
			}, [
				source,
				attempt,
				placementOnly
			]);
			return [catalog, () => setAttempt((value) => value + 1)];
		}
		const ADD_WORKSPACE = "add-workspace";
		const CUSTOM_TOOLS = "qqbot-custom-tools";
		function WorkbenchAgentFields({ settings, source, disabled, onChange, placementOnly = false, conversationDefaults = false, currentSession }) {
			const [catalog, retry] = useCatalog(source, placementOnly);
			const modelSource = source?.sessionModels;
			const sessionId = currentSession?.id;
			const projection = (0, react.useSyncExternalStore)(modelSource && sessionId ? modelSource.subscribe : noModelSubscription, () => sessionId ? modelSource?.read(sessionId) : void 0);
			(0, react.useEffect)(() => {
				if (sessionId) modelSource?.refresh(sessionId)?.catch(() => {});
			}, [modelSource, sessionId]);
			const [adding, setAdding] = (0, react.useState)(false);
			const [workspaceError, setWorkspaceError] = (0, react.useState)("");
			const [toolPickerOpen, setToolPickerOpen] = (0, react.useState)(false);
			const workspaceChange = (0, react.useRef)(void 0);
			(0, react.useLayoutEffect)(() => {
				workspaceChange.current = onChange;
				return () => {
					workspaceChange.current = void 0;
				};
			}, [onChange]);
			const addWorkspace = source?.addWorkspace;
			const pickWorkspace = async () => {
				if (!addWorkspace || adding) return;
				setAdding(true);
				setWorkspaceError("");
				try {
					const cwd = await addWorkspace();
					if (cwd) workspaceChange.current?.({ cwd });
				} catch (error) {
					setWorkspaceError(error instanceof Error ? error.message : "无法添加工作区。");
				} finally {
					setAdding(false);
				}
			};
			const models = catalog.models?.groups.flatMap((group) => group.models.map((model) => ({
				model,
				option: {
					value: modelChoiceId(model),
					label: `${group.name} / ${model.name}`,
					description: model.description
				}
			}))) ?? [];
			const route = settings.model ?? catalog.models?.defaultModel;
			const model = route && findModel(catalog.models, route);
			const defaultEffortName = model?.efforts.find((effort) => effort.id === model.defaultEffort)?.name;
			const workspaces = source?.workspaces() ?? [];
			const permissionLabel = catalog.permissions.options.find((option) => option.value === catalog.permissions.defaultPreset)?.name ?? catalog.permissions.defaultPreset;
			const nativeOptions = catalog.permissions.options.map((option) => ({
				value: option.value,
				label: option.name,
				description: option.description
			}));
			const baseOptions = WORKBENCH_BASE_PERMISSIONS.flatMap((value) => nativeOptions.filter((option) => option.value === value));
			const otherOptions = nativeOptions.filter((option) => !baseOptions.includes(option));
			const customBase = [
				settings.permission,
				catalog.permissions.defaultPreset,
				baseOptions[0]?.value
			].find((value) => baseOptions.some((option) => option.value === value));
			const capLabel = baseOptions.find((option) => option.value === settings.permission)?.label ?? settings.permission;
			const customLabel = settings.tools === void 0 ? "自定义工具" : `自定义工具 · 上限 ${capLabel} · 已选 ${settings.tools.length} 项`;
			const select = (label, value, options, onSelect, pending = false) => (0, react.createElement)("div", { className: "imqw-field" }, (0, react.createElement)("span", null, label), (0, react.createElement)(QQSelect, {
				label,
				value,
				options,
				disabled: disabled || pending,
				onChange: onSelect
			}));
			return (0, react.createElement)("div", { className: "imqw-agent-fields" }, currentSession ? (0, react.createElement)("div", { className: "imqw-current-session" }, (0, react.createElement)("strong", null, currentSession.archived ? "当前 Session（已归档）" : "当前 Session"), (0, react.createElement)("p", { className: "imqw-muted" }, sessionModelLabel(projection, catalog.models) ?? "模型与推理强度请在原生会话查看"), currentSession.placement ? (0, react.createElement)("p", { className: "imqw-muted" }, currentSession.placement) : null, currentSession.open ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "outline",
				onClick: currentSession.open
			}, "在原生会话中调整") : null) : null, conversationDefaults ? (0, react.createElement)("div", { className: "imqw-agent-default-heading" }, (0, react.createElement)("strong", null, "新建 Session 默认值"), (0, react.createElement)("p", { className: "imqw-muted" }, "模型、推理强度、预设、工作区和原生权限在新建时应用。自定义工具限制保存后生效。")) : null, catalog.loading ? (0, react.createElement)("p", {
				className: "imqw-muted",
				role: "status"
			}, "正在读取 DSH 目录…") : null, catalog.errors.length ? (0, react.createElement)("div", { className: "imqw-actions" }, (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, catalog.errors.join(" · ")), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				variant: "outline",
				size: "sm",
				onClick: retry
			}, "重试目录")) : null, !placementOnly ? (0, react.createElement)("div", { className: "imqw-model-fields" }, select("模型", settings.model ? modelChoiceId(settings.model) : "", [{
				value: "",
				label: defaultModelLabel(catalog.models)
			}, ...models.map((entry) => entry.option)], (id) => {
				const choice = models.find((entry) => entry.option.value === id)?.model;
				onChange({
					model: choice ? {
						provider: choice.provider,
						model: choice.model
					} : null,
					reasoningEffort: ""
				});
			}), model?.efforts.length || settings.reasoningEffort ? select("推理强度", settings.reasoningEffort, [{
				value: "",
				label: defaultEffortName ? `模型默认 · ${defaultEffortName}` : "模型默认"
			}, ...(model?.efforts ?? []).map((effort) => ({
				value: effort.id,
				label: effort.name,
				description: effort.description
			}))], (reasoningEffort) => onChange({ reasoningEffort })) : null) : null, select("Agent 预设", settings.preset, [{
				value: "",
				label: defaultPresetLabel(catalog.presets)
			}, ...catalog.presets.map((preset) => ({
				value: preset.id,
				label: preset.name,
				disabled: preset.broken !== void 0,
				description: preset.broken ?? preset.description
			}))], (preset) => onChange({ preset })), select("工作区", settings.cwd, [
				{
					value: "",
					label: "机器人默认目录"
				},
				...workspaces.map((workspace) => ({
					value: workspace.path,
					label: workspace.title === "default-workspace" ? "默认工作区" : workspace.title || workspace.path,
					description: workspace.path
				})),
				...settings.cwd && !workspaces.some((workspace) => workspace.path === settings.cwd) ? [{
					value: settings.cwd,
					label: settings.cwd,
					description: "已配置的工作目录"
				}] : [],
				...addWorkspace ? [{
					value: ADD_WORKSPACE,
					label: "＋ 添加工作区（选择文件夹…）"
				}] : []
			], (cwd) => {
				setWorkspaceError("");
				if (cwd === ADD_WORKSPACE) pickWorkspace();
				else onChange({ cwd });
			}, adding), workspaceError ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, workspaceError) : null, !placementOnly ? select("执行权限", settings.tools === void 0 ? settings.permission : CUSTOM_TOOLS, [
				...baseOptions,
				{
					value: CUSTOM_TOOLS,
					label: customLabel,
					description: "设置权限上限和允许的工具",
					disabled: customBase === void 0
				},
				...otherOptions,
				{
					value: "",
					label: permissionLabel ? `DSH 默认 · ${permissionLabel}` : "DSH 默认权限"
				}
			], (permission) => {
				if (permission === CUSTOM_TOOLS) setToolPickerOpen(true);
				else onChange({
					permission,
					tools: void 0
				});
			}) : null, !placementOnly && toolPickerOpen && customBase ? (0, react.createElement)(WorkbenchToolPicker, {
				key: settings.preset,
				initialPermission: customBase,
				initialTools: settings.tools ?? [],
				permissions: baseOptions,
				preset: settings.preset,
				disabled,
				onCancel: () => setToolPickerOpen(false),
				onConfirm: (permission, tools) => {
					onChange({
						permission,
						tools
					});
					setToolPickerOpen(false);
				}
			}) : null);
		}
		const promptScopes = [{
			value: "group",
			label: "群聊"
		}, {
			value: "c2c",
			label: "私聊"
		}];
		function WorkbenchReplyFields({ settings, scope, disabled, onChange }) {
			const scopeId = (0, react.useId)();
			const [promptScope, setPromptScope] = (0, react.useState)("group");
			const activeScope = scope ?? promptScope;
			const key = activeScope === "group" ? "groupPrompt" : "directPrompt";
			const label = activeScope === "group" ? "群聊补充提示词" : "私聊补充提示词";
			const title = scope ? label : "补充提示词";
			const editor = (0, react.createElement)(PromptEditor, {
				key,
				label,
				value: settings[key],
				disabled,
				onChange: (value) => onChange({ [key]: value }),
				hint: scope ? "保存后，下次组装模型请求时读取。" : void 0
			});
			return (0, react.createElement)("div", { className: "imqw-agent-fields" }, (0, react.createElement)("section", {
				className: "imqw-prompt-editor",
				"aria-label": title
			}, (0, react.createElement)("div", { className: "imqw-prompt-toolbar" }, (0, react.createElement)("h3", null, title), scope ? null : (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.SegmentedControl, {
				id: scopeId,
				label: "补充提示词场景",
				value: promptScope,
				onChange: setPromptScope,
				options: promptScopes
			})), scope ? editor : promptScopes.map(({ value }) => (0, react.createElement)("div", {
				key: value,
				role: "tabpanel",
				id: `${scopeId}-${value}-panel`,
				"aria-labelledby": `${scopeId}-${value}`,
				hidden: value !== promptScope
			}, value === promptScope ? editor : null))), scope !== "c2c" ? (0, react.createElement)("p", { className: "imqw-receiving imqw-muted" }, "群聊生成完成后发送整条回复。") : null, ...[[
				"streaming",
				"私聊流式输出",
				"保存后下一轮生效，仅限被动回复。"
			], [
				"showToolResults",
				"显示工具成功结果",
				"仅在整轮失败时向 QQ 发送简短提示。"
			]].filter(([key]) => key !== "streaming" || scope !== "group").map(([key, label, hint]) => (0, react.createElement)("div", {
				className: "imqw-receiving",
				key
			}, (0, react.createElement)("div", null, (0, react.createElement)("span", null, label), (0, react.createElement)("p", { className: "imqw-muted" }, hint)), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
				label,
				checked: settings[key],
				disabled,
				onChange: (value) => onChange({ [key]: value })
			}))));
		}
		//#endregion
		//#region src/client/agent-settings-draft.ts
		function agentSettingsPatch(baseline, draft) {
			const patch = {};
			const keys = Object.keys({
				...baseline,
				...draft
			});
			const copyChange = (key) => {
				if (JSON.stringify(baseline[key]) !== JSON.stringify(draft[key])) patch[key] = draft[key];
			};
			for (const key of keys) copyChange(key);
			return patch;
		}
		//#endregion
		//#region src/client/workbench-settings-group.ts
		function SettingsGroup({ title, hint, defaultOpen, children }) {
			return (0, react.createElement)("details", {
				className: "imqw-settings-group",
				open: defaultOpen
			}, (0, react.createElement)("summary", null, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 14 }), (0, react.createElement)("strong", null, title), hint ? (0, react.createElement)("span", { className: "imqw-muted" }, hint) : null), (0, react.createElement)("div", { className: "imqw-settings-group-body" }, children));
		}
		//#endregion
		//#region src/client/workbench-defaults.ts
		function readDefaults(appId, signal) {
			return fetchJson(`${WORKBENCH_DEFAULTS_PATH}?${new URLSearchParams({ appId })}`, {
				cache: "no-store",
				signal
			});
		}
		const drafts = /* @__PURE__ */ new Map();
		function changes$1(draft) {
			return agentSettingsPatch(draft.base.settings, draft.settings);
		}
		function WorkbenchDefaultsForm({ appId, bindingRevision = 0, source }) {
			const key = JSON.stringify([appId, bindingRevision]);
			const [draft, setDraft] = (0, react.useState)(() => drafts.get(key));
			const currentDraft = (0, react.useRef)(draft);
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)("");
			const [notice, setNotice] = (0, react.useState)("");
			const [conflict, setConflict] = (0, react.useState)(false);
			const [loading, setLoading] = (0, react.useState)(true);
			const request = (0, react.useRef)();
			const dirty = draft !== void 0 && Object.keys(changes$1(draft)).length > 0;
			const replace = (next) => {
				if (Object.keys(changes$1(next)).length) drafts.set(key, next);
				else drafts.delete(key);
				currentDraft.current = next;
				setDraft(next);
			};
			const run = async (action) => {
				if (request.current) return;
				const controller = new AbortController();
				request.current = controller;
				setBusy(true);
				setError("");
				setNotice("");
				try {
					await action(controller.signal);
				} catch (cause) {
					if (controller.signal.aborted) return;
					if (cause instanceof HttpError && cause.status === 409) setConflict(true);
					setError(cause instanceof Error ? cause.message : "无法更新默认设置。");
				} finally {
					if (request.current === controller) {
						request.current = void 0;
						setBusy(false);
						setLoading(false);
					}
				}
			};
			const read = (mode) => run(async (signal) => {
				const latest = await readDefaults(appId, signal);
				if (signal.aborted) return;
				const previous = drafts.get(key);
				if (mode === "discard" || !previous) replace({
					base: latest,
					settings: latest.settings
				});
				else {
					const merged = {
						base: latest,
						settings: {
							...latest.settings,
							...changes$1(previous)
						}
					};
					if (mode === "restore" && Object.keys(changes$1(merged)).length && (latest.revision !== previous.base.revision || Object.keys(agentSettingsPatch(previous.base.settings, latest.settings)).length)) {
						setConflict(true);
						setError("默认设置已更新，草稿已保留。");
						return;
					}
					replace(merged);
					if (mode === "merge") setNotice("草稿已合并，请核对后保存。");
				}
				setConflict(false);
			});
			(0, react.useEffect)(() => {
				read("restore");
				return () => {
					request.current?.abort();
					request.current = void 0;
				};
			}, [key]);
			const save = (event) => {
				event.preventDefault();
				if (!draft || !dirty || conflict || loading) return;
				run(async (signal) => {
					const next = await fetchJson(WORKBENCH_DEFAULTS_PATH, {
						method: "POST",
						headers: { "content-type": "application/json" },
						signal,
						body: JSON.stringify({
							appId,
							revision: draft.base.revision,
							settings: draft.settings
						})
					});
					if (signal.aborted) return;
					replace({
						base: next,
						settings: next.settings
					});
					setNotice("默认设置已保存。");
				});
			};
			const change = (patch) => {
				const current = currentDraft.current;
				if (current) replace({
					...current,
					settings: {
						...current.settings,
						...patch
					}
				});
				setNotice("");
			};
			const fields = draft && {
				settings: draft.settings,
				disabled: busy || loading,
				onChange: change
			};
			return (0, react.createElement)("form", {
				className: "imqw-form imqw-defaults-form",
				onSubmit: save
			}, (0, react.createElement)("p", { className: "imqw-muted" }, "首次建立 QQ 群聊或私聊的配置时采用。"), fields ? (0, react.createElement)(SettingsGroup, {
				title: "Agent 设置",
				defaultOpen: true,
				children: (0, react.createElement)(WorkbenchAgentFields, {
					...fields,
					source
				})
			}) : null, fields ? (0, react.createElement)(SettingsGroup, {
				title: "QQ 回复",
				defaultOpen: true,
				children: (0, react.createElement)(WorkbenchReplyFields, fields)
			}) : null, error ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, error) : null, notice ? (0, react.createElement)("p", {
				className: "imqw-muted",
				role: "status"
			}, notice) : null, fields ? (0, react.createElement)("footer", { className: "imqw-actions imqw-savebar" }, conflict ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "outline",
				disabled: busy,
				onClick: () => {
					read("merge");
				}
			}, "合并草稿") : null, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "ghost",
				disabled: busy || !dirty && !conflict,
				onClick: () => {
					read("discard");
				}
			}, "撤销修改"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "submit",
				size: "sm",
				variant: "primary",
				disabled: busy || loading || !dirty || conflict
			}, busy ? "处理中…" : "保存")) : error ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "outline",
				onClick: () => {
					read("restore");
				}
			}, "重新读取") : (0, react.createElement)("p", {
				role: "status",
				className: "imqw-muted"
			}, "正在读取默认设置…"));
		}
		//#endregion
		//#region src/client/workbench.ts
		const lastNavigation = {
			collapsed: false,
			peerSettingsOpen: true,
			smallPage: "list"
		};
		const peerSelections = /* @__PURE__ */ new Map();
		const expandedPeers = /* @__PURE__ */ new Set();
		const showAllSessions = /* @__PURE__ */ new Set();
		const peerDrafts = /* @__PURE__ */ new Map();
		const sessionOrigins = /* @__PURE__ */ new Map();
		const filters = [
			{
				value: "all",
				label: "全部"
			},
			{
				value: "group",
				label: "群聊"
			},
			{
				value: "c2c",
				label: "私聊"
			}
		];
		const sessionPreviewLimit = 5;
		const timeFormat = new Intl.DateTimeFormat("zh-CN", {
			dateStyle: "medium",
			timeStyle: "short"
		});
		function conversationKey({ scope, openId }) {
			return scope + ":" + openId;
		}
		function scopedKey(appId, peer) {
			return JSON.stringify([
				appId,
				peer.scope,
				peer.openId
			]);
		}
		function hasQqSessionOrigin(sessionId) {
			return sessionOrigins.has(sessionId);
		}
		function restoreQqSessionOrigin(sessionId) {
			const origin = sessionOrigins.get(sessionId);
			if (!origin) return false;
			lastNavigation.appId = origin.appId;
			lastNavigation.smallPage = "conversation";
			peerSelections.set(origin.appId, origin.peerKey);
			return true;
		}
		function peerName(peer) {
			return peer.alias || peer.name || `${peer.scope === "group" ? "群聊" : "私聊"} ${peer.openId.slice(-8)}`;
		}
		function sessionDate(session) {
			const time = new Date(session.createdAt);
			return Number.isFinite(time.valueOf()) ? timeFormat.format(time) : "";
		}
		function workspaceName(cwd) {
			return cwd?.split(/[\\/]/).filter(Boolean).at(-1) || cwd || "";
		}
		function receivingLabel(robot, peer, archived = false) {
			if (!robot.enabled) return "机器人已停用";
			if (!peer.admitted) return "未获准接入";
			if (!peer.receiving) return "已暂停接收";
			if (robot.state !== "connected") return ROBOT_STATE_LABELS[robot.state];
			if (archived) return "当前 Session 已归档";
			return peer.currentSessionId ? "当前接收" : "等待首个 Session";
		}
		function accessLabel(robot, peer) {
			return {
				open: "所有人",
				allowlist: "白名单",
				disabled: "关闭"
			}[peer.scope === "group" ? robot.access.groupMode : robot.access.c2cMode];
		}
		function selectDraft(peer) {
			const { alias, receiving, recording, agent, revision, defaultsRevision } = peer;
			return {
				alias,
				receiving,
				recording,
				agent,
				baseline: {
					alias,
					receiving,
					recording,
					agent,
					revision,
					defaultsRevision
				}
			};
		}
		function changes(draft) {
			const agentChanged = draft.agent && draft.baseline.agent ? Object.keys(agentSettingsPatch(draft.baseline.agent, draft.agent)).length > 0 : draft.agent !== draft.baseline.agent;
			return {
				...draft.alias !== draft.baseline.alias ? { alias: draft.alias } : {},
				...draft.receiving !== draft.baseline.receiving ? { receiving: draft.receiving } : {},
				...draft.recording !== draft.baseline.recording ? { recording: draft.recording } : {},
				...agentChanged ? { agent: draft.agent } : {}
			};
		}
		function mergeDraft(peer, draft, edited) {
			const latest = selectDraft(peer);
			const next = {
				...latest,
				...edited
			};
			const { agent } = edited;
			const baseline = draft.baseline.agent;
			if (latest.agent && agent && baseline) next.agent = {
				...latest.agent,
				...agentSettingsPatch(baseline, agent)
			};
			return next;
		}
		function QQWorkbench({ extensions, settingsRequest, configFileAction, agentSource, ...sessionNavigation }) {
			const views = (0, react.useSyncExternalStore)(extensions.subscribe, extensions.getViews);
			const settingsSections = (0, react.useSyncExternalStore)(extensions.subscribe, extensions.getSettingsSections);
			const [nav, setNav] = (0, react.useState)(() => ({ ...lastNavigation }));
			const [robotView, setRobotView] = (0, react.useState)("conversation");
			const [robotPage, setRobotPage] = (0, react.useState)("account");
			const robotTabsId = (0, react.useId)();
			const layout = useWorkbenchLayout(nav.collapsed, robotView === "conversation", nav.peerSettingsOpen);
			const navigate = (patch) => {
				Object.assign(lastNavigation, patch);
				setNav({ ...lastNavigation });
			};
			const selectRobot = (appId) => {
				setRobotView("conversation");
				if (nav.appId === appId) return;
				navigate({
					appId,
					smallPage: "list"
				});
			};
			return (0, react.createElement)(RobotAccounts, {
				selectedAppId: nav.appId,
				onSelect: selectRobot,
				workbench: {
					collapsed: layout.iconsOnly,
					compact: layout.compact,
					onToggleCollapse: () => navigate({ collapsed: !nav.collapsed }),
					onAdd: () => setRobotView("add"),
					onCancelAdd: () => setRobotView("conversation"),
					settingsRequest,
					primaryBinding: robotView === "bind-primary",
					onBindPrimary: () => setRobotView("bind-primary"),
					onOpenSettings: (appId) => {
						if (nav.appId !== appId) navigate({ appId });
						setRobotPage("account");
						setRobotView("settings");
					},
					render: ({ robots, unavailable, rail, accountSettings, cancelAdd, busy }) => {
						const robot = robots?.find((candidate) => candidate.appId === nav.appId) ?? robots?.find((candidate) => candidate.primary) ?? robots?.[0];
						const primaryUnbound = !unavailable && (robots?.length === 0 || robotView === "bind-primary");
						const adding = robotView === "add";
						const editing = !unavailable && robotView === "settings" && robot !== void 0 && accountSettings !== null;
						const showRobotSettings = primaryUnbound || adding || editing;
						const settingsSubtitle = editing && robot ? `${accountName(robot)} · ${ROBOT_STATE_LABELS[robot.state]}` : primaryUnbound ? "主机器人 · 未绑定" : "新机器人 · 未绑定";
						const settingsBody = editing && robot ? (0, react.createElement)(react.Fragment, null, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.SegmentedControl, {
							id: robotTabsId,
							label: "机器人设置页面",
							value: robotPage,
							options: [{
								value: "account",
								label: "账号与权限"
							}, {
								value: "defaults",
								label: "新会话默认设置"
							}],
							onChange: setRobotPage
						}), (0, react.createElement)("div", {
							className: "imqw-robot-tab",
							role: "tabpanel",
							id: `${robotTabsId}-account-panel`,
							"aria-labelledby": `${robotTabsId}-account`,
							hidden: robotPage !== "account"
						}, accountSettings), (0, react.createElement)("div", {
							className: "imqw-robot-tab",
							role: "tabpanel",
							id: `${robotTabsId}-defaults-panel`,
							"aria-labelledby": `${robotTabsId}-defaults`,
							hidden: robotPage !== "defaults"
						}, (0, react.createElement)(WorkbenchDefaultsForm, {
							key: robotBindingKey(robot),
							appId: robot.appId,
							bindingRevision: robot.bindingRevision,
							source: agentSource
						}))) : primaryUnbound ? (0, react.createElement)(BindPanelBody) : accountSettings;
						return (0, react.createElement)("div", {
							className: "imqw-root",
							ref: layout.root
						}, (0, react.createElement)("style", null, WORKBENCH_STYLES), (0, react.createElement)("div", {
							className: "imqw-layout",
							"data-collapsed": layout.iconsOnly,
							"data-single-page": layout.singlePage,
							style: {
								"--imqw-rail": `${layout.railWidth}px`,
								"--imqw-tree": `${layout.treeWidth}px`,
								"--imqw-settings": `${layout.settingsWidth}px`
							}
						}, (0, react.createElement)("aside", {
							className: "imqw-robots",
							"aria-label": "机器人列表"
						}, rail), layout.divider("robots"), (0, react.createElement)("div", { className: "imqw-content" }, unavailable ? (0, react.createElement)("section", { className: "imqw-empty" }, (0, react.createElement)("p", { role: "status" }, "机器人服务暂不可用，正在重试…")) : robot ? (0, react.createElement)("div", {
							className: "imqw-conversation-grid",
							hidden: showRobotSettings,
							"data-settings": nav.peerSettingsOpen,
							"data-page": nav.smallPage
						}, (0, react.createElement)(RobotConversations, {
							key: robot.appId,
							robot,
							agentSource,
							views,
							settingsSections: showRobotSettings ? [] : settingsSections,
							settingsOpen: nav.peerSettingsOpen,
							settingsVisible: nav.peerSettingsOpen && (!layout.singlePage || nav.smallPage === "settings"),
							singlePage: layout.singlePage,
							...sessionNavigation,
							treeDivider: layout.divider("tree"),
							settingsDivider: layout.divider("settings"),
							onToggleSettings: (open) => navigate({
								peerSettingsOpen: open,
								smallPage: open ? "settings" : "conversation"
							}),
							onSmallPage: (page) => navigate({ smallPage: page })
						})) : showRobotSettings ? null : (0, react.createElement)("section", { className: "imqw-empty" }, (0, react.createElement)("p", { role: "status" }, rail ? "机器人列表暂不可用" : "正在读取机器人…")), showRobotSettings ? (0, react.createElement)("section", {
							className: "imqw-robot-settings",
							"aria-label": "机器人设置"
						}, (0, react.createElement)("div", { className: "imqw-robot-settings-inner" }, (0, react.createElement)("header", { className: "imqw-column-head imqw-robot-settings-head" }, (0, react.createElement)("div", null, (0, react.createElement)("h2", null, "机器人设置"), (0, react.createElement)("p", { className: "imqw-muted" }, settingsSubtitle)), (0, react.createElement)("div", { className: "imqw-actions" }, configFileAction, robot ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							size: "sm",
							variant: "outline",
							disabled: adding && busy,
							onClick: adding ? cancelAdd : () => setRobotView("conversation")
						}, "返回会话") : null)), settingsBody)) : null)));
					}
				}
			});
		}
		function RobotConversations({ robot, agentSource, views, settingsSections, settingsOpen, settingsVisible, singlePage, treeDivider, settingsDivider, openSession, prepareSession, restoreSession, archivedSessionIds, sessionTitle, workspaceTitle, onToggleSettings, onSmallPage }) {
			const { appId } = robot;
			const [openViewId, setOpenViewId] = (0, react.useState)();
			const selectedView = views.find((view) => view.id === openViewId);
			const activeView = selectedView ?? views.find((view) => view.id === "qq-history");
			const [viewRefreshKey, setViewRefreshKey] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				if (!selectedView) setOpenViewId(void 0);
			}, [selectedView]);
			const [peers, setPeers] = (0, react.useState)(null);
			const [selection, setSelection] = (0, react.useState)(() => peerSelections.get(appId));
			const [query, setQuery] = (0, react.useState)("");
			const [filter, setFilter] = (0, react.useState)("all");
			const [reload, setReload] = (0, react.useState)(0);
			const [loadError, setLoadError] = (0, react.useState)("");
			const [openError, setOpenError] = (0, react.useState)("");
			const [restoring, setRestoring] = (0, react.useState)();
			const [restoreError, setRestoreError] = (0, react.useState)();
			const [sessionNotice, setSessionNotice] = (0, react.useState)();
			const [newSession, setNewSession] = (0, react.useState)();
			const [createError, setCreateError] = (0, react.useState)("");
			const [unavailable, setUnavailable] = (0, react.useState)(false);
			const [busyKey, setBusyKey] = (0, react.useState)();
			const [feedback, setFeedback] = (0, react.useState)();
			const [, redraw] = (0, react.useState)(0);
			const mutation = (0, react.useRef)(null);
			const generation = (0, react.useRef)(0);
			const opening = (0, react.useRef)(0);
			const filterId = (0, react.useId)();
			const settingsId = (0, react.useId)();
			const settingsTrigger = (0, react.useRef)(null);
			const settingsClose = (0, react.useRef)(null);
			const moveFocus = (0, react.useRef)(false);
			(0, react.useLayoutEffect)(() => {
				if (!moveFocus.current) return;
				moveFocus.current = false;
				(settingsVisible ? settingsClose.current : settingsTrigger.current)?.focus({ preventScroll: true });
			}, [settingsVisible]);
			const toggleSettings = () => {
				moveFocus.current = singlePage;
				onToggleSettings(!settingsVisible);
			};
			const closeSettings = () => {
				moveFocus.current = true;
				onToggleSettings(false);
			};
			const closeButton = (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				ref: settingsClose,
				type: "button",
				size: "sm",
				variant: "ghost",
				"aria-label": "收起设置栏",
				onClick: closeSettings
			}, "收起");
			(0, react.useLayoutEffect)(() => () => {
				opening.current++;
			}, []);
			(0, react.useEffect)(() => () => {
				mutation.current?.abort();
			}, []);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				let timer;
				const read = async () => {
					const started = generation.current;
					const current = () => !controller.signal.aborted && !mutation.current && started === generation.current;
					try {
						const params = new URLSearchParams({ appId });
						const response = await fetchJson(`${WORKBENCH_CONVERSATIONS_PATH}?${params}`, {
							cache: "no-store",
							signal: controller.signal
						});
						if (!current()) return;
						setPeers(response.conversations);
						setUnavailable(false);
						setLoadError("");
					} catch (error) {
						if (!current()) return;
						if (error instanceof HttpError && error.status === 404) setUnavailable(true);
						else setLoadError(error instanceof Error ? error.message : "无法读取 QQ 会话");
					} finally {
						if (!controller.signal.aborted) timer = setTimeout(() => {
							read();
						}, 4e3);
					}
				};
				read();
				return () => {
					controller.abort();
					if (timer !== void 0) clearTimeout(timer);
				};
			}, [appId, reload]);
			const peer = peers?.find((item) => conversationKey(item) === selection) ?? peers?.[0];
			const peerKey = peer ? scopedKey(appId, peer) : void 0;
			const current = peer?.sessions.find((session) => session.id === peer.currentSessionId);
			const isArchived = (id) => id !== void 0 && archivedSessionIds?.includes(id) === true;
			const currentArchived = isArchived(current?.id);
			const label = peer ? receivingLabel(robot, peer, currentArchived) : "";
			const restoreCurrent = async () => {
				if (!current || !currentArchived || !restoreSession || restoring || mutation.current) return;
				setRestoreError(void 0);
				setRestoring(current.id);
				try {
					await restoreSession(current.id);
				} catch (error) {
					setRestoreError({
						id: current.id,
						message: error instanceof Error ? error.message : "无法恢复原会话。"
					});
				} finally {
					setRestoring(void 0);
				}
			};
			const save = async (target, draft) => {
				if (mutation.current) return;
				const key = scopedKey(appId, target);
				const controller = new AbortController();
				const patch = {
					appId,
					scope: target.scope,
					openId: target.openId,
					revision: draft.baseline.revision,
					defaultsRevision: draft.baseline.defaultsRevision,
					...changes(draft)
				};
				mutation.current = controller;
				generation.current++;
				setBusyKey(key);
				setFeedback(void 0);
				try {
					const result = await fetchJson(WORKBENCH_CONVERSATIONS_PATH, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(patch),
						signal: controller.signal
					});
					if (controller.signal.aborted) return;
					if (result.conversation.scope !== target.scope || result.conversation.openId !== target.openId) throw new Error("会话标识不一致，请刷新后重试。");
					peerDrafts.delete(key);
					setPeers((rows) => rows?.map((item) => conversationKey(item) === conversationKey(target) ? result.conversation : item) ?? null);
				} catch (error) {
					if (controller.signal.aborted) return;
					setFeedback({
						key,
						message: error instanceof Error ? error.message : "无法保存会话设置。"
					});
					if (error instanceof HttpError && error.status === 409) setReload((value) => value + 1);
				} finally {
					if (!controller.signal.aborted) {
						generation.current++;
						mutation.current = null;
						setBusyKey(void 0);
					}
				}
			};
			const createSession = async () => {
				if (!newSession || mutation.current) return;
				const { peer: target, settings } = newSession;
				const key = scopedKey(appId, target);
				const controller = new AbortController();
				const input = {
					appId,
					scope: target.scope,
					openId: target.openId,
					revision: target.revision,
					currentSessionId: target.currentSessionId ?? null,
					cwd: settings.cwd,
					preset: settings.preset
				};
				mutation.current = controller;
				generation.current++;
				setBusyKey(key);
				setCreateError("");
				try {
					const result = await fetchJson(WORKBENCH_NEW_SESSION_PATH, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(input),
						signal: controller.signal
					}, 3e4);
					if (controller.signal.aborted) return;
					if (typeof result.sessionId !== "string" || !result.sessionId) throw new Error("未能确认新 Session，请刷新会话列表。");
					expandedPeers.add(key);
					setNewSession(void 0);
					setSessionNotice({
						key,
						text: "新 Session 已创建。下一条 QQ 消息会进入这个 Session。"
					});
				} catch (error) {
					if (controller.signal.aborted) return;
					setCreateError(error instanceof Error ? error.message : "无法新建 QQ Session。");
				} finally {
					if (!controller.signal.aborted) {
						generation.current++;
						mutation.current = null;
						setBusyKey(void 0);
						setReload((value) => value + 1);
					}
				}
			};
			const openNewSession = () => {
				if (!peer?.agent) return;
				setCreateError("");
				setSessionNotice(void 0);
				setNewSession({
					peer,
					settings: peer.agent
				});
			};
			const openNative = async (id, from) => {
				if (!openSession) return false;
				const attempt = ++opening.current;
				setOpenError("");
				try {
					await prepareSession?.(id);
					if (attempt !== opening.current) return false;
					const previous = sessionOrigins.get(id);
					sessionOrigins.set(id, {
						appId,
						peerKey: conversationKey(from)
					});
					try {
						openSession(id);
					} catch (error) {
						if (previous) sessionOrigins.set(id, previous);
						else sessionOrigins.delete(id);
						throw error;
					}
					return true;
				} catch (error) {
					if (attempt === opening.current) setOpenError(error instanceof Error ? error.message : "无法打开原生 Session，请稍后重试。");
					return false;
				}
			};
			const selectPeer = (item) => {
				opening.current++;
				const key = conversationKey(item);
				peerSelections.set(appId, key);
				setSelection(key);
				setOpenError("");
				onSmallPage("conversation");
			};
			const visiblePeers = (peers ?? []).filter((item) => {
				const needle = query.trim().toLowerCase();
				return (filter === "all" || filter === item.scope) && [
					peerName(item),
					item.name,
					item.openId
				].some((value) => value.toLowerCase().includes(needle));
			});
			const sessionCaption = current && [
				sessionTitle?.(current.id),
				workspaceTitle?.(current.id, current.cwd) || workspaceName(current.cwd),
				current.preset
			].filter(Boolean).join(" · ");
			return (0, react.createElement)(react.Fragment, null, (0, react.createElement)("aside", {
				className: "imqw-tree",
				"aria-label": "QQ 会话列表"
			}, (0, react.createElement)("header", { className: "imqw-column-head" }, (0, react.createElement)("h2", null, "QQ 会话"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				variant: "ghost",
				size: "sm",
				className: "imqw-icon-action",
				"aria-label": "刷新会话列表",
				title: "刷新会话列表",
				onClick: () => setReload((value) => value + 1)
			}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 14 }))), (0, react.createElement)("p", { className: "imqw-muted imqw-tree-caption" }, accountName(robot)), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				type: "search",
				value: query,
				onChange: (event) => setQuery(event.currentTarget.value),
				placeholder: "搜索会话",
				"aria-label": "搜索 QQ 会话"
			}), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.SegmentedControl, {
				id: filterId,
				value: filter,
				options: filters,
				onChange: setFilter,
				label: "会话类型"
			}), loadError ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, loadError) : null, unavailable ? (0, react.createElement)("p", { className: "imqw-muted" }, "此宿主暂不提供 QQ 会话列表。") : null, !peers && !loadError && !unavailable ? (0, react.createElement)("p", {
				className: "imqw-muted",
				role: "status"
			}, "正在读取会话…") : null, peers && visiblePeers.length === 0 ? (0, react.createElement)("p", { className: "imqw-muted" }, peers.length ? "没有符合条件的会话。" : "暂无 QQ 会话。") : null, ...filters.filter((kind) => kind.value !== "all").map((kind) => {
				const group = visiblePeers.filter((item) => item.scope === kind.value);
				if (!group.length) return null;
				return (0, react.createElement)("section", {
					className: "imqw-group",
					key: kind.value,
					"aria-label": kind.label
				}, (0, react.createElement)("h3", { className: "imqw-muted" }, kind.label, (0, react.createElement)("span", null, group.length)), group.map((item) => {
					const key = scopedKey(appId, item);
					const expanded = expandedPeers.has(key);
					const history = item.sessions.filter((session) => session.id !== item.currentSessionId).sort((a, b) => b.createdAt - a.createdAt);
					const active = item.sessions.find((session) => session.id === item.currentSessionId);
					const ordered = active ? [active, ...history] : history;
					const showAll = showAllSessions.has(key);
					const list = showAll ? ordered : ordered.slice(0, sessionPreviewLimit);
					const hiddenCount = ordered.length - sessionPreviewLimit;
					return (0, react.createElement)("div", {
						className: "imqw-peer",
						key,
						"data-scope": item.scope,
						"data-selected": item === peer || void 0
					}, (0, react.createElement)("div", { className: "imqw-peer-row" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						size: "sm",
						className: "imqw-chevron",
						disabled: !item.sessions.length,
						"aria-expanded": expanded,
						"aria-label": `${expanded ? "收起" : "展开"} ${peerName(item)} 的 Session`,
						onClick: () => {
							if (expanded) expandedPeers.delete(key);
							else expandedPeers.add(key);
							redraw((value) => value + 1);
						}
					}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 14 })), (0, react.createElement)("button", {
						className: "imqw-peer-select",
						type: "button",
						"aria-pressed": item === peer,
						onClick: () => selectPeer(item)
					}, (0, react.createElement)("strong", { title: peerName(item) }, peerName(item)), (0, react.createElement)("span", { className: "imqw-muted" }, receivingLabel(robot, item, isArchived(item.currentSessionId))))), expanded ? (0, react.createElement)("ul", { className: "imqw-sessions" }, list.map((session) => {
						const activeSession = session.id === item.currentSessionId;
						const title = sessionTitle?.(session.id)?.trim() || `Session ${session.id.slice(-8)}`;
						return (0, react.createElement)("li", { key: session.id }, (0, react.createElement)("button", {
							className: "imqw-session",
							type: "button",
							"data-session-id": session.id,
							disabled: !openSession,
							onClick: () => openNative(session.id, item),
							title: session.cwd || title
						}, (0, react.createElement)("span", { className: "imqw-session-title" }, title), (0, react.createElement)("span", { className: "imqw-muted" }, [
							activeSession ? receivingLabel(robot, item, isArchived(session.id)) : isArchived(session.id) ? "已归档" : "历史",
							workspaceTitle?.(session.id, session.cwd) || workspaceName(session.cwd),
							sessionDate(session)
						].filter(Boolean).join(" · "))));
					}), hiddenCount > 0 ? (0, react.createElement)("li", null, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						size: "sm",
						variant: "ghost",
						onClick: () => {
							if (showAllSessions.has(key)) showAllSessions.delete(key);
							else showAllSessions.add(key);
							redraw((value) => value + 1);
						}
					}, showAll ? "收起历史" : `另有 ${hiddenCount} 个 Session`)) : null) : null);
				}));
			})), treeDivider, (0, react.createElement)("section", {
				className: "imqw-conversation",
				"aria-label": "当前 QQ 会话"
			}, (0, react.createElement)("header", { className: "imqw-column-head imqw-main-head" }, (0, react.createElement)("div", { className: "imqw-main-title" }, (0, react.createElement)("h2", { title: peer && peerName(peer) }, peer ? peerName(peer) : accountName(robot)), (0, react.createElement)("p", { className: "imqw-muted" }, peer ? `${peer.scope === "group" ? "群聊" : "私聊"} · ${label}` : "请从会话列表选择对话")), (0, react.createElement)("div", { className: "imqw-actions" }, peer ? views.filter((view) => view.id !== QQ_HISTORY_VIEW_ID).map((view) => (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				key: view.id,
				type: "button",
				size: "sm",
				variant: "outline",
				"aria-expanded": activeView === view,
				onClick: () => setOpenViewId(activeView === view ? void 0 : view.id)
			}, `${activeView === view ? "收起" : "查看"} ${view.title}`)) : null, peer ? (0, react.createElement)(react.Fragment, null, currentArchived ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "outline",
				disabled: !restoreSession || !!busyKey || !!restoring,
				onClick: () => {
					restoreCurrent();
				}
			}, restoring === current?.id ? "恢复中…" : "恢复当前 Session") : (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "outline",
				disabled: !current || !openSession,
				title: current ? sessionCaption || "打开当前 Session" : "尚未创建 Session",
				onClick: () => {
					if (current) openNative(current.id, peer);
				}
			}, "当前 Session"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "outline",
				onClick: openNewSession,
				disabled: !peer.agent || !peer.admitted || !peer.receiving || !robot.enabled || robot.state !== "connected" || !!busyKey || !!restoring
			}, "新建 Session"), activeView?.refreshable ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "ghost",
				className: "imqw-icon-action",
				"aria-label": "刷新消息",
				title: "刷新消息",
				onClick: () => setViewRefreshKey((value) => value + 1)
			}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 14 })) : null, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				ref: settingsTrigger,
				size: "sm",
				variant: "outline",
				className: "imqw-icon-action imqw-settings-trigger",
				"aria-controls": settingsId,
				"aria-label": "会话设置",
				title: "会话设置",
				"aria-expanded": settingsVisible,
				onClick: toggleSettings
			}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconSettingsOutlineRegular, { size: 14 }))) : null)), currentArchived ? (0, react.createElement)("p", {
				className: "imqw-muted",
				role: "status"
			}, restoreSession ? "恢复原会话可继续原有上下文。也可以新建 Session 接收后续消息。" : "请在 DSH 工作区取消归档，或新建 Session 接收后续消息。") : null, current && restoreError?.id === current.id ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, restoreError.message) : null, openError ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, openError) : null, sessionNotice && sessionNotice.key === peerKey ? (0, react.createElement)("p", {
				className: "imqw-muted",
				role: "status"
			}, sessionNotice.text) : null, peer && activeView ? (0, react.createElement)(activeView.component, {
				key: `${activeView.id}:${peerKey}`,
				appId,
				peer,
				robotName: accountName(robot),
				openSession: openSession && ((id) => openNative(id, peer)),
				refreshKey: activeView.refreshable ? viewRefreshKey : void 0,
				disabledReason: !robot.enabled || robot.state !== "connected" ? "机器人未连接" : !peer.admitted ? "此会话未获准接入" : !peer.receiving ? "此会话已暂停" : void 0
			}) : null), settingsDivider, (0, react.createElement)("aside", {
				id: settingsId,
				className: "imqw-settings",
				"aria-label": "会话设置",
				hidden: !settingsOpen
			}, peer && peerKey ? (0, react.createElement)(react.Fragment, null, (0, react.createElement)(ConversationSettings, {
				key: peerKey,
				robot,
				peer,
				agentSource,
				closeButton,
				archived: currentArchived,
				workspace: current && workspaceTitle?.(current.id, current.cwd),
				draft: peerDrafts.get(peerKey) ?? selectDraft(peer),
				openCurrent: current && !currentArchived && openSession ? () => openNative(current.id, peer) : void 0,
				busy: busyKey === peerKey,
				feedback: feedback?.key === peerKey ? feedback : void 0,
				onEdit: (draft) => {
					if (Object.keys(changes(draft)).length > 0) peerDrafts.set(peerKey, draft);
					else peerDrafts.delete(peerKey);
					redraw((value) => value + 1);
					setFeedback(void 0);
				},
				onSave: (draft) => {
					save(peer, draft);
				}
			}), settingsVisible ? settingsSections.map((section) => (0, react.createElement)(ExtensionSettingsGroup, {
				key: `${peerKey}:${section.id}`,
				section,
				appId,
				scope: peer.scope,
				openId: peer.openId
			})) : null) : (0, react.createElement)(react.Fragment, null, (0, react.createElement)("header", { className: "imqw-column-head" }, (0, react.createElement)("h2", null, "会话设置"), closeButton), (0, react.createElement)("p", { className: "imqw-muted" }, "选择群聊或联系人后可以编辑。"))), newSession ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				title: "新建 QQ Session",
				closeLabel: "关闭",
				description: `${accountName(robot)} · ${peerName(newSession.peer)}。创建成功后，QQ 新消息会进入新 Session，原有记录可从历史打开。`,
				onClose: () => {
					if (!mutation.current) setNewSession(void 0);
				},
				footer: (0, react.createElement)(react.Fragment, null, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					type: "button",
					variant: "ghost",
					disabled: !!busyKey,
					onClick: () => setNewSession(void 0)
				}, "取消"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					type: "button",
					variant: "primary",
					disabled: !!busyKey,
					onClick: () => {
						createSession();
					}
				}, busyKey ? "正在创建…" : "创建并切换"))
			}, (0, react.createElement)(WorkbenchAgentFields, {
				source: agentSource,
				settings: newSession.settings,
				disabled: !!busyKey,
				placementOnly: true,
				onChange: (patch) => setNewSession((current) => current && {
					...current,
					settings: {
						...current.settings,
						...patch
					}
				})
			}), createError ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, createError) : null) : null, (0, react.createElement)("nav", {
				className: "imqw-small-nav",
				"aria-label": "工作台页面"
			}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				onClick: () => onSmallPage("list")
			}, "会话列表"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				onClick: () => onSmallPage("conversation")
			}, "会话"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				size: "sm",
				disabled: !peer,
				className: "imqw-settings-trigger",
				"aria-controls": settingsId,
				"aria-expanded": settingsVisible,
				onClick: toggleSettings
			}, "会话设置")));
		}
		function ExtensionSettingsGroup({ section, appId, scope, openId }) {
			const [opened, setOpened] = (0, react.useState)(false);
			const [props] = (0, react.useState)(() => extensionSettingsProps(section.id, {
				appId,
				scope,
				openId
			}));
			return (0, react.createElement)("details", {
				className: "imqw-settings-group imqw-extension-settings",
				onToggle: (event) => {
					if (event.currentTarget.open) setOpened(true);
				}
			}, (0, react.createElement)("summary", null, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineRegular, { size: 14 }), (0, react.createElement)("strong", null, section.title)), opened ? (0, react.createElement)("div", { className: "imqw-settings-group-body" }, (0, react.createElement)(section.component, props)) : null);
		}
		const groupPermissionGuide = [{
			title: "获取群内全部消息",
			description: "在「机器人可获取的群聊消息范围」中选择此项，工作台才能接收普通群消息。是否记录消息和是否仅在 @ 时回复由 DSH 设置决定。",
			image: WORKBENCH_GROUP_GUIDE_IMAGES["message-scope.png"]
		}, {
			title: "机器人主动在群聊内发言",
			description: "开启后，工作台可在没有可用回复凭据时主动发言。网页回答的自动推送仍由机器人的主动推送配置决定。",
			image: WORKBENCH_GROUP_GUIDE_IMAGES["proactive.png"]
		}];
		function GroupPermissionGuide() {
			const [preview, setPreview] = (0, react.useState)();
			return (0, react.createElement)(SettingsGroup, {
				title: "QQ 群权限",
				hint: "在手机 QQ 设置",
				children: (0, react.createElement)(react.Fragment, null, (0, react.createElement)("p", { className: "imqw-muted" }, "请群主在手机 QQ 的群聊中打开机器人的设置。"), groupPermissionGuide.map((item) => (0, react.createElement)("div", { key: item.image }, (0, react.createElement)("div", { className: "imqw-group-guide-heading" }, (0, react.createElement)("strong", null, item.title), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					type: "button",
					size: "sm",
					variant: "ghost",
					"aria-haspopup": "dialog",
					"aria-label": `看图：${item.title}`,
					onClick: () => setPreview(item)
				}, "看图")), (0, react.createElement)("p", { className: "imqw-muted" }, item.description))), preview ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
					open: true,
					title: preview.title,
					closeLabel: "关闭",
					onClose: () => setPreview(void 0),
					className: "imqw-group-guide-dialog",
					contentClassName: "imqw-group-guide-scroll"
				}, (0, react.createElement)("img", {
					className: "imqw-group-guide-image",
					src: preview.image,
					alt: `手机 QQ 设置截图：${preview.title}`
				})) : null)
			});
		}
		function ConversationSettings({ robot, peer, agentSource, closeButton, archived, workspace, openCurrent, draft, busy, feedback, onEdit, onSave }) {
			const [adoptError, setAdoptError] = (0, react.useState)("");
			const [reading, setReading] = (0, react.useState)(false);
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const edited = changes(draft);
			const dirty = Object.keys(edited).length > 0;
			const stale = dirty && (draft.baseline.revision !== peer.revision || draft.baseline.defaultsRevision !== peer.defaultsRevision);
			const current = peer.sessions.find((session) => session.id === peer.currentSessionId);
			const agent = draft.agent;
			const disabled = busy || reading;
			const fields = agent ? {
				settings: agent,
				disabled,
				onChange: (patch) => onEdit({
					...draft,
					agent: {
						...agent,
						...patch
					}
				})
			} : void 0;
			const adopt = async () => {
				setReading(true);
				setAdoptError("");
				try {
					const { settings } = await readDefaults(robot.appId);
					if (!agent) return;
					onEdit({
						...draft,
						agent: {
							...settings,
							...peer.scope === "group" ? {
								directPrompt: agent.directPrompt,
								streaming: agent.streaming
							} : { groupPrompt: agent.groupPrompt }
						}
					});
				} catch (error) {
					setAdoptError(error instanceof Error ? error.message : "无法读取机器人默认设置。");
				} finally {
					setReading(false);
				}
			};
			return (0, react.createElement)("form", {
				className: "imqw-form",
				onSubmit: (event) => {
					event.preventDefault();
					if (dirty && !stale && !busy && !reading) onSave(draft);
				}
			}, (0, react.createElement)("header", { className: "imqw-column-head" }, (0, react.createElement)("div", null, (0, react.createElement)("h2", null, "会话设置"), (0, react.createElement)("p", {
				className: "imqw-muted",
				title: peerName(peer)
			}, peerName(peer))), (0, react.createElement)("div", { className: "imqw-actions" }, agent ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
				open: menuOpen,
				onClose: () => setMenuOpen(false),
				portal: true,
				autoFocus: true,
				items: [{
					id: "adopt-defaults",
					label: "采用机器人当前默认值",
					disabled
				}],
				onSelect: () => {
					setMenuOpen(false);
					if (!disabled) adopt();
				},
				anchor: (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					type: "button",
					size: "sm",
					variant: "ghost",
					disabled,
					"aria-label": "更多会话设置",
					"aria-haspopup": "menu",
					"aria-expanded": menuOpen,
					onClick: () => setMenuOpen((open) => !open)
				}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconEllipsisOutlineRegular, { size: 16 }))
			}) : null, closeButton)), (0, react.createElement)(SettingsGroup, {
				title: "概览与接收",
				defaultOpen: true,
				children: (0, react.createElement)(react.Fragment, null, (0, react.createElement)("label", { className: "imqw-field" }, (0, react.createElement)("span", null, "会话备注"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
					value: draft.alias,
					maxLength: 120,
					placeholder: peer.name || "未设置备注",
					disabled,
					onChange: (event) => onEdit({
						...draft,
						alias: event.currentTarget.value
					})
				})), (0, react.createElement)("div", { className: "imqw-receiving" }, (0, react.createElement)("span", null, "接收 QQ 消息"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
					checked: draft.receiving,
					label: "接收 QQ 消息",
					disabled,
					onChange: (receiving) => onEdit({
						...draft,
						receiving
					})
				})), !peer.admitted ? (0, react.createElement)("p", { className: "imqw-muted" }, "此对话未获机器人接入许可。") : null, (0, react.createElement)("details", { className: "imqw-settings-meta" }, (0, react.createElement)("summary", null, "对话详情"), (0, react.createElement)("dl", { className: "imqw-details" }, (0, react.createElement)("dt", null, "接入规则"), (0, react.createElement)("dd", null, accessLabel(robot, peer)), (0, react.createElement)("dt", null, "OpenID"), (0, react.createElement)("dd", null, (0, react.createElement)("code", null, peer.openId)))))
			}), peer.scope === "group" ? (0, react.createElement)(GroupPermissionGuide) : null, fields ? (0, react.createElement)(react.Fragment, null, (0, react.createElement)(SettingsGroup, {
				title: "Agent 设置",
				hint: "当前与新建",
				children: (0, react.createElement)(WorkbenchAgentFields, {
					...fields,
					source: agentSource,
					conversationDefaults: true,
					currentSession: current ? {
						id: current.id,
						archived,
						open: openCurrent,
						placement: [workspace || workspaceName(current.cwd), current.preset].filter(Boolean).join(" · ")
					} : void 0
				})
			}), (0, react.createElement)(SettingsGroup, {
				title: "QQ 回复",
				hint: "当前 Session 也适用",
				children: (0, react.createElement)(WorkbenchReplyFields, {
					...fields,
					scope: peer.scope
				})
			})) : null, (0, react.createElement)(SettingsGroup, {
				title: "消息记录",
				children: (0, react.createElement)("div", { className: "imqw-receiving" }, (0, react.createElement)("div", null, (0, react.createElement)("span", null, "保存 QQ 消息"), !draft.recording ? (0, react.createElement)("p", { className: "imqw-muted" }, "已有记录保留。") : null), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
					checked: draft.recording,
					label: "保存 QQ 消息",
					disabled,
					onChange: (recording) => onEdit({
						...draft,
						recording
					})
				}))
			}), reading ? (0, react.createElement)("p", {
				className: "imqw-muted",
				role: "status"
			}, "正在读取默认值…") : null, adoptError ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, adoptError) : null, stale ? (0, react.createElement)("div", { className: "imqw-conflict" }, (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, "会话设置已更新。请确认是否将草稿中的改动合并到最新设置。"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "outline",
				disabled,
				onClick: () => onEdit(mergeDraft(peer, draft, edited))
			}, "合并草稿")) : null, feedback ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, feedback.message) : null, (0, react.createElement)("footer", { className: "imqw-actions imqw-savebar" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "ghost",
				disabled: disabled || !dirty,
				onClick: () => onEdit(selectDraft(peer))
			}, "撤销修改"), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "submit",
				size: "sm",
				variant: "primary",
				disabled: disabled || !dirty || stale
			}, busy ? "保存中…" : "保存")));
		}
		//#endregion
		//#region src/shared/workbench-answer-protocol.ts
		const WORKBENCH_ANSWER_PATH = "/api/qqbot/workbench/answer";
		//#endregion
		//#region src/client/workbench-answer.ts
		const availability = /* @__PURE__ */ new Map();
		function hasDestination(sessionId) {
			const cached = availability.get(sessionId);
			if (cached && cached.expires > Date.now()) return cached.request;
			const query = new URLSearchParams({ sessionId });
			const request = fetchJson(`${WORKBENCH_ANSWER_PATH}?${query}`).then((result) => result.available, () => false);
			availability.delete(sessionId);
			availability.set(sessionId, {
				expires: Date.now() + 15e3,
				request
			});
			if (availability.size > 64) availability.delete(availability.keys().next().value);
			return request;
		}
		function receiptLabel(receipt) {
			switch (receipt.status) {
				case "accepted": return "QQ 接口已接受。";
				case "sending": return "正在等待 QQ 回执。";
				case "unknown": return "发送结果未知，请在 QQ 核对。";
				case "rejected": {
					const codes = [receipt.httpStatus && `HTTP ${receipt.httpStatus}`, receipt.platformCode && `QQ ${receipt.platformCode}`].filter(Boolean);
					return `消息未发送${codes.length ? `（${codes.join(" · ")}）` : ""}。`;
				}
			}
		}
		function QqAnswerAction({ sessionId, messageId }) {
			const [visibleFor, setVisibleFor] = (0, react.useState)();
			const [open, setOpen] = (0, react.useState)(false);
			const [preview, setPreview] = (0, react.useState)();
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)("");
			const pending = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				let active = true;
				hasDestination(sessionId).then((available) => {
					if (active && available) setVisibleFor(sessionId);
				});
				return () => {
					active = false;
				};
			}, [sessionId]);
			const run = async (confirm) => {
				if (pending.current) return;
				pending.current = true;
				setBusy(true);
				setError("");
				try {
					if (confirm) {
						const receipt = await fetchJson(WORKBENCH_ANSWER_PATH, {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({
								sessionId,
								messageId,
								confirmation: confirm.confirmation
							})
						}, 25e3);
						setPreview({
							...confirm,
							receipt
						});
					} else {
						const query = new URLSearchParams({
							sessionId,
							messageId
						});
						setPreview(await fetchJson(`${WORKBENCH_ANSWER_PATH}?${query}`));
					}
				} catch (cause) {
					if (!confirm) setPreview(void 0);
					setError(confirm && !(cause instanceof HttpError && cause.status < 500) ? "暂未取得发送回执，请查询状态。" : cause instanceof Error ? cause.message : "暂时无法取得 QQ 发送结果。");
				} finally {
					pending.current = false;
					setBusy(false);
				}
			};
			const close = () => {
				if (pending.current) return;
				setOpen(false);
				setPreview(void 0);
				setError("");
			};
			if (visibleFor !== sessionId) return null;
			const receipt = preview?.receipt;
			const refresh = !!error || receipt?.status === "sending" || receipt?.status === "unknown";
			return (0, react.createElement)("span", null, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				variant: "toolbar",
				size: "sm",
				onClick: () => {
					setOpen(true);
					run();
				}
			}, "发送到 QQ"), open ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open,
				title: "发送到 QQ",
				closeLabel: "关闭",
				onClose: close,
				description: "请核对机器人、接收方和正文。",
				footer: (0, react.createElement)("div", { className: "imqb-row" }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					type: "button",
					variant: "ghost",
					disabled: busy,
					onClick: close
				}, receipt ? "完成" : "取消"), refresh ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					type: "button",
					variant: "outline",
					disabled: busy,
					onClick: () => {
						run();
					}
				}, "查询发送状态") : preview && !receipt ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					type: "button",
					variant: "primary",
					disabled: busy || !!preview.blockedReason,
					onClick: () => {
						run(preview);
					}
				}, busy ? "正在发送…" : "确认发送") : null)
			}, preview ? (0, react.createElement)("div", { className: "imqb-answer" }, (0, react.createElement)("dl", null, (0, react.createElement)("dt", null, "机器人"), (0, react.createElement)("dd", null, preview.robotName, (0, react.createElement)("small", null, `AppID ${preview.appId}`)), (0, react.createElement)("dt", null, "接收方"), (0, react.createElement)("dd", null, preview.peerName, (0, react.createElement)("small", null, preview.scope === "group" ? "QQ 群聊" : "QQ 私聊"))), (0, react.createElement)("div", {
				className: "imqb-answer-text",
				role: "region",
				"aria-label": "待发送正文",
				tabIndex: 0
			}, preview.text), preview.automaticWebReplies && !receipt ? (0, react.createElement)("small", null, "此对话允许网页回答自动推送。若 QQ 已有这条回答，手动发送会再发一条。") : null, !preview.recording ? (0, react.createElement)("small", null, "此对话已关闭消息保存，发送结果在此查看。") : null, preview.blockedReason && !receipt ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, preview.blockedReason) : null, receipt ? (0, react.createElement)("p", { role: "status" }, receiptLabel(receipt)) : null) : busy ? (0, react.createElement)("p", { role: "status" }, "正在读取回答…") : null, error ? (0, react.createElement)("p", {
				className: "imqb-error",
				role: "alert"
			}, error) : null) : null);
		}
		//#endregion
		//#region src/client/index.ts
		const name = "im-qqbot-client";
		const inject = ["slots"];
		/** 本插件包名（插件详情页按其匹配来源包，只在对应详情页渲染操作按钮） */
		const PACKAGE_NAME = "@tencent-connect/dsh-qqbot";
		/** 主面板 id（layout.selectPanel 导航目标；keyed main 席位按其分发） */
		const IM_MAIN_PANEL_ID = "im-qqbot";
		const emptyArchived = [];
		const noop = () => {};
		function OpenProfileConfig({ remote }) {
			const [available, setAvailable] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(false);
			const [opening, setOpening] = (0, react.useState)(false);
			const inFlight = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				let active = true;
				setAvailable(false);
				setError(false);
				remote?.describe().then((result) => {
					if (active) setAvailable(result.ok && result.value?.hasDocument === true);
				}).catch(() => {});
				return () => {
					active = false;
				};
			}, [remote]);
			if (!available || !remote) return null;
			const open = async () => {
				if (inFlight.current) return;
				inFlight.current = true;
				setOpening(true);
				setError(false);
				try {
					const result = await remote.openSettingsDocument();
					setError(!result.ok);
				} catch {
					setError(true);
				} finally {
					inFlight.current = false;
					setOpening(false);
				}
			};
			return (0, react.createElement)("div", { className: "imqw-actions" }, error ? (0, react.createElement)("span", {
				className: "imqb-error",
				role: "alert"
			}, "无法打开配置文件。") : null, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				type: "button",
				size: "sm",
				variant: "outline",
				disabled: opening,
				title: "打开当前 DSH 配置的 cordis.patch.yml",
				onClick: () => {
					open();
				}
			}, "打开配置文件"));
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
			const extensions = new WorkbenchExtensions();
			ctx.provide("qqbotWorkbench", extensions);
			installPanelStyles();
			const slots = ctx.slots;
			const disposers = [];
			if (slots) {
				const slot = "conversation.chat.assistant-actions";
				disposers.push(slots.inject(slot, () => slots.register({
					name: slot,
					id: "im-qqbot-send-answer",
					order: 30
				}, QqAnswerAction)));
			}
			const ctxInject = ctx.inject;
			if (typeof ctxInject === "function") {
				ctxInject.call(ctx, ["sidebarRight"], (scope) => {
					const sidebar = scope.get("sidebarRight");
					if (!sidebar?.openTabs || !sidebar.closeIn) return void 0;
					const { openTabs } = sidebar;
					const close = sidebar.closeIn.bind(sidebar);
					let stopped = false;
					let scheduled = false;
					const removeOldTabs = () => {
						if (scheduled || stopped) return;
						scheduled = true;
						queueMicrotask(() => {
							if (!stopped) {
								for (const tab of openTabs.getSnapshot()) if (tab.kind === "qqbot-bind") close(tab.sessionId, tab.tabId);
							}
							scheduled = false;
						});
					};
					const unsubscribe = openTabs.subscribe(removeOldTabs);
					removeOldTabs();
					return () => {
						stopped = true;
						unsubscribe();
					};
				});
				ctxInject.call(ctx, ["layout"], (pageCtx) => {
					const pageSlots = pageCtx.slots;
					const layout = pageCtx.layout;
					if (pageSlots === void 0 || layout === void 0) return void 0;
					const settingsListeners = /* @__PURE__ */ new Set();
					let settingsPending = false;
					let profileSettings;
					const emitSettings = () => {
						for (const listener of settingsListeners) listener();
					};
					const subscribeSettings = (listener) => {
						settingsListeners.add(listener);
						return () => {
							settingsListeners.delete(listener);
						};
					};
					const dismissSettingsRequest = () => {
						settingsPending = false;
						emitSettings();
					};
					const openRobotSettings = () => {
						layout.selectPanel(IM_MAIN_PANEL_ID);
						settingsPending = true;
						emitSettings();
					};
					ctxInject.call(pageCtx, ["remote", "remote.settings"], (scope) => {
						const { remote } = scope;
						if (!remote.$host?.isLoopback) return void 0;
						profileSettings = remote.settings;
						emitSettings();
						return () => {
							profileSettings = void 0;
							emitSettings();
						};
					});
					let remote;
					ctxInject.call(pageCtx, [
						"remote",
						"remote.session",
						"remote.agentPresets",
						"remote.permissionPresets"
					], (scope) => {
						remote = scope.remote;
						return () => {
							remote = void 0;
						};
					});
					let addWorkspace;
					ctxInject.call(pageCtx, ["workspaces", "uiWorkspace"], (scope) => {
						const { workspaces, uiWorkspace } = scope;
						if (!uiWorkspace.pickDirectory || !workspaces.create) return void 0;
						const pickDirectory = uiWorkspace.pickDirectory.bind(uiWorkspace);
						const createWorkspace = workspaces.create.bind(workspaces);
						addWorkspace = async () => {
							const path = await pickDirectory();
							if (!path) return null;
							return (await createWorkspace({ path })).path;
						};
						return () => {
							addWorkspace = void 0;
						};
					});
					let hostLocale;
					ctxInject.call(pageCtx, ["locale"], (scope) => {
						hostLocale = scope.locale;
						return () => {
							hostLocale = void 0;
						};
					});
					const hostLabel = (namespace, key) => {
						const label = hostLocale?.bind(namespace)(key);
						return label && label !== key && label !== `${namespace}.${key}` ? label : void 0;
					};
					const sessionService = () => pageCtx.get("sessions");
					const sessionModels = {
						subscribe: (listener) => sessionService()?.list?.subscribe(listener) ?? noop,
						read: (id) => sessionService()?.list?.getSnapshot().projectionsBySession?.[id]?.values.modelSelection,
						refresh: (id) => sessionService()?.refreshProjections?.(id)
					};
					const presetNameKeys = /* @__PURE__ */ new Map([
						["standard", "presetStandardName"],
						["ptc", "presetPtcName"],
						["minimal", "presetMinimalName"],
						["cordis", "presetCordisName"]
					]);
					const permissionLabels = /* @__PURE__ */ new Map([
						["read-only", {
							key: "preset.readOnly",
							nativeName: "Read Only"
						}],
						["workspace-write", {
							key: "preset.workspaceWrite",
							nativeName: "Workspace Write"
						}],
						["danger-full-access", {
							key: "preset.fullAccess",
							nativeName: "Full access"
						}],
						["auto", {
							key: "auto.label",
							nativeName: "Auto review"
						}]
					]);
					const getRemote = () => {
						if (!remote) throw new Error("DSH 目录服务尚未就绪。");
						return remote;
					};
					const agentSource = {
						sessionModels,
						modelCatalog: () => getRemote().session.modelCatalog(),
						listAgentPresets: () => getRemote().agentPresets.list(),
						permissionCatalog: () => getRemote().permissionPresets.catalog(),
						localizePreset: (id) => {
							const key = presetNameKeys.get(id);
							return key && hostLabel("settings.agentPreset", key);
						},
						localizePermission: (id, name) => {
							const builtin = permissionLabels.get(id);
							return builtin && (id === name || name === builtin.nativeName) ? hostLabel("permission.access", builtin.key) : void 0;
						},
						get addWorkspace() {
							return addWorkspace;
						},
						workspaces: () => pageCtx.get("workspaces")?.list?.getSnapshot().items ?? []
					};
					const QQBotPage = () => {
						const openSettings = (0, react.useSyncExternalStore)(subscribeSettings, () => settingsPending);
						const documentRemote = (0, react.useSyncExternalStore)(subscribeSettings, () => profileSettings);
						const workspace = pageCtx.get("uiWorkspace");
						const sessions = sessionService();
						const workspaces = pageCtx.get("workspaces");
						const open = workspace?.openSession?.bind(workspace);
						const list = workspaces?.list;
						const archivedSessionIds = (0, react.useSyncExternalStore)((0, react.useCallback)((listener) => list?.subscribe?.(listener) ?? noop, [list]), () => list?.getSnapshot().archivedSessionIds ?? emptyArchived);
						return (0, react.createElement)(QQWorkbench, {
							extensions,
							settingsRequest: openSettings ? dismissSettingsRequest : void 0,
							configFileAction: (0, react.createElement)(OpenProfileConfig, { remote: documentRemote }),
							agentSource,
							archivedSessionIds,
							restoreSession: workspace?.unarchiveSession?.bind(workspace),
							prepareSession: (id) => {
								const service = sessionService();
								return service?.list?.getSnapshot().byId[id] ? void 0 : service?.refresh?.();
							},
							openSession: open ? (id) => {
								if (workspaces?.list?.getSnapshot().archivedSessionIds?.includes(id)) throw new Error("这个 Session 已归档，请先在 DSH 工作区取消归档。");
								open(id);
							} : void 0,
							sessionTitle: (id) => sessions?.list?.getSnapshot().byId[id]?.title,
							workspaceTitle: (id, cwd) => {
								const items = workspaces?.list?.getSnapshot().items;
								return items?.find((item) => item.sessionIds.includes(id))?.title ?? items?.find((item) => item.path === cwd)?.title;
							}
						});
					};
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
							onOpen: openRobotSettings
						})
					}, OpenQqBotAction));
					const ReturnToQq = ({ sessionId }) => hasQqSessionOrigin(sessionId) ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						type: "button",
						variant: "toolbar",
						size: "sm",
						onClick: () => {
							if (restoreQqSessionOrigin(sessionId)) layout.selectPanel(IM_MAIN_PANEL_ID);
						}
					}, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.IconChevronLeftOutlineRegular, { size: 14 }), "返回 QQ 对话") : null;
					const stopReturn = ["conversation.session.header.utilities", "conversation.hero.options"].map((slot) => pageSlots.inject(slot, () => pageSlots.register({
						name: slot,
						id: "im-qqbot-return",
						order: 10
					}, ReturnToQq)));
					const stopSidebar = pageSlots.inject("sidebar.panellist", () => pageSlots.register({
						name: "sidebar.panellist",
						id: IM_MAIN_PANEL_ID,
						order: 10,
						label: "QQ 机器人"
					}, QqBotSidebarIcon));
					return () => {
						for (const stop of stopReturn) stop();
						stopActions();
						stopSidebar();
						stopMain();
					};
				});
			}
			ctx.effect(() => () => {
				for (const dispose of disposers.reverse()) dispose();
			}, "im-qqbot-client.slots");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map